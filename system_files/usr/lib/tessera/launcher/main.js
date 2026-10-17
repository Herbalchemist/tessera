// SPDX-License-Identifier: GPL-3.0-or-later
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Mutable data lives outside the read-only image, never under /usr.
// Override the folder with TESSERA_DATA_DIR, or the file with LAUNCHER_LIBRARY.
// The library is library.json; an older games.json (a plain list) still works.
const DATA_DIR =
  process.env.TESSERA_DATA_DIR ||
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'tessera');
const LIBRARY_FILE = process.env.LAUNCHER_LIBRARY || path.join(DATA_DIR, 'library.json');
const LEGACY_FILE = process.env.LAUNCHER_GAMES || path.join(DATA_DIR, 'games.json');

const TABS = ['home', 'library', 'apps'];
const KINDS = ['game', 'app'];

let mainWindow = null;
let items = [];   // launchable things, with paths. Never sent to the renderer.
let running = false;

// Library format:
//   items:      [{ id, kind: "game"|"app", title, path }]
//   categories: [{ id, title, tab?: "home"|"library"|"apps", entries: [id, ...] }]
// An entry is an item id or another category id (shown as a folder tile).
// A category with a tab is a row on that tab; without one it is only a folder.
function readLibraryFile() {
  for (const file of [LIBRARY_FILE, LEGACY_FILE]) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return { data: { items: data, categories: [] } };
      if (data && typeof data === 'object') return { data };
      return { error: `${path.basename(file)} has the wrong shape.` };
    } catch (e) {
      return { error: `${path.basename(file)} is not valid JSON: ${e.message}` };
    }
  }
  return { error: `No library found. Create ${LIBRARY_FILE}` };
}

function loadLibrary() {
  const empty = { tabs: { home: [], library: [], apps: [] }, folders: {} };
  const { data, error } = readLibraryFile();
  if (error) return { ...empty, items: [], error };

  let skipped = 0;
  const ids = new Set();
  const good = [];
  for (const g of Array.isArray(data.items) ? data.items : []) {
    const ok =
      g &&
      typeof g.id === 'string' &&
      typeof g.title === 'string' &&
      typeof g.path === 'string' &&
      path.isAbsolute(g.path) &&
      (g.kind === undefined || KINDS.includes(g.kind)) &&
      !ids.has(g.id);
    if (!ok) { skipped++; continue; }
    ids.add(g.id);
    good.push({ id: g.id, kind: g.kind || 'game', title: g.title, path: g.path });
  }

  const cats = new Map();
  for (const c of Array.isArray(data.categories) ? data.categories : []) {
    const ok =
      c &&
      typeof c.id === 'string' &&
      typeof c.title === 'string' &&
      Array.isArray(c.entries) &&
      (c.tab === undefined || TABS.includes(c.tab)) &&
      !ids.has(c.id) &&
      !cats.has(c.id);
    if (!ok) { skipped++; continue; }
    cats.set(c.id, c);
  }

  const byId = new Map(good.map((g) => [g.id, g]));
  // Turn entry ids into tiles. Unknown ids and self-references are dropped.
  const tilesFor = (c) =>
    c.entries
      .map((ref) => {
        if (typeof ref !== 'string' || ref === c.id) return null;
        const it = byId.get(ref);
        if (it) return { id: it.id, title: it.title, kind: it.kind };
        const sub = cats.get(ref);
        if (sub) return { id: sub.id, title: sub.title, kind: 'folder' };
        return null;
      })
      .filter(Boolean);

  const tabs = { home: [], library: [], apps: [] };
  const folders = {};
  for (const c of cats.values()) {
    const tiles = tilesFor(c);
    folders[c.id] = { title: c.title, tiles };
    if (c.tab) tabs[c.tab].push({ id: c.id, title: c.title, tiles });
  }

  // Automatic rows so a fresh install is never empty.
  const tileOf = (it) => ({ id: it.id, title: it.title, kind: it.kind });
  const games = good.filter((i) => i.kind === 'game').map(tileOf);
  const apps = good.filter((i) => i.kind === 'app').map(tileOf);
  if (!tabs.library.length && games.length) tabs.library.push({ id: '_all_games', title: 'All games', tiles: games });
  if (!tabs.apps.length && apps.length) tabs.apps.push({ id: '_all_apps', title: 'All apps', tiles: apps });
  if (!tabs.home.length) {
    if (games.length) tabs.home.push({ id: '_home_games', title: 'Games', tiles: games });
    if (apps.length) tabs.home.push({ id: '_home_apps', title: 'Apps', tiles: apps });
  }

  return {
    items: good,
    tabs,
    folders,
    error: skipped ? `${skipped} entry(ies) skipped: check ids, titles and absolute paths.` : null,
  };
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#10151c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    const lib = loadLibrary();
    items = lib.items;
    // The renderer only ever sees ids, titles and kinds, never file paths.
    send('init', { tabs: lib.tabs, folders: lib.folders, error: lib.error });
  });

  // Keyboard fallback exit. Local to this window, so it never steals keys from a game.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      app.quit();
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(createWindow);
}

ipcMain.on('launch', (_event, id) => {
  if (running || typeof id !== 'string') return;

  const game = items.find((g) => g.id === id);
  if (!game) return send('launch-failed', 'Unknown game.');

  try {
    fs.accessSync(game.path, fs.constants.X_OK);
  } catch {
    return send(
      'launch-failed',
      `Can't run ${path.basename(game.path)}. Check that it exists and is executable.`
    );
  }

  running = true;
  let finished = false;

  // 'error' and 'close' can both fire; only the first one counts.
  const finish = (message) => {
    if (finished) return;
    finished = true;
    running = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    send('game-exited', message || null);
  };

  mainWindow.hide();

  // No shell, args passed separately, game runs from its own folder so
  // AnyPS5 can find libs/ and app0/. stdio is ignored so an unread pipe
  // can never fill up and freeze the game.
  const child = spawn(game.path, [], {
    cwd: path.dirname(game.path),
    shell: false,
    stdio: 'ignore',
  });

  child.once('error', (err) => finish(`Launch failed: ${err.message}`));
  child.once('close', (code, signal) =>
    finish(code === 0 ? null : `Game exited (${code !== null ? 'code ' + code : signal}).`)
  );
});

ipcMain.on('quit', () => app.quit());

app.on('window-all-closed', () => app.quit());
