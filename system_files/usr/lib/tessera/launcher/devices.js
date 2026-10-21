// SPDX-License-Identifier: GPL-3.0-or-later
// Sound, Bluetooth and Wi-Fi for Settings. Main process only.
//
// Everything here talks to the system through its normal command line tools (pactl, bluetoothctl,
// nmcli), started WITHOUT a shell, with the arguments in a list. The page never sends a command: it
// sends an operation name and, at most, an id that must match something the tool itself just listed
// (a sound device name, a Bluetooth address, a network name) or a value that is checked here.
// None of these need root: the logged-in person at the console is allowed to use them.
//
// Pieces that take a while (pairing, joining a network) are "jobs": started with one call, then
// followed with poll() calls, so nothing sits inside one long call and it can be cancelled.
'use strict';

const { execFile, spawn } = require('child_process');

// ------------------------------------------------------------------ helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONTROL = /[\x00-\x1f\x7f]/g;
const HAS_CONTROL = /[\x00-\x1f\x7f]/; // not global: a global regex remembers where it stopped
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const shortText = (v, n) => (typeof v === 'string' ? v.replace(CONTROL, ' ').trim().slice(0, n) : '');
const cleanLines = (text) => String(text).replace(ANSI, '').split(/[\r\n]+/).map((l) => l.replace(CONTROL, ' ').trim()).filter(Boolean);
const lastLine = (text) => (cleanLines(text).pop() || '').slice(0, 160);

// Runs a tool and always resolves. `missing` means the program is not installed at all.
function run(cmd, args, { timeout = 8000, input, onChild } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', NO_COLOR: '1' } }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
        missing: Boolean(err && err.code === 'ENOENT'),
        timedOut: Boolean(err && err.killed),
        out: String(stdout || ''),
        err: String(stderr || ''),
      });
    });
    if (onChild) onChild(child);
    if (input !== undefined && child.stdin) { try { child.stdin.end(input); } catch { /* it exited already */ } }
  });
}

// A job that runs in the background and is followed with poll().
function makeJobs() {
  let seq = 0;
  let job = null;
  return {
    start(kind, extra = {}) { job = { id: ++seq, kind, startedAt: Date.now(), phase: 'running', stage: '', canceled: false, result: '', error: '', detail: '', ...extra }; return job; },
    get: () => job,
    running: () => Boolean(job && job.phase === 'running'),
    finish(j, patch) { if (j) Object.assign(j, { phase: 'done', finishedAt: Date.now() }, patch); },
    clear() { if (job && job.phase === 'done') job = null; },
    poll() {
      if (!job) return { ok: true, phase: 'idle' };
      const elapsed = Math.round(((job.phase === 'done' ? job.finishedAt : Date.now()) - job.startedAt) / 1000);
      if (job.phase === 'running') return { ok: true, phase: 'running', job: job.kind, stage: job.stage, elapsed, name: job.name || '' };
      return { ok: true, phase: 'done', job: job.kind, result: job.result, error: job.error, detail: job.detail, elapsed, name: job.name || '' };
    },
  };
}

// ------------------------------------------------------------------ sound (pactl)
// `pactl --format=json list sinks|sources|cards` talks to PipeWire's PulseAudio layer.

const parseJsonList = (text) => { try { const j = JSON.parse(text); return Array.isArray(j) ? j : null; } catch { return null; } };
// pactl gives each channel its own percentage ("75%"); one number for the device is their average.
function volumePct(v) {
  const vals = Object.values(v && typeof v === 'object' ? v : {}).map((c) => parseInt(c && c.value_percent, 10)).filter((n) => Number.isFinite(n));
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}
function audioKind(item) {
  const p = item.properties && typeof item.properties === 'object' ? item.properties : {};
  const name = String(item.name || '');
  const text = `${name} ${item.description || ''} ${item.active_port || ''}`;
  if (p['device.api'] === 'bluez5' || /^bluez_/.test(name)) return 'bluetooth';
  if (/hdmi|display ?port/i.test(text)) return 'tv';
  if (p['device.bus'] === 'usb') return 'usb';
  if (/head(?:phone|set)/i.test(`${p['device.form_factor'] || ''} ${item.active_port || ''}`)) return 'headphones';
  return 'speakers';
}
// sinks (outputs) or sources (inputs). A source that only listens to an output ("monitor") is not a microphone.
function parseAudioList(text, isSource) {
  const list = parseJsonList(text);
  if (!list) return null;
  const out = [];
  for (const it of list.slice(0, 40)) {
    if (!it || typeof it !== 'object' || typeof it.name !== 'string' || !it.name || it.name.startsWith('-')) continue;
    if (isSource && (/\.monitor$/.test(it.name) || (it.monitor_of_sink !== undefined && it.monitor_of_sink !== null))) continue;
    const props = it.properties && typeof it.properties === 'object' ? it.properties : {};
    out.push({
      id: it.name,
      label: shortText(it.description || props['device.description'] || it.name, 60),
      kind: audioKind(it),
      volume: volumePct(it.volume),
      mute: Boolean(it.mute),
      isDefault: false,
    });
  }
  return out;
}
// A Bluetooth headset has one card with several profiles: music quality, or a mode with the microphone.
function parseCards(text) {
  const list = parseJsonList(text);
  if (!list) return [];
  const out = [];
  for (const c of list.slice(0, 20)) {
    if (!c || typeof c !== 'object' || typeof c.name !== 'string' || c.name.startsWith('-')) continue;
    const props = c.properties && typeof c.properties === 'object' ? c.properties : {};
    if (!(props['device.api'] === 'bluez5' || /^bluez_card\./.test(c.name))) continue;
    const profiles = [];
    for (const [id, p] of Object.entries(c.profiles && typeof c.profiles === 'object' ? c.profiles : {})) {
      if (id === 'off' || !p || typeof p !== 'object' || p.available === false || id.startsWith('-')) continue;
      const mic = /headset|hfp|hsp|head-unit/i.test(id);
      profiles.push({ id, label: mic ? 'Call mode, with microphone' : /a2dp/i.test(id) ? 'Music quality' : shortText(p.description || id, 40), mic });
    }
    out.push({ id: c.name, label: shortText(props['device.description'] || props['device.alias'] || c.name, 60), profile: typeof c.active_profile === 'string' ? c.active_profile : '', profiles });
  }
  return out;
}
async function audioList() {
  const [sinks, sources, cards, ds, dsrc] = await Promise.all([
    run('pactl', ['--format=json', 'list', 'sinks']),
    run('pactl', ['--format=json', 'list', 'sources']),
    run('pactl', ['--format=json', 'list', 'cards']),
    run('pactl', ['get-default-sink']),
    run('pactl', ['get-default-source']),
  ]);
  if (sinks.missing) return { ok: false, problem: 'missing', error: "Sound controls aren't available on this system." };
  if (!sinks.ok) return { ok: false, problem: 'server', error: "The sound system isn't running.", detail: lastLine(sinks.err) };
  const outputs = parseAudioList(sinks.out, false);
  if (!outputs) return { ok: false, problem: 'unreadable', error: "Couldn't read the sound devices.", detail: '' };
  const inputs = (sources.ok && parseAudioList(sources.out, true)) || [];
  const defOut = ds.ok ? ds.out.trim() : '';
  const defIn = dsrc.ok ? dsrc.out.trim() : '';
  for (const o of outputs) o.isDefault = o.id === defOut;
  for (const i of inputs) i.isDefault = i.id === defIn;
  return { ok: true, outputs, inputs, cards: cards.ok ? parseCards(cards.out) : [] };
}
const audio = {
  async info() { return audioList(); },
  async summary() {
    const l = await audioList();
    if (!l.ok) return '';
    const o = l.outputs.find((x) => x.isDefault);
    return o ? (o.mute ? 'Muted' : o.label).slice(0, 30) : '';
  },
  // kind is 'output' or 'input'; id has to be one of the devices listed right now
  async setDefault(kind, id) {
    const l = await audioList();
    if (!l.ok) return l;
    const list = kind === 'output' ? l.outputs : kind === 'input' ? l.inputs : null;
    if (!list || !list.some((d) => d.id === id)) return { ok: false, error: "That sound device isn't there any more." };
    const r = await run('pactl', [kind === 'output' ? 'set-default-sink' : 'set-default-source', id]);
    return r.ok ? { ok: true } : { ok: false, error: "Couldn't switch to that device.", detail: lastLine(r.err) };
  },
  async setVolume(kind, id, pct) {
    if (typeof pct !== 'number' || !Number.isFinite(pct)) return { ok: false, error: 'Bad volume.' };
    const l = await audioList();
    if (!l.ok) return l;
    const list = kind === 'output' ? l.outputs : kind === 'input' ? l.inputs : null;
    if (!list || !list.some((d) => d.id === id)) return { ok: false, error: "That sound device isn't there any more." };
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    const r = await run('pactl', [kind === 'output' ? 'set-sink-volume' : 'set-source-volume', id, `${v}%`]);
    return r.ok ? { ok: true, volume: v } : { ok: false, error: "Couldn't change the volume.", detail: lastLine(r.err) };
  },
  async setMute(kind, id, on) {
    const l = await audioList();
    if (!l.ok) return l;
    const list = kind === 'output' ? l.outputs : kind === 'input' ? l.inputs : null;
    if (!list || !list.some((d) => d.id === id)) return { ok: false, error: "That sound device isn't there any more." };
    const r = await run('pactl', [kind === 'output' ? 'set-sink-mute' : 'set-source-mute', id, on ? '1' : '0']);
    return r.ok ? { ok: true, mute: Boolean(on) } : { ok: false, error: "Couldn't change that.", detail: lastLine(r.err) };
  },
  async setProfile(card, profile) {
    const l = await audioList();
    if (!l.ok) return l;
    const c = l.cards.find((x) => x.id === card);
    if (!c || !c.profiles.some((p) => p.id === profile)) return { ok: false, error: "That mode isn't available." };
    const r = await run('pactl', ['set-card-profile', card, profile]);
    return r.ok ? { ok: true } : { ok: false, error: "Couldn't switch the mode.", detail: lastLine(r.err) };
  },
};

// ------------------------------------------------------------------ Bluetooth (bluetoothctl)
// Reading goes through short bluetoothctl calls. Pairing needs a "pairing agent" that says yes to
// the pairing request, and an agent only lives as long as the program that registered it. So while
// the Bluetooth screen is open there is one long-lived bluetoothctl (`-a NoInputNoOutput`) that
// gets the commands that need it (scan, pair, trust, connect). Whatever it prints is only used to
// explain a failure: whether something worked is always decided by asking `info` again.

const MAC = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i;
const yes = (v) => /^yes$/i.test(String(v).trim());

function parseBtShow(text) {
  const t = cleanLines(text);
  if (!t.length || /No default controller|no controller/i.test(t.join('\n'))) return { present: false, powered: false, scanning: false, pairable: false };
  const o = {};
  for (const l of t) { const m = /^([A-Za-z ]+):\s*(.*)$/.exec(l); if (m) o[m[1].trim().toLowerCase()] = m[2]; }
  return { present: /^Controller\b/m.test(t.join('\n')), powered: yes(o.powered), scanning: yes(o.discovering), pairable: yes(o.pairable) };
}
function parseBtDevices(text) {
  const out = [];
  for (const l of cleanLines(text)) {
    const m = /^Device\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})\s*(.*)$/i.exec(l);
    if (m) out.push({ id: m[1].toUpperCase(), name: shortText(m[2], 60) });
  }
  return out;
}
const bluezReason = (r) => String(r || '').replace(/^org\.bluez\.Error\./, '').slice(0, 60); // "org.bluez.Error.AuthenticationFailed" -> "AuthenticationFailed"
const unnamed = (name, id) => !name || name.replace(/-/g, ':').toUpperCase() === id;
function parseBtInfo(text) {
  const t = cleanLines(text);
  if (!t.length || !/^Device\b/.test(t[0]) || /not available/i.test(t[0])) return null;
  const o = {};
  for (const l of t.slice(1)) { const m = /^([A-Za-z ]+):\s*(.*)$/.exec(l); if (m && !(m[1].trim() in o)) o[m[1].trim()] = m[2]; }
  if (!('Paired' in o) && !('Alias' in o) && !('Name' in o)) return null; // not a description of a device
  const bat = /\((\d{1,3})\)/.exec(o['Battery Percentage'] || '');
  const rssi = /\((-?\d+)\)/.exec(o.RSSI || '');
  return {
    name: shortText(o.Alias || o.Name || '', 60),
    icon: shortText(o.Icon || '', 40),
    paired: yes(o.Paired) || yes(o.Bonded),
    trusted: yes(o.Trusted),
    connected: yes(o.Connected),
    blocked: yes(o.Blocked),
    battery: bat ? Math.min(100, Number(bat[1])) : null,
    rssi: rssi ? Number(rssi[1]) : null,
  };
}
function btKind(icon, name) {
  if (/gaming/.test(icon) || /controller|gamepad|dualsense|dualshock|joy-?con|wireless controller|xbox|8bitdo/i.test(name)) return 'controller';
  if (/audio-head(?:set|phones)/.test(icon) || /headset|headphone|earbud|buds|airpods|wh-1000|wf-1000/i.test(name)) return 'headset';
  if (/audio-card|audio-speaker|speaker/.test(icon) || /speaker|soundbar|boom/i.test(name)) return 'speaker';
  if (/keyboard/.test(icon)) return 'keyboard';
  if (/mouse|pointing/.test(icon)) return 'mouse';
  if (/phone/.test(icon)) return 'phone';
  if (/computer|laptop/.test(icon)) return 'computer';
  return 'device';
}
// What the person is told when a step fails. The tool's own text only goes into the detail.
function btFailText(step, reason) {
  const r = String(reason || '');
  if (step === 'pair') {
    if (/ConnectionAttemptFailed|Page Timeout|NotReady|not available/i.test(r)) return "Couldn't reach the device. Is it in pairing mode and close by?";
    if (/Authentication|Rejected|Canceled|Cancelled|Timeout/i.test(r)) return 'The device refused to pair. Put it in pairing mode again, then try once more. Devices that want a code typed in are not supported here yet.';
    if (/InProgress/i.test(r)) return 'Pairing is already going on. Wait a moment and try again.';
    return "Pairing didn't work.";
  }
  if (/ConnectionAttemptFailed|not available|Page Timeout/i.test(r)) return "Couldn't reach the device. Is it switched on and close by?";
  if (/profile-unavailable|NotAvailable|NotSupported/i.test(r)) return 'The device paired, but nothing could be connected on it.';
  return "Couldn't connect.";
}

const bt = { child: null, seq: 0, lines: [], idleTimer: null };
const btJobs = makeJobs();
const IDLE_MS = 10 * 60 * 1000;
function btTouch() {
  if (bt.idleTimer) clearTimeout(bt.idleTimer);
  bt.idleTimer = setTimeout(() => btStop(), IDLE_MS);
  if (bt.idleTimer.unref) bt.idleTimer.unref();
}
function btEnsure() {
  if (bt.child && bt.child.exitCode === null && !bt.child.killed) { btTouch(); return true; }
  let child;
  try { child = spawn('bluetoothctl', ['--agent', 'NoInputNoOutput'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C', NO_COLOR: '1' } }); } catch { return false; }
  bt.child = child;
  let partial = '';
  const feed = (chunk) => {
    partial += chunk.toString('utf8');
    const parts = partial.split(/[\r\n]+/);
    partial = parts.pop();
    for (const p of parts) {
      const t = p.replace(ANSI, '').replace(CONTROL, ' ').trim();
      if (t) { bt.lines.push({ n: ++bt.seq, text: t.slice(0, 300) }); if (bt.lines.length > 200) bt.lines.shift(); }
    }
    if (partial.length > 4000) partial = '';
  };
  child.stdout.on('data', feed);
  child.stderr.on('data', feed);
  child.stdin.on('error', () => { /* it went away */ });
  child.on('error', () => { if (bt.child === child) bt.child = null; });
  child.on('exit', () => { if (bt.child === child) bt.child = null; });
  btTouch();
  return true;
}
function btSend(cmd) {
  if (!bt.child || !bt.child.stdin || bt.child.stdin.destroyed) return false;
  try { bt.child.stdin.write(`${cmd}\n`); return true; } catch { return false; }
}
function btStop() {
  if (bt.idleTimer) { clearTimeout(bt.idleTimer); bt.idleTimer = null; }
  const c = bt.child;
  bt.child = null;
  if (c) {
    try { c.stdin.write('scan off\nquit\n'); c.stdin.end(); } catch { /* gone */ }
    setTimeout(() => { try { c.kill('SIGTERM'); } catch { /* gone */ } }, 1500).unref();
  }
}
const btSaid = (since, re) => { for (const l of bt.lines) if (l.n > since) { const m = re.exec(l.text); if (m) return m; } return null; };

async function btInfoOne(id) {
  const r = await run('bluetoothctl', ['info', id], { timeout: 6000 });
  return r.ok || r.out ? parseBtInfo(r.out) : null;
}
async function btRead() {
  const show = await run('bluetoothctl', ['show'], { timeout: 6000 });
  if (show.missing) return { ok: false, problem: 'missing', error: "Bluetooth isn't available on this system." };
  const adapter = parseBtShow(show.out);
  if (!adapter.present) return { ok: true, adapter, devices: [], job: null };
  const list = await run('bluetoothctl', ['devices'], { timeout: 6000 });
  const known = parseBtDevices(list.out);
  const pairedIds = new Set(parseBtDevices((await run('bluetoothctl', ['devices', 'Paired'], { timeout: 6000 })).out).map((d) => d.id));
  // Nameless devices nearby (beacons, other people's gadgets) are not worth a lookup, and not worth showing.
  const wanted = known.filter((d) => pairedIds.has(d.id) || !unnamed(d.name, d.id)).slice(0, 40);
  const devices = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(6, wanted.length) }, async () => {
    while (i < wanted.length) {
      const d = wanted[i++];
      const inf = await btInfoOne(d.id);
      if (!inf || inf.blocked) continue;
      const name = inf.name && !unnamed(inf.name, d.id) ? inf.name : d.name;
      if (unnamed(name, d.id) && !inf.paired) continue;
      devices.push({ id: d.id, name: unnamed(name, d.id) ? d.id : name, kind: btKind(inf.icon, name), paired: inf.paired, connected: inf.connected, trusted: inf.trusted, battery: inf.battery, rssi: inf.rssi });
    }
  }));
  const rank = (d) => (d.connected ? 0 : d.paired ? 1 : 2);
  devices.sort((a, b) => rank(a) - rank(b) || (b.rssi === null ? -999 : b.rssi) - (a.rssi === null ? -999 : a.rssi) || a.name.localeCompare(b.name));
  return { ok: true, adapter, devices, job: btJobs.running() ? btJobs.get().kind : null };
}

async function btWaitFor(id, field, ms, job, failRe, since) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (job.canceled) return { state: 'canceled' };
    await sleep(900);
    const inf = await btInfoOne(id);
    if (inf && inf[field]) return { state: 'ok', inf };
    const said = btSaid(since, failRe);
    if (said) return { state: 'failed', reason: bluezReason(said[1] || said[0]) };
  }
  return { state: 'timeout' };
}
async function btPairJob(job, id) {
  try {
    if (!btEnsure()) return btJobs.finish(job, { result: 'error', error: "Couldn't start the Bluetooth service." });
    const before = await btInfoOne(id);
    job.name = (before && before.name) || id;
    if (!before || !before.paired) {
      job.stage = 'Pairing';
      const since = bt.seq;
      btSend('power on'); btSend('pairable on'); btSend('scan off'); btSend(`pair ${id}`);
      const w = await btWaitFor(id, 'paired', 45000, job, /Failed to pair:?\s*(\S+)/i, since);
      if (w.state === 'canceled') { btSend(`cancel-pairing ${id}`); return btJobs.finish(job, { result: 'canceled' }); }
      if (w.state !== 'ok') {
        const reason = w.reason || '';
        if (/AlreadyExists/i.test(reason)) { /* it is paired after all: carry on */ } else {
          btSend(`cancel-pairing ${id}`);
          return btJobs.finish(job, { result: 'error', error: w.state === 'timeout' ? "Pairing took too long. Put the device in pairing mode again, then try once more." : btFailText('pair', reason), detail: reason });
        }
      }
    }
    job.stage = 'Connecting';
    btSend(`trust ${id}`);
    let inf = await btInfoOne(id);
    if (!inf || !inf.connected) {
      const since = bt.seq;
      btSend(`connect ${id}`);
      const w = await btWaitFor(id, 'connected', 25000, job, /Failed to connect:?\s*(\S+)/i, since);
      if (w.state === 'canceled') return btJobs.finish(job, { result: 'canceled' });
      inf = w.state === 'ok' ? w.inf : await btInfoOne(id);
      if (!inf || !inf.connected) return btJobs.finish(job, { result: 'paired', error: btFailText('connect', w.reason), detail: w.reason || '' });
    }
    btJobs.finish(job, { result: 'connected' });
  } catch {
    btJobs.finish(job, { result: 'error', error: 'Something went wrong.' });
  }
}
async function btConnectJob(job, id) {
  try {
    const before = await btInfoOne(id);
    job.name = (before && before.name) || id;
    job.stage = 'Connecting';
    const r = await run('bluetoothctl', ['connect', id], { timeout: 30000 });
    if (job.canceled) return btJobs.finish(job, { result: 'canceled' });
    const inf = await btInfoOne(id);
    if (inf && inf.connected) return btJobs.finish(job, { result: 'connected' });
    const why = /Failed to connect:?\s*(\S+)/i.exec(`${r.out}\n${r.err}`);
    btJobs.finish(job, { result: 'error', error: btFailText('connect', why ? why[1] : ''), detail: why ? bluezReason(why[1]) : lastLine(r.err) });
  } catch {
    btJobs.finish(job, { result: 'error', error: 'Something went wrong.' });
  }
}
const bluetooth = {
  info: btRead,
  async summary() {
    const r = await btRead();
    if (!r.ok || !r.adapter.present) return '';
    if (!r.adapter.powered) return 'Off';
    const c = r.devices.filter((d) => d.connected);
    return c.length ? (c.length === 1 ? c[0].name : `${c.length} connected`).slice(0, 30) : '';
  },
  async power(on) {
    const r = await run('bluetoothctl', ['power', on ? 'on' : 'off'], { timeout: 8000 });
    if (r.missing) return { ok: false, error: "Bluetooth isn't available on this system." };
    const s = parseBtShow((await run('bluetoothctl', ['show'], { timeout: 6000 })).out);
    if (s.powered === Boolean(on)) return { ok: true };
    return { ok: false, error: on ? "Couldn't turn Bluetooth on. It may be switched off by a hardware switch." : "Couldn't turn Bluetooth off.", detail: lastLine(`${r.out}\n${r.err}`) };
  },
  async scan(on) {
    if (on) {
      if (!btEnsure()) return { ok: false, error: "Couldn't start the Bluetooth service." };
      btSend('power on'); btSend('pairable on'); btSend('scan on');
    } else if (bt.child) btSend('scan off');
    return { ok: true };
  },
  stop() { btStop(); return { ok: true }; },
  pair(id) { return btStart('pair', id); },
  connect(id) { return btStart('connect', id); },
  async disconnect(id) {
    if (typeof id !== 'string' || !MAC.test(id)) return { ok: false, error: 'Unknown device.' };
    await run('bluetoothctl', ['disconnect', id], { timeout: 12000 });
    const inf = await btInfoOne(id);
    return inf && inf.connected ? { ok: false, error: "Couldn't disconnect it." } : { ok: true };
  },
  async forget(id) {
    if (typeof id !== 'string' || !MAC.test(id)) return { ok: false, error: 'Unknown device.' };
    await run('bluetoothctl', ['remove', id], { timeout: 12000 });
    const inf = await btInfoOne(id);
    return inf ? { ok: false, error: "Couldn't remove it." } : { ok: true };
  },
  poll: () => btJobs.poll(),
  ack() { btJobs.clear(); return { ok: true }; },
  cancel() {
    const j = btJobs.get();
    if (!j || j.phase !== 'running') return { ok: true };
    j.canceled = true;
    return { ok: true };
  },
};
function btStart(kind, id) {
  if (typeof id !== 'string' || !MAC.test(id)) return { ok: false, error: 'Unknown device.' };
  const mac = id.toUpperCase();
  if (btJobs.running()) return { ok: false, error: 'Something else is still going on. Wait a moment.' };
  const job = btJobs.start(kind, { name: mac });
  (kind === 'pair' ? btPairJob : btConnectJob)(job, mac);
  return { ok: true, job: kind };
}

// ------------------------------------------------------------------ Wi-Fi (nmcli)
// `nmcli -t` separates columns with ':' and writes a ':' or '\' inside a value as '\:' or '\\'.

function splitTerse(line) {
  const out = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
    if (ch === ':') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
const signalWord = (n) => (n >= 70 ? 'Strong' : n >= 45 ? 'Good' : n >= 25 ? 'Fair' : 'Weak');
function secKind(sec) {
  const s = String(sec || '').trim();
  if (!s || s === '--') return 'open';
  if (/802\.1X|EAP/i.test(s)) return 'enterprise';
  if (/WEP/i.test(s) && !/WPA/i.test(s)) return 'wep';
  return 'secured';
}
// IN-USE:SSID:SIGNAL:SECURITY. The same network is often several access points: show the strongest once.
function parseWifiList(text) {
  const best = new Map();
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const f = splitTerse(line.replace(/\r$/, ''));
    if (f.length < 4) continue;
    const ssid = f[1].replace(CONTROL, ' ').trim();
    if (!ssid) continue; // hidden networks have no name to show
    const signal = Math.max(0, Math.min(100, parseInt(f[2], 10) || 0));
    const cur = best.get(ssid);
    const inUse = f[0].trim() === '*' || Boolean(cur && cur.inUse);
    if (!cur || signal > cur.signal) best.set(ssid, { ssid, signal, security: secKind(f[3]), inUse });
    else if (inUse) cur.inUse = true;
  }
  return [...best.values()].sort((a, b) => Number(b.inUse) - Number(a.inUse) || b.signal - a.signal || a.ssid.localeCompare(b.ssid));
}
function parseWifiSaved(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const f = splitTerse(line.replace(/\r$/, ''));
    if (f.length >= 2 && /^(802-11-wireless|wifi)$/.test(f[1]) && f[0]) out.push(f[0]);
  }
  return out;
}
function parseNmDevices(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const f = splitTerse(line.replace(/\r$/, ''));
    if (f.length >= 3 && f[0]) out.push({ device: f[0], type: f[1], state: f[2] });
  }
  return out;
}
function wifiFailText(text) {
  const t = String(text);
  if (/secrets were required|no secrets|invalid password|wrong password|802-1x|\(7\)|4-way|handshake/i.test(t)) return "That password didn't work.";
  if (/no network with ssid|not found|could not be found/i.test(t)) return "Couldn't find that network. Is it in range?";
  if (/timeout|timed out/i.test(t)) return "The network didn't answer in time.";
  if (/not (?:authorized|allowed)|permission|policy/i.test(t)) return "This account isn't allowed to change networks.";
  if (/network manager is not running|not running/i.test(t)) return "The network service isn't running.";
  return "Couldn't join that network.";
}
const validSsid = (s) => typeof s === 'string' && s.length > 0 && Buffer.byteLength(s, 'utf8') <= 32 && !HAS_CONTROL.test(s) && !s.startsWith('-');
const wifiJobs = makeJobs();

async function wifiRead(rescan) {
  const dev = await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'device'], { timeout: 6000 });
  if (dev.missing) return { ok: false, problem: 'missing', error: "Networking isn't available on this system." };
  if (!dev.ok) return { ok: false, problem: 'service', error: "The network service isn't running.", detail: lastLine(dev.err) };
  const devices = parseNmDevices(dev.out);
  const wifi = devices.find((d) => d.type === 'wifi');
  const wired = devices.some((d) => d.type === 'ethernet' && d.state === 'connected');
  if (!wifi) return { ok: true, present: false, wired, radio: false, networks: [], saved: [], job: null };
  const radio = /^enabled/i.test((await run('nmcli', ['radio', 'wifi'], { timeout: 5000 })).out.trim());
  let networks = [];
  let saved = [];
  if (radio) {
    const list = await run('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', rescan ? 'yes' : 'no'], { timeout: rescan ? 15000 : 8000 });
    networks = parseWifiList(list.out);
    saved = parseWifiSaved((await run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show'], { timeout: 6000 })).out);
  }
  return { ok: true, present: true, device: wifi.device, state: wifi.state, wired, radio, networks: networks.map((n) => ({ ...n, saved: saved.includes(n.ssid), word: signalWord(n.signal) })), saved, job: wifiJobs.running() ? wifiJobs.get().kind : null };
}
async function wifiJoinJob(job, ssid, password, hidden) {
  try {
    job.name = ssid;
    job.stage = 'Joining';
    const before = parseWifiSaved((await run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show'], { timeout: 6000 })).out);
    const args = ['--wait', '40', 'device', 'wifi', 'connect', ssid];
    if (password) args.push('password', password);
    if (hidden) args.push('hidden', 'yes');
    const r = await run('nmcli', args, { timeout: 50000, onChild: (c) => { job.child = c; } });
    job.child = null;
    if (job.canceled) {
      if (!before.includes(ssid)) await run('nmcli', ['connection', 'delete', 'id', ssid], { timeout: 8000 });
      return wifiJobs.finish(job, { result: 'canceled' });
    }
    if (r.ok) return wifiJobs.finish(job, { result: 'connected' });
    // a new network that did not work leaves a saved entry with a wrong password: take it away again
    if (!before.includes(ssid)) await run('nmcli', ['connection', 'delete', 'id', ssid], { timeout: 8000 });
    const said = `${r.err}\n${r.out}`;
    wifiJobs.finish(job, { result: 'error', error: wifiFailText(said), detail: lastLine(said) });
  } catch {
    wifiJobs.finish(job, { result: 'error', error: 'Something went wrong.' });
  }
}
async function wifiUpJob(job, name) {
  try {
    job.name = name;
    job.stage = 'Joining';
    const r = await run('nmcli', ['--wait', '40', 'connection', 'up', 'id', name], { timeout: 50000, onChild: (c) => { job.child = c; } });
    job.child = null;
    if (job.canceled) return wifiJobs.finish(job, { result: 'canceled' });
    if (r.ok) return wifiJobs.finish(job, { result: 'connected' });
    const said = `${r.err}\n${r.out}`;
    wifiJobs.finish(job, { result: 'error', error: wifiFailText(said), detail: lastLine(said) });
  } catch {
    wifiJobs.finish(job, { result: 'error', error: 'Something went wrong.' });
  }
}
const wifi = {
  info: (p) => wifiRead(Boolean(p && p.rescan)),
  async summary() {
    const r = await wifiRead(false);
    if (!r.ok || !r.present) return r.ok && r.wired ? 'Wired' : '';
    if (!r.radio) return 'Off';
    const on = r.networks.find((n) => n.inUse);
    return on ? on.ssid.slice(0, 30) : r.wired ? 'Wired' : '';
  },
  async rescan() {
    await run('nmcli', ['device', 'wifi', 'rescan'], { timeout: 8000 }); // "scanning not allowed so soon after the last one" is fine
    return { ok: true };
  },
  async radio(on) {
    const r = await run('nmcli', ['radio', 'wifi', on ? 'on' : 'off'], { timeout: 8000 });
    return r.ok ? { ok: true } : { ok: false, error: r.missing ? "Networking isn't available on this system." : "Couldn't change Wi-Fi.", detail: lastLine(r.err) };
  },
  // password is only sent along for a network that needs one; an open network has none
  join(p) {
    const ssid = p && p.ssid;
    if (!validSsid(ssid)) return { ok: false, error: "That network name can't be used." };
    const password = typeof p.password === 'string' ? p.password : '';
    if (password && !(/^[\x20-\x7e]{8,63}$/.test(password) || /^[0-9a-f]{64}$/i.test(password))) return { ok: false, error: 'A Wi-Fi password has 8 to 63 characters.' };
    if (wifiJobs.running()) return { ok: false, error: 'Something else is still going on. Wait a moment.' };
    const job = wifiJobs.start('join', { name: ssid });
    wifiJoinJob(job, ssid, password, Boolean(p.hidden));
    return { ok: true, job: 'join' };
  },
  async connect(p) {
    const name = p && p.ssid;
    if (!validSsid(name)) return { ok: false, error: "That network name can't be used." };
    if (wifiJobs.running()) return { ok: false, error: 'Something else is still going on. Wait a moment.' };
    const saved = parseWifiSaved((await run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show'], { timeout: 6000 })).out);
    if (!saved.includes(name)) return { ok: false, error: "That network isn't saved." };
    const job = wifiJobs.start('join', { name });
    wifiUpJob(job, name);
    return { ok: true, job: 'join' };
  },
  async disconnect() {
    const dev = parseNmDevices((await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'device'], { timeout: 6000 })).out).find((d) => d.type === 'wifi');
    if (!dev) return { ok: false, error: 'No Wi-Fi found.' };
    const r = await run('nmcli', ['device', 'disconnect', dev.device], { timeout: 12000 });
    return r.ok ? { ok: true } : { ok: false, error: "Couldn't disconnect.", detail: lastLine(r.err) };
  },
  async forget(p) {
    const name = p && p.ssid;
    if (!validSsid(name)) return { ok: false, error: "That network name can't be used." };
    const saved = parseWifiSaved((await run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show'], { timeout: 6000 })).out);
    if (!saved.includes(name)) return { ok: false, error: "That network isn't saved." };
    const r = await run('nmcli', ['connection', 'delete', 'id', name], { timeout: 10000 });
    return r.ok ? { ok: true } : { ok: false, error: "Couldn't forget that network.", detail: lastLine(r.err) };
  },
  poll: () => wifiJobs.poll(),
  ack() { wifiJobs.clear(); return { ok: true }; },
  cancel() {
    const j = wifiJobs.get();
    if (j && j.phase === 'running') {
      j.canceled = true;
      if (j.child) { try { j.child.kill('SIGTERM'); } catch { /* it ended already */ } }
    }
    return { ok: true };
  },
};

module.exports = {
  audio, bluetooth, wifi,
  parse: { parseAudioList, parseCards, volumePct, audioKind, parseBtShow, parseBtDevices, parseBtInfo, btKind, btFailText, splitTerse, parseWifiList, parseWifiSaved, parseNmDevices, wifiFailText, signalWord, secKind, validSsid, cleanLines, lastLine },
  _bt: bt,
};
