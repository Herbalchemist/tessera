// SPDX-License-Identifier: GPL-3.0-or-later
// "Report a problem": a text file about this machine and Tessera's recent logs, for the person to
// attach to an issue if they choose. Part of the launcher's main process (see main.js for the order
// the parts load in).
//
// This is not telemetry: nothing is ever sent anywhere. The file is written only when the person
// asks, lands in ~/Tessera/Reports, can be read in full on screen first, and sharing it is their
// own doing. Personal details are taken out before it is written: the account name and home
// folder, the computer's name, network and hardware addresses, IP addresses and e-mail addresses.
// PINs, passwords and Wi-Fi network names are never collected in the first place.

module.exports = {
  get scrub() { return scrub; },
  get buildReport() { return buildReport; },
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { ipcMain, screen } = require('electron');
const config = require('./config');
const prefs = require('./prefs');
const addons = require('./addons');
const ipc = require('./ipc');

// Runs a command without a shell; its output, or a note that it couldn't run. Never throws.
function run(cmd, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim();
      if (out) return resolve(out);
      resolve(err ? `(couldn't run ${cmd}: ${String(stderr || err.message).trim().split('\n')[0]})` : '');
    });
  });
}
const readTail = (file, lines) => {
  try {
    const all = fs.readFileSync(file, 'utf8').split('\n');
    return all.slice(-lines).join('\n').trim() || '(empty)';
  } catch { return '(not there)'; }
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Takes out what could identify the person or their network. Applied to the whole report.
function scrub(text, who = {}) {
  let t = String(text);
  const home = who.home || os.homedir();
  const user = who.user || (() => { try { return os.userInfo().username; } catch { return ''; } })();
  const host = who.host || os.hostname();
  if (home && home.length > 1) t = t.replace(new RegExp(esc(home), 'g'), '~');
  // the computer's name first: it often contains the account name (aleck-pc)
  if (host && host.length > 1 && host !== 'tessera' && host !== 'localhost') t = t.replace(new RegExp(`\\b${esc(host)}\\b`, 'gi'), '[computer]');
  if (user && user.length > 1 && !['root', 'tessera', 'liveuser'].includes(user)) t = t.replace(new RegExp(`\\b${esc(user)}\\b`, 'gi'), '[user]');
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]');
  t = t.replace(/\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, '[hardware address]');
  t = t.replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, (ip) => (ip === '127.0.0.1' || ip === '0.0.0.0' ? ip : '[ip]'));
  t = t.replace(/\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi, '[ip]');
  return t;
}

// What goes in a report (also what the screen lists under "What goes in it").
const CONTENTS = [
  'Tessera: the launcher version and which build and update the machine runs',
  'The system: its version and the kernel',
  'Hardware: processor, memory, graphics card and its driver, screens, controllers by name',
  'Controllers and Bluetooth: what the system logged while connecting them, and which controller drivers are loaded',
  'Starting up: whether Tessera signs in at boot, and the login screen',
  'Tessera\'s own logs from this and the last session, and the login screen\'s log',
  'Settings that change how things work (no PIN, no names, no addresses)',
];

async function buildReport() {
  const s = prefs.settings;
  const parts = [];
  const sec = (title, body) => parts.push(`== ${title}\n${String(body || '').trim() || '(nothing)'}\n`);
  let version = '?';
  try { version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version; } catch { /* unknown */ }

  // Tessera, and the build the machine runs
  let image = await run('bootc', ['status', '--format', 'json'], 10000);
  try {
    const j = JSON.parse(image);
    const pick = (d) => d && d.image ? `${d.image.image && d.image.image.image} version ${d.image.version || '?'} (${d.image.timestamp || '?'})` : 'none';
    image = `booted: ${pick(j.status && j.status.booted)}\nwaiting to start: ${pick(j.status && j.status.staged)}\nprevious: ${pick(j.status && j.status.rollback)}`;
  } catch { /* the plain output (or why it couldn't run) */ }
  sec('Tessera', `launcher ${version}\n${image}`);

  let osr = '';
  try { osr = fs.readFileSync('/usr/lib/os-release', 'utf8').split('\n').filter((l) => /^(PRETTY_NAME|VERSION|VERSION_ID|IMAGE_ID|BUILD_ID|ID)=/.test(l)).join('\n'); } catch { osr = '(no os-release)'; }
  sec('System', `${osr}\nkernel ${os.release()}\nup ${Math.round(os.uptime() / 60)} minutes`);

  // Hardware
  const cpus = os.cpus();
  const gpu = await run('lspci', ['-k', '-d', '::0300']);
  const gpu3d = await run('lspci', ['-k', '-d', '::0302']);
  let screens = '';
  try { screens = screen.getAllDisplays().map((d) => `${d.size.width}x${d.size.height} at ${d.displayFrequency || '?'} Hz, scale ${d.scaleFactor}${d.internal ? ' (built in)' : ''}`).join('\n'); } catch { screens = '(unknown)'; }
  let pads = '';
  try {
    pads = fs.readFileSync('/proc/bus/input/devices', 'utf8').split('\n\n')
      .filter((b) => /Handlers=.*\bjs\d/.test(b))
      .map((b) => { const n = /N: Name="([^"]*)"/.exec(b); const v = /Vendor=([0-9a-f]{4}) Product=([0-9a-f]{4})/.exec(b); return `${n ? n[1] : '?'}${v ? ` (${v[1]}:${v[2]})` : ''}`; })
      .join('\n');
  } catch { pads = '(unknown)'; }
  sec('Hardware', [
    `processor: ${cpus.length ? cpus[0].model : '?'} (${cpus.length} threads)`,
    `memory: ${Math.round(os.totalmem() / 2 ** 30)} GB`,
    `graphics:\n${[gpu, gpu3d].filter(Boolean).join('\n') || '(none found)'}`,
    `screens:\n${screens}`,
    `controllers:\n${pads || '(none connected)'}`,
  ].join('\n'));

  // Starting up
  const dm = await run('readlink', ['-f', '/etc/systemd/system/display-manager.service']);
  const autologinFiles = ['/etc/plasmalogin.conf.d/zzz-tessera-autologin.conf', '/etc/sddm.conf.d/zzz-tessera-autologin.conf'].filter((f) => fs.existsSync(f));
  sec('Starting up', [
    `Tessera signs in at boot (tessera-autologin.service): ${await run('systemctl', ['is-enabled', 'tessera-autologin.service'])}`,
    `turned off by /etc/tessera/no-autologin: ${fs.existsSync('/etc/tessera/no-autologin') ? 'yes' : 'no'}`,
    `sign-in settings written: ${autologinFiles.join(', ') || 'none'}`,
    `login screen: ${path.basename(dm || '?')} (${await run('systemctl', ['is-active', 'display-manager.service'])})`,
  ].join('\n'));

  // Logs
  const state = path.dirname(config.LOG_DIR);
  sec('Tessera session log (this session)', readTail(path.join(state, 'session.log'), 200));
  sec('Tessera session log (the session before)', readTail(path.join(state, 'session.log.1'), 120));
  let logs = [];
  try { logs = fs.readdirSync(config.LOG_DIR).filter((f) => f.endsWith('.log')).slice(0, 8); } catch { /* none */ }
  for (const f of logs) sec(`Log: ${f}`, readTail(path.join(config.LOG_DIR, f), 80));
  // Controllers that pair but never work: the kernel's Nintendo/PlayStation/Xbox drivers and
  // Bluetooth say why here (a handshake that timed out, a driver that didn't load).
  const kern = await run('journalctl', ['-k', '-b', '--no-pager', '-o', 'short-monotonic', '-g', 'nintendo|joycon|joy-con|hid|bluetooth|xpad|playstation|sony', '-n', '120'], 8000);
  sec('Controllers and Bluetooth (kernel, this boot)', kern);
  sec('Bluetooth service (this boot)', await run('journalctl', ['-b', '-u', 'bluetooth', '--no-pager', '-n', '60', '-o', 'short-monotonic'], 8000));
  sec('Controller drivers loaded', await run('sh', ['-c', 'lsmod | grep -i -E "^(hid_nintendo|hid_playstation|xpad|hid_xpadneo|hid_steam)\\b" || echo "(none of them)"']));
  sec('Joy-Con helper (joycond)', await run('systemctl', ['is-active', 'joycond.service']));
  sec('Steam running', await run('sh', ['-c', 'pgrep -x steam >/dev/null && echo yes || echo no']));
  sec('Login screen log (this boot)', await run('journalctl', ['-b', '-u', 'plasmalogin', '-u', 'sddm', '--no-pager', '-n', '80', '-o', 'short-monotonic'], 8000));

  // Settings that change behaviour: no PIN (not even its hash), no profile names, no folders
  sec('Settings', [
    `theme: ${s.theme && s.theme.active}`,
    `admin PIN set: ${s.pin ? 'yes' : 'no'}; also guards the browser: ${s.pinBrowser !== false ? 'yes' : 'no'}`,
    `profiles: ${s.profiles.length}${s.activeProfile ? ' (one playing)' : ' (Guest playing)'}; Guest may: ${Object.entries(s.guest || {}).filter(([, v]) => v).map(([k]) => k).join(', ')}`,
    `controller: ${JSON.stringify({ ...s.pad, remap: Object.keys(s.pad.remap || {}) })}`,
    `keyboard layout: ${s.kb && s.kb.preset}`,
    `library folders: ${s.scanRoots.length}; shards on: ${(s.codeAddons && s.codeAddons.enabled.length) || 0}; unverified shards allowed: ${s.codeAddons && s.codeAddons.allowUnverified ? 'yes' : 'no'}`,
  ].join('\n'));

  const head = `Tessera problem report, made ${new Date().toISOString()}\n` +
    'Made on this machine when asked. Nothing in it was sent anywhere.\n' +
    'Personal details (account and computer names, network and hardware addresses, e-mail addresses) are replaced with [brackets].\n\n';
  return scrub(head + parts.join('\n'));
}

const REPORT_NAME_RE = /^tessera-report-\d{8}-\d{6}\.txt$/;
const reportsDir = () => addons.vaultFolder('reports');
ipcMain.handle('report', ipc.safe(async (op, p) => {
  if (op === 'contents') return { ok: true, contents: CONTENTS, folder: reportsDir() };
  if (op === 'make') {
    let text;
    try { text = await buildReport(); } catch (e) { return { ok: false, error: "Couldn't make the report." }; }
    const d = new Date();
    const stamp = d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const name = `tessera-report-${stamp}.txt`;
    fs.mkdirSync(reportsDir(), { recursive: true });
    fs.writeFileSync(path.join(reportsDir(), name), text, { mode: 0o644 });
    return { ok: true, name, text, folder: reportsDir().replace(os.homedir(), '~') };
  }
  if (op === 'delete') {
    if (typeof p.name !== 'string' || !REPORT_NAME_RE.test(p.name)) return { ok: false, error: 'Bad request.' };
    try { fs.unlinkSync(path.join(reportsDir(), p.name)); } catch { /* already gone */ }
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
}));
