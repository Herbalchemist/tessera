// SPDX-License-Identifier: GPL-3.0-or-later
const { contextBridge, ipcRenderer } = require('electron');

// Narrow bridge: the page can ask to launch a known id or quit. Nothing else.
contextBridge.exposeInMainWorld('launcherAPI', {
  onInit: (cb) => ipcRenderer.on('init', (_e, data) => cb(data)),
  onGameExited: (cb) => ipcRenderer.on('game-exited', (_e, msg) => cb(msg)),
  onLaunchFailed: (cb) => ipcRenderer.on('launch-failed', (_e, msg) => cb(msg)),
  launch: (id) => ipcRenderer.send('launch', id),
  quit: () => ipcRenderer.send('quit'),
});
