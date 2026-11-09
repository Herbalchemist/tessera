// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the full Ludus's own main process, unchanged, run without its Electron window.
// Every part of it (library, themes, profiles, PIN, storage, updates, installer, add-ons, Steam,
// launching games) is loaded exactly as main.js loads it; only `require('electron')` is answered
// by the stand-ins below. The Qt screen talks to it over one private socket (fd 3, made by
// ludus.py and handed only to this process), one JSON message per line:
//   in:  { id, ch, args }                 a request, the same channels as the full Ludus's preload.js
//   out: { id, ok, result } / { id, ok: false, error }
//   out: { event, data }                   what the main process sends its page (init, game-exited…)
//   out: { window: 'hide' | 'show' | 'focus' }
'use strict';
const Module = require('module');
const net = require('net');
const path = require('path');
const { EventEmitter } = require('events');

const LAUNCHER = process.env.TESSERA_LAUNCHER_DIR || '/usr/lib/tessera/launcher';
const sock = new net.Socket({ fd: Number(process.env.TESSERA_BRIDGE_FD || 3), readable: true, writable: true });
const out = (msg) => { try { sock.write(JSON.stringify(msg) + '\n'); } catch { /* the screen has gone */ } };

// ---- the stand-ins for Electron
const handlers = new Map(); // channel -> { kind: 'handle' | 'on', fn }
const ipcMain = {
  handle: (ch, fn) => handlers.set(ch, { kind: 'handle', fn }),
  on: (ch, fn) => handlers.set(ch, { kind: 'on', fn }),
  removeHandler: (ch) => handlers.delete(ch),
};
const webContents = new EventEmitter();
webContents.send = (event, data) => out({ event, data });
webContents.mainFrame = {};
webContents.setWindowOpenHandler = () => {};
webContents.isDestroyed = () => false;
webContents.getURL = () => 'file://' + path.join(LAUNCHER, 'index.html');
webContents.focus = () => {};
let theWindow = null;
class BrowserWindow extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.webContents = webContents;
    this.contentView = { addChildView() {}, removeChildView() {}, children: [] };
    theWindow = this;
  }
  loadFile() { setImmediate(() => webContents.emit('did-finish-load')); return Promise.resolve(); }
  loadURL() { return this.loadFile(); }
  isDestroyed() { return false; }
  hide() { out({ window: 'hide' }); }
  show() { out({ window: 'show' }); }
  focus() { out({ window: 'focus' }); }
  isVisible() { return true; }
  isFocused() { return true; }
  getContentBounds() { return { x: 0, y: 0, ...screenSize() }; }
  getBounds() { return this.getContentBounds(); }
  setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setFullScreen() {} setBounds() {} setContentSize() {} setPosition() {}
  static getAllWindows() { return theWindow ? [theWindow] : []; }
}
const screenSize = () => {
  const [w, h] = String(process.env.TESSERA_SCREEN || '1920x1080').split('x').map(Number);
  return { width: w || 1920, height: h || 1080 };
};
const display = () => ({ id: 1, scaleFactor: 1, bounds: { x: 0, y: 0, ...screenSize() }, workArea: { x: 0, y: 0, ...screenSize() }, size: screenSize(), workAreaSize: screenSize() });
const app = new EventEmitter();
Object.assign(app, {
  whenReady: () => Promise.resolve(),
  isReady: () => true,
  requestSingleInstanceLock: () => true,
  quit: () => process.exit(0),
  exit: (code = 0) => process.exit(code),
  getPath: (name) => {
    const home = require('os').homedir();
    if (name === 'home') return home;
    if (name === 'temp') return require('os').tmpdir();
    if (name === 'downloads') return path.join(home, 'Downloads');
    return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'tessera-launcher'); // userData: Electron's own folder name for this app
  },
  setPath: () => {},
  getVersion: () => require(path.join(LAUNCHER, 'package.json')).version,
  commandLine: { appendSwitch() {} },
});
// The embedded browser. The page itself is Qt's (QtWebEngine, in the screen); the full Ludus's
// own browser code (the PIN and guest checks, the controller pointer, the sticks and buttons read
// from /dev/input) runs as it is and drives these stand-ins, which pass what it does to the screen:
//   browser-load  { url }              load this address
//   browser-input { type, x, y... }    a pointer or key event for the page (Electron's sendInputEvent shape)
//   browser-cursor { x, y, visible, down }  where to draw the pointer
//   browser-close                      drop the page (another profile is playing)
//   browser-forget { partition }       a removed profile's browser data
// and the screen tells it back what the page shows (__qt 'browserState') so a resumed page is known.
let pageView = null;
class BrowserView {
  constructor(opts = {}) {
    this.page = Boolean(opts.webPreferences && opts.webPreferences.partition);
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.visible = true;
    const st = this.state = { url: '', title: '', loading: false, canGoBack: false };
    const wc = this.webContents = new EventEmitter();
    wc.session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {} };
    wc.setWindowOpenHandler = () => {};
    wc.isDestroyed = () => false;
    wc.getURL = () => st.url;
    wc.getTitle = () => st.title;
    wc.isLoading = () => st.loading;
    wc.navigationHistory = { canGoBack: () => st.canGoBack };
    wc.focus = () => {};
    wc.loadURL = (u) => { if (this.page) { st.url = String(u); st.loading = true; out({ event: 'browser-load', data: String(u) }); } return Promise.resolve(); };
    wc.close = () => { if (this.page) { st.url = ''; st.title = ''; out({ event: 'browser-close' }); pageView = null; } };
    wc.sendInputEvent = (e) => { if (this.page) out({ event: 'browser-input', data: e }); };
    wc.capturePage = async () => ({ isEmpty: () => true });
    // the pointer's press state is told to the pointer's own little view this way
    wc.executeJavaScript = (code) => { const m = !this.page && /'down', (true|false)/.exec(String(code)); if (m) out({ event: 'browser-cursor', data: { down: m[1] === 'true' } }); return Promise.resolve(); };
    if (this.page) pageView = this;
  }
  setBounds(b) { this.bounds = b; this.cursor(); }
  setVisible(v) { this.visible = Boolean(v); this.cursor(); }
  setBackgroundColor() {}
  cursor() { if (!this.page) out({ event: 'browser-cursor', data: { x: this.bounds.x, y: this.bounds.y, visible: this.visible } }); }
}
const browserSession = {
  defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, webRequest: { onBeforeRequest() {} } },
  // a removed profile's browser data: the screen deletes its folder
  fromPartition: (name) => ({ clearStorageData: () => { out({ event: 'browser-forget', data: { partition: String(name) } }); return Promise.resolve(); }, clearCache: () => Promise.resolve() }),
};
const protocolHandlers = new Map();
const electron = {
  app, ipcMain, BrowserWindow,
  Menu: { setApplicationMenu() {} },
  protocol: { handle: (scheme, fn) => protocolHandlers.set(scheme, fn), registerSchemesAsPrivileged() {} },
  screen: { getPrimaryDisplay: display, getAllDisplays: () => [display()], on() {} },
  net: { fetch: (...a) => fetch(...a) },
  nativeImage: null, // no picture shrinking here: art.js then serves the originals
  WebContentsView: BrowserView,
  session: browserSession,
  contextBridge: { exposeInMainWorld() {} },
  ipcRenderer: { on() {}, send() {}, invoke: async () => null },
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electron;
  return load.call(this, request, parent, isMain);
};

// ---- requests from the screen. The full Ludus checks each one came from its own page; here
// the socket is that page (nothing else can reach it), so requests carry the page's identity.
const event = { sender: webContents, senderFrame: webContents.mainFrame, reply() {} };
async function serve(msg) {
  const { id, ch, args } = msg;
  if (ch === '__qt') {
    // Small helpers for the screen that the full Ludus does inside its own page: key names, the key tables.
    try {
      const kbm = require(path.join(LAUNCHER, 'keyboard-map.js'));
      const op = String(args && args[0] || '');
      if (op === 'keyLabels') return out({ id, ok: true, result: (args[1] || []).map((c) => kbm.label(String(c))) });
      if (op === 'kbm') return out({ id, ok: true, result: { ACTIONS: kbm.ACTIONS, ACTION_LABELS: kbm.ACTION_LABELS, PRESET_NAMES: kbm.PRESET_NAMES, PRESETS: kbm.PRESETS, MAX_PER_ACTION: kbm.MAX_PER_ACTION } });
      if (op === 'kb') return out({ id, ok: true, result: require(path.join(LAUNCHER, 'main', 'prefs')).kbPayload() });
      if (op === 'browserState') {
        const st = args[1] || {};
        if (pageView) Object.assign(pageView.state, { url: String(st.url || '').slice(0, 2000), title: String(st.title || '').slice(0, 200), loading: Boolean(st.loading), canGoBack: Boolean(st.canGoBack) });
        return out({ id, ok: true, result: true });
      }
      if (op === 'browserProfile') return out({ id, ok: true, result: String(require(path.join(LAUNCHER, 'main', 'prefs')).settings.activeProfile || '') });
      if (op === 'downloads') return out({ id, ok: true, result: require(path.join(LAUNCHER, 'main', 'addons')).vaultFolder('downloads') });
      return out({ id, ok: false, error: 'unknown' });
    } catch (e) { return out({ id, ok: false, error: String(e && e.message || e) }); }
  }
  if (ch === '__art') {
    // A game picture, for the screen's image provider: the same answer the tessera-art:// scheme gives.
    try {
      const art = require(path.join(LAUNCHER, 'main', 'art'));
      const r = await art.serveArtAsync(String(args && args[0] || ''));
      const body = r.body ? Buffer.from(r.body instanceof ArrayBuffer ? new Uint8Array(r.body) : r.body) : null;
      return out({ id, ok: r.status === 200 && body, result: body ? { type: (r.headers || {})['Content-Type'] || '', data: body.toString('base64') } : null });
    } catch (e) { return out({ id, ok: false, error: String(e && e.message || e) }); }
  }
  const h = handlers.get(ch);
  if (!h) return out({ id, ok: false, error: 'Unknown request: ' + ch });
  try {
    const result = await h.fn(event, ...(Array.isArray(args) ? args : []));
    out({ id, ok: true, result: h.kind === 'handle' ? result : null });
  } catch (e) {
    out({ id, ok: false, error: String(e && e.message || e) });
  }
}
let buf = '';
sock.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg && typeof msg.ch === 'string') serve(msg);
  }
});
sock.on('close', () => process.exit(0)); // the screen closed: so does this
sock.on('error', () => process.exit(0));

// ---- the full Ludus's main process, as main.js loads it
process.chdir(LAUNCHER);
require(path.join(LAUNCHER, 'main.js'));
if (process.env.LUDUS_QT_FAKE_DEVICES) require('./fake-devices')(handlers); // screenshot runs only
