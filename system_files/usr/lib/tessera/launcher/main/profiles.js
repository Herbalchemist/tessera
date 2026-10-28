// SPDX-License-Identifier: GPL-3.0-or-later
// Profiles: who is using Tessera, each with their own controls, pages, browser and theme.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views.
module.exports = {
  get browserNeedsProfilePin() { return browserNeedsProfilePin; },
  get atStartup() { return atStartup; },
};

const { ipcMain } = require('electron');
const crypto = require('crypto');
const prefs = require('./prefs');
const theming = require('./theming');
const ipc = require('./ipc');

// ------------------------------------------------------------ profiles
// Each person has their own:
//   - controls: the Controller settings (button layout, Confirm button, repeat speed and the rest),
//     keyboard keys and the on-screen keyboard's buttons (prefs.switchControls);
//   - pages: Home, their mosaics and the widgets on them, the tab order and Recently played
//     (library.switchLayout); the games and apps themselves are shared, installed once;
//   - browser: their own cookies, logins and history (a browser storage of their own);
//   - theme: whatever they pick while playing stays theirs.
// No profile ("Everyone") is a set of its own. Stick calibration belongs to the controller, not
// the person, and the PIN, Wi-Fi, storage and add-ons belong to the machine: those are shared.
const COLORS = ['#7fb2ff', '#ff8fb1', '#7fe0b0', '#ffc46b', '#c49bff', '#6be0e6', '#ff9a6b', '#b8e06b'];
const activeProfile = () => (prefs.settings.profiles.some((p) => p.id === prefs.settings.activeProfile) ? prefs.settings.activeProfile : null);
const keyOf = (id) => id || prefs.EVERYONE;
const profilesInfo = () => ({
  profiles: prefs.settings.profiles.map((p) => ({ id: p.id, name: p.name, themeId: p.themeId, color: p.color, locked: profileLocked(p), ownPin: Boolean(p.pin), browserLock: p.browserLock !== false, login: p.login || 'admin', admin: p.id === prefs.settings.adminProfile })),
  active: activeProfile(),
  ask: Boolean(prefs.settings.profileAsk),
  adminPin: pinLock.pinIsSet(),
  lockedOut,
});

// ---- profile PINs. A profile can have a PIN of its own: for logging in as them and for their own
// things (their browser). It never grants admin rights: Settings, adding, deleting and the rest
// still need the admin PIN. The admin PIN opens any profile.
// The admin's own profile (settings.adminProfile) logs in with the admin PIN itself (login
// 'admin', the default) or with a PIN of its own (login 'own'), and then the admin PIN is still
// asked whenever admin rights are needed.
const PROFILE_WINDOW = 5 * 60 * 1000;
const profileUnlockedUntil = new Map(); // id -> time: logged in with their PIN this recently
// Misses per profile, kept on disk (like the admin PIN's) so a restart doesn't hand out fresh guesses.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const PROFILE_TRIES_FILE = path.join(config.LOG_DIR, '..', 'profile-pin-tries.json');
const profileTries = new Map(); // id -> { fails, lockedUntil }
try {
  const d = JSON.parse(fs.readFileSync(PROFILE_TRIES_FILE, 'utf8'));
  for (const [id, t] of Object.entries(d || {}).slice(0, 64)) {
    if (t && Number.isInteger(t.fails) && t.fails > 0 && t.fails < 1e6) profileTries.set(id, { fails: t.fails, lockedUntil: Number.isFinite(t.lockedUntil) ? Math.min(t.lockedUntil, Date.now() + 300 * 1000) : 0 });
  }
} catch { /* none yet */ }
function saveProfileTries() {
  try {
    fs.mkdirSync(path.dirname(PROFILE_TRIES_FILE), { recursive: true });
    fs.writeFileSync(PROFILE_TRIES_FILE, JSON.stringify(Object.fromEntries(profileTries)), { mode: 0o600 });
  } catch { /* read-only: the in-memory count still applies */ }
}
const isAdminProfile = (pr) => Boolean(pr && pr.id === prefs.settings.adminProfile);
// Does logging in as them need a PIN?
function profileLocked(pr) {
  if (!pr) return false;
  if (isAdminProfile(pr) && pr.login !== 'own') return pinLock.pinIsSet();
  return Boolean(pr.pin);
}
function ownPinMatches(pr, pin) {
  if (!pr || !pr.pin || typeof pin !== 'string' || !pinLock.PIN_RE.test(pin)) return false;
  const a = Buffer.from(pinLock.pinHash(pin, pr.pin.salt), 'hex');
  return crypto.timingSafeEqual(a, Buffer.from(pr.pin.hash, 'hex'));
}
// Checks a PIN for a profile: the admin PIN always works (and unlocks admin rights, as entering it
// anywhere does); their own PIN works for them only. Misses lock that profile out for a while, like
// the admin PIN does.
function profilePinTry(pr, pin) {
  const now = Date.now();
  const t = profileTries.get(pr.id) || { fails: 0, lockedUntil: 0 };
  if (now < t.lockedUntil) return { ok: false, wait: Math.ceil((t.lockedUntil - now) / 1000), error: `Too many tries. Wait ${Math.ceil((t.lockedUntil - now) / 1000)} seconds.` };
  if (pinLock.pinIsSet() && pinLock.pinMatches(pin)) {
    const r = pinLock.pinTry(pin); // counts it as an admin PIN entry (its own lockout applies)
    if (r.ok) { profileTries.delete(pr.id); saveProfileTries(); profileUnlockedUntil.set(pr.id, now + PROFILE_WINDOW); return { ok: true, admin: true }; }
    return r;
  }
  const adminLogin = isAdminProfile(pr) && pr.login !== 'own';
  if (!adminLogin && ownPinMatches(pr, pin)) {
    profileTries.delete(pr.id);
    saveProfileTries();
    profileUnlockedUntil.set(pr.id, now + PROFILE_WINDOW);
    return { ok: true };
  }
  // A miss here was also a guess at the admin PIN: it counts against that one's lockout too.
  const admin = pinLock.pinIsSet() ? pinLock.pinMiss(now) : null;
  t.fails++;
  if (admin && admin.wait && t.fails < 5) { profileTries.set(pr.id, t); saveProfileTries(); return admin; }
  if (t.fails >= 5) {
    const wait = Math.min(300, 30 * 2 ** Math.floor((t.fails - 5) / 5));
    t.lockedUntil = now + wait * 1000;
    profileTries.set(pr.id, t);
    saveProfileTries();
    return { ok: false, wait, error: `Too many tries. Wait ${wait} seconds and try again.` };
  }
  profileTries.set(pr.id, t);
  saveProfileTries();
  return { ok: false, error: `That isn't ${pr.name}'s PIN. ${5 - t.fails} ${5 - t.fails === 1 ? 'try' : 'tries'} left.` };
}
// Is this profile's PIN fresh (entered in the last few minutes), or the admin unlocked?
const profileOk = (pr) => !profileLocked(pr) || Date.now() < (profileUnlockedUntil.get(pr.id) || 0) || (pinLock.pinIsSet() && pinLock.pinOk());
// The browser of the person playing, when they asked for their PIN to guard it.
function browserNeedsProfilePin() {
  const pr = prefs.settings.profiles.find((x) => x.id === activeProfile());
  if (!pr || pr.browserLock === false || !profileLocked(pr) || profileOk(pr)) return null;
  return { ok: false, needProfilePin: true, id: pr.id, name: pr.name, error: `Enter ${pr.name}'s PIN first.` };
}
// Tessera starting while a profile with a PIN was playing: nobody is logged in yet, so it starts as
// Everyone and asks who's playing (that person first).
let lockedOut = null;
function atStartup() {
  const pr = prefs.settings.profiles.find((x) => x.id === activeProfile());
  if (pr && profileLocked(pr) && !profileOk(pr) && useProfile(null)) lockedOut = pr.id;
}
const NEED_PROFILE_PIN = (pr) => ({ ok: false, needProfilePin: true, id: pr.id, name: pr.name, error: `Enter ${pr.name}'s PIN first.` });
// Switch who is playing: their controls, pages, browser and theme come with them.
function useProfile(id) {
  const from = activeProfile();
  if (from === id) return true;
  if (!library.switchLayout(keyOf(id))) return false; // the library file couldn't be read: change nothing
  prefs.switchControls(keyOf(from), keyOf(id));
  // the theme: the one leaving keeps what they had on; the one arriving gets theirs back
  const leaving = from && prefs.settings.profiles.find((p) => p.id === from);
  if (leaving) leaving.themeId = prefs.settings.theme.active;
  else prefs.settings.everyoneTheme = prefs.settings.theme.active;
  const arriving = id && prefs.settings.profiles.find((p) => p.id === id);
  // someone with no theme of their own gets the shared (Everyone's) one, never the last person's
  const theme = (arriving && arriving.themeId) || prefs.settings.everyoneTheme;
  if (theme && theming.themes.has(theme)) { prefs.settings.theme.active = theme; theming.themeRev++; }
  prefs.settings.activeProfile = id;
  prefs.saveSettings();
  webView.dropBrowserView(); // the next person's browser opens with their own logins
  system.padsCtl.regroup(); // Joy-Con grouping is a controller setting
  return true;
}
const switched = () => ({ ok: true, ...profilesInfo(), theme: theming.themePayload(), view: library.buildView() });
ipcMain.handle('profiles', ipc.safe((op, p) => {
  if (op === 'list') return profilesInfo();
  if (op === 'browserCheck') return browserNeedsProfilePin() || { ok: true };
  if (op === 'add') {
    if (!pinLock.pinOk()) return pinLock.NEED_PIN;
    const name = theming.clip(p.name, 24);
    if (!name) return { ok: false, error: 'Give them a name.' };
    if (prefs.settings.profiles.length >= theming.MAX_PROFILES) return { ok: false, error: `${theming.MAX_PROFILES} is the most profiles at once.` };
    let id;
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'player';
    for (let i = 0; ; i++) {
      const cand = i === 0 ? base : `${base}-${i}`;
      if (theming.PROFILE_ID_RE.test(cand) && !prefs.settings.profiles.some((pr) => pr.id === cand)) { id = cand; break; }
    }
    // A new person starts from Everyone's setup (pages and controls), or from scratch.
    const fresh = p.start === 'fresh';
    const used = new Set(prefs.settings.profiles.map((x) => x.color));
    const color = COLORS.find((c) => !used.has(c)) || COLORS[prefs.settings.profiles.length % COLORS.length];
    prefs.settings.profiles.push({ id, name, themeId: null, color, pin: null, browserLock: true, login: 'admin' });
    prefs.settings.profileData[id] = fresh ? prefs.freshControls() : (prefs.controlsOf(prefs.EVERYONE) || prefs.freshControls());
    library.setLayout(id, fresh ? library.freshLayout() : (library.layoutOf(prefs.EVERYONE) || library.freshLayout()));
    try { library.saveState(); } catch { /* the pages start fresh then */ }
    prefs.saveSettings();
    return { ok: true, id, ...profilesInfo() };
  }
  if (op === 'rename') {
    if (!pinLock.pinOk()) return pinLock.NEED_PIN;
    const pr = prefs.settings.profiles.find((x) => x.id === p.id);
    if (!pr) return { ok: false, error: "That profile doesn't exist." };
    const name = theming.clip(p.name, 24);
    if (!name) return { ok: false, error: 'Give them a name.' };
    pr.name = name;
    prefs.saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  if (op === 'remove') {
    if (!pinLock.pinOk()) return pinLock.NEED_PIN;
    const pr = prefs.settings.profiles.find((x) => x.id === p.id);
    if (!pr) return { ok: true, ...profilesInfo() };
    if (activeProfile() === pr.id && !useProfile(null)) return { ok: false, error: "Couldn't switch away from that profile first." };
    // Everything that was theirs goes: their controls, their pages and their browser data.
    prefs.settings.profiles = prefs.settings.profiles.filter((x) => x.id !== pr.id);
    if (prefs.settings.adminProfile === pr.id) prefs.settings.adminProfile = null;
    profileUnlockedUntil.delete(pr.id);
    profileTries.delete(pr.id);
    saveProfileTries();
    delete prefs.settings.profileData[pr.id];
    library.setLayout(pr.id, null);
    try { library.saveState(); } catch { /* left over; never shown */ }
    prefs.saveSettings();
    webView.forgetBrowserProfile(pr.id);
    return { ok: true, ...switched() };
  }
  // Who is playing. Switching needs no PIN: it only brings out that person's own things.
  if (op === 'use') {
    const pr = p.id !== null && prefs.settings.profiles.find((x) => x.id === p.id);
    if (p.id !== null && !pr) return { ok: false, error: "That profile doesn't exist." };
    // A profile with a PIN: theirs, or the admin PIN. (Switching to Everyone needs none.)
    if (pr && profileLocked(pr) && activeProfile() !== pr.id) {
      if (p.pin === undefined) return NEED_PROFILE_PIN(pr);
      const t = profilePinTry(pr, String(p.pin));
      if (!t.ok) return { ...t, needProfilePin: true, id: pr.id, name: pr.name };
    }
    const from = activeProfile();
    if (!useProfile(p.id)) return { ok: false, error: "Couldn't switch: the library file needs fixing first." };
    if (from && from !== p.id) profileUnlockedUntil.delete(from); // whoever left is logged out
    lockedOut = null;
    return switched();
  }
  // Their PIN, entered again (for their browser, after a while).
  if (op === 'unlock') {
    const pr = prefs.settings.profiles.find((x) => x.id === p.id);
    if (!pr) return { ok: false, error: "That profile doesn't exist." };
    return profilePinTry(pr, String(p.pin || ''));
  }
  // Setting, changing or removing a profile's own PIN: they do it while logged in as themselves
  // (with their PIN fresh), or the admin does it. Never a way in to admin rights.
  if (op === 'setPin') {
    const pr = prefs.settings.profiles.find((x) => x.id === p.id);
    if (!pr) return { ok: false, error: "That profile doesn't exist." };
    const mine = activeProfile() === pr.id && profileOk(pr) && !(isAdminProfile(pr) && pr.login !== 'own' && !pinLock.pinOk());
    if (!mine && !pinLock.pinOk()) return pinLock.NEED_PIN;
    if (p.pin === null) {
      pr.pin = null;
      if (isAdminProfile(pr)) pr.login = 'admin';
    } else {
      if (typeof p.pin !== 'string' || !pinLock.PIN_RE.test(p.pin)) return { ok: false, error: 'Use 4 to 8 digits.' };
      // Matching it against the admin PIN is only said to someone already holding admin rights:
      // telling anyone else would let them test guesses at the admin PIN with no lockout.
      if (pinLock.pinIsSet() && pinLock.pinOk() && pinLock.pinMatches(p.pin) && !isAdminProfile(pr)) return { ok: false, error: "That's the admin PIN. Choose a different one, so logging in as them doesn't also give admin rights." };
      const salt = crypto.randomBytes(16).toString('hex');
      pr.pin = { salt, hash: pinLock.pinHash(p.pin, salt) };
      if (isAdminProfile(pr)) pr.login = 'own';
      profileUnlockedUntil.set(pr.id, Date.now() + PROFILE_WINDOW);
    }
    prefs.saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  if (op === 'browserLock') {
    const pr = prefs.settings.profiles.find((x) => x.id === p.id);
    if (!pr) return { ok: false, error: "That profile doesn't exist." };
    if (!(activeProfile() === pr.id && profileOk(pr)) && !pinLock.pinOk()) return pinLock.NEED_PIN;
    pr.browserLock = p.on !== false;
    prefs.saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  // Which profile is the admin's own, and how it logs in. Admin rights needed.
  if (op === 'setAdmin') {
    if (!pinLock.pinIsSet()) return { ok: false, error: 'Set the admin PIN first (Settings › PIN).' };
    if (!pinLock.pinOk()) return pinLock.NEED_PIN;
    if (p.id !== null && !prefs.settings.profiles.some((x) => x.id === p.id)) return { ok: false, error: "That profile doesn't exist." };
    prefs.settings.adminProfile = p.id;
    prefs.saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  if (op === 'adminLogin') {
    const pr = prefs.settings.profiles.find((x) => x.id === prefs.settings.adminProfile);
    if (!pr) return { ok: false, error: 'No profile is the admin profile.' };
    if (!pinLock.pinOk()) return pinLock.NEED_PIN;
    if (p.login === 'admin') { pr.login = 'admin'; pr.pin = null; } // the admin PIN is their login again
    else if (p.login === 'own') { if (!pr.pin) return { ok: false, error: 'Choose their own PIN first.' }; pr.login = 'own'; }
    prefs.saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  // "Who's playing?" when Tessera starts.
  if (op === 'ask') {
    prefs.settings.profileAsk = p.on === true;
    prefs.saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  if (op === 'setTheme') {
    // Giving a profile its own theme is the one profile change that doesn't need the PIN —
    // it's no more sensitive than switching the active theme already is.
    const pr = prefs.settings.profiles.find((x) => x.id === p.id);
    if (!pr) return { ok: false, error: "That profile doesn't exist." };
    if (p.themeId !== null && (typeof p.themeId !== 'string' || !theming.themes.has(p.themeId))) return { ok: false, error: "That theme doesn't exist." };
    pr.themeId = p.themeId;
    if (activeProfile() === pr.id && p.themeId) { prefs.settings.theme.active = p.themeId; theming.themeRev++; }
    prefs.saveSettings();
    return { ok: true, ...profilesInfo(), theme: theming.themePayload() };
  }
  return { error: 'Unknown action.' };
}));

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const pinLock = require('./pinLock');
const library = require('./library');
const system = require('./system');
const webView = require('./webView');
