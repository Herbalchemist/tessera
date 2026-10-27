// SPDX-License-Identifier: GPL-3.0-or-later
const { contextBridge, ipcRenderer } = require('electron');

// Narrow bridge. The page can launch a known id, quit, and ask for a fixed
// set of library actions. It never sends or receives file paths.
contextBridge.exposeInMainWorld('launcherAPI', {
  onInit: (cb) => ipcRenderer.on('init', (_e, data) => cb(data)),
  onGameExited: (cb) => ipcRenderer.on('game-exited', (_e, msg) => cb(msg)),
  onShiftTab: (cb) => ipcRenderer.on('shift-tab', (_e, dir) => cb(dir)),
  onDriveAdded: (cb) => ipcRenderer.on('drive-added', (_e, d) => cb(d)),
  onLaunchFailed: (cb) => ipcRenderer.on('launch-failed', (_e, msg) => cb(msg)),
  launch: (id) => ipcRenderer.send('launch', id),
  quit: () => ipcRenderer.invoke('quit'),
  library: (op, payload) => ipcRenderer.invoke('library', op, payload),
  browse: (op, payload) => ipcRenderer.invoke('browse', op, payload),
  settings: (op, payload) => ipcRenderer.invoke('settings', op, payload),
  scan: (op, payload) => ipcRenderer.invoke('scan', op, payload),
  storage: (op, payload) => ipcRenderer.invoke('storage', op, payload),
  addons: (op, payload) => ipcRenderer.invoke('addons', op, payload),
  shards: (op, payload) => ipcRenderer.invoke('shards', op, payload),
  profiles: (op, payload) => ipcRenderer.invoke('profiles', op, payload),
  update: (op, payload) => ipcRenderer.invoke('update', op, payload),
  installer: (op, payload) => ipcRenderer.invoke('installer', op, payload),
  power: (op) => ipcRenderer.invoke('power', op),
  audio: (op, payload) => ipcRenderer.invoke('audio', op, payload),
  bluetooth: (op, payload) => ipcRenderer.invoke('bluetooth', op, payload),
  wifi: (op, payload) => ipcRenderer.invoke('wifi', op, payload),
  summaries: () => ipcRenderer.invoke('summaries'),
  systemInfo: () => ipcRenderer.invoke('systemInfo'),
  pads: (op, payload) => ipcRenderer.invoke('pads', op, payload),
  browser: (op, payload) => ipcRenderer.invoke('browser', op, payload),
  onPads: (cb) => ipcRenderer.on('pads', (_e, data) => cb(data)),
  onBrowserAction: (cb) => ipcRenderer.on('browser-action', (_e, action) => cb(action)),
  guide: (op, payload) => ipcRenderer.invoke('guide', op, payload),
  onGuide: (cb) => ipcRenderer.on('guide', (_e, msg) => cb(msg)),
  onGraphics: (cb) => ipcRenderer.on('graphics', (_e, g) => cb(g)),
});
