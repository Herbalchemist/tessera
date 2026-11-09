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
const protocolHandlers = new Map();
const electron = {
  app, ipcMain, BrowserWindow,
  Menu: { setApplicationMenu() {} },
  protocol: { handle: (scheme, fn) => protocolHandlers.set(scheme, fn), registerSchemesAsPrivileged() {} },
  screen: { getPrimaryDisplay: display, getAllDisplays: () => [display()], on() {} },
  session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, webRequest: { onBeforeRequest() {} } } },
  net: { fetch: (...a) => fetch(...a) },
  nativeImage: null, // no picture shrinking here: art.js then serves the originals
  WebContentsView: class { constructor() { this.webContents = new EventEmitter(); } setBounds() {} },
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
