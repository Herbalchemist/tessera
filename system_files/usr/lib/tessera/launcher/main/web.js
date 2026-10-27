// SPDX-License-Identifier: GPL-3.0-or-later
// The default web browser, launching games and apps, and the browser pointer.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get browserAnalog() { return browserAnalog; },
  get browserCursorView() { return browserCursorView; },
  get browserPadDirectionRepeater() { return browserPadDirectionRepeater; },
  get clearBrowserPadNavigation() { return clearBrowserPadNavigation; },
  get desktopDirs() { return desktopDirs; },
  get embeddedBrowserView() { return embeddedBrowserView; },
  get ensureBrowserCursorView() { return ensureBrowserCursorView; },
  get parseDesktopExec() { return parseDesktopExec; },
  get sendBrowserAction() { return sendBrowserAction; },
  get sendBrowserViewKey() { return sendBrowserViewKey; },
  get sendExternalBrowserKey() { return sendExternalBrowserKey; },
  get startBrowserPointer() { return startBrowserPointer; },
  get startBrowserViewJoystickWatch() { return startBrowserViewJoystickWatch; },
  get stopBrowserPointer() { return stopBrowserPointer; },
  get stopBrowserViewJoystickWatch() { return stopBrowserViewJoystickWatch; },
  get whichOnPath() { return whichOnPath; },
};

const { WebContentsView, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn, execFile, execFileSync } = require('child_process');
const browserGamepad = require('../browser-gamepad');
const browserNavigation = require('../browser-navigation');
const config = require('./config');
const library = require('./library');
const prefs = require('./prefs');
const calibration = require('./calibration');
const appWindow = require('./appWindow');
const system = require('./system');
const pinLock = require('./pinLock');

// ---- the default web browser: one press from the Browser tab
const BROWSER_FALLBACKS = [
  'firefox.desktop', 'org.mozilla.firefox.desktop', 'org.chromium.Chromium.desktop',
  'google-chrome.desktop', 'brave-browser.desktop', 'com.brave.Browser.desktop', 'chromium.desktop',
];
function desktopDirs() {
  const home = os.homedir();
  return [
    path.join(home, '.local/share/applications'),
    path.join(home, '.local/share/flatpak/exports/share/applications'),
    '/var/lib/flatpak/exports/share/applications',
    '/usr/local/share/applications',
    '/usr/share/applications',
  ];
}
// Split an Exec= line into words, honouring double quotes, and drop the
// placeholders (%u, %F, flatpak's @@u ... @@) that stand for a file or URL.
function parseDesktopExec(line) {
  const words = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line))) words.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]);
  const args = words.filter((w) => !/^%[a-zA-Z%]$/.test(w) && !/^@@[a-zA-Z]?$/.test(w));
  return args.length ? { file: args[0], args: args.slice(1) } : null;
}
function readDesktopExec(name) {
  if (!/^[A-Za-z0-9._-]+\.desktop$/.test(name)) return null;
  for (const dir of desktopDirs()) {
    let text;
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
    let inEntry = false;
    for (const line of text.split('\n')) {
      if (line.startsWith('[')) inEntry = line.trim() === '[Desktop Entry]';
      else if (inEntry && line.startsWith('Exec=')) return parseDesktopExec(line.slice(5).trim());
    }
  }
  return null;
}
function whichOnPath(file) {
  if (path.isAbsolute(file)) return file;
  for (const d of (process.env.PATH || '').split(':')) {
    const p = path.join(d, file);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}
function resolveBrowser() {
  const names = [];
  try {
    const out = execFileSync('xdg-settings', ['get', 'default-web-browser'], { timeout: 3000, encoding: 'utf8' }).trim();
    if (out) names.push(out);
  } catch { /* fall back to the usual suspects */ }
  names.push(...BROWSER_FALLBACKS);
  for (const n of names) {
    const cmd = readDesktopExec(n);
    const file = cmd && whichOnPath(cmd.file);
    if (file) return { file, args: cmd.args };
  }
  return null;
}

// Generic Linux joystick input for browser navigation. The joydev interface is non-exclusive:
// native Gamepad API consumers and games still receive their original controller input. Nintendo
// controllers are handled by pads.js, whose Joy-Con button mapping is controller-specific.
function watchJoysticks(onShoulder, onAction = () => {}, onBrowserAction = null, dir = '/dev/input', onAnalog = null) {
  const devices = new Map();
  let directoryWatch = null;
  const sysRoot = '/sys/class/input';
  const read = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };
  const real = (file) => { try { return fs.realpathSync(file); } catch { return ''; } };
  const bitsHave = browserGamepad.capabilityHas;
  const stopDevice = (entry) => {
    if (entry.mapper) entry.mapper.dispose();
    for (const proc of [entry.jsProc, entry.eventProc]) {
      if (proc) { try { proc.kill(); } catch { /* gone */ } }
    }
  };
  const scan = () => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { names = []; }
    const jsNames = names.filter(browserGamepad.isJoystickNodeName);
    const eventNames = names.filter(browserGamepad.isEventNodeName);
    const eventByDevice = new Map();
    for (const eventName of eventNames) {
      const sysDevice = path.join(sysRoot, eventName, 'device');
      const keyCaps = read(path.join(sysDevice, 'capabilities/key'));
      // Require the Linux gamepad position codes for South and East. This excludes keyboards,
      // mice, and the separate IMU event node on controllers that expose one.
      if (!bitsHave(keyCaps, 0x130) || !bitsHave(keyCaps, 0x131)) continue;
      const devicePath = real(sysDevice);
      if (devicePath && !eventByDevice.has(devicePath)) eventByDevice.set(devicePath, eventName);
    }
    const seen = new Set();
    for (const jsName of jsNames) {
      const sysDevice = path.join(sysRoot, jsName, 'device');
      const devicePath = real(sysDevice);
      if (!devicePath) continue;
      const eventName = eventByDevice.get(devicePath);
      if (!eventName) continue;
      const vendor = read(path.join(sysDevice, 'id/vendor')).toLowerCase();
      if (vendor === '057e') continue; // pads.js handles Switch/Joy-Con mapping specially.
      seen.add(jsName);
      const old = devices.get(jsName);
      if (old && old.eventName === eventName && old.devicePath === devicePath) continue;
      if (old) { devices.delete(jsName); stopDevice(old); }

      const axisCodes = browserGamepad.axisCodesFromSysfs(read(path.join(sysDevice, 'capabilities/abs')));
      const entry = { eventName, devicePath, jsProc: null, eventProc: null, mapper: null };
      const hasRightStick = axisCodes.includes(0x03) && axisCodes.includes(0x04);
      const analog = onAnalog ? (name, value) => onAnalog(jsName, name, value) : null;
      const mapper = browserGamepad.createMapper({ onShoulder, onAction, onBrowserAction, onAnalog: analog, hasRightStick });
      entry.mapper = mapper;
      const startReader = (node, eventSize, consume) => {
        const proc = spawn('cat', [path.join(dir, node)], { stdio: ['ignore', 'pipe', 'ignore'] });
        let pending = Buffer.alloc(0);
        proc.stdout.on('data', (chunk) => {
          pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
          const whole = pending.length - (pending.length % eventSize);
          if (whole) consume(pending.subarray(0, whole));
          pending = pending.subarray(whole);
        });
        proc.on('error', () => {});
        proc.on('close', () => {
          if (devices.get(jsName) === entry) {
            devices.delete(jsName);
            stopDevice(entry);
          }
        });
        return proc;
      };
      entry.jsProc = startReader(jsName, 8, (buffer) => {
        browserGamepad.parseJsEvents(buffer, (event) => {
          const code = axisCodes[event.number];
          if (code !== undefined) mapper.handleAxis(code, event.value);
        });
      });
      entry.eventProc = startReader(eventName, 24, (buffer) => {
        browserGamepad.parseInputEvents(buffer, (event) => mapper.handleButton(event.code, event.value));
      });
      devices.set(jsName, entry);
    }
    for (const [name, entry] of devices) {
      if (!seen.has(name)) { devices.delete(name); stopDevice(entry); if (onAnalog) onAnalog(name, 'gone', 0); }
    }
  };
  scan();
  try {
    directoryWatch = fs.watch(dir, scan);
    directoryWatch.on('error', () => {
      try { directoryWatch.close(); } catch { /* gone */ }
      directoryWatch = null;
    });
  } catch { /* joystick hotplug watch unavailable */ }
  return () => {
    if (directoryWatch) { try { directoryWatch.close(); } catch { /* gone */ } }
    for (const entry of devices.values()) stopDevice(entry);
    devices.clear();
  };
}
const BROWSER_KEYSYMS = {
  UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right',
  ENTER: 'Return', ESC: 'Escape', TAB: 'Tab', PAGEUP: 'Page_Up', PAGEDOWN: 'Page_Down',
};
function sendExternalBrowserKey(key) {
  const keysym = BROWSER_KEYSYMS[key];
  if (!keysym) return;
  const child = spawn('wtype', ['-k', keysym], { stdio: 'ignore' });
  child.on('error', () => {});
}
function sendBrowserViewKey(key) {
  const view = webView.browserView;
  if (!view || !config.mainWindow || config.mainWindow.isDestroyed() ||
      !webView.browserViewAttached || view.webContents.isDestroyed()) return;
  try {
    for (const event of browserNavigation.keyEvents(key)) view.webContents.sendInputEvent(event);
  } catch {}
}
// ---- the browser pointer: a cursor on one stick, scrolling on the other, clicks on the triggers.
// A small transparent view floats above the page to draw the cursor, since synthetic mouse
// events don't move a real pointer. It hides itself after a few seconds without use.
const browserPointerLib = require('../browser-pointer');
const CURSOR_W = 40;
const CURSOR_H = 51;
const CURSOR_HTML = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}' +
  'svg{display:block;transform-origin:4px 3px;transition:transform .08s ease-out;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))}' +
  'body.down svg{transform:scale(.82)}</style><body><svg width="40" height="51" viewBox="0 0 30 38">' +
  '<path d="M3 2 L3 30 L10 23.5 L15 35 L20.5 32.8 L15.5 21.5 L25 21.5 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg></body>';
let browserCursorView = null;
let browserCursorVisible = false;
let browserCursorHideTimer = null;
let browserPointerTimer = null;
let browserPointerLast = 0;
function embeddedBrowserView() {
  const view = webView.browserView;
  return view && config.mainWindow && !config.mainWindow.isDestroyed() && webView.browserViewAttached && !view.webContents.isDestroyed() ? view : null;
}
function sendPointerEvent(event) {
  const view = embeddedBrowserView();
  if (!view) return;
  try { view.webContents.sendInputEvent(event); } catch { /* page went away */ }
}
function ensureBrowserCursorView() {
  if (browserCursorView && !browserCursorView.webContents.isDestroyed()) return browserCursorView;
  browserCursorView = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  browserCursorView.setBackgroundColor('#00000000');
  browserCursorView.setVisible(false);
  browserCursorView.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(CURSOR_HTML)).catch(() => {});
  return browserCursorView;
}
function showBrowserCursor(x, y, pressed) {
  if (!embeddedBrowserView()) return;
  const cursor = ensureBrowserCursorView();
  cursor.setBounds({ x: Math.round(x) - 4, y: Math.round(y) - 3, width: CURSOR_W, height: CURSOR_H });
  if (!browserCursorVisible) { cursor.setVisible(true); browserCursorVisible = true; }
  if (pressed !== undefined) {
    cursor.webContents.executeJavaScript(`document.body.classList.toggle('down', ${pressed ? 'true' : 'false'})`).catch(() => {});
  }
  if (browserCursorHideTimer) clearTimeout(browserCursorHideTimer);
  browserCursorHideTimer = setTimeout(hideBrowserCursor, 5000);
}
function hideBrowserCursor() {
  if (browserCursorHideTimer) { clearTimeout(browserCursorHideTimer); browserCursorHideTimer = null; }
  if (browserCursorView && browserCursorVisible) { try { browserCursorView.setVisible(false); } catch { /* closing */ } }
  browserCursorVisible = false;
}
const browserPointer = browserPointerLib.createPointer({
  bounds: () => {
    if (!config.mainWindow || config.mainWindow.isDestroyed()) return { width: 1280, height: 720 };
    const { width, height } = config.mainWindow.getContentBounds();
    return { width, height };
  },
  settings: () => prefs.settings.pad,
  onMove: (x, y) => { sendPointerEvent({ type: 'mouseMove', x, y }); showBrowserCursor(x, y); },
  onWheel: (x, y, deltaX, deltaY) => sendPointerEvent({ type: 'mouseWheel', x, y, deltaX, deltaY, canScroll: true }),
  onButton: (side, down, x, y) => {
    const view = embeddedBrowserView();
    if (!view) return;
    // Chromium only delivers synthetic clicks to the focused page.
    if (down) { try { view.webContents.focus(); } catch { /* closing */ } sendPointerEvent({ type: 'mouseMove', x, y }); }
    sendPointerEvent({ type: down ? 'mouseDown' : 'mouseUp', x, y, button: side, clickCount: 1 });
    showBrowserCursor(x, y, down);
  },
});
// Stick and trigger values from any adapter: evdev pads ('js:…') and Nintendo pads ('pad:…').
function browserAnalog(source, name, value) {
  const key = String(source).includes(':') ? String(source) : 'js:' + source;
  if (name === 'gone') return browserPointer.removeSource(key);
  if (name === 'lt' || name === 'rt') return browserPointer.setTrigger(key, name === 'lt' ? 'left' : 'right', value);
  return browserPointer.setAxis(key, name, value);
}
// Integration tests (TESSERA_DEV=1 only) feed stick/trigger values here, standing in for a real pad.
if (config.DEV) globalThis.__tesseraBrowserAnalog = browserAnalog;
function startBrowserPointer() {
  if (browserPointerTimer) return;
  browserPointerLast = Date.now();
  browserPointerTimer = setInterval(() => {
    const now = Date.now();
    const dt = now - browserPointerLast;
    browserPointerLast = now;
    if (embeddedBrowserView()) browserPointer.tick(dt);
  }, 16);
}
function stopBrowserPointer() {
  if (browserPointerTimer) { clearInterval(browserPointerTimer); browserPointerTimer = null; }
  browserPointer.reset();
  hideBrowserCursor();
}
function sendBrowserAction(action) {
  if (action !== 'b' && action !== 'lb' && action !== 'rb' && action !== 'y') return;
  appWindow.send('browser-action', action);
}
function browserNavigationKey(key) {
  const view = webView.browserView;
  const embeddedActive = Boolean(
    view && config.mainWindow && !config.mainWindow.isDestroyed() && webView.browserViewAttached && !view.webContents.isDestroyed()
  );
  if (embeddedActive) sendBrowserViewKey(key);
  else if (system.browserShoulder) sendExternalBrowserKey(key);
}
function browserPadDirectionRepeater(id) {
  let navigation = system.browserPadNavigation.get(id);
  if (!navigation) {
    navigation = browserGamepad.createDirectionRepeater({ onAction: browserNavigationKey });
    system.browserPadNavigation.set(id, navigation);
  }
  return navigation;
}
function clearBrowserPadNavigation(id) {
  if (id !== undefined) browserPointer.removeSource('pad:' + id);
  if (id !== undefined) {
    const navigation = system.browserPadNavigation.get(id);
    if (navigation) navigation.dispose();
    system.browserPadNavigation.delete(id);
    return;
  }
  for (const navigation of system.browserPadNavigation.values()) navigation.dispose();
  system.browserPadNavigation.clear();
}
let browserViewJoystickStop = null;
function startBrowserViewJoystickWatch() {
  if (browserViewJoystickStop) return;
  browserViewJoystickStop = watchJoysticks(null, sendBrowserViewKey, sendBrowserAction, '/dev/input', browserAnalog);
}
function stopBrowserViewJoystickWatch() {
  if (!browserViewJoystickStop) return;
  browserViewJoystickStop();
  browserViewJoystickStop = null;
}
// Which Flatpak app is this command running, if any (so it can be stopped properly)?
function flatpakAppId(file, args) {
  if (path.basename(file) !== 'flatpak' || args[0] !== 'run') return null;
  const id = [...args].reverse().find((a) => /^[A-Za-z0-9_]+(\.[A-Za-z0-9_-]+)+$/.test(a) && !a.startsWith('-'));
  return id || null;
}

// Run one program full-screen-style: hide the launcher, bring it back when it ends.
// A browser can also be closed from the controller (LB / RB), which then moves
// Tessera to the neighbouring tab.
function runChild(file, args, cwd, label, logName, title) {
  config.running = true;
  let finished = false;
  let closing = 0;
  let stopWatching = null;
  // 'error' and 'close' can both fire; only the first one counts.
  const finish = (message) => {
    if (finished) return;
    finished = true;
    config.running = false;
    guide.runningInfo = null;
    guide.guideOverGame = false;
    if (stopWatching) stopWatching();
    system.browserShoulder = null;
    clearBrowserPadNavigation();
    system.padsCtl.resume();
    if (config.mainWindow && !config.mainWindow.isDestroyed()) {
      config.mainWindow.show();
      config.mainWindow.focus();
    }
    appWindow.send('game-exited', message || null);
    if (closing) appWindow.send('shift-tab', closing);
  };

  config.mainWindow.hide();
  // No shell, args passed separately. stdio is ignored so an unread pipe
  // can never fill up and freeze the program.
  const isBrowser = label === 'Browser';
  // A game's output goes to a small log file (never a pipe, which could fill
  // and freeze it), so a crash can be explained afterwards.
  let out = 'ignore';
  let logFile = null;
  if (logName) {
    try {
      fs.mkdirSync(config.LOG_DIR, { recursive: true });
      logFile = path.join(config.LOG_DIR, logName + '.log');
      const fd = fs.openSync(logFile, 'w');
      out = fd;
    } catch { logFile = null; }
  }
  // Its own process group, so "Close game" in the guide can end it and anything it started.
  const child = spawn(file, args, { cwd, shell: false, stdio: ['ignore', out, out], detached: true });
  guide.runningInfo = {
    kind: isBrowser ? 'browser' : 'game',
    title: title || label,
    since: Date.now(),
    close: () => {
      if (isBrowser && system.browserShoulder) return system.browserShoulder(0);
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
      setTimeout(() => { if (!finished) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } } }, 5000);
    },
  };
  if (typeof out === 'number') try { fs.closeSync(out); } catch { /* the child has its own copy */ }
  child.once('error', (err) => finish(`Launch failed: ${err.message}`));
  child.once('close', (code, signal) =>
    finish(isBrowser || code === 0 ? null : `${label} exited (${code !== null ? 'code ' + code : signal}).` + (logFile ? ` Details: ${calibration.display(logFile)}` : ''))
  );
  if (!isBrowser) system.padsCtl.pause(); // a game reads its controllers itself; Tessera reads nothing meanwhile
  if (isBrowser) {
    const closeBrowser = (dir) => {
      if (closing) return;
      closing = dir;
      const app = flatpakAppId(file, args);
      if (app) execFile('flatpak', ['kill', app], () => {});
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 4000);
    };
    stopWatching = watchJoysticks(closeBrowser, sendExternalBrowserKey);
    system.browserShoulder = closeBrowser;
  }
}

ipcMain.on('launch', (_event, id) => {
  if (typeof id !== 'string') return;
  if (config.running) return appWindow.send('launch-failed', `${guide.runningInfo ? guide.runningInfo.title : 'A game'} is still running. Close it from the guide first.`);
  if (id === '_browser') {
    if (prefs.settings.pinBrowser !== false && !pinLock.pinOk()) return appWindow.send('launch-failed', 'Enter the PIN first.');
    const b = resolveBrowser();
    if (!b) return appWindow.send('launch-failed', "Couldn't find a web browser to open.");
    return runChild(b.file, b.args, os.homedir(), 'Browser', null, 'Browser');
  }
  const game = library.itemById(id);
  if (!game) return appWindow.send('launch-failed', 'Unknown game.');
  try {
    fs.accessSync(game.path, fs.constants.X_OK);
  } catch {
    const exists = fs.existsSync(game.path);
    return appWindow.send(
      'launch-failed',
      exists
        ? `${path.basename(game.path)} isn't marked executable. Run: chmod +x on it.`
        : `Can't find ${path.basename(game.path)}. Is the drive plugged in?`
    );
  }
  library.recordPlay(game.id);
  // The game runs from its own folder so AnyPS5 can find libs/ and app0/.
  runChild(game.path, game.args || [], path.dirname(game.path), 'Game', game.id, game.title);
});

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const guide = require('./guide');
const webView = require('./webView');
