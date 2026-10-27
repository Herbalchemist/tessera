// SPDX-License-Identifier: GPL-3.0-or-later
// The embedded browser view.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get browserView() { return browserView; },
  get browserViewAttached() { return browserViewAttached; },
  get fitBrowserView() { return fitBrowserView; },
};

const { app, WebContentsView, ipcMain } = require('electron');
const browserNavigation = require('../browser-navigation');
const config = require('./config');
const prefs = require('./prefs');
const pinLock = require('./pinLock');
const web = require('./web');
const guide = require('./guide');

// ------------------------------------------------------------- embedded browser view
// WebContentsView is the supported Electron 44 API; the browser remains inside Tessera.
let browserView = null;
let browserViewAttached = false;
let browserSessionOpen = false;
const BROWSER_PARTITION = 'persist:tessera-browser';
function isLauncherMainFrame(event) {
  return Boolean(
    event && config.mainWindow && !config.mainWindow.isDestroyed() &&
    event.sender === config.mainWindow.webContents &&
    event.senderFrame && event.senderFrame === config.mainWindow.webContents.mainFrame
  );
}
function ensureBrowserView() {
  if (browserView) return browserView;
  browserView = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
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
function detachBrowserView() {
  if (!browserView || !config.mainWindow || config.mainWindow.isDestroyed() || !browserViewAttached) return;
  web.clearBrowserPadNavigation();
  web.stopBrowserPointer();
  if (web.browserCursorView) { try { config.mainWindow.contentView.removeChildView(web.browserCursorView); } catch { /* not attached */ } }
  config.mainWindow.contentView.removeChildView(browserView);
  browserViewAttached = false;
  try { config.mainWindow.focus(); } catch { /* window is closing */ }
}
function fitBrowserView() {
  if (!browserView || !config.mainWindow || config.mainWindow.isDestroyed()) return;
  const { width, height } = config.mainWindow.getContentBounds();
  browserView.setBounds({ x: 0, y: 0, width, height });
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
