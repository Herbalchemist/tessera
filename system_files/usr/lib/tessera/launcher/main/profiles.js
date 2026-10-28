// SPDX-License-Identifier: GPL-3.0-or-later
// Profiles: who is using Tessera, each with their own controls, pages, browser and theme.
// Part of the launcher's main process (see main.js for the order the parts load in).

const { ipcMain } = require('electron');
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
  profiles: prefs.settings.profiles.map((p) => ({ id: p.id, name: p.name, themeId: p.themeId, color: p.color })),
  active: activeProfile(),
  ask: Boolean(prefs.settings.profileAsk),
});
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
    prefs.settings.profiles.push({ id, name, themeId: null, color });
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
    delete prefs.settings.profileData[pr.id];
    library.setLayout(pr.id, null);
    try { library.saveState(); } catch { /* left over; never shown */ }
    prefs.saveSettings();
    webView.forgetBrowserProfile(pr.id);
    return { ok: true, ...switched() };
  }
  // Who is playing. Switching needs no PIN: it only brings out that person's own things.
  if (op === 'use') {
    if (p.id !== null && !prefs.settings.profiles.some((x) => x.id === p.id)) return { ok: false, error: "That profile doesn't exist." };
    if (!useProfile(p.id)) return { ok: false, error: "Couldn't switch: the library file needs fixing first." };
    return switched();
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
