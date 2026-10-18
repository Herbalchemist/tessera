// SPDX-License-Identifier: GPL-3.0-or-later
const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');

// Widgets are shown through their own scheme so the app can control exactly
// what they may load. Must be registered before the app is ready.
const WIDGET_SCHEME = 'tessera-widget';
const ART_SCHEME = 'tessera-art'; // game pictures, by library id (never by path)
protocol.registerSchemesAsPrivileged([
  { scheme: WIDGET_SCHEME, privileges: { standard: true, secure: true } },
  { scheme: ART_SCHEME, privileges: { standard: true, secure: true } },
]);

// Mutable data lives outside the read-only image, never under /usr.
// Override the folder with TESSERA_DATA_DIR, or the files with
// LAUNCHER_LIBRARY. library.json holds what you see; settings.json holds
// the folders you asked Tessera to scan. An older games.json still loads.
const DATA_DIR =
  process.env.TESSERA_DATA_DIR ||
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'tessera');
const LIBRARY_FILE = process.env.LAUNCHER_LIBRARY || path.join(DATA_DIR, 'library.json');
const LEGACY_FILE = process.env.LAUNCHER_GAMES || path.join(DATA_DIR, 'games.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEV = process.env.TESSERA_DEV === '1';

const LEGACY_TABS = ['home', 'library', 'apps']; // older files put rows on tabs
const KINDS = ['game', 'app'];
// Inlays are small live pieces (widgets) set into a page. A built-in preset is
// drawn by the renderer; a downloaded widget is a folder in widgets/ and runs
// in a locked-down frame (see "add-ons" below).
// Presets that ship with Tessera. Nothing is added to a page by default: the
// user picks one. Inlays sit on Home's grid (GRID cells across the whole
// screen, so a layout scales to any display). size/min/max are in cells.
const GRID = { cols: 12, rows: 6 };
const BUILTIN_INLAYS = {
  clock: {
    name: 'Clock', description: 'Time and date',
    size: { w: 3, h: 2 }, min: { w: 2, h: 1 }, max: { w: 12, h: 6 }, resizable: true,
  },
  recent: {
    name: 'Recently played', description: 'Your latest games and apps',
    size: { w: 4, h: 3 }, min: { w: 3, h: 2 }, max: { w: 8, h: 6 }, resizable: true,
  },
};
const RECENT_MAX = 30; // remembered plays (the widget shows as many as fit)
const WIDGET_TYPE_RE = /^widget:[a-z0-9][a-z0-9._-]{0,63}$/;
const TAB_ID_RE = /^(home|library|apps|m:[A-Za-z0-9._-]{1,80})$/;
const HOME_ID = '_home'; // Home is a built-in page that holds entries like any mosaic
const MAX_TITLE = 40;
const SCAN_DEPTH = 3;       // folders below a library folder
const SCAN_MAX_VISITS = 20000;
const BROWSE_MAX = 500;
const LOG_DIR = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'tessera', 'logs');

let mainWindow = null;
let running = false;

// ---------------------------------------------------------------- library

// items:      [{ id, kind: "game"|"app", title, path, args? }]
// inlays:     [{ id, type }]
// categories: [{ id, title, entries: [id...], top?: true, builtin?: true }]
// An entry is an item, an inlay, or another category (shown as a folder tile).
// A "top" category is a mosaic: it gets its own tab, in the order listed.
// The built-in Home category holds Home's tiles and cannot be renamed or deleted.
let state = { items: [], inlays: [], categories: [], tabOrder: [], recent: [], warn: null, locked: null };

function homeCat() {
  return { id: HOME_ID, title: 'Home', entries: [], builtin: true };
}

function readLibraryFile() {
  for (const file of [LIBRARY_FILE, LEGACY_FILE]) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return { data: { items: data, categories: [] } };
      if (data && typeof data === 'object') return { data };
      return { error: `${path.basename(file)} has the wrong shape.` };
    } catch (e) {
      return { error: `${path.basename(file)} is not valid JSON: ${e.message}` };
    }
  }
  return { data: { items: [], categories: [] } }; // nothing yet: that's fine
}

function loadState() {
  const { data, error } = readLibraryFile();
  if (error) {
    // Never overwrite a file we couldn't read: the user may want to fix it.
    state = { items: [], inlays: [], categories: [homeCat()], warn: error, locked: error };
    return;
  }
  let skipped = 0;
  const ids = new Set();
  const items = [];
  for (const g of Array.isArray(data.items) ? data.items : []) {
    const ok =
      g &&
      typeof g.id === 'string' &&
      typeof g.title === 'string' &&
      typeof g.path === 'string' &&
      path.isAbsolute(g.path) &&
      (g.kind === undefined || KINDS.includes(g.kind)) &&
      (g.args === undefined ||
        (Array.isArray(g.args) && g.args.every((a) => typeof a === 'string' && a.length <= 500))) &&
      !ids.has(g.id);
    if (!ok) { skipped++; continue; }
    ids.add(g.id);
    const it = { id: g.id, kind: g.kind || 'game', title: g.title, path: g.path };
    if (g.args && g.args.length) it.args = g.args;
    if (typeof g.art === 'string' && path.isAbsolute(g.art)) it.art = g.art; // a picture the person chose
    items.push(it);
  }
  const inlays = [];
  const autoPlace = [];
  for (const n of Array.isArray(data.inlays) ? data.inlays : []) {
    const ok =
      n &&
      typeof n.id === 'string' &&
      typeof n.type === 'string' &&
      (BUILTIN_INLAYS[n.type] || WIDGET_TYPE_RE.test(n.type)) &&
      !ids.has(n.id);
    if (!ok) { skipped++; continue; }
    ids.add(n.id);
    const inlay = { id: n.id, type: n.type, ...fitRect(inlayDef(n.type), n) };
    if (!Number.isInteger(n.x) || !Number.isInteger(n.y)) autoPlace.push(inlay);
    inlays.push(inlay);
  }
  // Older files have no position: put those in the first free spot.
  const placed = inlays.filter((o) => !autoPlace.includes(o));
  for (const inlay of autoPlace) {
    Object.assign(inlay, findFree(inlay.w, inlay.h, placed));
    placed.push(inlay);
  }
  const catIds = new Set();
  const categories = [];
  for (const c of Array.isArray(data.categories) ? data.categories : []) {
    const ok =
      c &&
      typeof c.id === 'string' &&
      typeof c.title === 'string' &&
      Array.isArray(c.entries) &&
      !ids.has(c.id) &&
      !catIds.has(c.id);
    if (!ok) { skipped++; continue; }
    catIds.add(c.id);
    const cat = { id: c.id, title: c.title, entries: c.entries.filter((e) => typeof e === 'string') };
    if (c.id === HOME_ID) cat.builtin = true;
    // Older files placed categories as rows on tabs; they become mosaics.
    else if (c.top === true || LEGACY_TABS.includes(c.tab)) cat.top = true;
    categories.push(cat);
  }
  if (!catIds.has(HOME_ID)) categories.unshift(homeCat());
  const tabOrder = (Array.isArray(data.tabOrder) ? data.tabOrder : [])
    .filter((t) => typeof t === 'string' && TAB_ID_RE.test(t))
    .slice(0, 200);
  const itemIds = new Set(items.map((i) => i.id));
  const recent = (Array.isArray(data.recent) ? data.recent : [])
    .filter((r) => r && typeof r.id === 'string' && itemIds.has(r.id) && Number.isFinite(r.at))
    .slice(0, RECENT_MAX)
    .map((r) => ({ id: r.id, at: r.at }));
  state = {
    items,
    inlays,
    categories,
    tabOrder,
    recent,
    warn: skipped ? `${skipped} entry(ies) skipped: check ids, titles and absolute paths.` : null,
    locked: null,
  };
}

function saveState() {
  fs.mkdirSync(path.dirname(LIBRARY_FILE), { recursive: true });
  const tmp = LIBRARY_FILE + '.tmp';
  fs.writeFileSync(
    tmp,
    JSON.stringify({ items: state.items, inlays: state.inlays, categories: state.categories, tabOrder: state.tabOrder, recent: state.recent }, null, 2)
  );
  fs.renameSync(tmp, LIBRARY_FILE); // atomic: a crash never leaves half a file
}

// The order of the tabs you switch between with LB / RB. Settings and
// "+ Mosaic" and Browser are not part of it: they stay at the ends.
function computeTabOrder() {
  const base = ['home', 'library', 'apps', ...state.categories.filter((c) => c.top).map((c) => 'm:' + c.id)];
  const order = (state.tabOrder || []).filter((t, i, a) => base.includes(t) && a.indexOf(t) === i);
  for (const t of base) if (!order.includes(t)) order.push(t);
  return order;
}

const itemById = (id) => state.items.find((i) => i.id === id);
const inlayById = (id) => state.inlays.find((n) => n.id === id);

// ---- grid placement (cells, not pixels: the layout scales to any screen)
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// Make a rectangle legal for this inlay: within its min/max and inside the grid.
function fitRect(def, r) {
  const min = def ? def.min : { w: 1, h: 1 };
  const max = def ? def.max : { w: GRID.cols, h: GRID.rows };
  const dflt = def ? def.size : { w: 3, h: 2 };
  const num = (v, d) => (Number.isInteger(v) ? v : d);
  const w = Math.max(min.w, Math.min(max.w, num(r.w, dflt.w)));
  const h = Math.max(min.h, Math.min(max.h, num(r.h, dflt.h)));
  const x = Math.max(0, Math.min(GRID.cols - w, num(r.x, 0)));
  const y = Math.max(0, Math.min(GRID.rows - h, num(r.y, 0)));
  return { x, y, w, h };
}
function findFree(w, h, others) {
  for (let y = 0; y + h <= GRID.rows; y++)
    for (let x = 0; x + w <= GRID.cols; x++)
      if (!others.some((o) => overlaps({ x, y, w, h }, o))) return { x, y };
  return { x: 0, y: 0 };
}
const catById = (id) => state.categories.find((c) => c.id === id);

// What the renderer is allowed to see: ids, titles, kinds. Never paths.
function buildView() {
  const tileFor = (ref, selfId) => {
    if (ref === selfId) return null;
    const it = itemById(ref);
    if (it) return { id: it.id, title: it.title, kind: it.kind, art: Boolean(resolveArt(it)), custom: Boolean(it.art) };
    const inl = inlayById(ref);
    if (inl) {
      // A widget that was removed from the folder stays on the page as a
      // placeholder, so putting it back restores it.
      const def = inlayDef(inl.type);
      return {
        id: inl.id,
        title: def ? def.name : 'Missing widget',
        kind: 'inlay',
        type: inl.type,
        widget: def ? def.widget : null,
        missing: !def,
        x: inl.x, y: inl.y, w: inl.w, h: inl.h,
        resizable: Boolean(def && def.resizable),
        min: def ? def.min : { w: inl.w, h: inl.h },
        max: def ? def.max : { w: inl.w, h: inl.h },
      };
    }
    const sub = catById(ref);
    return sub ? { id: sub.id, title: sub.title, kind: 'folder' } : null;
  };
  const folders = {};
  for (const c of state.categories) {
    folders[c.id] = { title: c.title, tiles: c.entries.map((e) => tileFor(e, c.id)).filter(Boolean) };
  }
  const tileOf = (it) => ({ id: it.id, title: it.title, kind: it.kind, art: Boolean(resolveArt(it)), custom: Boolean(it.art) });
  const games = state.items.filter((i) => i.kind === 'game').map(tileOf);
  const apps = state.items.filter((i) => i.kind === 'app').map(tileOf);
  // Library and Apps are automatic: everything you've added, filed or not.
  const tabs = {
    library: games.length ? [{ id: '_all_games', title: 'All games', tiles: games }] : [],
    apps: apps.length ? [{ id: '_all_apps', title: 'All apps', tiles: apps }] : [],
  };
  const mosaics = state.categories.filter((c) => c.top).map((c) => ({ id: c.id, title: c.title }));
  const recent = state.recent
    .map((r) => itemById(r.id))
    .filter(Boolean)
    .slice(0, 12)
    .map(tileOf);
  return { tabs, folders, mosaics, tabOrder: computeTabOrder(), recent, keys: settings.keys, prefs: prefsPayload(), artRev, error: state.warn };
}

// Remember what was launched, newest first. Only the id and a time are stored.
function recordPlay(id) {
  state.recent = [{ id, at: Date.now() }, ...state.recent.filter((r) => r.id !== id)].slice(0, RECENT_MAX);
  if (!state.locked) {
    try { saveState(); } catch { /* not worth interrupting a game over */ }
  }
}

function cleanTitle(s, max = MAX_TITLE) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return t || null;
}

function newId(title, fallback) {
  const slug =
    title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || fallback;
  for (;;) {
    const id = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
    if (!itemById(id) && !catById(id) && !inlayById(id)) return id;
  }
}

// Does `target` appear inside `fromId`'s folders, however deep?
function reaches(fromId, target, seen = new Set()) {
  if (seen.has(fromId)) return false;
  seen.add(fromId);
  const c = catById(fromId);
  if (!c) return false;
  return c.entries.some((e) => e === target || (catById(e) && reaches(e, target, seen)));
}

// Remove folders and inlays that nothing points to any more.
function gc() {
  for (;;) {
    const refs = new Set();
    state.categories.forEach((c) => c.entries.forEach((e) => refs.add(e)));
    const before = state.categories.length + state.inlays.length;
    state.categories = state.categories.filter((c) => c.top || c.builtin || refs.has(c.id));
    state.inlays = state.inlays.filter((n) => refs.has(n.id));
    if (state.categories.length + state.inlays.length === before) return;
  }
}

function libraryOp(op, p) {
  if (state.locked) return { ok: false, error: `Can't edit: ${state.locked} Fix the file first.` };
  switch (op) {
    case 'newCategory': {
      const title = cleanTitle(p.title);
      if (!title) return { ok: false, error: 'Give it a name first.' };
      const cat = { id: newId(title, 'mosaic'), title, entries: [] };
      if (p.parentId !== undefined) {
        const parent = catById(p.parentId);
        if (!parent) return { ok: false, error: 'That no longer exists.' };
        parent.entries.push(cat.id); // a folder inside it
      } else {
        cat.top = true; // a mosaic with its own tab
      }
      state.categories.push(cat);
      return { ok: true, message: `Created ${title}.`, id: cat.id };
    }
    case 'renameCategory': {
      const c = catById(p.id);
      const title = cleanTitle(p.title);
      if (!c || !title) return { ok: false, error: 'Could not rename that.' };
      if (c.builtin) return { ok: false, error: "Home can't be renamed." };
      c.title = title;
      return { ok: true, message: 'Renamed.' };
    }
    case 'renameItem': {
      const it = itemById(p.id);
      const title = cleanTitle(p.title, 60);
      if (!it || !title) return { ok: false, error: 'Could not rename that.' };
      it.title = title;
      return { ok: true, message: 'Renamed.' };
    }
    case 'clearArt': {
      const it = itemById(p.id);
      if (!it) return { ok: false, error: 'That no longer exists.' };
      delete it.art;
      artCache.delete(it.id);
      artRev++;
      return { ok: true, message: 'Using the automatic picture.' };
    }
    case 'deleteCategory': {
      const c = catById(p.id);
      if (!c) return { ok: false, error: 'That no longer exists.' };
      if (c.builtin) return { ok: false, error: "Home can't be deleted." };
      state.categories = state.categories.filter((x) => x.id !== c.id);
      state.categories.forEach((x) => (x.entries = x.entries.filter((e) => e !== c.id)));
      gc();
      return { ok: true, message: `Deleted ${c.title}. Your games and apps were not touched.` };
    }
    case 'moveTab': {
      const order = computeTabOrder();
      const i = order.indexOf(p.id);
      if (i < 0 || (p.dir !== -1 && p.dir !== 1)) return { ok: false, error: 'That no longer exists.' };
      const j = i + p.dir;
      if (j >= 0 && j < order.length) [order[i], order[j]] = [order[j], order[i]];
      state.tabOrder = order;
      return { ok: true, message: '' };
    }
    case 'moveMosaic': {
      const tops = state.categories.filter((c) => c.top);
      const i = tops.findIndex((c) => c.id === p.id);
      const j = i + (p.dir === -1 ? -1 : p.dir === 1 ? 1 : 0);
      if (i < 0 || j === i) return { ok: false, error: 'That no longer exists.' };
      if (j < 0 || j >= tops.length) return { ok: true, message: '' }; // already at the end
      const a = state.categories.indexOf(tops[i]);
      const b = state.categories.indexOf(tops[j]);
      [state.categories[a], state.categories[b]] = [state.categories[b], state.categories[a]];
      return { ok: true, message: '' };
    }
    case 'addInlay': {
      const c = catById(p.catId);
      if (!c) return { ok: false, error: 'That no longer exists.' };
      const def = typeof p.type === 'string' ? inlayDef(p.type) : null;
      if (!def) return { ok: false, error: 'That inlay is not installed.' };
      const rect = fitRect(def, p);
      const others = c.entries.map(inlayById).filter(Boolean);
      if (others.some((o) => overlaps(rect, o))) return { ok: false, error: 'That spot is taken.' };
      const inlay = { id: newId(def.name, 'inlay'), type: p.type, ...rect };
      state.inlays.push(inlay);
      c.entries.push(inlay.id);
      return { ok: true, message: `Added ${def.name}.` };
    }
    case 'placeInlay': {
      const inlay = inlayById(p.id);
      if (!inlay) return { ok: false, error: 'That no longer exists.' };
      const def = inlayDef(inlay.type);
      if (!def) return { ok: false, error: 'That widget is not installed.' };
      const home = state.categories.find((c) => c.entries.includes(inlay.id));
      const rect = fitRect(def, p);
      const others = (home ? home.entries : []).map(inlayById).filter((o) => o && o !== inlay);
      if (others.some((o) => overlaps(rect, o))) return { ok: false, error: 'That spot is taken.' };
      Object.assign(inlay, rect);
      return { ok: true, message: '' };
    }
    case 'addEntry': {
      const c = catById(p.catId);
      if (!c) return { ok: false, error: 'That no longer exists.' };
      const isItem = Boolean(itemById(p.ref));
      const target = catById(p.ref);
      if (!isItem && !target) return { ok: false, error: 'That no longer exists.' };
      if (target && target.builtin) return { ok: false, error: "Home can't go inside something else." };
      if (c.entries.includes(p.ref)) return { ok: false, error: 'It is already in there.' };
      if (target && (p.ref === c.id || reaches(p.ref, c.id)))
        return { ok: false, error: 'That would put a folder inside itself.' };
      c.entries.push(p.ref);
      return { ok: true, message: `Added to ${c.title}.` };
    }
    case 'removeEntry': {
      const c = catById(p.catId);
      if (!c) return { ok: false, error: 'That no longer exists.' };
      c.entries = c.entries.filter((e) => e !== p.ref);
      gc();
      return { ok: true, message: 'Removed from this row.' };
    }
    case 'deleteItem': {
      const it = itemById(p.id);
      if (!it) return { ok: false, error: 'That no longer exists.' };
      state.items = state.items.filter((x) => x.id !== it.id);
      state.categories.forEach((x) => (x.entries = x.entries.filter((e) => e !== it.id)));
      gc();
      return { ok: true, message: `Removed ${it.title} from your library. Files were not touched.` };
    }
    default:
      return { ok: false, error: 'Unknown action.' };
  }
}

function addItem({ title, kind, file, args }) {
  const dup = state.items.some(
    (i) => i.path === file && JSON.stringify(i.args || []) === JSON.stringify(args || [])
  );
  if (dup) return null;
  const t = cleanTitle(title, 60) || path.basename(file);
  const item = { id: newId(t, 'game'), kind, title: t, path: file };
  if (args && args.length) item.args = args;
  state.items.push(item);
  return item;
}

// -------------------------------------------------------------- settings

// Which controller button does each on-screen keyboard action use?
// Indices are the standard gamepad layout: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB,
// 8 View, 9 Menu, 10 left stick click. A always types, and the D-pad always moves.
// Defaults: click the left stick for Shift, Y space, X delete, Menu done, B cancel.
const DEFAULT_KEYS = { back: 2, space: 3, shift: 10, done: 9, cancel: 1 };
const OLD_DEFAULT_KEYS = { back: 1, space: 2, shift: 3, done: 9, cancel: 8 }; // before 0.13: someone who never changed them gets the new ones
const SETTINGS_VERSION = 2;
const RESERVED_BUTTONS = [0, 12, 13, 14, 15];

// Controller preferences. Deadzone and trigger threshold are percentages.
const PAD_DEFAULTS = { deadzone: 15, trigger: 8, rumble: 'normal', style: 'split', glyphs: 'auto' };
const PAD_CHOICES = {
  rumble: ['off', 'low', 'normal', 'high'],
  style: ['split', 'both', 'pulse'],
  glyphs: ['auto', 'xbox', 'playstation', 'nintendo'],
};
const PAD_RANGES = { deadzone: [0, 40], trigger: [0, 50] };

let settings = {
  scanRoots: [],
  keys: { ...DEFAULT_KEYS },
  theme: { active: 'stock', values: {} }, // values[themeId][settingId]
  pad: { ...PAD_DEFAULTS },
  calib: {}, // per controller: resting offsets of each axis
  driveNames: {}, // drive key -> the name the person gave it
};

function loadSettings() {
  try {
    const d = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (d && Array.isArray(d.scanRoots))
      settings.scanRoots = d.scanRoots.filter((r) => typeof r === 'string' && path.isAbsolute(r));
    const untouched = d && d.keys && Object.keys(OLD_DEFAULT_KEYS).every((k) => d.keys[k] === OLD_DEFAULT_KEYS[k]);
    if (d && d.keys && typeof d.keys === 'object' && !untouched) {
      for (const k of Object.keys(DEFAULT_KEYS)) {
        const v = d.keys[k];
        if (Number.isInteger(v) && v >= 0 && v < 32 && !RESERVED_BUTTONS.includes(v)) settings.keys[k] = v;
      }
    }
    if (d && d.theme && typeof d.theme === 'object') {
      if (typeof d.theme.active === 'string' && THEME_ID_RE.test(d.theme.active)) settings.theme.active = d.theme.active;
      const vals = d.theme.values;
      if (vals && typeof vals === 'object') {
        for (const [tid, tv] of Object.entries(vals).slice(0, 32)) {
          if (!THEME_ID_RE.test(tid) || !tv || typeof tv !== 'object') continue;
          const clean = {};
          for (const [sid, v] of Object.entries(tv).slice(0, 80)) {
            if (SETTING_ID_RE.test(sid) && (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length < 600))) clean[sid] = v;
          }
          settings.theme.values[tid] = clean;
        }
      }
    }
    if (d && d.pad && typeof d.pad === 'object') {
      for (const k of Object.keys(PAD_DEFAULTS)) {
        if (k === 'glyphs' && !(d.v >= 2)) continue; // 0.12 saved "xbox" without the person choosing it
        const v = d.pad[k];
        if (PAD_CHOICES[k] && PAD_CHOICES[k].includes(v)) settings.pad[k] = v;
        else if (PAD_RANGES[k] && Number.isFinite(v) && v >= PAD_RANGES[k][0] && v <= PAD_RANGES[k][1]) settings.pad[k] = Math.round(v);
      }
    }
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
  } catch {
    /* none yet */
  }
}
function saveSettings() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ v: SETTINGS_VERSION, ...settings }, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
}
// ------------------------------------------------------------ theme settings
// A theme is a list of settings the person can change. The stock list below
// is always there; a theme can change its defaults and add settings of its
// own in themes/<id>/theme.json. Values only ever become CSS custom
// properties (never code), so a theme can't run anything.
const THEME_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const SETTING_ID_RE = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/;
const VAR_RE = /^--(theme-)?[a-z][a-z0-9-]{0,30}$/;
const SAFE_VALUE_RE = /^[#a-zA-Z0-9 .%(),+-]{1,40}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const IMG_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_IMAGE = 12 * 1024 * 1024;
const STOCK_VARS = ['--use', '--font-scale', '--radius', '--border-w', '--accent', '--border', '--card', '--panel', '--bg', '--text', '--muted', '--bg-image', '--bg-dim', '--danger', '--ok', '--motion'];
// Two themes ship with Tessera. They share one list of settings and differ
// only in their defaults. ("stock" stays the id of Bright so saved choices carry over.)
const BUILTIN_THEMES = [
  {
    id: 'stock', name: 'Tessera Bright', author: 'Tessera',
    defaults: {
      bg: '#fff3dc', card: '#ffffff', panel: '#ffffff', text: '#24213d', muted: '#6b6786', accent: '#ff4d8d',
      border: '#24213d', borderW: '4px', radius: '20px', cancel: '#ff3b5c', confirm: '#12b886',
      backdrop: 'glow', layout: 'grid', gridPreset: 'c5r3',
    },
  },
  {
    id: 'dark', name: 'Tessera Dark', author: 'Tessera',
    defaults: {
      bg: '#0a0714', card: '#1a1230', panel: '#150e29', text: '#e9defc', muted: '#9a8bc0', accent: '#9d7bff',
      border: '#3b2a6b', borderW: '2px', radius: '14px', cancel: '#ff5d8f', confirm: '#3ee0b0',
      backdrop: 'mystic', layout: 'rails', gridPreset: 'c5r3',
    },
  },
];
const STOCK_THEME = {
  id: 'stock',
  name: 'Tessera Bright',
  author: 'Tessera',
  settings: [
    { id: 'screenUse', group: 'Screen', label: 'Screen area used', type: 'range', min: 70, max: 100, step: 5, unit: '%', default: 100, var: '--use', scale: 0.01, hint: 'Lower this if your TV cuts off the edges' },
    { id: 'fontScale', group: 'Screen', label: 'Text size', type: 'range', min: 80, max: 160, step: 10, unit: '%', default: 100, var: '--font-scale', scale: 0.01 },
    { id: 'radius', group: 'Shape', label: 'Corner roundness', type: 'choice', default: '14px', var: '--radius',
      options: [{ label: 'Sharp', value: '4px' }, { label: 'Slight', value: '10px' }, { label: 'Normal', value: '14px' }, { label: 'Soft', value: '20px' }, { label: 'Round', value: '28px' }, { label: 'Pill', value: '40px' }] },
    { id: 'borderW', group: 'Shape', label: 'Border thickness', type: 'choice', default: '0px', var: '--border-w',
      options: [{ label: 'None', value: '0px' }, { label: 'Thin', value: '2px' }, { label: 'Medium', value: '4px' }, { label: 'Thick', value: '6px' }] },
    { id: 'accent', group: 'Colors', label: 'Highlight color', type: 'color', default: '#7fb2ff', var: '--accent' },
    { id: 'border', group: 'Colors', label: 'Border color', type: 'color', default: '#3b475a', var: '--border' },
    { id: 'card', group: 'Colors', label: 'Tile fill', type: 'color', default: '#1a222c', var: '--card' },
    { id: 'panel', group: 'Colors', label: 'Menu fill', type: 'color', default: '#161d27', var: '--panel' },
    { id: 'bg', group: 'Colors', label: 'Background color', type: 'color', default: '#10151c', var: '--bg' },
    { id: 'text', group: 'Colors', label: 'Text color', type: 'color', default: '#e9e4d8', var: '--text' },
    { id: 'muted', group: 'Colors', label: 'Small text color', type: 'color', default: '#8b95a3', var: '--muted' },
    { id: 'background', group: 'Background', label: 'Background picture', type: 'image', default: '', var: '--bg-image' },
    { id: 'bgDim', group: 'Background', label: 'Picture dimming', type: 'range', min: 0, max: 90, step: 10, unit: '%', default: 50, var: '--bg-dim', scale: 0.01 },
    { id: 'backdrop', group: 'Background', label: 'Backdrop effect', type: 'choice', default: 'none',
      options: [{ label: 'None', value: 'none' }, { label: 'Glow', value: 'glow' }, { label: 'Mystic', value: 'mystic' }] },
    { id: 'confirm', group: 'Buttons', label: 'Done / Yes button color', type: 'color', default: '#3ddc97', var: '--ok' },
    { id: 'cancel', group: 'Buttons', label: 'Cancel / Close button color', type: 'color', default: '#ff6b6b', var: '--danger' },
    { id: 'layout', group: 'Layout', label: 'Tile layout', type: 'choice', default: 'rails',
      options: [{ label: 'Rails (sideways, like a console)', value: 'rails' }, { label: 'Grid', value: 'grid' }, { label: 'Flow grid (scrolls up and down)', value: 'flow' }] },
    { id: 'gridPreset', group: 'Layout', label: 'Grid size', type: 'choice', default: 'c5r3',
      options: [
        { label: '3 × 2', value: 'c3r2' }, { label: '4 × 2', value: 'c4r2' }, { label: '5 × 3', value: 'c5r3' },
        { label: '6 × 3', value: 'c6r3' }, { label: '6 × 4', value: 'c6r4' }, { label: '8 × 4', value: 'c8r4' },
        { label: 'Custom (use the two settings below)', value: 'custom' },
      ] },
    { id: 'gridCols', group: 'Layout', label: 'Custom grid: columns', type: 'range', min: 2, max: 12, step: 1, unit: '', default: 5 },
    { id: 'gridRows', group: 'Layout', label: 'Custom grid: rows on screen', type: 'range', min: 1, max: 8, step: 1, unit: '', default: 3 },
    { id: 'motion', group: 'Motion', label: 'Animations', type: 'toggle', default: true, var: '--motion', on: '1', off: '0', hint: 'Turn off if movement makes you dizzy' },
  ],
};
const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');

let themes = new Map(); // id -> { id, name, author, defaults, extra }
function scanThemes() {
  themes = new Map(BUILTIN_THEMES.map((t) => [t.id, { id: t.id, name: t.name, author: t.author, defaults: t.defaults, extra: [], builtin: true }]));
  let names = [];
  try { names = fs.readdirSync(addonDir('themes'), { withFileTypes: true }); } catch { return; }
  for (const e of names.slice(0, 64)) {
    if (!e.isDirectory() || e.isSymbolicLink() || !THEME_ID_RE.test(e.name) || themes.has(e.name)) continue;
    let m;
    try {
      const f = path.join(addonDir('themes'), e.name, 'theme.json');
      if (fs.statSync(f).size > 64 * 1024) continue;
      m = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch { continue; }
    if (!m || typeof m !== 'object') continue;
    const extra = [];
    for (const s of (Array.isArray(m.settings) ? m.settings : []).slice(0, 40)) {
      const d = cleanSetting(s);
      if (d) extra.push(d);
    }
    const defaults = {};
    if (m.defaults && typeof m.defaults === 'object')
      for (const [k, v] of Object.entries(m.defaults).slice(0, 80))
        if (SETTING_ID_RE.test(k) && (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) defaults[k] = v;
    themes.set(e.name, { id: e.name, name: clip(m.name, 40) || e.name, author: clip(m.author, 60), defaults, extra });
  }
}
// One setting from a theme file, or null if it doesn't make sense.
function cleanSetting(s) {
  if (!s || typeof s !== 'object' || !SETTING_ID_RE.test(s.id) || !['range', 'choice', 'color', 'toggle', 'image'].includes(s.type)) return null;
  const out = { id: s.id, type: s.type, label: clip(s.label, 40) || s.id, group: clip(s.group, 30) || 'Theme', hint: clip(s.hint, 120) };
  if (s.var !== undefined) {
    if (typeof s.var !== 'string' || !VAR_RE.test(s.var)) return null;
    if (!s.var.startsWith('--theme-') && !STOCK_VARS.includes(s.var)) return null;
    out.var = s.var;
  }
  if (s.type === 'range') {
    const n = (v, d) => (Number.isFinite(v) ? v : d);
    out.min = n(s.min, 0); out.max = n(s.max, 100); out.step = Math.max(n(s.step, 1), (out.max - out.min) / 100 || 1);
    if (out.max <= out.min) return null;
    out.unit = clip(s.unit, 4);
    out.scale = Number.isFinite(s.scale) ? s.scale : 1;
    out.default = Math.min(out.max, Math.max(out.min, n(s.default, out.min)));
  } else if (s.type === 'choice') {
    out.options = (Array.isArray(s.options) ? s.options : []).slice(0, 12)
      .map((o) => ({ label: clip(o && o.label, 30), value: o && typeof o.value === 'string' ? o.value : '' }))
      .filter((o) => o.label && SAFE_VALUE_RE.test(o.value) && !/url\(/i.test(o.value));
    if (!out.options.length) return null;
    out.default = out.options.some((o) => o.value === s.default) ? s.default : out.options[0].value;
  } else if (s.type === 'color') {
    out.default = HEX_RE.test(s.default) ? s.default.toLowerCase() : '#ffffff';
  } else if (s.type === 'toggle') {
    out.default = Boolean(s.default);
    out.on = typeof s.on === 'string' && SAFE_VALUE_RE.test(s.on) ? s.on : '1';
    out.off = typeof s.off === 'string' && SAFE_VALUE_RE.test(s.off) ? s.off : '0';
  } else {
    out.default = '';
  }
  return out;
}
function schemaFor(id) {
  const t = themes.get(id) || themes.get('stock');
  const list = STOCK_THEME.settings.map((s) => {
    const d = { ...s };
    const v = t.defaults[s.id];
    if (v !== undefined) {
      const c = cleanValue(d, v);
      if (c !== undefined) d.default = c;
    }
    return d;
  });
  for (const x of t.extra) {
    const at = list.findIndex((s) => s.id === x.id);
    if (at >= 0) list[at] = x;
    else list.push(x);
  }
  return list;
}
// A value for this setting, or undefined if it isn't allowed.
function cleanValue(def, v) {
  if (def.type === 'range') {
    if (!Number.isFinite(v)) return undefined;
    const snapped = Math.round((v - def.min) / def.step) * def.step + def.min;
    return Math.min(def.max, Math.max(def.min, Math.round(snapped * 1000) / 1000));
  }
  if (def.type === 'choice') return def.options.some((o) => o.value === v) ? v : undefined;
  if (def.type === 'color') return typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : undefined;
  if (def.type === 'toggle') return typeof v === 'boolean' ? v : undefined;
  if (def.type === 'image') return v === '' ? '' : typeof v === 'string' && path.isAbsolute(v) ? v : undefined;
  return undefined;
}
function activeTheme() {
  return themes.has(settings.theme.active) ? settings.theme.active : 'stock';
}
function themePayload() {
  const id = activeTheme();
  const saved = settings.theme.values[id] || {};
  const list = schemaFor(id).map((d) => {
    const c = saved[d.id] !== undefined ? cleanValue(d, saved[d.id]) : undefined;
    const value = c === undefined ? d.default : c;
    // The page never sees where a picture lives, only its file name.
    return { ...d, default: d.type === 'image' ? '' : d.default, value: d.type === 'image' ? (value ? path.basename(value) : '') : value };
  });
  return {
    rev: themeRev,
    active: id,
    themes: [...themes.values()].map((t) => ({ id: t.id, name: t.name, author: t.author })),
    settings: list,
  };
}
let themeRev = 0; // bumps whenever a theme value changes, so the page knows to reload pictures
function setThemeValue(sid, value) {
  const id = activeTheme();
  const def = schemaFor(id).find((s) => s.id === sid);
  if (!def) return false;
  const c = cleanValue(def, value);
  if (c === undefined) return false;
  settings.theme.values[id] = { ...(settings.theme.values[id] || {}), [sid]: c };
  themeRev++;
  saveSettings();
  return true;
}
// The picture for an image setting, as a data: URL. Only files inside the
// places Tessera may browse, only real PNG / JPEG / WebP files, and not huge.
function themeImage(sid) {
  const id = activeTheme();
  const def = schemaFor(id).find((s) => s.id === sid && s.type === 'image');
  const file = def && ((settings.theme.values[id] || {})[sid] || '');
  if (!file) return { dataUrl: '' };
  const rp = real(file);
  const mime = rp && IMG_EXT[path.extname(rp).toLowerCase()];
  if (!rp || !mime || !underRoot(path.dirname(rp))) return { dataUrl: '', error: "That picture can't be used." };
  const st = fs.statSync(rp);
  if (!st.isFile() || st.size > MAX_IMAGE) return { dataUrl: '', error: 'That picture is too large (12 MB max).' };
  const buf = fs.readFileSync(rp);
  const head = buf.subarray(0, 12);
  const ok = mime === 'image/png' ? head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    : mime === 'image/jpeg' ? head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!ok) return { dataUrl: '', error: "That file isn't a real picture." };
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
}
const prefsPayload = () => ({ pad: { ...settings.pad }, calib: settings.calib, theme: themePayload() });

const display = (p) => {
  const home = os.homedir();
  return p === home ? '~' : p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
};

// --------------------------------------------------------- folder browser
// The renderer never sends a path. It says "enter entry 3" and this file
// resolves that against the listing it produced itself. Browsing is limited
// to the home folder and removable/extra drives.

const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const real = (p) => {
  try { return fs.realpathSync(p); } catch { return null; }
};
const browseRoots = () =>
  [os.homedir(), '/run/media', '/mnt', '/var/mnt'].map(real).filter((r) => r && isDir(r));
const underRoot = (rp) => browseRoots().some((r) => rp === r || rp.startsWith(r + path.sep));

// ------------------------------------------------------------------ drives
// Where drives show up. Each gets a friendly name (the one the person chose,
// else the drive's label, else its model and size) and a technical line.
const unescapeMount = (s) => s.replace(/\\([0-7]{3})/g, (_m, o) => String.fromCharCode(parseInt(o, 8)));
function mountSources() {
  const out = new Map();
  try {
    for (const line of fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n')) {
      const [left, right] = line.split(' - ');
      if (!right) continue;
      const mp = unescapeMount(left.split(' ')[4] || '');
      const [fstype, source] = right.split(' ');
      if (mp && source && source.startsWith('/dev/')) out.set(real(mp) || mp, { fstype, source });
    }
  } catch { /* no mountinfo */ }
  return out;
}
let lsblkCache = { at: 0, map: new Map() };
function lsblkLabels() {
  if (Date.now() - lsblkCache.at < 4000) return lsblkCache.map;
  const map = new Map(); // device path -> { label, uuid, size, model }
  const walk = (devs, parentModel) => {
    for (const d of devs || []) {
      const model = d.model || parentModel || '';
      if (d.path) map.set(d.path, { label: d.label || '', uuid: d.uuid || '', size: d.size || '', model: (model || '').trim() });
      walk(d.children, model);
    }
  };
  try {
    const out = execFileSync('lsblk', ['-J', '-o', 'PATH,LABEL,UUID,SIZE,MODEL'], { timeout: 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    walk(JSON.parse(out).blockdevices, '');
  } catch { /* lsblk missing: fall back to folder names */ }
  lsblkCache = { at: Date.now(), map };
  return map;
}
function driveList() {
  const found = new Map(); // real path -> mount folder
  const add = (p) => { const rp = real(p); if (rp && isDir(rp) && !found.has(rp)) found.set(rp, p); };
  const subdirs = (d) => {
    try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(d, e.name)); } catch { return []; }
  };
  for (const u of subdirs('/run/media')) subdirs(u).forEach(add);
  subdirs('/mnt').forEach(add);
  subdirs('/var/mnt').forEach(add);
  const src = mountSources();
  const labels = lsblkLabels();
  const taken = new Set();
  return [...found.keys()].map((rp) => {
    const s = src.get(rp);
    const info = s && labels.get(s.source);
    const key = (info && info.uuid) || 'dir:' + rp;
    const auto = (info && info.label) || (info && info.model && info.size ? `${info.model} (${info.size})` : '') || path.basename(rp);
    let name = settings.driveNames[key] || auto;
    if (taken.has(name)) name = `${name} (${path.basename(rp)})`;
    taken.add(name);
    return { key, mount: rp, name, auto, custom: Boolean(settings.driveNames[key]), tech: [s && s.source, display(rp)].filter(Boolean).join(' · ') };
  });
}
// Home first, then every drive. Going "up" from any of these lands on this list.
const topLevels = () => {
  const home = real(os.homedir());
  return [...(home ? [home] : []), ...driveList().map((d) => d.mount)];
};
// A path shown the way a person would say it: "Games SSD / SteamLibrary".
function friendly(p) {
  const rp = real(p) || p;
  const d = driveList().find((x) => rp === x.mount || rp.startsWith(x.mount + path.sep));
  if (d) return { name: [d.name, ...rp.slice(d.mount.length).split(path.sep).filter(Boolean)].join(' / '), tech: display(rp) };
  return { name: display(rp), tech: '' };
}


// ------------------------------------------------------------- game pictures
// A tile's picture is, in order: one the person picked, or one Tessera finds
// (Steam's library cache, Lutris cover art, a PS5 game's own icon, or a
// cover.png next to the game). The page only ever asks for a library id, so
// it never learns a path, and every file is checked before it is served.
const IMG_MAX_ART = 8 * 1024 * 1024;
const imageMime = (file) => {
  const mime = IMG_EXT[path.extname(file).toLowerCase()];
  if (!mime) return null;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > IMG_MAX_ART || st.size < 16) return null;
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    const ok = mime === 'image/png' ? head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      : mime === 'image/jpeg' ? head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
    return ok ? mime : null;
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
};
const firstImage = (files) => {
  for (const f of files) {
    const rp = real(f);
    if (rp && underRoot(rp) && imageMime(rp)) return rp;
  }
  return null;
};
const EXTS = ['.jpg', '.png', '.jpeg', '.webp'];
function steamArt(id) {
  const home = os.homedir();
  for (const root of ['.local/share/Steam', '.steam/steam', '.steam/root', '.var/app/com.valvesoftware.Steam/.local/share/Steam']) {
    const base = path.join(home, root, 'appcache', 'librarycache');
    const dirs = [path.join(base, id)];
    try {
      for (const e of fs.readdirSync(dirs[0], { withFileTypes: true })) if (e.isDirectory()) dirs.push(path.join(dirs[0], e.name)); // newer layout: one folder per picture
    } catch { /* older layout, or Steam hasn't cached this one */ }
    const hit = firstImage([
      ...dirs.flatMap((d) => EXTS.map((x) => path.join(d, 'library_600x900' + x))),
      ...EXTS.map((x) => path.join(base, `${id}_library_600x900${x}`)),
      ...dirs.flatMap((d) => EXTS.map((x) => path.join(d, 'header' + x))),
      ...EXTS.map((x) => path.join(base, `${id}_header${x}`)),
    ]);
    if (hit) return hit;
  }
  return null;
}
function lutrisArt(slug) {
  const home = os.homedir();
  const dirs = ['.local/share/lutris/coverart', '.cache/lutris/coverart', '.local/share/lutris/banners', '.var/app/net.lutris.Lutris/data/lutris/coverart', '.var/app/net.lutris.Lutris/data/lutris/banners'];
  return firstImage(dirs.flatMap((d) => EXTS.map((x) => path.join(home, d, slug + x))));
}
function localArt(file) {
  const dir = path.dirname(file);
  const sce = ['sce_sys/icon0.png', 'sce_sys/pic0.png', 'app0/sce_sys/icon0.png', 'app0/sce_sys/pic0.png'];
  const loose = ['cover', 'folder', 'poster', 'boxart', 'thumbnail', 'icon', 'logo'].flatMap((n) => EXTS.map((x) => n + x));
  return firstImage([...sce.map((s) => path.join(dir, s)), ...sce.map((s) => path.join(dir, '..', s)), ...loose.map((l) => path.join(dir, l))]);
}
const artCache = new Map(); // item id -> { at, file }
let artRev = 0;
function resolveArt(item) {
  const hit = artCache.get(item.id);
  if (hit && Date.now() - hit.at < 60000 && hit.custom === (item.art || '')) return hit.file;
  let file = null;
  if (item.art) file = firstImage([item.art]);
  if (!file) {
    const args = (item.args || []).join(' ');
    let m;
    if ((m = /steam:\/\/rungameid\/(\d+)/.exec(args))) file = steamArt(m[1]);
    else if ((m = /lutris:rungame\/([A-Za-z0-9._-]+)/.exec(args))) file = lutrisArt(m[1]);
    else if (!/^(steam|heroic|lutris):/.test(args)) file = localArt(item.path);
  }
  artCache.set(item.id, { at: Date.now(), file, custom: item.art || '' });
  return file;
}
function serveArt(id) {
  const notFound = { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' };
  const item = itemById(id);
  const file = item && resolveArt(item);
  const mime = file && imageMime(file);
  if (!mime) return notFound;
  return { status: 200, headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }, body: fs.readFileSync(file) };
}

// Launchers worth a shortcut. Shown only if installed. Fixed list, so nothing
// the page sends can add to it.
const SUGGESTED = '@suggested';
const KNOWN_APPS = [
  { title: 'Steam', bin: '/usr/bin/steam', flatpak: 'com.valvesoftware.Steam' },
  { title: 'Heroic Games Launcher', bin: '/usr/bin/heroic', flatpak: 'com.heroicgameslauncher.hgl' },
  { title: 'Lutris', bin: '/usr/bin/lutris', flatpak: 'net.lutris.Lutris' },
  { title: 'RetroArch', bin: '/usr/bin/retroarch', flatpak: 'org.libretro.RetroArch' },
  { title: 'Firefox', bin: '/usr/bin/firefox', flatpak: 'org.mozilla.firefox' },
  { title: 'Discord', bin: '/usr/bin/discord', flatpak: 'com.discordapp.Discord' },
];
function suggestedApps() {
  const out = [];
  for (const a of KNOWN_APPS) {
    const flatpakInstalled =
      fs.existsSync('/usr/bin/flatpak') &&
      [
        path.join('/var/lib/flatpak/app', a.flatpak),
        path.join(os.homedir(), '.local', 'share', 'flatpak', 'app', a.flatpak),
      ].some(isDir);
    if (fs.existsSync(a.bin)) out.push({ title: a.title, file: a.bin, args: [] });
    else if (flatpakInstalled) out.push({ title: a.title, file: '/usr/bin/flatpak', args: ['run', a.flatpak] });
  }
  return out;
}

let browse = null; // { purpose: 'addGame'|'addApp'|'addRoot', into?: id, dir: string|null|SUGGESTED, entries: [...] }

function browseView() {
  const b = browse;
  const pub = () => b.entries.map((e) => ({ name: e.name, isDir: e.isDir, sub: e.sub, key: e.key }));
  if (!b.dir) {
    const home = real(os.homedir());
    b.entries = [
      ...(home ? [{ name: 'Home folder', sub: display(home), isDir: true, full: home }] : []),
      ...driveList().map((d) => ({ name: d.name, sub: d.tech, key: d.key, isDir: true, full: d.mount })),
    ];
    if (b.purpose === 'addApp')
      b.entries.unshift({ name: 'Suggested apps', isDir: true, virtual: true });
    return { crumb: 'Choose a location  ·  Y renames a drive', canUp: false, canChooseHere: false, entries: pub(), renamable: true };
  }
  if (b.dir === SUGGESTED) {
    b.entries = suggestedApps().map((a) => ({
      name: a.title, isDir: false, virtual: true, title: a.title, full: a.file, args: a.args,
    }));
    return { crumb: 'Suggested apps (installed)', canUp: true, canChooseHere: false, entries: pub() };
  }
  let ents;
  try {
    ents = fs.readdirSync(b.dir, { withFileTypes: true });
  } catch {
    return { error: "Can't open that folder." };
  }
  const rows = [];
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(b.dir, e.name);
    let dir = e.isDirectory();
    let file = e.isFile();
    if (e.isSymbolicLink()) {
      try {
        const st = fs.statSync(full);
        dir = st.isDirectory();
        file = st.isFile();
      } catch {
        continue;
      }
    }
    if (dir) rows.push({ name: e.name, isDir: true, full });
    else if (file && (b.purpose === 'pickImage' || b.purpose === 'pickArt')) {
      if (IMG_EXT[path.extname(e.name).toLowerCase()]) rows.push({ name: e.name, isDir: false, full });
    } else if (file && b.purpose !== 'addRoot') {
      try { fs.accessSync(full, fs.constants.X_OK); } catch { continue; }
      rows.push({ name: e.name, isDir: false, full });
    }
  }
  rows.sort((a, c) => (a.isDir === c.isDir ? a.name.localeCompare(c.name) : a.isDir ? -1 : 1));
  b.entries = rows.slice(0, BROWSE_MAX);
  return {
    crumb: friendly(b.dir).name,
    canUp: true,
    canChooseHere: b.purpose === 'addRoot',
    entries: pub(),
    truncated: rows.length > BROWSE_MAX,
  };
}

function browseOp(op, p) {
  if (op === 'start') {
    if (!['addGame', 'addApp', 'addRoot', 'pickImage', 'pickArt'].includes(p.purpose)) return { error: 'Bad request.' };
    if (p.purpose === 'pickArt' && !itemById(p.item)) return { error: 'That no longer exists.' };
    browse = {
      purpose: p.purpose,
      item: p.purpose === 'pickArt' ? p.item : null,
      into: typeof p.into === 'string' && catById(p.into) ? p.into : null,
      dir: null,
      entries: [],
    };
    return browseView();
  }
  if (!browse) return { error: 'Nothing is open.' };
  if (op === 'close') {
    browse = null;
    return { ok: true };
  }
  if (op === 'refresh') return browseView();
  if (op === 'up') {
    if (browse.dir === SUGGESTED) browse.dir = null;
    else if (browse.dir) {
      const here = real(browse.dir);
      browse.dir = topLevels().includes(here) ? null : path.dirname(here);
    }
    return browseView();
  }
  const entry = Number.isInteger(p.index) ? browse.entries[p.index] : null;
  if (op === 'enter') {
    if (!entry || !entry.isDir) return { error: 'Not a folder.' };
    if (entry.virtual) {
      browse.dir = SUGGESTED;
      return browseView();
    }
    const rp = real(entry.full);
    if (!rp || !underRoot(rp)) return { error: "Tessera can't browse there." };
    browse.dir = rp;
    return browseView();
  }
  if (op === 'choose') {
    if (browse.purpose === 'pickArt') {
      if (!entry || entry.isDir) return { error: 'Pick a picture.' };
      const rp = real(entry.full);
      const item = itemById(browse.item);
      if (!item || !rp || !underRoot(path.dirname(rp))) return { error: "Tessera can't use that file." };
      if (!imageMime(rp)) return { error: "That isn't a usable picture (PNG, JPEG or WebP, up to 8 MB)." };
      item.art = rp;
      artCache.delete(item.id);
      artRev++;
      saveState();
      browse = null;
      return { ok: true, message: 'Picture set.', view: buildView() };
    }
    if (browse.purpose === 'pickImage') {
      if (!entry || entry.isDir) return { error: 'Pick a picture.' };
      const rp = real(entry.full);
      if (!rp || !underRoot(path.dirname(rp))) return { error: "Tessera can't use that file." };
      if (!setThemeValue('background', rp)) return { error: "This theme doesn't use a background picture." };
      const t = themeImage('background');
      if (!t.dataUrl) { setThemeValue('background', ''); return { error: t.error || "That picture can't be used." }; }
      browse = null;
      return { ok: true, message: 'Background set.', theme: themePayload() };
    }
    if (browse.purpose === 'addRoot') {
      const rp = browse.dir && real(browse.dir);
      if (!rp || !underRoot(rp)) return { error: 'Pick a folder first.' };
      if (settings.scanRoots.includes(rp)) return { error: 'That folder is already on the list.' };
      settings.scanRoots.push(rp);
      saveSettings();
      browse = null;
      return { ok: true, message: `Added ${friendly(rp).name} to your library folders.` };
    }
    if (state.locked) return { error: `Can't edit: ${state.locked}` };
    if (!entry || entry.isDir) return { error: 'Pick a file.' };
    // The listing was built by this file inside an allowed place (or from the
    // fixed suggested list), so entry.full is trusted as-is.
    const file = entry.full;
    if (!entry.virtual && !underRoot(path.dirname(file))) return { error: "Tessera can't use that file." };
    try { fs.accessSync(file, fs.constants.X_OK); } catch { return { error: "That isn't runnable." }; }
    const kind = browse.purpose === 'addApp' ? 'app' : 'game';
    const args = entry.args || [];
    const base = path.basename(file, path.extname(file));
    const generic = ['eboot', 'game', 'run', 'start', 'launch'];
    const title = entry.virtual
      ? entry.title
      : kind === 'game' && generic.includes(base.toLowerCase())
        ? path.basename(path.dirname(file))
        : kind === 'app' ? path.basename(file) : base;
    const into = browse.into && catById(browse.into);
    let item = addItem({ title, kind, file, args });
    if (!item) {
      // Already in the library: if we're filling a mosaic, just file it there.
      item = state.items.find((i) => i.path === file && JSON.stringify(i.args || []) === JSON.stringify(args));
      if (!(into && item && !into.entries.includes(item.id)))
        return { error: `That ${kind} is already in your library.` };
    }
    if (into) into.entries.push(item.id);
    saveState();
    browse = null;
    return { ok: true, message: `Added ${cleanTitle(item.title, 60)}.`, view: buildView() };
  }
  return { error: 'Unknown action.' };
}

// ---------------------------------------------------------------- scanner
// Looks for things Tessera recognizes, not for "any .exe": installers and
// crash handlers would drown the real games. Found games are only shown;
// the user decides what gets added.

let found = new Map(); // cid -> candidate (paths stay here, in main)

const STEAM_SKIP = /^(Proton\b|Steam Linux Runtime|Steamworks Common)/i;

function steamLauncher() {
  if (fs.existsSync('/usr/bin/steam')) return { file: '/usr/bin/steam', pre: [] };
  if (
    fs.existsSync('/usr/bin/flatpak') &&
    isDir(path.join(os.homedir(), '.var', 'app', 'com.valvesoftware.Steam'))
  )
    return { file: '/usr/bin/flatpak', pre: ['run', 'com.valvesoftware.Steam'] };
  return null;
}

function isElf(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(4);
    return fs.readSync(fd, b, 0, 4, 0) === 4 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46;
  } catch { return false; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* done */ } }
}
function isExecutable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
}
const readJson = (file, max = 8 * 1024 * 1024) => {
  try {
    if (fs.statSync(file).size > max) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
};
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// The program that starts a launcher: a native binary, else its Flatpak.
function launcherFor(bin, flatpakId) {
  const native = whichOnPath(bin);
  if (native) return { file: native, pre: [] };
  const fp = whichOnPath('flatpak');
  if (fp && isDir(path.join(os.homedir(), '.var', 'app', flatpakId))) return { file: fp, pre: ['run', flatpakId] };
  return null;
}

// Installed apps that call themselves games (freedesktop "Game" category). They
// are offered unticked: system folders hold plenty you may not want here.
function scanDesktopGames(offer) {
  const skipExec = /(^|\/)(steam|lutris|heroic)$/;
  const seen = new Set();
  for (const dir of desktopDirs()) {
    let names;
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.desktop')).slice(0, 3000); } catch { continue; }
    for (const n of names) {
      if (seen.has(n)) continue;
      seen.add(n);
      let text;
      try { text = fs.readFileSync(path.join(dir, n), 'utf8'); } catch { continue; }
      const kv = {};
      let inEntry = false;
      for (const line of text.split('\n')) {
        if (line.startsWith('[')) inEntry = line.trim() === '[Desktop Entry]';
        else if (inEntry) {
          const m = /^([A-Za-z-]+)=(.*)$/.exec(line);
          if (m && kv[m[1]] === undefined) kv[m[1]] = m[2].trim();
        }
      }
      if (kv.Type !== 'Application' || !/(^|;)Game(;|$)/.test(kv.Categories || '')) continue;
      if (kv.NoDisplay === 'true' || kv.Hidden === 'true' || kv.Terminal === 'true') continue;
      const cmd = parseDesktopExec(kv.Exec || '');
      const file = cmd && whichOnPath(cmd.file);
      if (!file || skipExec.test(file) || cmd.args.some((a) => /^(steam:|lutris:|heroic:)/.test(a))) continue;
      const title = cleanTitle(kv.Name || '', 60);
      if (title) offer({ title, source: 'Installed app', kind: 'game', file, args: cmd.args, optional: true });
    }
  }
}

// Lutris lists its own installed games as JSON.
function scanLutris(offer, notes) {
  const l = launcherFor('lutris', 'net.lutris.Lutris');
  if (!l) return;
  let list;
  try {
    const out = execFileSync(l.file, [...l.pre, '-l', '-o', '-j'], {
      timeout: 20000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
    list = JSON.parse(out.slice(out.indexOf('[')));
  } catch {
    notes.add("Couldn't read Lutris's game list.");
    return;
  }
  const seen = new Set();
  for (const g of Array.isArray(list) ? list : []) {
    if (!g || typeof g.slug !== 'string' || typeof g.name !== 'string' || !SAFE_ID.test(g.slug) || seen.has(g.slug)) continue;
    seen.add(g.slug);
    const title = cleanTitle(g.name, 60);
    if (title) offer({ title, source: 'Lutris', kind: 'game', file: l.file, args: [...l.pre, `lutris:rungame/${g.slug}`] });
  }
}

// Heroic (Epic and GOG). Its files differ between native and Flatpak installs.
function scanHeroic(offer) {
  const l = launcherFor('heroic', 'com.heroicgameslauncher.hgl');
  if (!l) return;
  const home = os.homedir();
  const bases = [
    path.join(home, '.config'),
    path.join(home, '.var', 'app', 'com.heroicgameslauncher.hgl', 'config'),
  ];
  const seen = new Set();
  const add = (runner, label, appName, title, installPath) => {
    if (typeof appName !== 'string' || !SAFE_ID.test(appName) || seen.has(runner + appName)) return;
    seen.add(runner + appName);
    const t = cleanTitle(typeof title === 'string' && title ? title : path.basename(String(installPath || appName)), 60);
    if (t) offer({ title: t, source: label, kind: 'game', file: l.file, args: [...l.pre, `heroic://launch/${runner}/${appName}`] });
  };
  for (const base of bases) {
    // Epic, through legendary: { <app>: { title, install_path, is_dlc } }
    const epic = readJson(path.join(base, 'legendary', 'installed.json'));
    if (epic && typeof epic === 'object' && !Array.isArray(epic)) {
      for (const [name, g] of Object.entries(epic)) {
        if (g && typeof g === 'object' && !g.is_dlc) add('legendary', 'Heroic (Epic)', g.app_name || name, g.title, g.install_path);
      }
    }
    // GOG: installed.json lists what is installed, the library cache has titles.
    const gog = readJson(path.join(base, 'heroic', 'gog_store', 'installed.json'));
    if (gog && Array.isArray(gog.installed)) {
      const titles = new Map();
      for (const f of [
        path.join(base, 'heroic', 'store_cache', 'gog_library.json'),
        path.join(base, 'heroic', 'gog_store', 'library.json'),
      ]) {
        const lib = readJson(f);
        for (const g of lib && Array.isArray(lib.games) ? lib.games : []) {
          if (g && typeof g.app_name === 'string' && typeof g.title === 'string') titles.set(g.app_name, g.title);
        }
      }
      for (const g of gog.installed) {
        if (g && typeof g === 'object') add('gog', 'Heroic (GOG)', g.appName, titles.get(g.appName), g.install_path);
      }
    }
  }
}

function runScan() {
  found = new Map();
  const notes = new Set();
  const known = new Set(state.items.map((i) => i.path + '\0' + JSON.stringify(i.args || [])));
  const steam = steamLauncher();
  let visits = 0;
  let steamSeen = false;

  const offer = (c) => {
    const key = c.file + '\0' + JSON.stringify(c.args || []);
    if (known.has(key)) return;
    known.add(key);
    found.set(crypto.randomBytes(4).toString('hex'), c);
  };

  const walk = (dir, depth) => {
    if (depth > SCAN_DEPTH || visits > SCAN_MAX_VISITS) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    visits += ents.length;

    // Steam library: steamapps/appmanifest_<id>.acf
    if (path.basename(dir) === 'steamapps') {
      steamSeen = true;
      if (steam) {
        for (const e of ents) {
          const m = /^appmanifest_(\d+)\.acf$/.exec(e.name);
          if (!m || !e.isFile()) continue;
          let text = '';
          try { text = fs.readFileSync(path.join(dir, e.name), 'utf8').slice(0, 65536); } catch { continue; }
          const nm = /"name"\s+"([^"]*)"/.exec(text);
          const title = nm && cleanTitle(nm[1], 60);
          if (!title || STEAM_SKIP.test(title)) continue;
          offer({
            title, source: 'Steam', kind: 'game',
            file: steam.file, args: [...steam.pre, `steam://rungameid/${m[1]}`],
          });
        }
      }
      return;
    }

    // AnyPS5 output (its docs): the converted executable sits beside libs/ and
    // app0/, and app0/ holds the converted modules. Older layouts put
    // sce_module/ beside the executable, so both are accepted.
    const names = new Set(ents.filter((e) => e.isDirectory()).map((e) => e.name));
    if (names.has('app0') && (names.has('libs') || names.has('sce_module'))) {
      const exes = ents
        .filter((e) => e.isFile() && !/\.(so|prx|sh|txt|json|md|ini|exe)$/i.test(e.name) && !e.name.includes('.so.'))
        .map((e) => e.name)
        .filter((n) => isElf(path.join(dir, n)))
        .sort((a, b) => Number(/^eboot/i.test(b)) - Number(/^eboot/i.test(a)) || Number(/\.elf$/i.test(b)) - Number(/\.elf$/i.test(a)));
      if (exes.length) {
        const file = path.join(dir, exes[0]);
        if (!isExecutable(file)) notes.add('Some PS5 games are not marked executable. Run chmod +x on the .elf file.');
        offer({
          title: cleanTitle(path.basename(dir), 60) || exes[0],
          source: 'PS5 (AnyPS5)', kind: 'game', file, args: [],
        });
      }
      return; // don't dig into the game's own folders
    }

    for (const e of ents) {
      if (e.isDirectory() && !e.isSymbolicLink()) walk(path.join(dir, e.name), depth + 1);
    }
  };

  const roots = settings.scanRoots.filter(isDir);
  if (roots.length < settings.scanRoots.length) notes.add('Some library folders are missing (is a drive unplugged?).');
  roots.forEach((r) => walk(r, 0));
  if (steamSeen && !steam) notes.add('Found Steam games but no Steam launcher is installed.');
  if (visits > SCAN_MAX_VISITS) notes.add('Scan stopped early: that is a lot of files. Try a more specific folder.');
  // Launchers that keep their own game lists are read from their usual places.
  for (const source of [scanHeroic, scanLutris, scanDesktopGames]) {
    try { source(offer, notes); } catch { /* one broken source never stops the rest */ }
  }

  return {
    found: [...found].map(([cid, c]) => ({ cid, title: c.title, source: c.source, optional: Boolean(c.optional) })),
    notes: [...notes].join(' ') || null,
  };
}

// ----------------------------------------------------------------- add-ons
// Everything a user can download lives in one folder tree under the data
// folder, so a marketplace only has to drop files in the right place:
//
//   widgets/<id>/manifest.json + files    inlays shown on any page
//   themes/<id>/...                       look and feel (loader comes later)
//   art/  fonts/  sounds/                 shared assets themes and pages can use
//
// Add-ons are DATA. Tessera never runs code from these folders in its own
// process. A widget's page runs in a sandboxed frame with no network access.

const ADDON_DIRS = ['widgets', 'themes', 'art', 'fonts', 'sounds'];
const WIDGET_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const WIDGET_MAX_FILE = 5 * 1024 * 1024;
const addonDir = (name) => path.join(DATA_DIR, name);

const README = {
  widgets: `Put one folder per widget here. The folder name is the widget's id
(lowercase letters, numbers, . _ -).

  my-widget/
    manifest.json
    index.html
    app.js        (scripts must be separate files; inline scripts are blocked)

manifest.json:
  {
    "name": "My Widget",
    "description": "What it does",
    "author": "You",
    "version": "1.0",
    "entry": "index.html",
    "size": { "w": 3, "h": 2 },
    "resizable": true,
    "min": { "w": 2, "h": 1 },
    "max": { "w": 6, "h": 4 }
  }

Home is a grid of 12 x 6 cells spread over the whole screen, so a widget is
sized in cells, not pixels, and looks right on any display. "size" is the
starting size (default 3 x 2). Set "resizable" to let people stretch it between
"min" and "max". Make your page fill its frame (width and height 100%).
Widgets cannot use the network or touch your files.
Restart Tessera or use Settings > Add-ons > Reload to pick up changes.
`,
  themes: `One folder per theme, with a theme.json inside. A theme starts from the
stock Theme Settings (screen area, text size, colors, corners, background
picture) and can change their defaults and add settings of its own.

  my-theme/
    theme.json

theme.json:
  {
    "name": "My Theme",
    "author": "You",
    "defaults": { "accent": "#ff00aa", "radius": "28px" },
    "settings": [
      { "id": "glow", "label": "Glow", "group": "My Theme", "type": "range",
        "min": 0, "max": 10, "step": 2, "default": 4, "unit": "px",
        "var": "--theme-glow" }
    ]
  }

Setting types: range, choice (with "options": [{ "label", "value" }]), color
(#rrggbb), toggle ("on" / "off" values), image (stock background only).
A setting's value becomes a CSS variable named in "var". Variables must start
with --theme- (or be one of the stock ones: --accent, --bg, --card, ...).
Themes only set values; they cannot run code or load files from the network.
Switch themes in Settings > Add-ons > Themes. Changes show in Settings > Theme Settings.
`,
};

function ensureTree() {
  for (const d of ADDON_DIRS) {
    try { fs.mkdirSync(addonDir(d), { recursive: true }); } catch { /* read-only: skip */ }
  }
  for (const [d, text] of Object.entries(README)) {
    const f = path.join(addonDir(d), 'README.txt');
    try { if (!fs.existsSync(f)) fs.writeFileSync(f, text); } catch { /* ignore */ }
  }
}

let widgets = new Map(); // id -> { dir, manifest }
let rejected = [];       // [{ id, reason }] so authors can see what's wrong

function readManifest(dir) {
  const file = path.join(dir, 'manifest.json');
  let st;
  try { st = fs.statSync(file); } catch { return { reason: 'no manifest.json' }; }
  if (!st.isFile() || st.size > 64 * 1024) return { reason: 'manifest.json is not a small file' };
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { reason: 'manifest.json is not valid JSON' }; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { reason: 'manifest.json has the wrong shape' };
  const name = cleanTitle(m.name);
  if (!name) return { reason: 'needs a "name"' };
  const entry = m.entry === undefined ? 'index.html' : m.entry;
  if (
    typeof entry !== 'string' ||
    entry.startsWith('/') ||
    entry.split(/[\\/]/).includes('..') ||
    !/\.html$/i.test(entry)
  )
    return { reason: '"entry" must be a relative .html file' };
  const dims = (v, dflt, label) => {
    if (v === undefined) return dflt;
    const ok = v && typeof v === 'object' && Number.isInteger(v.w) && Number.isInteger(v.h) &&
      v.w >= 1 && v.w <= GRID.cols && v.h >= 1 && v.h <= GRID.rows;
    if (!ok) throw new Error(`"${label}" must look like { "w": 3, "h": 2 } within ${GRID.cols} x ${GRID.rows}`);
    return { w: v.w, h: v.h };
  };
  let size, min, max;
  const resizable = m.resizable === true;
  try {
    size = dims(m.size, { w: 3, h: 2 }, 'size');
    min = resizable ? dims(m.min, { w: 1, h: 1 }, 'min') : size;
    max = resizable ? dims(m.max, { w: GRID.cols, h: GRID.rows }, 'max') : size;
  } catch (e) { return { reason: e.message }; }
  if (min.w > size.w || min.h > size.h || max.w < size.w || max.h < size.h)
    return { reason: '"size" must be between "min" and "max"' };
  const opt = (v, max) => (typeof v === 'string' ? cleanTitle(v, max) || '' : '');
  return {
    manifest: {
      name,
      description: opt(m.description, 120),
      author: opt(m.author, 60),
      version: opt(m.version, 20),
      entry,
      size, min, max, resizable,
    },
  };
}

function scanAddons() {
  widgets = new Map();
  rejected = [];
  let names = [];
  try {
    names = fs.readdirSync(addonDir('widgets'), { withFileTypes: true });
  } catch { /* none yet */ }
  for (const e of names) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue; // files and links are ignored
    if (!WIDGET_ID_RE.test(e.name)) {
      rejected.push({ id: e.name, reason: 'folder name must be lowercase letters, numbers, . _ -' });
      continue;
    }
    const dir = path.join(addonDir('widgets'), e.name);
    const r = readManifest(dir);
    if (r.reason) { rejected.push({ id: e.name, reason: r.reason }); continue; }
    const entryFile = path.join(dir, r.manifest.entry);
    const rp = real(entryFile);
    const base = real(dir);
    if (!rp || !base || !rp.startsWith(base + path.sep) || !fs.statSync(rp).isFile()) {
      rejected.push({ id: e.name, reason: `"${r.manifest.entry}" was not found inside the folder` });
      continue;
    }
    widgets.set(e.name, { dir, manifest: r.manifest });
  }
}

function inlayDef(type) {
  if (BUILTIN_INLAYS[type]) return { ...BUILTIN_INLAYS[type], widget: null };
  const m = /^widget:(.+)$/.exec(type);
  const w = m && widgets.get(m[1]);
  return w ? { name: w.manifest.name, description: w.manifest.description, size: w.manifest.size, min: w.manifest.min, max: w.manifest.max, resizable: w.manifest.resizable, widget: m[1] } : null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
// Enforced by Tessera on every widget response, whatever the widget says:
// its own files only, scripts from files, and no network of any kind.
const WIDGET_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'none'; " +
  "form-action 'none'; base-uri 'none'";

// Serve one file from one widget folder. Anything outside the folder, any
// symlink that leaves it, and any unknown file type is a 404.
function serveWidget(id, pathname) {
  const notFound = { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' };
  const w = widgets.get(id);
  if (!w) return notFound;
  let rel;
  try { rel = decodeURIComponent(pathname || '/'); } catch { return notFound; }
  if (rel === '/' || rel === '') rel = '/' + w.manifest.entry;
  if (rel.includes('\0')) return notFound;
  const full = path.resolve(w.dir, '.' + rel);
  const rp = real(full);
  const base = real(w.dir);
  if (!rp || !base || !rp.startsWith(base + path.sep)) return notFound;
  const type = MIME[path.extname(rp).toLowerCase()];
  if (!type) return notFound;
  let body;
  try {
    const st = fs.statSync(rp);
    if (!st.isFile() || st.size > WIDGET_MAX_FILE) return notFound;
    body = fs.readFileSync(rp);
  } catch {
    return notFound;
  }
  return {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Security-Policy': WIDGET_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
    body,
  };
}

function addonsInfo() {
  const countDirs = (d) => {
    try { return fs.readdirSync(addonDir(d), { withFileTypes: true }).filter((e) => e.isDirectory()).length; } catch { return 0; }
  };
  return {
    presets: Object.entries(BUILTIN_INLAYS).map(([type, d]) => ({
      type, name: d.name, description: d.description, size: d.size, min: d.min, max: d.max, resizable: d.resizable,
    })),
    widgets: [...widgets].map(([id, w]) => ({
      type: 'widget:' + id, name: w.manifest.name, description: w.manifest.description,
      author: w.manifest.author, size: w.manifest.size, min: w.manifest.min, max: w.manifest.max, resizable: w.manifest.resizable,
    })),
    rejected,
    dirs: Object.fromEntries(ADDON_DIRS.map((d) => [d, display(addonDir(d))])),
    themeCount: countDirs('themes'),
    themes: [...themes.values()].filter((t) => !t.builtin).map((t) => ({ id: t.id, name: t.name, author: t.author, settings: t.extra.length })),
  };
}

// ----------------------------------------------------------------- window

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#10151c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: DEV, // no inspector for anyone sitting at the TV
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => {
    ensureTree();
    scanAddons();
    scanThemes();
    loadState();
    loadSettings();
    send('init', buildView());
  });
  // Tessera is the front door of the machine, so there is no quit shortcut for
  // whoever is holding the controller. Leaving goes through Settings > Desktop
  // Mode, which lands on the login screen. Developers get Ctrl+Q with TESSERA_DEV=1.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (DEV && input.control && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      app.quit();
    } else if (!DEV && (input.key === 'F12' || (input.control && input.shift && /^[ijc]$/i.test(input.key)) || (input.control && /^[rw]$/i.test(input.key)) || input.key === 'F5' || (input.alt && input.key === 'F4'))) {
      event.preventDefault(); // no inspector, reload or close
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // the default menu carries Reload and Toggle DevTools
    protocol.handle(ART_SCHEME, (req) => {
      try {
        const m = /^\/([^/]+)$/.exec(new URL(req.url).pathname);
        const r = serveArt(m ? decodeURIComponent(m[1]) : '');
        return new Response(r.body, { status: r.status, headers: r.headers });
      } catch {
        return new Response('Bad request', { status: 400 });
      }
    });
    protocol.handle(WIDGET_SCHEME, (req) => {
      try {
        const u = new URL(req.url);
        const r = serveWidget(u.hostname, u.pathname);
        return new Response(r.body, { status: r.status, headers: r.headers });
      } catch {
        return new Response('Bad request', { status: 400 });
      }
    });
    createWindow();
  });
}

// Every handler takes plain data, validates it, and returns plain data.
const safe = (fn) => (_e, op, p) => {
  try {
    return fn(typeof op === 'string' ? op : '', p && typeof p === 'object' ? p : {});
  } catch (err) {
    return { ok: false, error: 'Something went wrong.' };
  }
};

ipcMain.handle('library', safe((op, p) => {
  const r = libraryOp(op, p);
  if (r.ok) {
    try { saveState(); } catch { return { ok: false, error: "Couldn't save your library." }; }
  }
  return { ...r, view: buildView() };
}));

ipcMain.handle('browse', safe((op, p) => browseOp(op, p)));

ipcMain.handle('addons', safe((op) => {
  if (op === 'rescan') { scanAddons(); scanThemes(); }
  if (op === 'list' || op === 'rescan') return addonsInfo();
  return { error: 'Unknown action.' };
}));

ipcMain.handle('settings', safe((op, p) => {
  const rootsView = () => settings.scanRoots.map(friendly);
  if (op === 'get') return { roots: rootsView() };
  if (op === 'removeRoot') {
    if (Number.isInteger(p.index) && p.index >= 0 && p.index < settings.scanRoots.length) {
      settings.scanRoots.splice(p.index, 1);
      saveSettings();
    }
    return { roots: rootsView() };
  }
  if (op === 'drives') return { drives: driveList().map(({ key, name, auto, custom, tech }) => ({ key, name, auto, custom, tech })) };
  if (op === 'driveName') {
    const d = driveList().find((x) => x.key === p.key);
    if (!d) return { ok: false, error: "That drive isn't connected." };
    const nm = typeof p.name === 'string' ? p.name.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40) : '';
    if (nm) settings.driveNames[d.key] = nm;
    else delete settings.driveNames[d.key]; // empty goes back to the automatic name
    saveSettings();
    lsblkCache.at = 0;
    return { ok: true };
  }
  if (op === 'themeGet') return themePayload();
  if (op === 'themeSet') {
    if (typeof p.id !== 'string' || !setThemeValue(p.id, p.value)) return { ok: false, error: "That can't be set.", theme: themePayload() };
    return { ok: true, theme: themePayload() };
  }
  if (op === 'themeUse') {
    if (typeof p.id !== 'string' || !themes.has(p.id)) return { ok: false, theme: themePayload() };
    settings.theme.active = p.id;
    themeRev++;
    saveSettings();
    return { ok: true, theme: themePayload() };
  }
  if (op === 'themeReset') {
    delete settings.theme.values[activeTheme()];
    themeRev++;
    saveSettings();
    return { ok: true, theme: themePayload() };
  }
  if (op === 'themeImage') return themeImage(typeof p.id === 'string' ? p.id : '');
  if (op === 'padGet') return { pad: { ...settings.pad }, calib: settings.calib };
  if (op === 'padSet') {
    const k = p.key;
    if (!Object.keys(PAD_DEFAULTS).includes(k)) return { ok: false };
    if (PAD_CHOICES[k]) {
      if (!PAD_CHOICES[k].includes(p.value)) return { ok: false };
      settings.pad[k] = p.value;
    } else {
      if (!Number.isFinite(p.value) || p.value < PAD_RANGES[k][0] || p.value > PAD_RANGES[k][1]) return { ok: false };
      settings.pad[k] = Math.round(p.value);
    }
    saveSettings();
    return { ok: true, pad: { ...settings.pad }, calib: settings.calib };
  }
  if (op === 'padCalib') {
    const id = typeof p.id === 'string' ? p.id.slice(0, 80) : '';
    const offs = Array.isArray(p.offsets) ? p.offsets.slice(0, 8) : null;
    if (!id) return { ok: false };
    if (offs === null) delete settings.calib[id];
    else if (offs.every((n) => Number.isFinite(n) && Math.abs(n) <= 0.5)) settings.calib[id] = offs.map((n) => Math.round(n * 1000) / 1000);
    else return { ok: false, error: 'Let go of the sticks and try again.' };
    if (Object.keys(settings.calib).length > 16) delete settings.calib[Object.keys(settings.calib)[0]];
    saveSettings();
    return { ok: true, pad: { ...settings.pad }, calib: settings.calib };
  }
  if (op === 'getKeys') return { keys: settings.keys };
  if (op === 'setKey') {
    const ok =
      Object.keys(DEFAULT_KEYS).includes(p.action) &&
      Number.isInteger(p.button) && p.button >= 0 && p.button < 32 &&
      !RESERVED_BUTTONS.includes(p.button);
    if (!ok) return { ok: false, error: "That button can't be used here.", keys: settings.keys };
    // If another action already uses that button, give it this action's old one.
    const other = Object.keys(settings.keys).find((k) => k !== p.action && settings.keys[k] === p.button);
    if (other) settings.keys[other] = settings.keys[p.action];
    settings.keys[p.action] = p.button;
    saveSettings();
    return { ok: true, keys: settings.keys };
  }
  if (op === 'resetKeys') {
    settings.keys = { ...DEFAULT_KEYS };
    saveSettings();
    return { ok: true, keys: settings.keys };
  }
  return { error: 'Unknown action.' };
}));

ipcMain.handle('scan', safe((op, p) => {
  if (op === 'run') return runScan();
  if (op === 'add') {
    if (state.locked) return { ok: false, error: `Can't edit: ${state.locked}`, view: buildView() };
    const cids = Array.isArray(p.cids) ? p.cids.filter((c) => typeof c === 'string') : [];
    const into = typeof p.into === 'string' ? catById(p.into) : null;
    let n = 0;
    for (const cid of cids) {
      const c = found.get(cid);
      const it = c && addItem({ title: c.title, kind: c.kind, file: c.file, args: c.args });
      if (it) {
        n++;
        if (into) into.entries.push(it.id);
      }
      found.delete(cid);
    }
    if (n) saveState();
    return { ok: true, message: n ? `Added ${n} game${n === 1 ? '' : 's'}.` : 'Nothing added.', view: buildView() };
  }
  return { ok: false, error: 'Unknown action.' };
}));

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

// While the browser has the screen, Tessera is hidden and can't see the
// controller through the page. So for that time only, read the kernel's joystick
// devices directly (via `cat`, which can be stopped cleanly) and watch for
// LB / RB. js-device button numbers: 4 = LB, 5 = RB on common pads.
const JS_LB = 4;
const JS_RB = 5;
function parseJsEvents(buf, onShoulder) {
  // Each event is 8 bytes: time u32, value s16, type u8, number u8.
  for (let i = 0; i + 8 <= buf.length; i += 8) {
    const type = buf[i + 6];
    if (type & 0x80) continue; // synthetic "initial state" event
    if ((type & 0x7f) !== 1 || buf.readInt16LE(i + 4) !== 1) continue; // button pressed
    const n = buf[i + 7];
    if (n === JS_LB) onShoulder(-1);
    else if (n === JS_RB) onShoulder(1);
  }
}
function watchJoysticks(onShoulder, dir = '/dev/input') {
  const procs = [];
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /^js\d+$/.test(n)); } catch { /* none */ }
  for (const n of names) {
    const cat = spawn('cat', [path.join(dir, n)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let pending = Buffer.alloc(0);
    cat.stdout.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      const whole = pending.length - (pending.length % 8);
      parseJsEvents(pending.subarray(0, whole), onShoulder);
      pending = pending.subarray(whole);
    });
    cat.on('error', () => {});
    procs.push(cat);
  }
  return () => procs.forEach((p) => { try { p.kill(); } catch { /* gone */ } });
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
function runChild(file, args, cwd, label, logName) {
  running = true;
  let finished = false;
  let closing = 0;
  let stopWatching = null;
  // 'error' and 'close' can both fire; only the first one counts.
  const finish = (message) => {
    if (finished) return;
    finished = true;
    running = false;
    if (stopWatching) stopWatching();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    send('game-exited', message || null);
    if (closing) send('shift-tab', closing);
  };

  mainWindow.hide();
  // No shell, args passed separately. stdio is ignored so an unread pipe
  // can never fill up and freeze the program.
  const isBrowser = label === 'Browser';
  // A game's output goes to a small log file (never a pipe, which could fill
  // and freeze it), so a crash can be explained afterwards.
  let out = 'ignore';
  let logFile = null;
  if (logName) {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      logFile = path.join(LOG_DIR, logName + '.log');
      const fd = fs.openSync(logFile, 'w');
      out = fd;
    } catch { logFile = null; }
  }
  const child = spawn(file, args, { cwd, shell: false, stdio: ['ignore', out, out], detached: isBrowser });
  if (typeof out === 'number') try { fs.closeSync(out); } catch { /* the child has its own copy */ }
  child.once('error', (err) => finish(`Launch failed: ${err.message}`));
  child.once('close', (code, signal) =>
    finish(isBrowser || code === 0 ? null : `${label} exited (${code !== null ? 'code ' + code : signal}).` + (logFile ? ` Details: ${display(logFile)}` : ''))
  );
  if (isBrowser) {
    stopWatching = watchJoysticks((dir) => {
      if (closing) return;
      closing = dir;
      const app = flatpakAppId(file, args);
      if (app) execFile('flatpak', ['kill', app], () => {});
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 4000);
    });
  }
}

ipcMain.on('launch', (_event, id) => {
  if (running || typeof id !== 'string') return;
  if (id === '_browser') {
    const b = resolveBrowser();
    if (!b) return send('launch-failed', "Couldn't find a web browser to open.");
    return runChild(b.file, b.args, os.homedir(), 'Browser');
  }
  const game = itemById(id);
  if (!game) return send('launch-failed', 'Unknown game.');
  try {
    fs.accessSync(game.path, fs.constants.X_OK);
  } catch {
    const exists = fs.existsSync(game.path);
    return send(
      'launch-failed',
      exists
        ? `${path.basename(game.path)} isn't marked executable. Run: chmod +x on it.`
        : `Can't find ${path.basename(game.path)}. Is the drive plugged in?`
    );
  }
  recordPlay(game.id);
  // The game runs from its own folder so AnyPS5 can find libs/ and app0/.
  runChild(game.path, game.args || [], path.dirname(game.path), 'Game', game.id);
});

ipcMain.on('quit', () => app.quit());
app.on('window-all-closed', () => app.quit());
