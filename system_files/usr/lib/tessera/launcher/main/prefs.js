// SPDX-License-Identifier: GPL-3.0-or-later
// Settings: loading, cleaning and saving settings.json.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get cleanPageGrid() { return cleanPageGrid; },
  get DEFAULT_KEYS() { return DEFAULT_KEYS; },
  get KB_CHOICES() { return KB_CHOICES; },
  get KB_RANGES() { return KB_RANGES; },
  get kbPayload() { return kbPayload; },
  get loadSettings() { return loadSettings; },
  get PAD_CHOICES() { return PAD_CHOICES; },
  get PAD_DEFAULTS() { return PAD_DEFAULTS; },
  get PAD_RANGES() { return PAD_RANGES; },
  get RESERVED_BUTTONS() { return RESERVED_BUTTONS; },
  get saveSettings() { return saveSettings; },
  get settings() { return settings; },
  get EVERYONE() { return EVERYONE; },
  get GUEST_DEFAULTS() { return GUEST_DEFAULTS; },
  get switchControls() { return switchControls; },
  get controlsOf() { return controlsOf; },
  get freshControls() { return freshControls; },
  get SETTINGS_VERSION() { return SETTINGS_VERSION; },
};

const fs = require('fs');
const path = require('path');
const config = require('./config');

// -------------------------------------------------------------- settings

// Which controller button does each on-screen keyboard action use?
// Indices are the standard gamepad layout: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB,
// 8 View, 9 Menu, 10 left stick click. A always types, and the D-pad always moves.
// Defaults: click the left stick for Shift, Y space, X delete, Menu done, B cancel.
const DEFAULT_KEYS = { back: 2, space: 3, shift: 10, done: 9, cancel: 1 };
const OLD_DEFAULT_KEYS = { back: 1, space: 2, shift: 3, done: 9, cancel: 8 }; // before 0.13: someone who never changed them gets the new ones
const SETTINGS_VERSION = 2;
const RESERVED_BUTTONS = [0, 12, 13, 14, 15];

const inputActions = require('../input-actions');

// Controller preferences. Deadzone and trigger threshold are percentages.
const PAD_DEFAULTS = {
  deadzone: 15, trigger: 8, rumble: 'normal', style: 'split', glyphs: 'auto', joycons: 'together',
  // Which face button confirms: 'position' (the bottom one, on every controller) or 'label'
  // (Nintendo controllers follow their printed A/B/X/Y). See input-actions.js.
  confirm: 'position',
  repeat: 'standard', // how fast a held direction repeats, in the launcher and the browser (input-actions.js)
  // The browser pointer: which stick moves the cursor (the other one scrolls), and how fast.
  browserCursor: 'right', cursorSpeed: 50, scrollSpeed: 50,
  // The Guide button: what a quick press and a long hold do (see guide-button.js).
  guideButton: 'menu-home',
  guideDesktop: 'auto', // the guide in Desktop Mode: 'auto' (not while Steam runs), 'on', 'off'
  guideStyle: 'side', // how the guide looks: a panel from the side, a floating card, or compact
  oskSize: 'dock', // the on-screen keyboard: a docked panel in the middle, or wide (bigger keys, the whole width)
};
const PAD_CHOICES = {
  rumble: ['off', 'low', 'normal', 'high'],
  style: ['split', 'both', 'pulse'],
  glyphs: ['auto', 'xbox', 'playstation', 'nintendo'],
  joycons: ['together', 'separate'], // a left and a right Joy-Con: one controller, or two players
  confirm: inputActions.CONFIRM_CHOICES,
  repeat: inputActions.REPEAT_CHOICES,
  browserCursor: ['right', 'left'],
  guideButton: ['menu-home', 'home-menu', 'menu'],
  guideDesktop: ['auto', 'on', 'off'],
  guideStyle: ['side', 'float', 'compact'],
  oskSize: ['dock', 'wide'],
};
const PAD_RANGES = { deadzone: [0, 40], trigger: [0, 50], cursorSpeed: [10, 100], scrollSpeed: [10, 100] };
// Keyboard & mouse. Bindings are KeyboardEvent.code lists per action (see keyboard-map.js).
const keyboardMap = require('../keyboard-map');
const KB_DEFAULTS = { preset: 'standard', hints: 'auto', mouseHide: 3, wheel: 'move', bindings: null };
const KB_CHOICES = { preset: Object.keys(keyboardMap.PRESETS), hints: ['auto', 'controller', 'keyboard'], wheel: ['move', 'tabs', 'off'] };
const KB_RANGES = { mouseHide: [0, 30] }; // seconds; 0 = never hide while the mouse is in use
const kbPayload = () => ({ ...settings.kb, bindings: keyboardMap.normalize(settings.kb.bindings, settings.kb.preset) });

// What Guest may do once profiles exist: locked down to playing games until the admin allows more.
const GUEST_DEFAULTS = { show: true, games: true, apps: false, browser: false, pages: false, look: false, controls: false };
let settings = {
  scanRoots: [],
  keys: { ...DEFAULT_KEYS },
  theme: { active: 'stock', values: {} }, // values[themeId][settingId]
  pad: { ...PAD_DEFAULTS, remap: {} }, // remap: Settings > Button mapping, per controller family (input-actions.js)
  kb: { ...KB_DEFAULTS },
  calib: {}, // per controller: resting offsets of each axis
  driveNames: {}, // drive key -> the name the person gave it
  pin: null, // { salt, hash } for the PIN (never the PIN itself)
  pinBrowser: true, // the PIN also guards the browser
  firstRunDone: false, // the welcome page is shown once
  pageGrid: {}, // page key -> { cols, rows } for pages that differ from the theme's grid size
  calibration: null, // display calibration made by eye (see "display calibration" below), or null
  calibrationSystem: false, // also hand it to Gamescope so games get it too (experimental)
  installRoot: '', // where new games go by default (one of the library folders)
  ignoredDrives: [], // drives the person said "don't ask again" for
  mutedDrives: [], // drives that never trigger that warning
  hiddenDrives: [], // drives left out of Storage altogether
  profileData: {}, // the controls of everyone not playing right now (see switchControls)
  activeProfile: null, // who is playing (a profile id), or null: Everyone
  adminProfile: null, // the admin's own profile (see profiles.js: profile PINs)
  // Guest: Tessera with nobody's profile. Once profiles exist, Guest only does what the admin
  // allows here (see profiles.js); with no profiles at all nothing is restricted.
  guest: { ...GUEST_DEFAULTS },
  profileAsk: false, // ask "Who's playing?" when Tessera starts
  everyoneTheme: null, // the theme Everyone had on when someone else started playing
  profiles: [], // { id, name, themeId } — themeId null means "use the active theme"; first look at who's using Tessera
  // Shards (~/Tessera/Shards/<id>/) are the one add-on kind with Tessera's own level of system
  // access — unlike themes (values only) or widgets (sandboxed, no network, own files only).
  // Both of these are the owner's own call, not a fixed rule: this is a control Tessera gives
  // you, not a gate Tessera puts on you.
  codeAddons: {
    pinRequired: true, // installing or removing a shard needs the PIN, same as everywhere else that only matters once you've set one
    allowUnverified: true, // shards without Tessera's own signature still run — your device, your call
    enabled: [], // shards turned on in Settings > Add-ons > Shards; nothing runs until it's here
  },
};

function loadSettings() {
  try {
    const d = JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf8'));
    if (d && Array.isArray(d.scanRoots))
      settings.scanRoots = d.scanRoots.filter((r) => typeof r === 'string' && path.isAbsolute(r));
    if (d) settings.keys = cleanKeys(d.keys);
    if (d && d.theme && typeof d.theme === 'object') {
      if (typeof d.theme.active === 'string' && theming.THEME_ID_RE.test(d.theme.active)) settings.theme.active = d.theme.active;
      const vals = d.theme.values;
      if (vals && typeof vals === 'object') {
        for (const [tid, tv] of Object.entries(vals).slice(0, 32)) {
          if (!theming.THEME_ID_RE.test(tid) || !tv || typeof tv !== 'object') continue;
          const clean = {};
          for (const [sid, v] of Object.entries(tv).slice(0, 80)) {
            if (theming.SETTING_ID_RE.test(sid) && (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length < 600))) clean[sid] = v;
          }
          settings.theme.values[tid] = clean;
        }
      }
    }
    if (d) { settings.pad = cleanPad(d.pad, d.v); settings.kb = cleanKb(d.kb); }
    if (d && d.calib && typeof d.calib === 'object') {
      for (const [id, arr] of Object.entries(d.calib).slice(0, 16)) {
        if (id.length < 90 && Array.isArray(arr) && arr.length <= 8 && arr.every((n) => Number.isFinite(n) && Math.abs(n) <= 0.5))
          settings.calib[id] = arr.map((n) => Math.round(n * 1000) / 1000);
      }
    }
    if (d && d.driveNames && typeof d.driveNames === 'object') {
      for (const [k, v] of Object.entries(d.driveNames).slice(0, 64))
        if (k.length < 200 && typeof v === 'string' && v.trim() && v.length <= 40) settings.driveNames[k] = v.trim();
    }
    if (d && Array.isArray(d.profiles)) {
      const ids = new Set();
      const loaded = [];
      for (const pr of d.profiles.slice(0, theming.MAX_PROFILES)) {
        if (!pr || typeof pr !== 'object' || typeof pr.id !== 'string' || !theming.PROFILE_ID_RE.test(pr.id) || ids.has(pr.id)) continue;
        const name = theming.clip(pr.name, 24);
        if (!name) continue;
        ids.add(pr.id);
        const themeId = typeof pr.themeId === 'string' && theming.THEME_ID_RE.test(pr.themeId) ? pr.themeId : null;
        const color = typeof pr.color === 'string' && /^#[0-9a-f]{6}$/i.test(pr.color) ? pr.color : null;
        // their own PIN (a salted hash, like the admin PIN), and whether it guards their browser
        const pin = pr.pin && /^[0-9a-f]{32}$/.test(pr.pin.salt || '') && /^[0-9a-f]{64}$/.test(pr.pin.hash || '') ? { salt: pr.pin.salt, hash: pr.pin.hash } : null;
        loaded.push({ id: pr.id, name, themeId, color, pin, browserLock: pr.browserLock !== false, login: pr.login === 'own' ? 'own' : 'admin' });
      }
      // Replace, don't append: loadSettings() can run again in this same process (restoring a
      // backup, or a window reload), and appending would let stale or duplicate profiles from
      // before that reload silently pile up alongside the freshly-read ones.
      settings.profiles = loaded;
      settings.activeProfile = typeof d.activeProfile === 'string' && loaded.some((pr) => pr.id === d.activeProfile) ? d.activeProfile : null;
    } else if (d) {
      settings.profiles = [];
    }
    settings.profileAsk = Boolean(d && d.profileAsk === true && settings.profiles.length);
    settings.guest = { ...GUEST_DEFAULTS };
    if (d && d.guest && typeof d.guest === 'object') for (const k of Object.keys(GUEST_DEFAULTS)) if (typeof d.guest[k] === 'boolean') settings.guest[k] = d.guest[k];
    // The admin's own profile: it can log in with the admin PIN itself, or a PIN of its own.
    settings.adminProfile = d && typeof d.adminProfile === 'string' && settings.profiles.some((pr) => pr.id === d.adminProfile) ? d.adminProfile : null;
    settings.everyoneTheme = d && typeof d.everyoneTheme === 'string' && theming.THEME_ID_RE.test(d.everyoneTheme) ? d.everyoneTheme : null;
    // Everyone else's controls, kept while someone else is playing (see switchControls).
    settings.profileData = {};
    if (d && d.profileData && typeof d.profileData === 'object') {
      const live = settings.activeProfile || EVERYONE;
      for (const [key, c] of Object.entries(d.profileData).slice(0, theming.MAX_PROFILES + 1)) {
        if (key === live || !(key === EVERYONE || settings.profiles.some((pr) => pr.id === key)) || !c || typeof c !== 'object') continue;
        settings.profileData[key] = { pad: cleanPad(c.pad, 2), kb: cleanKb(c.kb), keys: cleanKeys(c.keys) };
      }
    }
    // A settings file from before the welcome page existed counts as "already welcomed".
    settings.firstRunDone = !d || d.firstRunDone === undefined ? true : d.firstRunDone === true;
    if (d && d.pin && /^[0-9a-f]{32}$/.test(d.pin.salt || '') && /^[0-9a-f]{64}$/.test(d.pin.hash || '')) settings.pin = { salt: d.pin.salt, hash: d.pin.hash };
    settings.pinBrowser = !d || d.pinBrowser !== false;
    settings.codeAddons = {
      pinRequired: !d || !d.codeAddons || d.codeAddons.pinRequired !== false,
      allowUnverified: !d || !d.codeAddons || d.codeAddons.allowUnverified !== false,
      enabled: d && d.codeAddons && Array.isArray(d.codeAddons.enabled)
        ? [...new Set(d.codeAddons.enabled.filter((x) => typeof x === 'string' && addons.WIDGET_ID_RE.test(x)))].slice(0, 64) : [],
    };
    settings.calibration = d && d.calibration ? calibration.cleanCal(d.calibration) : null;
    settings.calibrationSystem = Boolean(d && d.calibrationSystem === true && settings.calibration);
    if (d && typeof d.installRoot === 'string' && path.isAbsolute(d.installRoot)) settings.installRoot = d.installRoot;
    for (const k of ['mutedDrives', 'hiddenDrives']) if (d && Array.isArray(d[k])) settings[k] = d[k].filter((x) => typeof x === 'string' && x.length < 200).slice(-64);
    if (d && Array.isArray(d.ignoredDrives)) settings.ignoredDrives = d.ignoredDrives.filter((k) => typeof k === 'string' && k.length < 200).slice(-64);
    if (d && d.pageGrid && typeof d.pageGrid === 'object') {
      for (const [k, v] of Object.entries(d.pageGrid).slice(0, 200)) {
        const g = cleanPageGrid(k, v && v.cols, v && v.rows);
        if (g) settings.pageGrid[k] = g;
      }
    }
  } catch {
    /* none yet */
  }
  // A brand-new install looks in ~/Tessera/Games from the start.
  if (!settings.firstRunDone && !settings.scanRoots.length) {
    const g = folderBrowser.real(addons.vaultFolder('games'));
    if (g) settings.scanRoots.push(g);
  }
}
// ---- each person's controls: the Controller settings (button layout too), keyboard keys and the
// on-screen keyboard's buttons. The live ones (settings.pad / kb / keys) are always the person
// playing; the others wait in settings.profileData, under their profile id or EVERYONE (no
// profile). Everything reads the live ones, so switching is a swap, checked like a fresh load.
const EVERYONE = '_everyone'; // Guest's own controls (the key is older than the name)
function cleanKeys(src) {
  const keys = { ...DEFAULT_KEYS };
  const untouched = src && Object.keys(OLD_DEFAULT_KEYS).every((k) => src[k] === OLD_DEFAULT_KEYS[k]);
  if (src && typeof src === 'object' && !untouched) {
    for (const k of Object.keys(DEFAULT_KEYS)) {
      const v = src[k];
      if (Number.isInteger(v) && v >= 0 && v < 32 && !RESERVED_BUTTONS.includes(v)) keys[k] = v;
    }
  }
  return keys;
}
function cleanPad(src, v) {
  const pad = { ...PAD_DEFAULTS, remap: {} };
  if (!src || typeof src !== 'object') return pad;
  for (const k of Object.keys(PAD_DEFAULTS)) {
    if (k === 'glyphs' && !(v >= 2)) continue; // 0.12 saved "xbox" without the person choosing it
    const x = src[k];
    if (PAD_CHOICES[k] && PAD_CHOICES[k].includes(x)) pad[k] = x;
    else if (PAD_RANGES[k] && Number.isFinite(x) && x >= PAD_RANGES[k][0] && x <= PAD_RANGES[k][1]) pad[k] = Math.round(x);
  }
  if (src.remap && typeof src.remap === 'object') {
    for (const fam of inputActions.FAMILIES) {
      const m = src.remap[fam];
      if (inputActions.validRemap(m) && !inputActions.isIdentity(m)) pad.remap[fam] = m.slice();
    }
  }
  return pad;
}
function cleanKb(src) {
  const kb = { ...KB_DEFAULTS };
  if (!src || typeof src !== 'object') return kb;
  for (const k of Object.keys(KB_CHOICES)) if (KB_CHOICES[k].includes(src[k])) kb[k] = src[k];
  for (const k of Object.keys(KB_RANGES)) {
    const x = src[k];
    if (Number.isFinite(x) && x >= KB_RANGES[k][0] && x <= KB_RANGES[k][1]) kb[k] = Math.round(x);
  }
  if (src.bindings && typeof src.bindings === 'object') kb.bindings = keyboardMap.normalize(src.bindings, kb.preset);
  return kb;
}
const controlsNow = () => JSON.parse(JSON.stringify({ pad: settings.pad, kb: settings.kb, keys: settings.keys }));
const freshControls = () => ({ pad: cleanPad(null), kb: cleanKb(null), keys: { ...DEFAULT_KEYS } });
// The controls a profile has (or would have), without switching to it.
function controlsOf(key) {
  if (key === (settings.activeProfile || EVERYONE)) return controlsNow();
  const c = settings.profileData[key];
  return c ? JSON.parse(JSON.stringify(c)) : null;
}
// Put `from`'s live controls away and bring out `to`'s (or a fresh set).
function switchControls(from, to) {
  settings.profileData[from] = controlsNow();
  const c = settings.profileData[to] || freshControls();
  delete settings.profileData[to];
  settings.pad = cleanPad(c.pad, 2);
  settings.kb = cleanKb(c.kb);
  settings.keys = cleanKeys(c.keys);
}
// A page's own grid size: key is a page id (or f:<folder id>), cols 2-12, rows 1-8.
function cleanPageGrid(key, cols, rows) {
  if (typeof key !== 'string' || !/^(f:)?[A-Za-z0-9._-]{1,80}$/.test(key)) return null;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 12 || rows < 1 || rows > 8) return null;
  return { cols, rows };
}
function saveSettings() {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  const tmp = config.SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ v: SETTINGS_VERSION, ...settings }, null, 2));
  fs.renameSync(tmp, config.SETTINGS_FILE);
}

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const theming = require('./theming');
const calibration = require('./calibration');
const folderBrowser = require('./folderBrowser');
const addons = require('./addons');
