// SPDX-License-Identifier: GPL-3.0-or-later
// Installing Tessera from the live USB, and switching graphics builds.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get GRAPHICS_CHECK_DELAY_MS() { return GRAPHICS_CHECK_DELAY_MS; },
  get graphicsCheck() { return graphicsCheck; },
  get graphicsFor() { return graphicsFor; },
  get INSTALLER() { return INSTALLER; },
};

const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { spawn, execFile } = require('child_process');
const config = require('./config');
const appWindow = require('./appWindow');
const updates = require('./updates');

// ------------------------------------------------------------ installing from the live USB
// On the Tessera USB (see the tessera-mortar repo) the launcher starts into Install Tessera. The real
// work is done by a root helper on the USB (/usr/libexec/tessera/live-install, allowed through sudo
// for the live user only), which checks every choice against what it offered; this only relays.
const INSTALLER = process.env.TESSERA_INSTALLER === '1' || fs.existsSync(process.env.TESSERA_LIVE_MARKER || '/etc/tessera/live-installer');
const LIVE_INSTALL = process.env.TESSERA_LIVE_INSTALL || '/usr/libexec/tessera/live-install';
const LIVE_SUDO = process.env.TESSERA_LIVE_INSTALL_NOSUDO === '1' ? [] : ['sudo', '-n'];
const INSTALL_STATE = path.join(process.env.TESSERA_INSTALL_STATE || '/run/tessera-install', 'state.json');
let installChild = null;
function liveHelper(args, input) {
  const cmd = [...LIVE_SUDO, LIVE_INSTALL, ...args];
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => resolve({ ok: false, out, err: 'missing' }));
    child.on('close', (code) => resolve({ ok: code === 0, out, err }));
    // A helper that answers without reading its input closes the pipe first; writing to it then
    // fails later (EPIPE) as an event, which would end the whole launcher if nothing listened.
    child.stdin.on('error', () => { /* it didn't need its input */ });
    child.stdin.end(input || '');
  });
}
async function installerOp(op, p) {
  if (!INSTALLER) return { ok: false, error: 'Not on a Tessera USB.' };
  if (op === 'probe') {
    const r = await liveHelper(['probe']);
    let j = null;
    try { j = JSON.parse(r.out); } catch { /* below */ }
    if (!j || !j.ok) return { ok: false, error: "Couldn't look at this computer's disks and graphics." };
    const gpus = await nameGpus(Array.isArray(j.gpus) ? j.gpus : []);
    const need = gpuMatch.needFor(gpus);
    const avail = (Array.isArray(j.images) ? j.images : []).map((n) => gpuMatch.variantOfRef(n)).filter(Boolean);
    return {
      ok: true,
      disks: Array.isArray(j.disks) ? j.disks : [],
      cards: gpuMatch.describe(gpus),
      need: need.variant, why: need.why,
      available: avail,
      recommended: avail.includes(need.variant) ? need.variant : avail[0] || null,
      names: gpuMatch.VARIANT_NAMES,
      secureBoot: j.secureBoot || { efi: false, state: 'unknown' },
      timezones: Array.isArray(j.timezones) ? j.timezones : ['UTC'],
      source: j.source === 'online' ? 'online' : 'usb', // "online": the USB has no builds on it; it downloads one while installing
      online: j.online === true,
    };
  }
  if (op === 'online') {
    const r = await liveHelper(['online']);
    try { return { ok: true, online: JSON.parse(r.out).online === true }; } catch { return { ok: true, online: false }; }
  }
  if (op === 'start') {
    if (installChild) return { ok: true };
    const c = p && typeof p.choices === 'object' ? p.choices : null;
    if (!c) return { ok: false, error: 'Nothing to install.' };
    const pick = (k, n) => (typeof c[k] === 'string' ? c[k].slice(0, n) : '');
    const choices = { disk: pick('disk', 64), variant: pick('variant', 20), user: pick('user', 32), fullName: pick('fullName', 60), password: pick('password', 200), timezone: pick('timezone', 64), secureBoot: pick('secureBoot', 10) };
    try { fs.rmSync(INSTALL_STATE, { force: true }); } catch { /* the helper starts it afresh anyway */ }
    const cmd = [...LIVE_SUDO, LIVE_INSTALL, 'run'];
    installChild = spawn(cmd[0], cmd.slice(1), { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
    installChild.on('error', () => { installChild = null; });
    installChild.on('exit', () => { installChild = null; });
    installChild.stdin.on('error', () => { /* it stopped before reading: its state file says why */ });
    installChild.stdin.end(JSON.stringify(choices));
    return { ok: true };
  }
  if (op === 'poll') {
    let st = null;
    try { st = JSON.parse(fs.readFileSync(INSTALL_STATE, 'utf8')); } catch { /* not started yet */ }
    if (!st) return { ok: true, phase: installChild ? 'starting' : 'idle' };
    return { ok: true, phase: String(st.phase || ''), percent: Number(st.percent) || 0, stage: updates.shortText(st.stage, 60), line: updates.shortText(st.line, 160), error: updates.shortText(st.error, 200), enrolled: st.enrolled === true, secureBoot: updates.shortText(st.secureBoot, 10) };
  }
  if (op === 'reboot') {
    const r = await updates.sysctl(['reboot'], 15000);
    return r.ok ? { ok: true } : { ok: false, error: "Couldn't restart. Hold the power button." };
  }
  return { ok: false, error: 'Unknown action.' };
}
ipcMain.handle('installer', (_e, op, p) => installerOp(typeof op === 'string' ? op : '', p && typeof p === 'object' ? p : {}).catch(() => ({ ok: false, error: 'Something went wrong.' })));

// ---- graphics builds
// Tessera comes in a build per graphics family (see gpu-match.js). After a card swap the running build
// may not suit the new card; Settings > Update software then offers to switch, which is the same kind
// of image switch as an update: games, saves and settings stay, and the old build stays in the boot menu.
const gpuMatch = require('../gpu-match');
const PCI_DIR = process.env.TESSERA_PCI_DIR || '/sys/bus/pci/devices';
const GRAPHICS_CHECK_DELAY_MS = Number(process.env.TESSERA_GRAPHICS_DELAY_MS) || 20000;
const GRAPHICS_UNIT = (v) => `tessera-graphics-switch@${v}.service`;
function readGpus() {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(PCI_DIR); } catch { return out; }
  for (const d of names.slice(0, 256)) {
    const rd = (f) => { try { return fs.readFileSync(path.join(PCI_DIR, d, f), 'utf8').trim().toLowerCase().replace(/^0x/, ''); } catch { return ''; } };
    const cls = rd('class');
    if (/^03/.test(cls)) out.push({ slot: d, vendor: rd('vendor'), device: rd('device'), cls });
  }
  return out;
}
// Card names, from lspci when it's there (it is on Bazzite). Without it the ids are shown instead.
function nameGpus(gpus) {
  return Promise.all(gpus.map((g) => new Promise((resolve) => {
    if (!/^[0-9a-f:.]+$/i.test(g.slot)) return resolve(g);
    execFile('lspci', ['-mm', '-s', g.slot], { timeout: 4000, encoding: 'utf8' }, (err, stdout) => {
      const parts = err ? [] : [...String(stdout).matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      resolve(parts.length >= 3 ? { ...g, name: updates.shortText(`${parts[1]} ${parts[2]}`.replace(/Advanced Micro Devices, Inc\. \[AMD\/ATI\]/, 'AMD').replace(/NVIDIA Corporation/, 'NVIDIA').replace(/Intel Corporation/, 'Intel'), 80) } : g);
    });
  })));
}
async function graphicsFor(st) {
  if (!st || !st.booted || !st.booted.ref) return null;
  const gpus = await nameGpus(readGpus());
  const m = gpuMatch.match(gpus, st.booted.ref);
  const stagedFor = st.staged && st.staged.ref ? gpuMatch.variantOfRef(st.staged.ref) : null;
  return { ...m, names: gpuMatch.VARIANT_NAMES, staged: stagedFor, switching: Boolean(m.mismatch && stagedFor === m.need) };
}
// Shortly after start: if the card and the build don't match (and the switch isn't already waiting
// for a restart), tell the page so it can offer the switch.
async function graphicsCheck() {
  const gpus = readGpus();
  if (!gpus.length) return;
  const st = await updates.fetchStatus();
  if (!st.ok) return;
  const g = await graphicsFor(st);
  if (g && g.mismatch && !g.switching) appWindow.send('graphics', g);
}
async function startUpdate(kind, p = {}) {
  if (kind !== 'check' && kind !== 'apply' && kind !== 'rollback' && kind !== 'graphics') return { ok: false, error: 'Unknown action.' };
  if (kind === 'graphics' && !gpuMatch.VARIANTS.includes(p.variant)) return { ok: false, error: 'Unknown action.' };
  if (config.running) return { ok: false, error: 'Close the game first.' };
  const cur = await updates.runningJob();
  if (cur) return { ok: true, job: cur.kind };
  if (kind === 'rollback') {
    // Going back twice would undo itself, so look first: there has to be an older version, and it must not be queued already.
    const st = await updates.fetchStatus();
    if (!st.ok) return { ok: false, error: updates.UPDATE_PROBLEM[st.why] || updates.UPDATE_PROBLEM.unreadable };
    if (st.rollbackQueued || updates.rolledBackNow) return { ok: false, error: 'Already set. Restart to go back to the previous version.' };
    if (st.staged) return { ok: false, error: 'An update is waiting for a restart. Restart first, then you can go back if you need to.' };
    if (!st.rollback) return { ok: false, error: "There's no earlier version to go back to." };
  }
  const unit = kind === 'graphics' ? GRAPHICS_UNIT(p.variant) : updates.UPDATE_UNIT[kind];
  const before = await updates.unitProps(unit);
  if (!before || before.LoadState === 'not-found') return { ok: false, error: updates.UPDATE_PROBLEM.missing };
  const r = await updates.sysctl(['start', '--no-block', unit], 15000);
  if (!r.ok) return { ok: false, error: updates.UPDATE_PROBLEM[updates.ctlWhy(r)] };
  updates.upJob = { kind, unit, before: before.InvocationID || '', startedAt: Date.now(), seen: false, canceled: false };
  return { ok: true, job: kind };
}
// Called about once a second while the progress screen is up.
async function pollUpdate() {
  if (!updates.upJob) await updates.runningJob();
  const job = updates.upJob;
  if (!job) return { ok: true, phase: 'idle' };
  const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
  const p = await updates.unitProps(job.unit);
  if (!p) return { ok: true, phase: 'running', job: job.kind, elapsed, line: '' }; // a hiccup in systemctl: keep waiting
  const log = updates.readNote(`${job.kind}.log`);
  if (['activating', 'active', 'reloading', 'deactivating'].includes(p.ActiveState)) {
    job.seen = true;
    return { ok: true, phase: 'running', job: job.kind, elapsed, line: updates.lastLine(log) };
  }
  if (!job.seen && (p.InvocationID || '') === job.before) {
    // queued but not begun yet, or it never will
    if (Date.now() - job.startedAt < updates.UPDATE_START_GRACE_MS) return { ok: true, phase: 'running', job: job.kind, elapsed, line: '' };
    updates.upJob = null;
    return { ok: true, phase: 'done', job: job.kind, result: 'error', error: "The update service didn't start.", detail: '' };
  }
  updates.upJob = null;
  const done = { ok: true, phase: 'done', job: job.kind };
  if (job.canceled) return { ...done, result: 'canceled' };
  if (p.Result !== 'success' || p.ActiveState === 'failed') return { ...done, result: 'error', error: job.kind === 'rollback' ? "Couldn't go back to the previous version." : updates.updateErrorText(log), detail: updates.lastLine(log) };
  if (job.kind === 'rollback') {
    updates.rolledBackNow = true;
    return { ...done, result: 'rolledback' };
  }
  if (job.kind === 'check') {
    const c = updates.parseCheck(log);
    if (c.state === 'available') return { ...done, result: 'available', version: c.version, size: c.size };
    // "No changes" is also what a check says when the newest build is already downloaded and waiting for a restart
    const st = await updates.fetchStatus();
    if (st.ok && st.staged) return { ...done, result: 'staged', version: st.staged.version, time: st.staged.time };
    return { ...done, result: c.state === 'uptodate' ? 'uptodate' : 'unknown' };
  }
  const st = await updates.fetchStatus();
  if (st.ok) return st.staged ? { ...done, result: 'staged', version: st.staged.version, time: st.staged.time } : { ...done, result: 'uptodate' };
  const said = updates.parseApply(log);
  return { ...done, result: said || 'unknown' };
}
async function cancelUpdate() {
  const job = updates.upJob || (await updates.runningJob());
  if (!job) return { ok: true };
  job.canceled = true;
  const r = await updates.sysctl(['stop', job.unit], 30000);
  return r.ok ? { ok: true } : { ok: false, error: updates.UPDATE_PROBLEM[updates.ctlWhy(r)] };
}
async function restartNow() {
  if (config.running) return { ok: false, error: 'Close the game first.' };
  const r = await updates.sysctl(['reboot'], 15000);
  return r.ok ? { ok: true } : { ok: false, error: "Couldn't restart from here. Use the power button, or Desktop Mode." };
}
async function updateOp(op, p) {
  try {
    if (['start', 'reboot'].includes(op) && !pinLock.pinOk()) return pinLock.NEED_PIN;
    switch (op) {
      case 'info': return await updates.updateInfo();
      case 'start': return await startUpdate(p.job, p);
      case 'poll': return await pollUpdate();
      case 'cancel': return await cancelUpdate();
      case 'reboot': return await restartNow();
      default: return { ok: false, error: 'Unknown action.' };
    }
  } catch {
    return { ok: false, error: 'Something went wrong.' };
  }
}
ipcMain.handle('update', (_e, op, p) => updateOp(typeof op === 'string' ? op : '', p && typeof p === 'object' ? p : {}));

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const pinLock = require('./pinLock');
