// SPDX-License-Identifier: GPL-3.0-or-later
// The PIN, and the settings and scan requests that it guards.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get NEED_PIN() { return NEED_PIN; },
  get pinInfo() { return pinInfo; },
  get pinIsSet() { return pinIsSet; },
  get pinOk() { return pinOk; },
};

const { ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const keyboardMap = require('../keyboard-map');
const library = require('./library');
const prefs = require('./prefs');
const theming = require('./theming');
const calibration = require('./calibration');
const driveList = require('./driveList');
const scanner = require('./scanner');
const ipc = require('./ipc');
const system = require('./system');

// ------------------------------------------------------------ PIN
// Only a salted hash is kept. A PIN keeps whoever is holding the controller out
// of Settings, deleting and adding things; the login password is the real lock.
let pinUnlockedUntil = 0;
let pinFails = 0;
let pinLockedUntil = 0;
const PIN_RE = /^\d{4,8}$/;
const pinIsSet = () => Boolean(prefs.settings.pin);
const pinOk = () => !pinIsSet() || Date.now() < pinUnlockedUntil;
const pinHash = (pin, salt) => crypto.scryptSync(pin, Buffer.from(salt, 'hex'), 32).toString('hex');
function pinMatches(pin) {
  if (!pinIsSet() || typeof pin !== 'string' || !PIN_RE.test(pin)) return false;
  const a = Buffer.from(pinHash(pin, prefs.settings.pin.salt), 'hex');
  const b = Buffer.from(prefs.settings.pin.hash, 'hex');
  return crypto.timingSafeEqual(a, b);
}
function pinInfo() {
  return { set: pinIsSet(), browser: prefs.settings.pinBrowser !== false, firstRun: !prefs.settings.firstRunDone, unlocked: pinOk() };
}
// Checks a PIN with a short lockout after repeated misses.
function pinTry(pin) {
  const now = Date.now();
  if (now < pinLockedUntil) return { ok: false, wait: Math.ceil((pinLockedUntil - now) / 1000), error: `Too many tries. Wait ${Math.ceil((pinLockedUntil - now) / 1000)} seconds.` };
  if (pinMatches(pin)) {
    pinFails = 0;
    pinUnlockedUntil = now + 5 * 60 * 1000;
    return { ok: true };
  }
  pinFails++;
  if (pinFails >= 5) {
    const wait = Math.min(300, 30 * 2 ** Math.floor((pinFails - 5) / 5));
    pinLockedUntil = now + wait * 1000;
    return { ok: false, wait, error: `Too many tries. Wait ${wait} seconds and try again.` };
  }
  return { ok: false, error: `That isn't the PIN. ${5 - pinFails} ${5 - pinFails === 1 ? 'try' : 'tries'} left.` };
}
const NEED_PIN = { ok: false, needPin: true, error: 'Enter the PIN first.' };

ipcMain.handle('settings', ipc.safe((op, p) => {
  if (op === 'pinStatus') return pinInfo();
  if (op === 'pinCheck') return pinTry(p.pin);
  if (op === 'pinLock') { pinUnlockedUntil = 0; return { ok: true }; }
  if (op === 'firstRunDone') { prefs.settings.firstRunDone = true; prefs.saveSettings(); return { ok: true, prefs: theming.prefsPayload() }; }
  if (op === 'pinSet') {
    if (typeof p.pin !== 'string' || !PIN_RE.test(p.pin)) return { ok: false, error: 'Use 4 to 8 digits.' };
    if (pinIsSet()) { const t = pinTry(p.old); if (!t.ok) return t; }
    const salt = crypto.randomBytes(16).toString('hex');
    prefs.settings.pin = { salt, hash: pinHash(p.pin, salt) };
    prefs.settings.firstRunDone = true;
    pinUnlockedUntil = Date.now() + 5 * 60 * 1000;
    prefs.saveSettings();
    return { ok: true, prefs: theming.prefsPayload() };
  }
  if (op === 'pinRemove') {
    if (!pinIsSet()) return { ok: true, prefs: theming.prefsPayload() };
    const t = pinTry(p.pin);
    if (!t.ok) return t;
    prefs.settings.pin = null;
    prefs.saveSettings();
    return { ok: true, prefs: theming.prefsPayload() };
  }
  if (op === 'pinBrowser') {
    if (!pinOk()) return NEED_PIN;
    prefs.settings.pinBrowser = p.value === true;
    prefs.saveSettings();
    return { ok: true, prefs: theming.prefsPayload() };
  }
  // Changing what the library can reach, or what's installed, needs the PIN when one is set.
  if (['removeRoot', 'themeUse', 'driveName'].includes(op) && !pinOk()) return NEED_PIN;
  const rootsView = () => prefs.settings.scanRoots.map(driveList.friendly);
  if (op === 'get') return { roots: rootsView() };
  if (op === 'removeRoot') {
    if (Number.isInteger(p.index) && p.index >= 0 && p.index < prefs.settings.scanRoots.length) {
      prefs.settings.scanRoots.splice(p.index, 1);
      prefs.saveSettings();
    }
    return { roots: rootsView() };
  }
  if (op === 'drives') return { drives: driveList.driveList().map(({ key, name, auto, custom, tech }) => ({ key, name, auto, custom, tech })) };
  if (op === 'driveName') {
    const d = driveList.driveList().find((x) => x.key === p.key);
    if (!d) return { ok: false, error: "That drive isn't connected." };
    const nm = typeof p.name === 'string' ? p.name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40) : '';
    if (nm) prefs.settings.driveNames[d.key] = nm;
    else delete prefs.settings.driveNames[d.key]; // empty goes back to the automatic name
    prefs.saveSettings();
    driveList.lsblkCache.at = 0;
    return { ok: true };
  }
  if (['calSet', 'calReset', 'calToggle', 'calSystem'].includes(op) && !pinOk()) return NEED_PIN;
  if (op === 'calGet') return { ok: true, calibration: calibration.calPayload() };
  if (op === 'calSet') {
    const c = calibration.cleanCal({ ...p.cal, enabled: true, at: new Date().toISOString() });
    if (!c || !p.cal) return { ok: false, error: "That calibration isn't valid." };
    prefs.settings.calibration = c;
    prefs.saveSettings(); calibration.syncCalFx();
    return { ok: true, prefs: theming.prefsPayload() };
  }
  if (op === 'calReset') {
    prefs.settings.calibration = null; prefs.settings.calibrationSystem = false;
    prefs.saveSettings(); calibration.syncCalFx();
    try { fs.rmSync(calibration.CAL_FAILED, { force: true }); } catch { /* ignore */ }
    return { ok: true, prefs: theming.prefsPayload() };
  }
  if (op === 'calToggle') {
    if (!prefs.settings.calibration) return { ok: false, error: 'Calibrate first.' };
    prefs.settings.calibration.enabled = p.enabled === true;
    prefs.saveSettings(); calibration.syncCalFx();
    return { ok: true, prefs: theming.prefsPayload() };
  }
  if (op === 'calSystem') {
    if (!prefs.settings.calibration) return { ok: false, error: 'Calibrate first.' };
    prefs.settings.calibrationSystem = p.on === true;
    if (p.on === true) { try { fs.rmSync(calibration.CAL_FAILED, { force: true }); } catch { /* ignore */ } }
    prefs.saveSettings(); calibration.syncCalFx();
    return { ok: true, prefs: theming.prefsPayload() };
  }
  if (op === 'themeGet') return theming.themePayload();
  if (op === 'themeSet') {
    if (typeof p.id !== 'string' || !theming.setThemeValue(p.id, p.value)) return { ok: false, error: "That can't be set.", theme: theming.themePayload() };
    return { ok: true, theme: theming.themePayload() };
  }
  if (op === 'themeUse') {
    if (typeof p.id !== 'string' || !theming.themes.has(p.id)) return { ok: false, theme: theming.themePayload() };
    prefs.settings.theme.active = p.id;
    theming.themeRev++;
    prefs.saveSettings();
    return { ok: true, theme: theming.themePayload() };
  }
  if (op === 'themeReset') {
    delete prefs.settings.theme.values[theming.activeTheme()];
    theming.themeRev++;
    prefs.saveSettings();
    return { ok: true, theme: theming.themePayload() };
  }
  if (op === 'themeImage') return theming.themeImage(typeof p.id === 'string' ? p.id : '');
  if (op === 'pageGridSet') {
    // cols and rows for one page; leaving them out goes back to the theme's grid size
    if (p.cols === undefined && p.rows === undefined) {
      if (typeof p.key !== 'string') return { ok: false };
      delete prefs.settings.pageGrid[p.key];
    } else {
      const g = prefs.cleanPageGrid(p.key, p.cols, p.rows);
      if (!g) return { ok: false };
      prefs.settings.pageGrid[p.key] = g;
      const keys = Object.keys(prefs.settings.pageGrid);
      if (keys.length > 200) delete prefs.settings.pageGrid[keys[0]];
    }
    prefs.saveSettings();
    return { ok: true, prefs: theming.prefsPayload() };
  }
  if (op === 'padGet') return { pad: { ...prefs.settings.pad }, calib: prefs.settings.calib };
  if (op === 'padSet') {
    const k = p.key;
    if (!Object.keys(prefs.PAD_DEFAULTS).includes(k)) return { ok: false };
    if (prefs.PAD_CHOICES[k]) {
      if (!prefs.PAD_CHOICES[k].includes(p.value)) return { ok: false };
      prefs.settings.pad[k] = p.value;
    } else {
      if (!Number.isFinite(p.value) || p.value < prefs.PAD_RANGES[k][0] || p.value > prefs.PAD_RANGES[k][1]) return { ok: false };
      prefs.settings.pad[k] = Math.round(p.value);
    }
    prefs.saveSettings();
    if (k === 'joycons') system.padsCtl.regroup();
    return { ok: true, pad: { ...prefs.settings.pad }, calib: prefs.settings.calib };
  }
  if (op === 'kbSet') {
    const k = p.key;
    if (prefs.KB_CHOICES[k]) {
      if (!prefs.KB_CHOICES[k].includes(p.value)) return { ok: false };
      prefs.settings.kb[k] = p.value;
      if (k === 'preset') prefs.settings.kb.bindings = null; // a preset starts from its own keys
    } else if (prefs.KB_RANGES[k]) {
      if (!Number.isFinite(p.value) || p.value < prefs.KB_RANGES[k][0] || p.value > prefs.KB_RANGES[k][1]) return { ok: false };
      prefs.settings.kb[k] = Math.round(p.value);
    } else return { ok: false };
    prefs.saveSettings();
    return { ok: true, kb: prefs.kbPayload() };
  }
  if (op === 'kbBind') {
    const cur = prefs.kbPayload().bindings;
    const owner = keyboardMap.lookup(cur).get(p.code);
    if (owner && owner !== p.action && cur[owner].length <= 1) return { ok: false, error: `That's the only key for ${keyboardMap.ACTION_LABELS[owner]}. Give it another key first.` };
    const next = keyboardMap.bind(cur, p.action, p.code, prefs.settings.kb.preset);
    if (!next) return { ok: false, error: "That key can't be used." };
    prefs.settings.kb.bindings = next;
    prefs.saveSettings();
    return { ok: true, kb: prefs.kbPayload() };
  }
  if (op === 'kbUnbind') {
    const cur = prefs.kbPayload().bindings;
    if (!keyboardMap.ACTIONS.includes(p.action) || !Array.isArray(cur[p.action])) return { ok: false };
    if (cur[p.action].length <= 1) return { ok: false, error: 'Every action needs at least one key.' };
    cur[p.action] = cur[p.action].filter((c) => c !== p.code);
    prefs.settings.kb.bindings = keyboardMap.normalize(cur, prefs.settings.kb.preset);
    prefs.saveSettings();
    return { ok: true, kb: prefs.kbPayload() };
  }
  if (op === 'kbReset') {
    prefs.settings.kb.bindings = null;
    prefs.saveSettings();
    return { ok: true, kb: prefs.kbPayload() };
  }
  if (op === 'padCalib') {
    const id = typeof p.id === 'string' ? p.id.slice(0, 80) : '';
    const offs = Array.isArray(p.offsets) ? p.offsets.slice(0, 8) : null;
    if (!id) return { ok: false };
    if (offs === null) delete prefs.settings.calib[id];
    else if (offs.every((n) => Number.isFinite(n) && Math.abs(n) <= 0.5)) prefs.settings.calib[id] = offs.map((n) => Math.round(n * 1000) / 1000);
    else return { ok: false, error: 'Let go of the sticks and try again.' };
    if (Object.keys(prefs.settings.calib).length > 16) delete prefs.settings.calib[Object.keys(prefs.settings.calib)[0]];
    prefs.saveSettings();
    return { ok: true, pad: { ...prefs.settings.pad }, calib: prefs.settings.calib };
  }
  if (op === 'getKeys') return { keys: prefs.settings.keys };
  if (op === 'setKey') {
    const ok =
      Object.keys(prefs.DEFAULT_KEYS).includes(p.action) &&
      Number.isInteger(p.button) && p.button >= 0 && p.button < 32 &&
      !prefs.RESERVED_BUTTONS.includes(p.button);
    if (!ok) return { ok: false, error: "That button can't be used here.", keys: prefs.settings.keys };
    // If another action already uses that button, give it this action's old one.
    const other = Object.keys(prefs.settings.keys).find((k) => k !== p.action && prefs.settings.keys[k] === p.button);
    if (other) prefs.settings.keys[other] = prefs.settings.keys[p.action];
    prefs.settings.keys[p.action] = p.button;
    prefs.saveSettings();
    return { ok: true, keys: prefs.settings.keys };
  }
  if (op === 'resetKeys') {
    prefs.settings.keys = { ...prefs.DEFAULT_KEYS };
    prefs.saveSettings();
    return { ok: true, keys: prefs.settings.keys };
  }
  return { error: 'Unknown action.' };
}));

ipcMain.handle('scan', ipc.safe((op, p) => {
  if (op === 'run') return scanner.runScan();
  if (op === 'add') {
    if (library.state.locked) return { ok: false, error: `Can't edit: ${library.state.locked}`, view: library.buildView() };
    const cids = Array.isArray(p.cids) ? p.cids.filter((c) => typeof c === 'string') : [];
    const into = typeof p.into === 'string' ? library.catById(p.into) : null;
    let n = 0;
    for (const cid of cids) {
      const c = scanner.found.get(cid);
      const it = c && library.addItem({ title: c.title, kind: c.kind, file: c.file, args: c.args });
      if (it) {
        n++;
        if (into) into.entries.push(it.id);
      }
      scanner.found.delete(cid);
    }
    if (n) library.saveState();
    return { ok: true, message: n ? `Added ${n} game${n === 1 ? '' : 's'}.` : 'Nothing added.', view: library.buildView() };
  }
  return { ok: false, error: 'Unknown action.' };
}));
