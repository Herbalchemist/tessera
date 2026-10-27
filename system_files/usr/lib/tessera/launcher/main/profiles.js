// SPDX-License-Identifier: GPL-3.0-or-later
// Profiles: who is using Tessera, and their theme.
// Part of the launcher's main process (see main.js for the order the parts load in).

const { ipcMain } = require('electron');
const prefs = require('./prefs');
const theming = require('./theming');
const ipc = require('./ipc');

// ------------------------------------------------------------ profiles
// Minimal, on purpose: an id, a name, and an optional theme of their own. No switching session,
// no PIN-per-profile, no startup wizard yet — just enough real state for "is this theme being
// used by someone else" to mean something, instead of being permanently empty.
const activeProfile = () => (prefs.settings.profiles.some((p) => p.id === prefs.settings.activeProfile) ? prefs.settings.activeProfile : null);
const profilesInfo = () => ({ profiles: prefs.settings.profiles.map((p) => ({ id: p.id, name: p.name, themeId: p.themeId })), active: activeProfile() });
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
    prefs.settings.profiles.push({ id, name, themeId: null });
    prefs.saveSettings();
    return { ok: true, ...profilesInfo() };
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
    const before = prefs.settings.profiles.length;
    prefs.settings.profiles = prefs.settings.profiles.filter((x) => x.id !== p.id);
    if (prefs.settings.profiles.length !== before) prefs.saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  // Who is playing. Switching needs no PIN (it is no more than picking a theme); the profile's
  // own theme, if it has one, comes with it.
  if (op === 'use') {
    if (p.id === null) { prefs.settings.activeProfile = null; prefs.saveSettings(); return { ok: true, ...profilesInfo(), theme: theming.themePayload() }; }
    const pr = prefs.settings.profiles.find((x) => x.id === p.id);
    if (!pr) return { ok: false, error: "That profile doesn't exist." };
    prefs.settings.activeProfile = pr.id;
    if (pr.themeId && theming.themes.has(pr.themeId)) { prefs.settings.theme.active = pr.themeId; theming.themeRev++; }
    prefs.saveSettings();
    return { ok: true, ...profilesInfo(), theme: theming.themePayload() };
  }
  if (op === 'setTheme') {
    // Giving a profile its own theme is the one profile change that doesn't need the PIN —
    // it's no more sensitive than switching the active theme already is.
    const pr = prefs.settings.profiles.find((x) => x.id === p.id);
    if (!pr) return { ok: false, error: "That profile doesn't exist." };
    if (p.themeId !== null && (typeof p.themeId !== 'string' || !theming.themes.has(p.themeId))) return { ok: false, error: "That theme doesn't exist." };
    pr.themeId = p.themeId;
    prefs.saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  return { error: 'Unknown action.' };
}));

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const pinLock = require('./pinLock');
