// SPDX-License-Identifier: GPL-3.0-or-later
// Requests from the page for the library, folders, storage and add-ons.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get safe() { return safe; },
};

const { ipcMain } = require('electron');
const path = require('path');
const library = require('./library');
const prefs = require('./prefs');
const theming = require('./theming');
const art = require('./art');
const addons = require('./addons');
const shards = require('./shards');
const storage = require('./storage');

// Every handler takes plain data, validates it, and returns plain data.
const safe = (fn) => (_e, op, p) => {
  try {
    return fn(typeof op === 'string' ? op : '', p && typeof p === 'object' ? p : {});
  } catch (err) {
    return { ok: false, error: 'Something went wrong.' };
  }
};

ipcMain.handle('library', safe((op, p) => {
  const guest = require('./profiles').guestDenies('pages'); // Guest changes pages only if the admin allows
  if (guest) return { ...guest, view: library.buildView() };
  if (['deleteItem', 'deleteCategory', 'removeEntry', 'deleteFiles'].includes(op) && !pinLock.pinOk()) return { ...pinLock.NEED_PIN, view: library.buildView() };
  const r = library.libraryOp(op, p);
  if (r.ok) {
    try { library.saveState(); } catch { return { ok: false, error: "Couldn't save your library." }; }
  }
  return { ...r, view: library.buildView() };
}));

ipcMain.handle('browse', safe((op, p) => {
  if (op === 'choose' && ['addGame', 'addApp', 'addRoot', 'backupTo', 'restoreFrom'].includes(art.browse && art.browse.purpose) && !pinLock.pinOk()) return pinLock.NEED_PIN;
  return art.browseOp(op, p);
}));

ipcMain.handle('storage', (_e, op, p) => storage.storageOp(typeof op === 'string' ? op : '', p && typeof p === 'object' ? p : {}));

ipcMain.handle('addons', safe((op, p) => {
  if (op === 'remove') {
    // Deletes one widget, theme or shard folder from the Tessera folder, never the folder itself.
    const dir = p.dir === 'widgets' || p.dir === 'themes' || p.dir === 'packs' ? p.dir : null;
    if (!dir || typeof p.id !== "string" || !(dir === "themes" ? theming.THEME_ID_RE : addons.WIDGET_ID_RE).test(p.id)) return { ok: false, error: 'Bad request.' };
    // A theme isn't blocked from being deleted just because it's active or in use — it's only
    // the PIN that's conditional on that. Whoever's relying on it falls back to stock. A shard's
    // PIN requirement is the owner's own setting (settings.codeAddons.pinRequired), separate
    // from everything else here, because a shard is a different kind of thing entirely.
    const inUse = dir === 'themes' && theming.themeInUse(p.id);
    if (inUse && !pinLock.pinOk()) return pinLock.NEED_PIN;
    if (dir === 'packs' && prefs.settings.codeAddons.pinRequired && !pinLock.pinOk()) return pinLock.NEED_PIN;
    if (dir === 'packs') shards.forget(p.id); // stop it first, and forget it was on
    const r = addons.vaultDelete(path.join(addons.addonDir(dir), p.id));
    if (!r.ok) return r;
    let fellBack = [];
    if (dir === 'themes') {
      delete prefs.settings.theme.values[p.id];
      if (theming.activeTheme() === p.id) { prefs.settings.theme.active = 'stock'; fellBack.push('the active theme'); theming.themeRev++; }
      for (const pr of prefs.settings.profiles) if (pr.themeId === p.id) { pr.themeId = null; fellBack.push(pr.name); }
    }
    addons.scanAddons(); theming.scanThemes(); prefs.saveSettings();
    return { ok: true, info: addons.addonsInfo(), theme: theming.themePayload(), fellBack };
  }
  if (op === 'packsPinRequired') {
    if (!pinLock.pinOk()) return pinLock.NEED_PIN;
    prefs.settings.codeAddons.pinRequired = p.value === true;
    prefs.saveSettings();
    return { ok: true, info: addons.addonsInfo() };
  }
  if (op === 'packsAllowUnverified') {
    if (!pinLock.pinOk()) return pinLock.NEED_PIN;
    prefs.settings.codeAddons.allowUnverified = p.value === true;
    prefs.saveSettings();
    return { ok: true, info: addons.addonsInfo() };
  }
  if (op === 'saveTheme') {
    if (typeof p.name !== 'string' || !p.name.trim()) return { ok: false, error: 'Give it a name.' };
    const id = theming.newThemeId(p.name);
    if (!id) return { ok: false, error: "Couldn't make room for a new theme." };
    const r = theming.writeThemeFile(id, p.name, theming.currentThemeValues(theming.activeTheme()));
    if (!r.ok) return r;
    theming.scanThemes();
    prefs.settings.theme.active = id;
    theming.themeRev++;
    prefs.saveSettings();
    return { ok: true, info: addons.addonsInfo(), theme: theming.themePayload() };
  }
  if (op === 'renameTheme') {
    const t = theming.themes.get(p.id);
    if (!t || t.builtin) return { ok: false, error: "That theme can't be renamed." };
    if (typeof p.name !== 'string' || !p.name.trim()) return { ok: false, error: 'Give it a name.' };
    const r = theming.renameThemeFile(p.id, p.name);
    if (!r.ok) return r;
    theming.scanThemes();
    return { ok: true, info: addons.addonsInfo(), theme: theming.themePayload() };
  }
  if (op === 'overwriteTheme') {
    const t = theming.themes.get(p.id);
    if (!t || t.builtin) return { ok: false, error: "That theme can't be overwritten." };
    if (p.id !== theming.activeTheme()) return { ok: false, error: 'Switch to it first.' };
    const r = theming.writeThemeFile(p.id, t.name, theming.currentThemeValues(p.id));
    if (!r.ok) return r;
    theming.scanThemes();
    return { ok: true, info: addons.addonsInfo(), theme: theming.themePayload() };
  }
  if (op === 'rescan') { addons.scanAddons(); theming.scanThemes(); }
  if (op === 'list' || op === 'rescan') return addons.addonsInfo();
  return { error: 'Unknown action.' };
}));

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const pinLock = require('./pinLock');
