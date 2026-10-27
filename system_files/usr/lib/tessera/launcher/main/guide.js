// SPDX-License-Identifier: GPL-3.0-or-later
// The Guide button: over a running game, over the browser, and leaving Tessera.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get guideOverGame() { return guideOverGame; }, set guideOverGame(v) { guideOverGame = v; },
  get guideWatch() { return guideWatch; }, set guideWatch(v) { guideWatch = v; },
  get leaveTessera() { return leaveTessera; },
  get runningInfo() { return runningInfo; }, set runningInfo(v) { runningInfo = v; },
  get watchGuideButtons() { return watchGuideButtons; },
};

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const browserGamepad = require('../browser-gamepad');
const { spawn, execFile } = require('child_process');
const config = require('./config');
const prefs = require('./prefs');
const appWindow = require('./appWindow');
const system = require('./system');

// ------------------------------------------------------------------ the Guide button
// Watched here, not in the page: during a game the launcher window is hidden and Chromium
// gives hidden windows no controller input. Every controller's Guide button (evdev BTN_MODE)
// is read directly, read-only, so games keep seeing it too. guide-button.js tells a quick
// press from a long hold; Settings > Controller > Guide button says what each one does.
const guideButtonLib = require('../guide-button');
let runningInfo = null;     // what is running: { kind, title, since, close }
let guideOverGame = false;  // the launcher is up in front of a running game
const guideButton = guideButtonLib.createGuideButton({ mode: () => prefs.settings.pad.guideButton, onAction: guideAction });
function guideAction(action, how) {
  if (!config.mainWindow || config.mainWindow.isDestroyed()) return;
  if (config.GUIDE_ONLY) return guideHelperAction(action);
  const inGame = Boolean(config.running && runningInfo);
  if (inGame && !guideOverGame) {
    // Bring Tessera up in front of the game. Most games stop reading the controller once they
    // lose focus, so the guide's buttons don't leak into the game. The game keeps running.
    guideOverGame = true;
    if (runningInfo.kind === 'game') system.padsCtl.resume();
    config.mainWindow.show();
    config.mainWindow.focus();
  }
  appWindow.send('guide', { action, how, inGame, overGame: guideOverGame, title: inGame ? runningInfo.title : '' });
}
function watchGuideButtons(dir = '/dev/input') {
  const readers = new Map(); // event node -> cat process
  const refused = new Set(); // nodes we may not read (permissions): not retried every scan
  const sysRoot = '/sys/class/input';
  const read = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };
  const scan = () => {
    let names = [];
    try { names = fs.readdirSync(dir).filter(browserGamepad.isEventNodeName); } catch { names = []; }
    const seen = new Set();
    for (const ev of names) {
      const caps = read(path.join(sysRoot, ev, 'device', 'capabilities/key'));
      // A controller: it has the Guide button and face buttons (a keyboard's "mode" key doesn't count).
      if (!browserGamepad.capabilityHas(caps, guideButtonLib.BTN_MODE)) continue;
      if (!browserGamepad.capabilityHas(caps, 0x130) && !browserGamepad.capabilityHas(caps, 0x131)) continue;
      seen.add(ev);
      if (readers.has(ev) || refused.has(ev)) continue;
      const startedAt = Date.now();
      const proc = spawn('cat', [path.join(dir, ev)], { stdio: ['ignore', 'pipe', 'ignore'] });
      let pending = Buffer.alloc(0);
      proc.stdout.on('data', (chunk) => {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        const whole = pending.length - (pending.length % 24);
        if (whole) {
          browserGamepad.parseInputEvents(pending.subarray(0, whole), (e) => {
            if (e.code !== guideButtonLib.BTN_MODE) return;
            if (e.value === 1) guideButton.down(ev);
            else if (e.value === 0) guideButton.up(ev);
          });
        }
        pending = pending.subarray(whole);
      });
      proc.on('error', () => {});
      proc.on('close', () => {
        if (readers.get(ev) !== proc) return;
        readers.delete(ev);
        guideButton.drop(ev);
        if (Date.now() - startedAt < 2000) refused.add(ev); // couldn't open it
      });
      readers.set(ev, proc);
    }
    for (const [ev, proc] of readers) {
      if (seen.has(ev)) continue;
      readers.delete(ev);
      guideButton.drop(ev);
      try { proc.kill(); } catch { /* gone */ }
    }
    for (const ev of refused) if (!seen.has(ev)) refused.delete(ev); // replugged later: try again
  };
  scan();
  let watcher = null;
  try { watcher = fs.watch(dir, () => setTimeout(scan, 400)); watcher.on('error', () => {}); } catch { /* hotplug falls back to the timer */ }
  const timer = setInterval(scan, 15000);
  if (timer.unref) timer.unref();
  return {
    count: () => readers.size,
    stop() { clearInterval(timer); if (watcher) try { watcher.close(); } catch { /* gone */ } for (const p of readers.values()) try { p.kill(); } catch { /* gone */ } readers.clear(); },
  };
}
function guideHelperAction(action) {
  // The launcher (nested over the desktop) is showing: it answers Guide itself.
  if (appWindow.launcherRunning()) return;
  const when = prefs.settings.pad.guideDesktop || 'auto';
  if (when === 'off' || (when === 'auto' && appWindow.steamRunning())) return;
  if (action === 'home') {
    // Holding Guide on the desktop means "take me to Tessera".
    return execFile('/usr/bin/tessera-return', [], () => {});
  }
  if (appWindow.guideHelperShown) return appWindow.send('guide', { action: 'menu', desktop: true });
  appWindow.guideHelperShown = true;
  system.padsCtl.resume();
  config.mainWindow.show();
  config.mainWindow.focus();
  appWindow.send('guide', { action: 'menu', desktop: true });
}
let guideWatch = null;
ipcMain.handle('guide', (_e, op, p) => {
  p = p && typeof p === 'object' ? p : {};
  if (op === 'status') {
    return { watching: guideWatch ? guideWatch.count() : 0, running: Boolean(config.running && runningInfo), title: runningInfo ? runningInfo.title : '', kind: runningInfo ? runningInfo.kind : '', since: runningInfo ? runningInfo.since : 0, overGame: guideOverGame, mode: prefs.settings.pad.guideButton, helper: config.GUIDE_ONLY };
  }
  // The page saw Guide itself (keyboard, or a controller this process can't read).
  if (op === 'press') {
    const action = p.action === 'home' || p.action === 'menu' ? p.action : null;
    if (action) guideAction(action, 'press');
    return { ok: Boolean(action) };
  }
  if (op === 'resume') {
    if (!config.running || !runningInfo) { guideOverGame = false; return { ok: false }; }
    guideOverGame = false;
    if (runningInfo.kind === 'game') system.padsCtl.pause();
    if (config.mainWindow && !config.mainWindow.isDestroyed()) config.mainWindow.hide(); // the game comes back to the front
    return { ok: true };
  }
  // Desktop helper: the guide closed, hide the window again. Or go back to Tessera.
  if (op === 'hideHelper') {
    if (!config.GUIDE_ONLY) return { ok: false };
    appWindow.guideHelperShown = false;
    system.padsCtl.pause();
    if (config.mainWindow && !config.mainWindow.isDestroyed()) config.mainWindow.hide();
    return { ok: true };
  }
  if (op === 'returnToTessera') {
    if (!config.GUIDE_ONLY) return { ok: false };
    execFile('/usr/bin/tessera-return', [], () => {});
    return { ok: true };
  }
  if (op === 'closeGame') {
    if (!config.running || !runningInfo) return { ok: false, error: 'Nothing is running.' };
    runningInfo.close();
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
});
// Integration tests (TESSERA_DEV=1 only) press the Guide button through this, standing in for a pad.
if (config.DEV) globalThis.__tesseraGuide = { down: (s) => guideButton.down(s || 'qa'), up: (s) => guideButton.up(s || 'qa') };

// Desktop Mode. tessera-session has to tell "the person chose Desktop Mode" from "Tessera crashed"
// (which it restarts). Gamescope's exit code cannot tell it: at shutdown it is not reliable, and a
// non-zero code on a normal exit made Tessera start again instead of leaving. So leaving writes a
// note first and the session goes by the note. tessera-session sets TESSERA_LEAVE_FILE.
const LEAVE_FILE = process.env.TESSERA_LEAVE_FILE || path.join(path.dirname(config.LOG_DIR), 'leave-requested');
let leaving = false;
function leaveTessera() {
  if (leaving) return;
  leaving = true;
  try {
    fs.mkdirSync(path.dirname(LEAVE_FILE), { recursive: true });
    fs.writeFileSync(LEAVE_FILE, `${new Date().toISOString()}\n`);
  } catch { /* no note: the session falls back to the exit code, as before */ }
  app.quit();
  // quit() waits for the window and the helper processes. If one of them hangs, don't leave the
  // person looking at a frozen screen: end the process anyway.
  setTimeout(() => app.exit(0), 4000);
}
