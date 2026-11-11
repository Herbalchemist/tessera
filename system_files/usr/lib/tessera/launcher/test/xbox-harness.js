// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Loads the real main.js with a stand-in for Electron, so its IPC handlers (settings, scan, launch)
// can be called from a test. Nothing here is a real window, a real Steam or a real game: it shows
// that the wiring behaves, not that it works on a desktop.
const Module = require('module');
const path = require('path');
const fs = require('fs');

function deep() {
  const f = function () { return deep(); };
  return new Proxy(f, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : deep()), apply: () => deep(), construct: () => deep() });
}

// opts: { launcher: dir of main.js, tmp: scratch folder, spawned: [] collects spawn() calls }
async function load(opts) {
  const { launcher, tmp } = opts;
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  Object.assign(process.env, {
    TESSERA_DATA_DIR: path.join(tmp, 'data'), HOME: home, XDG_STATE_HOME: path.join(tmp, 'state'),
    XDG_DATA_HOME: path.join(tmp, 'xdg'), TESSERA_VAULT_DIR: path.join(tmp, 'vault'), PATH: process.env.PATH,
  });
  const handlers = {}, listeners = {}, sent = [], wc = {};
  const frame = {};
  class FakeWindow {
    constructor() {
      this.webContents = new Proxy({}, { get: (t, k) => (k === 'send' ? (ch, p) => sent.push([ch, p]) : k === 'mainFrame' ? frame : k === 'on' ? (ev, fn) => { (wc[ev] = wc[ev] || []).push(fn); } : () => deep()) });
      // any other window method (loadFile, show, on ...) does nothing
      return new Proxy(this, { get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : () => deep()) });
    }
    isDestroyed() { return false; }
    isVisible() { return true; }
  }
  const noop = () => {};
  const app = new Proxy({}, { get: (t, k) => (k === 'whenReady' ? () => Promise.resolve() : k === 'requestSingleInstanceLock' ? () => true : k === 'getPath' ? () => tmp : k === 'isPackaged' ? false : k === 'getVersion' ? () => '0.0.0' : noop) });
  const fake = {
    app, BrowserWindow: FakeWindow, Menu: { setApplicationMenu: noop },
    ipcMain: { handle: (c, f) => { handlers[c] = f; }, on: (c, f) => { listeners[c] = f; }, once: noop },
    net: { fetch: (...a) => fetch(...a) }, protocol: { registerSchemesAsPrivileged: noop, handle: noop }, session: deep(), screen: deep(), shell: deep(), dialog: deep(),
  };
  // spawn() is recorded and never really runs a program
  const realCp = require('child_process');
  const cp = opts.realSpawn ? realCp : { ...realCp, spawn: (file, args, o) => { (opts.spawned || []).push({ file, args, cwd: o && o.cwd }); const { EventEmitter } = require('events'); const e = new EventEmitter(); e.pid = 0; return e; } };
  const orig = Module._load;
  Module._load = function (req, parent, ...a) {
    if (req === 'electron') return fake;
    if (req === 'child_process' && parent && parent.filename && parent.filename.startsWith(launcher)) return cp;
    return orig.call(this, req, parent, ...a);
  };
  require(path.join(launcher, 'main.js'));
  Module._load = orig;
  // app.whenReady() has resolved and the window exists: let the page "finish loading", which is when
  // main.js reads the library and the settings
  await new Promise((r) => setImmediate(r));
  for (const fn of wc['did-finish-load'] || []) fn();
  // requests count only when they come from the launcher window's own page (main/ipcGuard.js)
  const ev = () => { const w = require(path.join(launcher, 'main', 'config')).mainWindow; return { sender: w.webContents, senderFrame: frame }; };
  return {
    handlers, listeners, sent,
    call: (ch, ...a) => handlers[ch](ev(), ...a),
    launch: (id) => listeners.launch(ev(), id),
  };
}
module.exports = { load };
