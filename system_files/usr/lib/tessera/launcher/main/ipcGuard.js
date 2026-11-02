// SPDX-License-Identifier: GPL-3.0-or-later
// Every request to the main process must come from the launcher's own page: its main frame in the
// launcher window. Anything else (a web page in the browser view, a widget's frame, a page that got
// into the window some other way) is refused before any handler sees it. Loaded right after
// config.js, before any part registers a handler, so it covers all of them (see main.js).
'use strict';

const { ipcMain } = require('electron');
const config = require('./config');

function trusted(event) {
  const win = config.mainWindow;
  return Boolean(
    event && win && !win.isDestroyed() &&
    event.sender === win.webContents &&
    event.senderFrame && event.senderFrame === win.webContents.mainFrame
  );
}

const handle = ipcMain.handle.bind(ipcMain);
const on = ipcMain.on.bind(ipcMain);
ipcMain.handle = (channel, fn) => handle(channel, (event, ...args) => (trusted(event) ? fn(event, ...args) : { ok: false, error: 'Not allowed.' }));
ipcMain.on = (channel, fn) => on(channel, (event, ...args) => { if (trusted(event)) fn(event, ...args); });

module.exports = { trusted };
