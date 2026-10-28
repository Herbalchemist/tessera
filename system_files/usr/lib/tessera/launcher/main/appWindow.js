// SPDX-License-Identifier: GPL-3.0-or-later
// The launcher window and app startup.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get guideHelperShown() { return guideHelperShown; }, set guideHelperShown(v) { guideHelperShown = v; },
  get launcherRunning() { return launcherRunning; },
  get send() { return send; },
  get steamRunning() { return steamRunning; },
};

const { app, BrowserWindow, protocol, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const library = require('./library');
const prefs = require('./prefs');
const theming = require('./theming');
const art = require('./art');
const addons = require('./addons');
const shards = require('./shards');

// ----------------------------------------------------------------- window

function send(channel, payload) {
  if (config.mainWindow && !config.mainWindow.isDestroyed()) config.mainWindow.webContents.send(channel, payload);
}

// The background colour of the saved theme, read straight from the settings file (nothing
// else is loaded yet), so a light theme doesn't flash dark before the page draws.
function savedBackground() {
  try {
    const d = JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf8'));
    const id = d && d.theme && typeof d.theme.active === 'string' ? d.theme.active : 'stock';
    const own = d && d.theme && d.theme.values && d.theme.values[id] && d.theme.values[id].bg;
    if (typeof own === 'string' && theming.HEX_RE.test(own)) return own;
    const b = theming.BUILTIN_THEMES.find((t) => t.id === id);
    if (b && theming.HEX_RE.test(b.defaults.bg)) return b.defaults.bg;
  } catch { /* first start */ }
  return '#10151c';
}
function createGuideWindow() {
  const { screen } = require('electron');
  const area = screen.getPrimaryDisplay().workArea;
  config.mainWindow = new BrowserWindow({
    x: area.x, y: area.y, width: area.width, height: area.height,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: config.DEV },
  });
  config.mainWindow.setAlwaysOnTop(true, 'screen-saver');
  config.mainWindow.setVisibleOnAllWorkspaces(true);
  config.mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  config.mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  config.mainWindow.loadFile('index.html', { query: { guide: '1' } });
  config.mainWindow.webContents.on('did-finish-load', () => {
    addons.ensureTree(); addons.scanAddons(); theming.scanThemes(); library.loadState(); prefs.loadSettings();
    send('init', library.buildView());
  });
  config.mainWindow.on('blur', () => { if (guideHelperShown) send('guide', { action: 'blur' }); });
}
let guideHelperShown = false;
// Is the Tessera launcher itself running (nested over the desktop, say)? Then it handles Guide.
function launcherRunning() {
  try {
    const pid = Number(fs.readFileSync(config.LAUNCHER_PID_FILE, 'utf8').trim());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}
// Steam on the desktop takes the Guide button for itself (Big Picture). Two menus at once is worse
// than one, so by default the helper steps aside while Steam is running.
function steamRunning() {
  try {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      let comm = '';
      try { comm = fs.readFileSync(`/proc/${d}/comm`, 'utf8').trim(); } catch { continue; }
      if (comm === 'steam' || comm === 'steamwebhelper') return true;
    }
  } catch { /* can't tell */ }
  return false;
}
function createWindow() {
  if (config.GUIDE_ONLY) return createGuideWindow();
  try { fs.mkdirSync(path.dirname(config.LAUNCHER_PID_FILE), { recursive: true }); fs.writeFileSync(config.LAUNCHER_PID_FILE, String(process.pid)); } catch { /* the helper just won't know */ }
  app.on('will-quit', () => { try { if (fs.readFileSync(config.LAUNCHER_PID_FILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(config.LAUNCHER_PID_FILE); } catch { /* gone */ } });
  config.mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: savedBackground(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: config.DEV, // no inspector for anyone sitting at the TV
    },
  });
  config.mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  config.mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  config.mainWindow.on('resize', webView.fitBrowserView);
  config.mainWindow.loadFile('index.html');
  config.mainWindow.webContents.on('did-finish-load', () => {
    addons.ensureTree();
    addons.scanAddons();
    theming.scanThemes();
    library.loadState();
    prefs.loadSettings();
    shards.startEnabled(); // the shards their owner turned on (nothing else runs)
    require('./profiles').atStartup(); // a profile with a PIN isn't logged in by a restart
    send('init', library.buildView());
  });
  // Tessera is the front door of the machine, so there is no quit shortcut for
  // whoever is holding the controller. Leaving goes through Settings > Desktop
  // Mode, which lands on the login screen. Developers get Ctrl+Q with TESSERA_DEV=1.
  config.mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (config.DEV && input.control && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      guide.leaveTessera();
    } else if (!config.DEV && (input.key === 'F12' || (input.control && input.shift && /^[ijc]$/i.test(input.key)) || (input.control && /^[rw]$/i.test(input.key)) || input.key === 'F5' || (input.alt && input.key === 'F4'))) {
      event.preventDefault(); // no inspector, reload or close
    }
  });
}

// The helper keeps its own browser profile, so it never blocks or shares the launcher's single-instance lock.
if (config.GUIDE_ONLY) app.setPath('userData', path.join(app.getPath('userData'), 'guide'));
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // the default menu carries Reload and Toggle DevTools
    protocol.handle(config.ART_SCHEME, async (req) => {
      try {
        const m = /^\/([^/]+)$/.exec(new URL(req.url).pathname);
        const r = await art.serveArtAsync(m ? decodeURIComponent(m[1]) : '');
        return new Response(r.body, { status: r.status, headers: r.headers });
      } catch {
        return new Response('Bad request', { status: 400 });
      }
    });
    protocol.handle(config.WIDGET_SCHEME, (req) => {
      try {
        const u = new URL(req.url);
        const r = addons.serveWidget(u.hostname, u.pathname);
        return new Response(r.body, { status: r.status, headers: r.headers });
      } catch {
        return new Response('Bad request', { status: 400 });
      }
    });
    createWindow();
    if (!config.GUIDE_ONLY) storage.watchDrives();
    system.padsCtl.start();
    if (config.GUIDE_ONLY) system.padsCtl.pause(); // Nintendo pads are read only while the guide is up
    guide.guideWatch = guide.watchGuideButtons();
    if (!config.GUIDE_ONLY && !installer.INSTALLER) setTimeout(() => { installer.graphicsCheck().catch(() => {}); }, installer.GRAPHICS_CHECK_DELAY_MS);
  });
}

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const storage = require('./storage');
const installer = require('./installer');
const system = require('./system');
const guide = require('./guide');
const webView = require('./webView');
