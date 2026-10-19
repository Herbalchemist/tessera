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
  quit: () => ipcRenderer.send('quit'),
  library: (op, payload) => ipcRenderer.invoke('library', op, payload),
  browse: (op, payload) => ipcRenderer.invoke('browse', op, payload),
  settings: (op, payload) => ipcRenderer.invoke('settings', op, payload),
  scan: (op, payload) => ipcRenderer.invoke('scan', op, payload),
  storage: (op, payload) => ipcRenderer.invoke('storage', op, payload),
  addons: (op) => ipcRenderer.invoke('addons', op),
  update: (op, payload) => ipcRenderer.invoke('update', op, payload),
});
