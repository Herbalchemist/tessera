// SPDX-License-Identifier: GPL-3.0-or-later
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Games live outside the app so you can edit them without touching code.
// Override with LAUNCHER_GAMES=/path/to/games.json
// Mutable data lives outside the read-only image, never under /usr.
// Override with TESSERA_DATA_DIR. Games are listed in games.json inside it.
const DATA_DIR =
  process.env.TESSERA_DATA_DIR ||
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'tessera');
const GAMES_FILE = process.env.LAUNCHER_GAMES || path.join(DATA_DIR, 'games.json');

let mainWindow = null;
let games = [];
let running = false;

function loadGames() {
  let raw;
  try {
    raw = fs.readFileSync(GAMES_FILE, 'utf8');
  } catch {
    return { games: [], error: `No game list found. Create ${GAMES_FILE}` };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { games: [], error: `games.json is not valid JSON: ${e.message}` };
  }
  if (!Array.isArray(data)) {
    return { games: [], error: 'games.json must be a list of games.' };
  }
  const seen = new Set();
  const valid = data.filter((g) => {
    const ok =
      g &&
      typeof g.id === 'string' &&
      typeof g.title === 'string' &&
      typeof g.path === 'string' &&
      path.isAbsolute(g.path) &&
      !seen.has(g.id);
    if (ok) seen.add(g.id);
    return ok;
  });
  const skipped = data.length - valid.length;
  return {
    games: valid,
    error: skipped
      ? `${skipped} game(s) skipped: each needs a unique id, a title, and an absolute path.`
      : null,
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
    const result = loadGames();
    games = result.games;
    // The renderer only ever sees ids and titles, never file paths.
    send('init', {
      games: games.map((g) => ({ id: g.id, title: g.title })),
      error: result.error,
    });
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

  const game = games.find((g) => g.id === id);
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
