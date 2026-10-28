// SPDX-License-Identifier: GPL-3.0-or-later
// Sound, Bluetooth, Wi-Fi, controllers, and system info for the built-in widgets.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get browserPadNavigation() { return browserPadNavigation; },
  get browserShoulder() { return browserShoulder; }, set browserShoulder(v) { browserShoulder = v; },
  get padsCtl() { return padsCtl; },
};

const { app, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const prefs = require('./prefs');
const theming = require('./theming');
const addons = require('./addons');
const appWindow = require('./appWindow');
const storage = require('./storage');
const updates = require('./updates');

// ------------------------------------------------------------ sound, Bluetooth, Wi-Fi
// The work is in devices.js. What is asked for here is the operation name plus values that are
// checked there; pairing, joining, forgetting and the Wi-Fi switch need the PIN (when there is one).
const devices = require('../devices');

// Nintendo Switch controllers, read straight from the kernel (Chromium leaves them out; see pads.js).
// While the browser has the screen, LB / RB on them close it, like on any other controller.
const browserGamepad = require('../browser-gamepad');
const inputActions = require('../input-actions');
let browserShoulder = null;
const padBits = new Map();
const browserPadNavigation = new Map();
const padsCtl = require('../pads').create({
  prefs: () => ({ joycons: prefs.settings.pad.joycons }),
  onList: (p) => {
    const ids = new Set((p.pads || []).map(pad => pad.id));
    for (const id of padBits.keys()) {
      if (!ids.has(id)) { padBits.delete(id); web.clearBrowserPadNavigation(id); }
    }
    appWindow.send('pads', { type: 'list', ...p });
  },
  onMotion: (m) => appWindow.send('pads', { type: 'motion', ...m }),
  onFrame: (f) => {
    // Every pad here is a Nintendo controller. The launcher page gets its buttons as they are (it
    // reads them by role itself, like any controller); the browser handling below gets them by
    // role, under the Nintendo button settings (input-actions.js).
    const raw = f;
    f = { ...f, b: inputActions.roleBits(f.b | 0, inputActions.mapFor('nintendo', prefs.settings.pad)) };
    const before = padBits.get(f.id) || 0;
    padBits.set(f.id, f.b);

    const view = webView.browserView;
    const browserViewActive = Boolean(
      view && config.mainWindow && !config.mainWindow.isDestroyed() &&
      webView.browserViewAttached &&
      !view.webContents.isDestroyed()
    );

    if (browserShoulder || browserViewActive) {
      const down = f.b & ~before;
      const pressKey = browserViewActive ? web.sendBrowserViewKey : web.sendExternalBrowserKey;
      const axes = Array.isArray(f.a) ? f.a : [];

      if (browserViewActive) {
        // BrowserView receives page-navigation input directly. Browser controls which
        // operate Tessera itself go to the hidden launcher through a narrow IPC event.
        const actions = browserGamepad.standardButtonActions(down);
        actions.browserActions.forEach(web.sendBrowserAction);
        actions.keys.forEach(pressKey);
      } else {
        // Preserve the existing external-browser shoulder-button close behavior.
        if (browserShoulder && (down & (1 << 4))) { browserShoulder(-1); return; }
        if (browserShoulder && (down & (1 << 5))) { browserShoulder(1); return; }
        if (down & (1 << 0)) pressKey('ENTER');
        if (down & (1 << 1)) pressKey('ESC');
        if (down & (1 << 2)) pressKey('TAB');
      }

      const navigation = web.browserPadDirectionRepeater(f.id);
      for (const [bit, key] of [[12, 'UP'], [13, 'DOWN'], [14, 'LEFT'], [15, 'RIGHT']]) {
        navigation.set('dpad:' + bit, f.b & (1 << bit) ? key : '');
      }
      const lx = Number(axes[0]) || 0;
      const ly = Number(axes[1]) || 0;
      const rx = Number(axes[2]) || 0;
      const ry = Number(axes[3]) || 0;
      if (browserViewActive) {
        // The embedded page gets a real pointer: cursor, analog scrolling, trigger clicks.
        const src = 'pad:' + f.id;
        web.browserAnalog(src, 'lx', lx); web.browserAnalog(src, 'ly', ly);
        web.browserAnalog(src, 'rx', rx); web.browserAnalog(src, 'ry', ry);
        web.browserAnalog(src, 'lt', f.b & (1 << 6) ? 1 : 0);
        web.browserAnalog(src, 'rt', f.b & (1 << 7) ? 1 : 0);
        return; // Keep browser input away from the hidden launcher UI.
      }
      const left = Math.abs(lx) > Math.abs(ly)
        ? (Math.abs(lx) > 0.65 ? (lx < 0 ? 'LEFT' : 'RIGHT') : '')
        : (Math.abs(ly) > 0.65 ? (ly < 0 ? 'UP' : 'DOWN') : '');
      const right = Math.abs(rx) > Math.abs(ry)
        ? (Math.abs(rx) > 0.65 ? (rx < 0 ? 'LEFT' : 'RIGHT') : '')
        : (Math.abs(ry) > 0.65 ? (ry < 0 ? 'PAGEUP' : 'PAGEDOWN') : '');
      navigation.set('left-stick', left);
      navigation.set('right-stick', right);
      return; // Keep browser input away from the hidden launcher UI.
    }

    web.clearBrowserPadNavigation(f.id);
    appWindow.send('pads', { type: 'frame', ...raw });
  },
});
ipcMain.handle('pads', (_e, op, p) => {
  const on = Boolean(p && p.on);
  if (op === 'list') return padsCtl.list();
  if (op === 'grip') return padsCtl.setGrip(on);
  if (op === 'motion') return padsCtl.setMotion(on);
  if (op === 'regroup') return padsCtl.regroup();
  return { ok: false };
});
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const str = (v) => (typeof v === 'string' ? v : '');
function deviceHandler(table, needPin) {
  return async (_e, op, p) => {
    try {
      op = typeof op === 'string' ? op : '';
      p = p && typeof p === 'object' ? p : {};
      if (!Object.prototype.hasOwnProperty.call(table, op)) return { ok: false, error: 'Unknown action.' };
      if (needPin.includes(op) && !pinLock.pinOk()) return pinLock.NEED_PIN;
      return await table[op](p);
    } catch {
      return { ok: false, error: 'Something went wrong.' };
    }
  };
}
ipcMain.handle('audio', deviceHandler({
  info: () => devices.audio.info(),
  setDefault: (p) => devices.audio.setDefault(str(p.kind), str(p.id)),
  volume: (p) => devices.audio.setVolume(str(p.kind), str(p.id), num(p.pct)),
  mute: (p) => devices.audio.setMute(str(p.kind), str(p.id), p.on === true),
  profile: (p) => devices.audio.setProfile(str(p.card), str(p.profile)),
}, []));
ipcMain.handle('bluetooth', deviceHandler({
  info: () => devices.bluetooth.info(),
  power: (p) => devices.bluetooth.power(p.on === true),
  scan: (p) => devices.bluetooth.scan(p.on === true),
  stop: () => devices.bluetooth.stop(),
  pair: (p) => devices.bluetooth.pair(str(p.id)),
  connect: (p) => devices.bluetooth.connect(str(p.id)),
  disconnect: (p) => devices.bluetooth.disconnect(str(p.id)),
  forget: (p) => devices.bluetooth.forget(str(p.id)),
  poll: () => devices.bluetooth.poll(),
  ack: () => devices.bluetooth.ack(),
  cancel: () => devices.bluetooth.cancel(),
}, ['pair', 'forget']));
ipcMain.handle('wifi', deviceHandler({
  info: (p) => devices.wifi.info({ rescan: p.rescan === true }),
  rescan: () => devices.wifi.rescan(),
  radio: (p) => devices.wifi.radio(p.on === true),
  join: (p) => devices.wifi.join({ ssid: str(p.ssid), password: str(p.password), hidden: p.hidden === true }),
  connect: (p) => devices.wifi.connect({ ssid: str(p.ssid) }),
  disconnect: () => devices.wifi.disconnect(),
  forget: (p) => devices.wifi.forget({ ssid: str(p.ssid) }),
  poll: () => devices.wifi.poll(),
  ack: () => devices.wifi.ack(),
  cancel: () => devices.wifi.cancel(),
}, ['radio', 'join', 'forget']));
// Short notes for the Settings tiles ("HomeNetwork", "WH-1000XM5"). Each is given a few seconds and then left blank.
ipcMain.handle('summaries', async () => {
  const quick = (f) => Promise.race([Promise.resolve().then(f).catch(() => ''), new Promise((r) => setTimeout(() => r(''), 4000))]);
  const [w, b, a] = await Promise.all([quick(() => devices.wifi.summary()), quick(() => devices.bluetooth.summary()), quick(() => devices.audio.summary())]);
  // For the notes under the other Settings tiles: free space where the games live, add-ons, version.
  let home = null;
  try { const st = fs.statfsSync(os.homedir()); home = { free: st.bavail * st.bsize, total: st.blocks * st.bsize }; } catch { /* unknown */ }
  const addonsCount = addons.widgets.size + [...theming.themes.values()].filter((t) => !t.builtin).length;
  return { wifi: w || '', bluetooth: b || '', audio: a || '', home, addons: addonsCount, version: updates.LAUNCHER_VERSION };
});

// ---- system info, for the built-in CPU/Memory/Storage/Battery/Network/Uptime widgets.
// Everything here is a read; nothing here is ever written, and nothing here ever spawns a
// process — just /proc, /sys and Node's own os module, cheap enough for the renderer to poll
// once a second while one of these widgets is actually on screen (see tickInlays in renderer.js).
let cpuPrev = null; // { idle, total } from the last sample, so usage is a rate, not a snapshot
function cpuPct() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; }
  let pct = null;
  if (cpuPrev) {
    const dIdle = idle - cpuPrev.idle, dTotal = total - cpuPrev.total;
    if (dTotal > 0) pct = Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)));
  }
  cpuPrev = { idle, total };
  return pct; // null only on the very first call this process ever makes
}
function ramInfo() {
  try {
    const text = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (k) => { const m = new RegExp(`^${k}:\\s*(\\d+)`, 'm').exec(text); return m ? Number(m[1]) * 1024 : null; };
    const total = get('MemTotal');
    const avail = get('MemAvailable');
    if (total == null || avail == null) throw new Error('unreadable');
    return { total, used: Math.max(0, total - avail) };
  } catch {
    const total = os.totalmem(), free = os.freemem(); // older kernels without MemAvailable
    return { total, used: Math.max(0, total - free) };
  }
}
function storageInfo() {
  try {
    const drives = storage.storageDrives();
    const d = drives.find((x) => x.system) || drives[0];
    return d ? { free: d.free, total: d.total } : null;
  } catch { return null; }
}
function batteryInfo() {
  try {
    const base = '/sys/class/power_supply';
    const names = fs.readdirSync(base);
    // Controllers report their batteries here too, as scope "Device": those aren't the computer's.
    const bat = names.find((n) => {
      const r = (f) => { try { return fs.readFileSync(path.join(base, n, f), 'utf8').trim(); } catch { return ''; } };
      return r('type') === 'Battery' && r('scope') !== 'Device';
    });
    if (!bat) return { present: false };
    const read = (f) => { try { return fs.readFileSync(path.join(base, bat, f), 'utf8').trim(); } catch { return ''; } };
    const pct = Number(read('capacity'));
    const status = read('status'); // "Charging", "Discharging", "Full", "Not charging", "Unknown"
    return { present: true, pct: Number.isFinite(pct) ? pct : null, charging: status === 'Charging' || status === 'Full' };
  } catch { return { present: false }; }
}
let netPrev = null; // { at, rx, tx } from the last sample, so speed is a rate, not a snapshot
function networkInfo() {
  try {
    const base = '/sys/class/net';
    const names = fs.readdirSync(base).filter((n) => n !== 'lo');
    let rx = 0, tx = 0, up = false;
    for (const n of names) {
      try {
        if (fs.readFileSync(path.join(base, n, 'operstate'), 'utf8').trim() === 'up') up = true;
        rx += Number(fs.readFileSync(path.join(base, n, 'statistics', 'rx_bytes'), 'utf8').trim()) || 0;
        tx += Number(fs.readFileSync(path.join(base, n, 'statistics', 'tx_bytes'), 'utf8').trim()) || 0;
      } catch { /* that interface came or went between the readdir and the read; skip it */ }
    }
    const now = Date.now();
    let rxRate = null, txRate = null;
    if (netPrev) {
      const dt = (now - netPrev.at) / 1000;
      if (dt > 0) { rxRate = Math.max(0, (rx - netPrev.rx) / dt); txRate = Math.max(0, (tx - netPrev.tx) / dt); }
    }
    netPrev = { at: now, rx, tx };
    return { connected: up, rxRate, txRate };
  } catch { return { connected: false, rxRate: null, txRate: null }; }
}
// Controller batteries (Xbox, PlayStation, Nintendo drivers all list them as scope "Device").
function controllerBatteries() {
  const out = [];
  try {
    const base = '/sys/class/power_supply';
    for (const n of fs.readdirSync(base)) {
      const r = (f) => { try { return fs.readFileSync(path.join(base, n, f), 'utf8').trim(); } catch { return ''; } };
      if (r('type') !== 'Battery' || r('scope') !== 'Device') continue;
      const pct = Number(r('capacity'));
      const level = r('capacity_level'); // some pads only say "Low"/"Normal"/"Full"
      const status = r('status');
      const model = r('model_name') || (/nintendo|joycon/i.test(n) ? 'Nintendo controller' : /ps-controller|dualsense|sony/i.test(n) ? 'PlayStation controller' : /xpad|xbox|gip/i.test(n) ? 'Xbox controller' : 'Controller');
      out.push({ name: model.slice(0, 40), pct: Number.isFinite(pct) && r('capacity') !== '' ? pct : null, level: level || null, charging: status === 'Charging' || status === 'Full' });
      if (out.length >= 8) break;
    }
  } catch { /* none */ }
  return out;
}
function systemInfo() {
  return { cpu: cpuPct(), ram: ramInfo(), storage: storageInfo(), battery: batteryInfo(), network: networkInfo(), uptime: os.uptime(), pads: controllerBatteries() };
}
ipcMain.handle('systemInfo', () => systemInfo());
app.on('before-quit', () => { try { devices.bluetooth.stop(); } catch { /* going away anyway */ } });

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const pinLock = require('./pinLock');
const web = require('./web');
const webView = require('./webView');
