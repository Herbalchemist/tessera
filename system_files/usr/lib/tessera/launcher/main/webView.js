// SPDX-License-Identifier: GPL-3.0-or-later
// The embedded browser view.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get browserView() { return browserView; },
  get browserViewAttached() { return browserViewAttached; },
  get fitBrowserView() { return fitBrowserView; },
  get browserViewBounds() { return browserViewBounds; },
  get dropBrowserView() { return dropBrowserView; },
  get forgetBrowserProfile() { return forgetBrowserProfile; },
};

const fs = require('fs');
const path = require('path');
const { app, WebContentsView, ipcMain, session } = require('electron');
const browserNavigation = require('../browser-navigation');
const config = require('./config');
const addons = require('./addons');
const prefs = require('./prefs');
const pinLock = require('./pinLock');
const web = require('./web');
const appWindow = require('./appWindow');
const guide = require('./guide');

// ------------------------------------------------------------- embedded browser view
// WebContentsView is the supported Electron 44 API; the browser remains inside Tessera.
let browserView = null;
let browserViewAttached = false;
let browserSessionOpen = false;
// Each profile browses with its own storage (cookies, logins, history); no profile keeps the one
// Tessera always had.
const BROWSER_PARTITION = 'persist:tessera-browser';
const partitionFor = (id) => (id ? `${BROWSER_PARTITION}-${id}` : BROWSER_PARTITION);
function isLauncherMainFrame(event) {
  return Boolean(
    event && config.mainWindow && !config.mainWindow.isDestroyed() &&
    event.sender === config.mainWindow.webContents &&
    event.senderFrame && event.senderFrame === config.mainWindow.webContents.mainFrame
  );
}
// Downloads go straight to ~/Tessera/Downloads (no save dialog: a controller can't work one),
// under a cleaned-up name that never replaces a file already there.
const downloadSessions = new WeakSet();
function downloadPath(name) {
  const dir = addons.vaultFolder('downloads');
  fs.mkdirSync(dir, { recursive: true });
  const base = String(name || '').replace(/[^\w.()+ -]/g, '_').replace(/^[.\s]+/, '').slice(0, 120) || 'download';
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let p = path.join(dir, base);
  for (let n = 1; fs.existsSync(p) && n < 1000; n++) p = path.join(dir, `${stem} (${n})${ext}`);
  return p;
}
function ensureBrowserView() {
  if (browserView) return browserView;
  browserView = new WebContentsView({
    webPreferences: {
      partition: partitionFor(prefs.settings.activeProfile),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });
  // The remote browser has no preload bridge. Its dedicated session is denied
  // all permissions until Tessera has a controller-friendly consent flow.
  const browserSession = browserView.webContents.session;
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (!downloadSessions.has(browserSession)) {
    downloadSessions.add(browserSession);
    browserSession.on('will-download', (_event, item) => item.setSavePath(downloadPath(item.getFilename())));
  }
  browserView.webContents.on('will-navigate', (event, target) => {
    if (!browserNavigation.isHttpUrl(target)) event.preventDefault();
  });
  // Esc+Left / Esc+Right switch tabs from inside the page too (the page has the keyboard
  // focus, so the launcher never sees these keys). Esc on its own still reaches the page.
  let escapeHeld = false;
  browserView.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') { escapeHeld = input.type === 'keyDown'; return; }
    if (escapeHeld && input.type === 'keyDown' && (input.key === 'ArrowLeft' || input.key === 'ArrowRight')) {
      event.preventDefault();
      web.sendBrowserAction(input.key === 'ArrowLeft' ? 'lb' : 'rb');
    }
  });
  // The frame around the page shows its title and address, and a loading line.
  const sendState = () => {
    if (!browserView || browserView.webContents.isDestroyed()) return;
    const wc = browserView.webContents;
    let url = '';
    try { url = wc.getURL(); } catch { /* closing */ }
    appWindow.send('browser-state', {
      url: String(url).slice(0, 2000),
      title: String(wc.getTitle() || '').slice(0, 200),
      loading: wc.isLoading(),
      canGoBack: Boolean(wc.navigationHistory && wc.navigationHistory.canGoBack()),
    });
  };
  for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page']) browserView.webContents.on(ev, sendState);
  browserView.webContents.on('did-finish-load', () => {
    if (browserViewAttached && !browserView.webContents.isDestroyed()) {
      try { browserView.webContents.focus(); } catch { /* browser closed while loading */ }
    }
  });
  return browserView;
}
function attachBrowserView() {
  if (!browserView || !config.mainWindow || config.mainWindow.isDestroyed() || browserViewAttached) return;
  config.mainWindow.contentView.addChildView(browserView);
  browserViewAttached = true;
  // The cursor view goes on after the page so it draws above it.
  config.mainWindow.contentView.addChildView(web.ensureBrowserCursorView());
  web.startBrowserPointer();
  try { browserView.webContents.focus(); } catch { /* browser closed while attaching */ }
}
// Someone else is playing now: close the page; the next open uses their own browser storage.
function dropBrowserView() {
  if (!browserView) return;
  detachBrowserView();
  web.stopBrowserViewJoystickWatch();
  try { browserView.webContents.close(); } catch { /* already gone */ }
  browserView = null;
  browserSessionOpen = false;
}
// A removed profile's browser data goes with it.
function forgetBrowserProfile(id) {
  if (!id) return;
  try {
    const ses = session.fromPartition(partitionFor(id));
    ses.clearStorageData().catch(() => {});
    ses.clearCache().catch(() => {});
  } catch { /* nothing there */ }
}
function detachBrowserView() {
  if (!browserView || !config.mainWindow || config.mainWindow.isDestroyed() || !browserViewAttached) return;
  web.clearBrowserPadNavigation();
  web.stopBrowserPointer();
  if (web.browserCursorView) { try { config.mainWindow.contentView.removeChildView(web.browserCursorView); } catch { /* not attached */ } }
  config.mainWindow.contentView.removeChildView(browserView);
  browserViewAttached = false;
  try { config.mainWindow.focus(); } catch { /* window is closing */ }
}
// Where the page sits: the whole window, or the opening of Tessera's frame around it (the launcher
// measures the frame and sends it, in window pixels). Kept inside the window, and never tiny.
let frameRect = null;
function browserViewBounds() {
  const win = config.mainWindow && !config.mainWindow.isDestroyed() ? config.mainWindow.getContentBounds() : { width: 1280, height: 720 };
  const full = { x: 0, y: 0, width: win.width, height: win.height };
  const r = frameRect;
  if (!r) return full;
  const x = Math.max(0, Math.min(r.x, win.width - 200));
  const y = Math.max(0, Math.min(r.y, win.height - 150));
  const width = Math.max(200, Math.min(r.width, win.width - x));
  const height = Math.max(150, Math.min(r.height, win.height - y));
  return { x, y, width, height };
}
function fitBrowserView() {
  if (!browserView || !config.mainWindow || config.mainWindow.isDestroyed()) return;
  browserView.setBounds(browserViewBounds());
}
function cleanRect(r) {
  if (!r || typeof r !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : NaN);
  const out = { x: n(r.x), y: n(r.y), width: n(r.width), height: n(r.height) };
  return Object.values(out).every((v) => Number.isFinite(v) && v >= 0 && v <= 20000) ? out : null;
}
// The renderer provides the interactive PIN prompt, but the privileged navigation
// entry point verifies it too so a compromised renderer cannot bypass browser policy.
ipcMain.handle('browser', async (event, op, payload) => {
  if (!isLauncherMainFrame(event)) return { ok: false, error: 'Unauthorized browser request.' };
  if (op === 'open' || op === 'go') {
    const url = payload && typeof payload.url === 'string' ? payload.url : null;
    if (prefs.settings.pinBrowser !== false && !pinLock.pinOk()) return pinLock.NEED_PIN;
    const checked = browserNavigation.validateHttpUrl(url);
    if (!checked.ok) return checked;
    const fresh = !browserView;
    const view = ensureBrowserView();
    browserSessionOpen = true;
    attachBrowserView();
    web.startBrowserViewJoystickWatch();
    fitBrowserView();
    // Coming back to the Browser tab resumes the page where it was, like any other tab.
    // 'go' (an address typed in) and the very first open load the address.
    const current = view.webContents.getURL();
    if (op === 'go' || fresh || !current || current === 'about:blank') view.webContents.loadURL(checked.url).catch(() => {});
    return { ok: true, url: current || checked.url };
  }
  // A picture of the page as it is now, for the launcher to animate in place of the live
  // view (a native view can't be moved, faded or scaled by CSS).
  if (op === 'snapshot') {
    const view = web.embeddedBrowserView();
    if (!view) return { ok: false };
    try {
      const image = await view.webContents.capturePage();
      if (image.isEmpty()) return { ok: false };
      return { ok: true, image: 'data:image/jpeg;base64,' + image.toJPEG(82).toString('base64') };
    } catch {
      return { ok: false };
    }
  }
  // The launcher's frame around the page: { rect } (window pixels) or { rect: null } for full screen.
  if (op === 'frame') {
    frameRect = payload && payload.rect ? cleanRect(payload.rect) : null;
    if (browserView && browserViewAttached) fitBrowserView();
    return { ok: true, bounds: browserViewBounds() };
  }
  if (op === 'hide') {
    detachBrowserView();
    web.stopBrowserViewJoystickWatch();
    return { ok: true };
  }
  if (op === 'show') {
    if (prefs.settings.pinBrowser !== false && !pinLock.pinOk()) return pinLock.NEED_PIN;
    if (!browserSessionOpen) return { ok: false, error: 'Open the browser first.' };
    if (browserView) { attachBrowserView(); web.startBrowserViewJoystickWatch(); fitBrowserView(); }
    return { ok: true };
  }
  if (op === 'close') {
    browserSessionOpen = false;
    detachBrowserView();
    web.stopBrowserViewJoystickWatch();
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
});
ipcMain.handle('quit', () => {
  if (!pinLock.pinOk()) return pinLock.NEED_PIN;
  guide.leaveTessera();
  return { ok: true };
});
app.on('window-all-closed', () => app.quit());
