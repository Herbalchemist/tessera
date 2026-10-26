// SPDX-License-Identifier: GPL-3.0-or-later
const { app, BrowserWindow, WebContentsView, ipcMain, protocol, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');
const { verifyAddon } = require('./addon-verify');

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
// Desktop Mode helper (tessera-guide): the same program, showing only the guide, in a hidden
// window that comes up over the desktop when a controller's Guide button is pressed.
const GUIDE_ONLY = process.env.TESSERA_GUIDE_ONLY === '1';

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
  // The six below all read from systemInfo() (see near the "summaries" IPC handler), polled by
  // the renderer itself once a second — nothing is pushed from here, and nothing here ever
  // spawns a process; it's all local /proc, /sys and Node's own os module, so polling it that
  // often costs nothing worth noticing.
  cpu: {
    name: 'CPU', description: 'Processor load',
    size: { w: 2, h: 2 }, min: { w: 2, h: 1 }, max: { w: 4, h: 3 }, resizable: true,
  },
  ram: {
    name: 'Memory', description: 'RAM used and free',
    size: { w: 2, h: 2 }, min: { w: 2, h: 1 }, max: { w: 4, h: 3 }, resizable: true,
  },
  storage: {
    name: 'Storage', description: 'Free space on the main drive',
    size: { w: 3, h: 2 }, min: { w: 2, h: 1 }, max: { w: 5, h: 3 }, resizable: true,
  },
  battery: {
    name: 'Battery', description: 'Charge level, if this device has one',
    size: { w: 2, h: 2 }, min: { w: 2, h: 1 }, max: { w: 4, h: 3 }, resizable: true,
  },
  network: {
    name: 'Network', description: 'Connection and live speed',
    size: { w: 3, h: 2 }, min: { w: 2, h: 1 }, max: { w: 5, h: 3 }, resizable: true,
  },
  uptime: {
    name: 'Uptime', description: 'How long this session has been running',
    size: { w: 2, h: 2 }, min: { w: 2, h: 1 }, max: { w: 4, h: 3 }, resizable: true,
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
// While the launcher runs it leaves its process id here, so the desktop helper knows to stay quiet.
const LAUNCHER_PID_FILE = path.join(path.dirname(LOG_DIR), 'launcher.pid');

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
  const roots = vaultRoots(); // looked up once for the whole list, not for every tile
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const tileOf = (it) => ({ id: it.id, title: it.title, kind: it.kind, art: Boolean(resolveArt(it)), custom: Boolean(it.art), deletable: Boolean(itemDeleteTarget(it, roots)), offline: offlineKind(it) });
  const tileFor = (ref, selfId) => {
    if (ref === selfId) return null;
    const it = byId.get(ref);
    if (it) return tileOf(it);
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
  return { tabs, folders, mosaics, tabOrder: computeTabOrder(), recent, keys: settings.keys, prefs: prefsPayload(), artRev, error: state.warn, nested: Boolean(process.env.TESSERA_NESTED) };
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
    case 'deleteFiles': {
      const it = itemById(p.id);
      if (!it) return { ok: false, error: 'That no longer exists.' };
      const target = itemDeleteTarget(it);
      if (!target) return { ok: false, error: "Tessera only deletes files it keeps in your Tessera folder. Remove it from the library instead, or uninstall it where you installed it." };
      const r = vaultDelete(target);
      if (!r.ok) return r;
      const gone = (x) => { const rp = real(x.path); return !rp || rp === target || rp.startsWith(target + path.sep); };
      const ids = new Set(state.items.filter((x) => gone(x)).map((x) => x.id));
      state.items = state.items.filter((x) => !ids.has(x.id));
      state.categories.forEach((x) => (x.entries = x.entries.filter((e) => !ids.has(e))));
      gc();
      return { ok: true, message: `Deleted ${it.title} and its files.` };
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
const PAD_DEFAULTS = {
  deadzone: 15, trigger: 8, rumble: 'normal', style: 'split', glyphs: 'auto', joycons: 'together',
  // The browser pointer: which stick moves the cursor (the other one scrolls), and how fast.
  browserCursor: 'right', cursorSpeed: 50, scrollSpeed: 50,
  // The Guide button: what a quick press and a long hold do (see guide-button.js).
  guideButton: 'menu-home',
  guideDesktop: 'auto', // the guide in Desktop Mode: 'auto' (not while Steam runs), 'on', 'off'
};
const PAD_CHOICES = {
  rumble: ['off', 'low', 'normal', 'high'],
  style: ['split', 'both', 'pulse'],
  glyphs: ['auto', 'xbox', 'playstation', 'nintendo'],
  joycons: ['together', 'separate'], // a left and a right Joy-Con: one controller, or two players
  browserCursor: ['right', 'left'],
  guideButton: ['menu-home', 'home-menu', 'menu'],
  guideDesktop: ['auto', 'on', 'off'],
};
const PAD_RANGES = { deadzone: [0, 40], trigger: [0, 50], cursorSpeed: [10, 100], scrollSpeed: [10, 100] };

let settings = {
  scanRoots: [],
  keys: { ...DEFAULT_KEYS },
  theme: { active: 'stock', values: {} }, // values[themeId][settingId]
  pad: { ...PAD_DEFAULTS },
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
  profiles: [], // { id, name, themeId } — themeId null means "use the active theme"; first look at who's using Tessera
  // Shards (~/Tessera/Shards/<id>/) are the one add-on kind with Tessera's own level of system
  // access — unlike themes (values only) or widgets (sandboxed, no network, own files only).
  // Both of these are the owner's own call, not a fixed rule: this is a control Tessera gives
  // you, not a gate Tessera puts on you.
  codeAddons: {
    pinRequired: true, // installing or removing a shard needs the PIN, same as everywhere else that only matters once you've set one
    allowUnverified: true, // shards without Tessera's own signature still run — your device, your call
  },
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
    if (d && Array.isArray(d.profiles)) {
      const ids = new Set();
      const loaded = [];
      for (const pr of d.profiles.slice(0, MAX_PROFILES)) {
        if (!pr || typeof pr !== 'object' || typeof pr.id !== 'string' || !PROFILE_ID_RE.test(pr.id) || ids.has(pr.id)) continue;
        const name = clip(pr.name, 24);
        if (!name) continue;
        ids.add(pr.id);
        const themeId = typeof pr.themeId === 'string' && THEME_ID_RE.test(pr.themeId) ? pr.themeId : null;
        loaded.push({ id: pr.id, name, themeId });
      }
      // Replace, don't append: loadSettings() can run again in this same process (restoring a
      // backup, or a window reload), and appending would let stale or duplicate profiles from
      // before that reload silently pile up alongside the freshly-read ones.
      settings.profiles = loaded;
      settings.activeProfile = typeof d.activeProfile === 'string' && loaded.some((pr) => pr.id === d.activeProfile) ? d.activeProfile : null;
    } else if (d) {
      settings.profiles = [];
    }
    // A settings file from before the welcome page existed counts as "already welcomed".
    settings.firstRunDone = !d || d.firstRunDone === undefined ? true : d.firstRunDone === true;
    if (d && d.pin && /^[0-9a-f]{32}$/.test(d.pin.salt || '') && /^[0-9a-f]{64}$/.test(d.pin.hash || '')) settings.pin = { salt: d.pin.salt, hash: d.pin.hash };
    settings.pinBrowser = !d || d.pinBrowser !== false;
    settings.codeAddons = {
      pinRequired: !d || !d.codeAddons || d.codeAddons.pinRequired !== false,
      allowUnverified: !d || !d.codeAddons || d.codeAddons.allowUnverified !== false,
    };
    settings.calibration = d && d.calibration ? cleanCal(d.calibration) : null;
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
    const g = real(vaultFolder('games'));
    if (g) settings.scanRoots.push(g);
  }
}
// A page's own grid size: key is a page id (or f:<folder id>), cols 2-12, rows 1-8.
function cleanPageGrid(key, cols, rows) {
  if (typeof key !== 'string' || !/^(f:)?[A-Za-z0-9._-]{1,80}$/.test(key)) return null;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 12 || rows < 1 || rows > 8) return null;
  return { cols, rows };
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
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,23}$/;
const MAX_PROFILES = 16;
const SETTING_ID_RE = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/;
const VAR_RE = /^--(theme-)?[a-z][a-z0-9-]{0,30}$/;
const SAFE_VALUE_RE = /^[#a-zA-Z0-9 .%(),+-]{1,40}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const IMG_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_IMAGE = 12 * 1024 * 1024;
const STOCK_VARS = ['--use', '--font-scale', '--radius', '--border-w', '--accent', '--border', '--card', '--panel', '--bg', '--text', '--muted', '--bg-image', '--bg-dim', '--danger', '--ok', '--motion', '--wg-tint', '--wg-blur', '--wg-color', '--wg-sheen', '--wg-clear', '--shadow', '--ring', '--tab-shadow'];
// Seven themes ship with Tessera. They share one list of settings and differ
// only in their defaults, including a safe structural shell preset. ("stock"
// stays the id of Bright so saved choices carry over.)
// The two Mosaic themes turn on "selColor: pastel" (Theme Settings > Selector glow):
// the glow around whatever the selector lands on takes a new random pastel every
// move. The tile, tab, menu row or key itself keeps its own colour.
const BUILTIN_THEMES = [
  {
    id: 'stock', name: 'Tessera Bright', author: 'Tessera',
    defaults: {
      bg: '#f4f1fa', card: '#ffffff', panel: '#ffffff', text: '#2b2640', muted: '#6a6586', accent: '#6a58d8',
      border: '#2b2640', borderW: '0px', shadow: 60, radius: '20px', cancel: '#e5484d', confirm: '#12a37f',
      backdrop: 'glow', shellLayout: 'classic', layout: 'grid', gridPreset: 'c5r3',
      widgetStyle: 'frosted', widgetTint: 30, widgetBlur: 22, widgetClear: 60, widgetColor: '#ffffff',
    },
  },
  {
    id: 'dark', name: 'Tessera Dark', author: 'Tessera',
    defaults: {
      bg: '#0a0714', card: '#1a1230', panel: '#150e29', text: '#e9defc', muted: '#9a8bc0', accent: '#9d7bff',
      border: '#3b2a6b', borderW: '2px', radius: '14px', cancel: '#ff5d8f', confirm: '#3ee0b0',
      backdrop: 'mystic', shellLayout: 'classic', layout: 'rails', gridPreset: 'c5r3',
      widgetStyle: 'glass', widgetTint: 40, widgetBlur: 18, widgetClear: 55, widgetColor: '#1a1230',
    },
  },
  {
    id: 'mosaic', name: 'Tessera Mosaic', author: 'Tessera',
    defaults: {
      bg: '#f8f5ef', card: '#ffffff', panel: '#ffffff', text: '#2a2638', muted: '#6d6882', accent: '#6063d8',
      border: '#2a2638', borderW: '0px', shadow: 55, radius: '20px', cancel: '#e5546b', confirm: '#1fa67a',
      backdrop: 'tiles', selColor: 'pastel', shellLayout: 'classic', layout: 'grid', gridPreset: 'c5r3',
      widgetStyle: 'frosted', widgetTint: 35, widgetBlur: 22, widgetClear: 60, widgetColor: '#ffffff',
    },
  },
  {
    id: 'mosaic-dark', name: 'Tessera Mosaic Dark', author: 'Tessera',
    defaults: {
      bg: '#121018', card: '#1f1c2b', panel: '#1a1724', text: '#ece8f5', muted: '#9a94b0', accent: '#b4a7ff',
      border: '#3a3450', borderW: '0px', shadow: 70, radius: '20px', cancel: '#ff6b8b', confirm: '#4fe0b0',
      backdrop: 'tiles', selColor: 'pastel', shellLayout: 'classic', layout: 'grid', gridPreset: 'c5r3',
      widgetStyle: 'glass', widgetTint: 40, widgetBlur: 18, widgetClear: 55, widgetColor: '#1f1c2b',
    },
  },
  // Console homages: each takes a home screen's layout, colors and motion, never its artwork,
  // logos or sounds. Cartridge Pop and Dashboard Steel keep their ids so saved choices survive.
  {
    // A row of big square game tiles under a selection frame, round buttons below, clock up top.
    id: 'cartridge-pop', name: 'Cartridge Pop', author: 'Tessera',
    defaults: {
      bg: '#ebebeb', card: '#ffffff', panel: '#f6f6f6', text: '#2d2d2d', muted: '#7d7d7d', accent: '#00b4e6',
      border: '#d4d4d4', borderW: '0px', radius: '4px', shadow: 30, tabShadow: 40, selectRing: '5px',
      confirm: '#00b4e6', cancel: '#e60012', backdrop: 'none', selColor: 'accent', shellLayout: 'switch', layout: 'rails', gridPreset: 'c6r3',
      setPack: false, setNotes: true, setIcons: 'still',
      widgetStyle: 'solid', widgetTint: 35, widgetBlur: 18, widgetClear: 60, widgetColor: '#ffffff', widgetSheen: false,
      motion: true, browserAnim: 'zoom',
    },
  },
  {
    // Near-black glass, a row of small tiles that grows the one you're on, its art behind everything.
    id: 'nova-black', name: 'Nova Black', author: 'Tessera',
    defaults: {
      bg: '#06070d', card: '#1a1d2a', panel: '#11131c', text: '#ffffff', muted: '#9aa0b4', accent: '#ffffff',
      border: '#2b3042', borderW: '0px', radius: '10px', shadow: 80, tabShadow: 0, selectRing: '3px',
      confirm: '#3c7cff', cancel: '#ff5a6e', backdrop: 'none', selColor: 'accent', shellLayout: 'hero', layout: 'rails', gridPreset: 'c6r3',
      setPack: false, setNotes: true, setIcons: 'still',
      widgetStyle: 'glass', widgetTint: 30, widgetBlur: 24, widgetClear: 70, widgetColor: '#1a1d2a', widgetSheen: false,
      motion: true, browserAnim: 'fade',
    },
  },
  {
    // Flat square tiles, text pivots along the top, green highlights, a white focus frame.
    id: 'dashboard-steel', name: 'Dashboard Steel', author: 'Tessera',
    defaults: {
      bg: '#171717', card: '#2b2b2b', panel: '#1f1f1f', text: '#ffffff', muted: '#a0a0a0', accent: '#107c10',
      border: '#3a3a3a', borderW: '0px', radius: '4px', shadow: 20, tabShadow: 0, selectRing: '3px',
      confirm: '#107c10', cancel: '#d13438', backdrop: 'none', selColor: 'accent', shellLayout: 'pivot', layout: 'grid', gridPreset: 'c6r3', tileGap: 40,
      setPack: true, setNotes: true, setIcons: 'still',
      widgetStyle: 'solid', widgetTint: 40, widgetBlur: 10, widgetClear: 70, widgetColor: '#2b2b2b', widgetSheen: false,
      motion: true, browserAnim: 'slide',
    },
  },
  {
    // Deep indigo, chunky glossy menu buttons down the left, a turning cube, drifting cube outlines.
    id: 'indigo-cube', name: 'Indigo Cube', author: 'Tessera',
    defaults: {
      bg: '#120b38', card: '#2c2178', panel: '#1c1352', text: '#f4f0ff', muted: '#a99fdc', accent: '#9fd8ff',
      border: '#5a4bc6', borderW: '2px', radius: '20px', shadow: 90, tabShadow: 90, selectRing: '3px',
      confirm: '#3fd38a', cancel: '#ff5c7a', backdrop: 'cubes', selColor: 'accent', shellLayout: 'cube', layout: 'grid', gridPreset: 'c4r2',
      setPack: false, setNotes: true, setIcons: 'animated',
      widgetStyle: 'glass', widgetTint: 45, widgetBlur: 20, widgetClear: 55, widgetColor: '#2c2178', widgetSheen: true,
      motion: true, browserAnim: 'flip',
    },
  },
  {
    // A white pinstriped wall of wide rounded channels, blue glow, a curved bar with the clock.
    id: 'channel-white', name: 'Channel White', author: 'Tessera',
    defaults: {
      bg: '#f3f3f3', card: '#ffffff', panel: '#e9e9e9', text: '#4a4a4a', muted: '#9b9b9b', accent: '#34beed',
      border: '#cdcdcd', borderW: '2px', radius: '20px', shadow: 25, tabShadow: 30, selectRing: '5px',
      confirm: '#34beed', cancel: '#e5484d', backdrop: 'stripes', selColor: 'accent', shellLayout: 'channel', layout: 'grid', gridPreset: 'custom', gridCols: 4, gridRows: 3, tileGap: 70,
      setPack: false, setNotes: false, setIcons: 'still',
      widgetStyle: 'solid', widgetTint: 40, widgetBlur: 10, widgetClear: 70, widgetColor: '#ffffff', widgetSheen: true,
      motion: true, browserAnim: 'zoom',
    },
  },
  {
    // Not a console: an arcade cabinet's marquee glow.
    id: 'arcade-marquee', name: 'Arcade Marquee', author: 'Tessera',
    defaults: {
      bg: '#120a1a', card: '#1e1130', panel: '#180d28', text: '#fbeaff', muted: '#b79bd6', accent: '#ff4fd8',
      border: '#ff4fd8', borderW: '2px', radius: '28px', shadow: 100, tabShadow: 100, selectRing: '5px',
      confirm: '#3ee6c7', cancel: '#ff5d6c', backdrop: 'glow', selColor: 'accent', shellLayout: 'crossbar', layout: 'grid', gridPreset: 'c5r3',
      setPack: false, setNotes: true, setIcons: 'animated',
      widgetStyle: 'glass', widgetTint: 45, widgetBlur: 20, widgetClear: 55, widgetColor: '#1e1130', widgetSheen: true,
      motion: true,
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
    { id: 'shadow', group: 'Shape', label: 'Tile shadow', type: 'range', min: 0, max: 100, step: 10, unit: '%', default: 100, var: '--shadow', scale: 0.01, hint: 'The soft shadow under tiles, strongest on the selected one' },
    { id: 'tabShadow', group: 'Shape', label: 'Tab highlight shadow', type: 'range', min: 0, max: 100, step: 10, unit: '%', default: 100, var: '--tab-shadow', scale: 0.01, hint: 'The glow and shadow around the selected tab at the top' },
    { id: 'selectRing', group: 'Shape', label: 'Selection outline', type: 'choice', default: '3px', var: '--ring',
      options: [{ label: 'None', value: '0px' }, { label: 'Thin', value: '2px' }, { label: 'Normal', value: '3px' }, { label: 'Thick', value: '5px' }] },
    { id: 'accent', group: 'Colors', label: 'Highlight color', type: 'color', default: '#7fb2ff', var: '--accent' },
    { id: 'selColor', group: 'Colors', label: 'Selector glow', type: 'choice', default: 'accent', hint: 'Random pastel gives the glow around whatever you select a new random color every time you move. Tiles and buttons keep their own colors.',
      options: [{ label: 'Highlight color', value: 'accent' }, { label: 'Random pastel', value: 'pastel' }] },
    { id: 'border', group: 'Colors', label: 'Border color', type: 'color', default: '#3b475a', var: '--border' },
    { id: 'card', group: 'Colors', label: 'Tile fill', type: 'color', default: '#1a222c', var: '--card' },
    { id: 'panel', group: 'Colors', label: 'Menu fill', type: 'color', default: '#161d27', var: '--panel' },
    { id: 'bg', group: 'Colors', label: 'Background color', type: 'color', default: '#10151c', var: '--bg' },
    { id: 'text', group: 'Colors', label: 'Text color', type: 'color', default: '#e9e4d8', var: '--text' },
    { id: 'muted', group: 'Colors', label: 'Small text color', type: 'color', default: '#8b95a3', var: '--muted' },
    { id: 'background', group: 'Background', label: 'Background picture', type: 'image', default: '', var: '--bg-image' },
    { id: 'bgDim', group: 'Background', label: 'Picture dimming', type: 'range', min: 0, max: 90, step: 10, unit: '%', default: 50, var: '--bg-dim', scale: 0.01 },
    { id: 'backdrop', group: 'Background', label: 'Backdrop effect', type: 'choice', default: 'none',
      options: [{ label: 'None', value: 'none' }, { label: 'Glow', value: 'glow' }, { label: 'Mystic', value: 'mystic' }, { label: 'Mosaic tiles', value: 'tiles' }, { label: 'Drifting cubes', value: 'cubes' }, { label: 'Pinstripes', value: 'stripes' }] },
    { id: 'confirm', group: 'Buttons', label: 'Done / Yes button color', type: 'color', default: '#3ddc97', var: '--ok' },
    { id: 'cancel', group: 'Buttons', label: 'Cancel / Close button color', type: 'color', default: '#ff6b6b', var: '--danger' },
    { id: 'shellLayout', group: 'Layout', label: 'Shell arrangement', type: 'choice', default: 'classic', hint: 'A structural preset for navigation and page framing. It does not edit your Home widgets or create arbitrary layouts.',
      options: [
        { label: 'Classic (top navigation)', value: 'classic' },
        { label: 'Bottom dock / card strip', value: 'dock' },
        { label: 'Crossbar (top categories)', value: 'crossbar' },
        { label: 'Dashboard (left sidebar)', value: 'dashboard' },
        { label: 'Home row (square tiles over round buttons)', value: 'switch' },
        { label: 'Spotlight (the selection fills the screen)', value: 'hero' },
        { label: 'Pivot (text headers over flat tiles)', value: 'pivot' },
        { label: 'Cube (chunky menu down the left)', value: 'cube' },
        { label: 'Channels (wide tiles over a curved clock bar)', value: 'channel' },
      ] },
    { id: 'partNav', group: 'Layout parts', label: 'Menu position', type: 'choice', default: 'auto', hint: 'Each part can come from a different arrangement. Auto keeps what the Shell arrangement above uses.',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Top, centered', value: 'top' }, { label: 'Top left', value: 'top-left' }, { label: 'Bottom', value: 'bottom' }, { label: 'Bottom dock', value: 'bottom-dock' }, { label: 'Curved bottom bar', value: 'bottom-bar' }, { label: 'Left sidebar', value: 'left' }] },
    { id: 'partTabs', group: 'Layout parts', label: 'Tab look', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Pills', value: 'pills' }, { label: 'Plain text', value: 'text' }, { label: 'Large text pivots', value: 'pivots' }, { label: 'Round icon buttons', value: 'round' }, { label: 'Chunky glossy buttons', value: 'chunky' }, { label: 'Full-width segments', value: 'segments' }] },
    { id: 'partClock', group: 'Layout parts', label: 'Clock', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Off', value: 'off' }, { label: 'Top corner', value: 'corner' }, { label: 'Across the top, with a profile icon', value: 'topbar' }, { label: 'In the curved bottom bar', value: 'bar' }] },
    { id: 'partFrame', group: 'Layout parts', label: 'Selection frame', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Glow', value: 'glow' }, { label: 'Frame with a gap', value: 'framed' }, { label: 'White outline', value: 'white' }, { label: 'Soft halo', value: 'halo' }] },
    { id: 'partTitle', group: 'Layout parts', label: 'Name of the selection', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Under the tiles', value: 'below' }, { label: 'Above the tiles', value: 'above' }, { label: 'Big, on the left', value: 'big' }] },
    { id: 'partTile', group: 'Layout parts', label: 'Tile shape', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Tall (box art)', value: 'portrait' }, { label: 'Square', value: 'square' }, { label: 'Wide', value: 'wide' }] },
    { id: 'partSize', group: 'Layout parts', label: 'Tile size (rows)', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Small', value: 'small' }, { label: 'Medium', value: 'medium' }, { label: 'Large', value: 'large' }] },
    { id: 'partRow', group: 'Layout parts', label: 'Row movement', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Selection stays in the middle', value: 'center' }, { label: 'Middle, other rows faded', value: 'focus' }, { label: 'Selection at the front, and it grows', value: 'start' }] },
    { id: 'partCard', group: 'Layout parts', label: 'Tile look', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Standard', value: 'standard' }, { label: 'Picture only', value: 'flat' }, { label: 'Flat with color', value: 'metro' }, { label: 'Glossy', value: 'glossy' }, { label: 'Rounded bezel', value: 'bezel' }] },
    { id: 'partSpot', group: 'Layout parts', label: 'Selection art behind everything', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Off', value: 'off' }, { label: 'On', value: 'on' }] },
    { id: 'partEmblem', group: 'Layout parts', label: 'Emblem over the menu', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'None', value: 'none' }, { label: 'Turning cube', value: 'cube' }] },
    { id: 'partHints', group: 'Layout parts', label: 'Button hints', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Centered', value: 'center' }, { label: 'Left', value: 'left' }, { label: 'Right', value: 'right' }] },
    { id: 'layout', group: 'Layout', label: 'Tile layout', type: 'choice', default: 'rails',
      options: [{ label: 'Rails (sideways, like a console)', value: 'rails' }, { label: 'Grid', value: 'grid' }, { label: 'Flow grid (scrolls up and down)', value: 'flow' }] },
    { id: 'gridPreset', group: 'Layout', label: 'Grid size (default for every page)', type: 'choice', default: 'c5r3',
      options: [
        { label: '3 × 2', value: 'c3r2' }, { label: '4 × 2', value: 'c4r2' }, { label: '5 × 3', value: 'c5r3' },
        { label: '6 × 3', value: 'c6r3' }, { label: '6 × 4', value: 'c6r4' }, { label: '8 × 4', value: 'c8r4' },
        { label: 'Custom (use the two settings below)', value: 'custom' },
      ] },
    { id: 'tileGap', group: 'Layout', label: 'Space between tiles (grid and flow)', type: 'range', min: 20, max: 240, step: 10, unit: '%', default: 100, hint: 'The same space across and down' },
    { id: 'gridCols', group: 'Layout', label: 'Custom grid: columns', type: 'range', min: 2, max: 12, step: 1, unit: '', default: 5 },
    { id: 'gridRows', group: 'Layout', label: 'Custom grid: rows on screen', type: 'range', min: 1, max: 8, step: 1, unit: '', default: 3 },
    { id: 'setPack', group: 'Settings page', label: 'Small groups side by side (grid)', type: 'toggle', default: false, hint: 'Groups that fit share a row, so Settings needs less scrolling' },
    { id: 'setNotes', group: 'Settings page', label: 'Status under every tile', type: 'toggle', default: true, hint: 'Free space, theme, PIN, controller and more' },
    { id: 'setIcons', group: 'Settings page', label: 'Icons on tiles', type: 'choice', default: 'animated',
      options: [{ label: 'Animated (the selected tile moves)', value: 'animated' }, { label: 'Still', value: 'still' }, { label: 'Off', value: 'off' }] },
    { id: 'widgetStyle', group: 'Widgets', label: 'Widget style', type: 'choice', default: 'frosted',
      options: [{ label: 'Frosted (even, like sandblasted glass)', value: 'frosted' }, { label: 'Glass (a see-through pane)', value: 'glass' }, { label: 'Outline only (see-through)', value: 'outline' }, { label: 'Solid color', value: 'solid' }] },
    { id: 'widgetTint', group: 'Widgets', label: 'Frosted: how opaque', type: 'range', min: 0, max: 100, step: 5, unit: '%', default: 55, var: '--wg-tint', scale: 0.01 },
    { id: 'widgetBlur', group: 'Widgets', label: 'Frosted: diffusion (blur)', type: 'range', min: 0, max: 40, step: 2, unit: 'px', default: 16, var: '--wg-blur' },
    { id: 'widgetClear', group: 'Widgets', label: 'Glass: transparency', type: 'range', min: 0, max: 100, step: 5, unit: '%', default: 60, var: '--wg-clear', scale: 0.01 },
    { id: 'widgetColor', group: 'Widgets', label: 'Solid color: fill', type: 'color', default: '#ffffff', var: '--wg-color' },
    { id: 'widgetSheen', group: 'Widgets', label: 'Glass: shine', type: 'toggle', default: true, var: '--wg-sheen', on: '1', off: '0' },
    { id: 'motion', group: 'Motion', label: 'Animations', type: 'toggle', default: true, var: '--motion', on: '1', off: '0', hint: 'Turn off if movement makes you dizzy' },
    { id: 'browserAnim', group: 'Motion', label: 'Browser transition', type: 'choice', default: 'slide', hint: 'How the browser comes in and goes away',
      options: [
        { label: 'Slide (from the side you came from)', value: 'slide' },
        { label: 'Zoom (grows out of the Browser tab)', value: 'zoom' },
        { label: 'Fade', value: 'fade' },
        { label: 'Rise (comes up like a sheet)', value: 'rise' },
        { label: 'Flip (turns like a card)', value: 'flip' },
        { label: 'Doors (opens from the middle)', value: 'doors' },
        { label: 'None (instant)', value: 'none' },
      ] },
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
// A theme someone is actually relying on right now: either it's the active theme (today's one
// implicit "whoever is playing"), or a profile has it as its own explicit choice. Deleting or
// renaming it then needs the PIN, same as anything else that could surprise someone mid-use.
function themeInUse(id) {
  if (activeTheme() === id) return true;
  return settings.profiles.some((p) => p.themeId === id);
}
// A free, valid folder name for a new theme, built from the name someone gave it.
function newThemeId(name) {
  const base = (clip(name, 24) || 'theme').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'theme';
  for (let i = 0; i < 1000; i++) {
    const id = i === 0 ? base : `${base}-${i}`;
    if (THEME_ID_RE.test(id) && !themes.has(id)) return id;
  }
  return null;
}
// The settings list as it actually stands right now for a theme (its resolved values, not just
// its defaults) — what "save as new" or "overwrite" should capture.
function currentThemeValues(id) {
  const out = {};
  const saved = settings.theme.values[id] || {};
  for (const d of schemaFor(id)) {
    if (d.type === 'image') continue; // a saved theme doesn't carry a picture reference yet
    const c = saved[d.id] !== undefined ? cleanValue(d, saved[d.id]) : undefined;
    out[d.id] = c === undefined ? d.default : c;
  }
  return out;
}
function writeThemeFile(id, name, defaultsObj) {
  try {
    const dir = path.join(addonDir('themes'), id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ name: clip(name, 40) || id, author: 'You', defaults: defaultsObj }, null, 2));
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save the theme." };
  }
}
function renameThemeFile(id, name) {
  const f = path.join(addonDir('themes'), id, 'theme.json');
  let m;
  try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { ok: false, error: "Couldn't read that theme." }; }
  if (!m || typeof m !== 'object') return { ok: false, error: "Couldn't read that theme." };
  m.name = clip(name, 40) || id;
  try { fs.writeFileSync(f, JSON.stringify(m, null, 2)); return { ok: true }; }
  catch { return { ok: false, error: "Couldn't rename it." }; }
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
  const themeList = [...themes.values()].map((t) => ({ id: t.id, name: t.name, author: t.author, builtin: Boolean(t.builtin) }));
  // Two themes can end up with the same display name (a duplicate save, or two downloads of the
  // same pack). Their ids are always unique; flag the name collision so the page can show a short
  // tag next to it instead of silently showing two identical-looking rows.
  const counts = {};
  for (const t of themeList) counts[t.name.toLowerCase()] = (counts[t.name.toLowerCase()] || 0) + 1;
  for (const t of themeList) t.dup = counts[t.name.toLowerCase()] > 1;
  return {
    rev: themeRev,
    active: id,
    themes: themeList,
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
const prefsPayload = () => ({ pad: { ...settings.pad }, calib: settings.calib, pageGrid: settings.pageGrid, pin: pinInfo(), vault: display(VAULT_DIR), storage: { low: lowSpace() }, calibration: calPayload(), theme: themePayload(), profiles: settings.profiles.map((p) => ({ id: p.id, name: p.name, themeId: p.themeId })) });


// ------------------------------------------------------- display calibration
// A calibration made by eye with test patterns (no measuring device), so it is
// a good correction, not a lab one. It is a few numbers, not code:
//   black    -0.10..0.10  brightness: positive darkens shadows, negative lifts them
//   white    0.80..1      highest level, below 1 gives bright detail room
//   gamma    3 x 0.6..1.6 a correction exponent per colour (1 = leave alone)
//   gain     3 x 0.85..1  white balance (only ever turns a colour down)
//   sat      0.5..1.5     saturation
// For each colour:  out = (clamp((in - black) / (1 - black)) ^ gamma) * white * gain
// The page draws it with an SVG filter. For games it can also be written as a
// ReShade shader that Gamescope loads (--reshade-effect), see tessera-session.
const CAL_RANGES = { black: [-0.1, 0.1], white: [0.8, 1], gamma: [0.6, 1.6], gain: [0.85, 1], sat: [0.5, 1.5] };
function cleanCal(c) {
  if (!c || typeof c !== 'object') return null;
  const num = (v, [lo, hi], dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 10000) / 10000)) : dflt);
  const tri = (v, r, dflt) => (Array.isArray(v) && v.length === 3 ? v.map((x) => num(x, r, dflt)) : [dflt, dflt, dflt]);
  return {
    black: num(c.black, CAL_RANGES.black, 0),
    white: num(c.white, CAL_RANGES.white, 1),
    gamma: tri(c.gamma, CAL_RANGES.gamma, 1),
    gain: tri(c.gain, CAL_RANGES.gain, 1),
    sat: num(c.sat, CAL_RANGES.sat, 1),
    enabled: c.enabled !== false,
    mode: c.mode === 'thorough' ? 'thorough' : 'quick',
    at: typeof c.at === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(c.at) ? c.at : '',
  };
}
const calIsIdentity = (c) => !c || (c.black === 0 && c.white === 1 && c.sat === 1 && c.gamma.every((g) => g === 1) && c.gain.every((g) => g === 1));
function calCurve(c, ch, x) {
  const t = Math.min(1, Math.max(0, (x - c.black) / (1 - c.black)));
  return Math.min(1, Math.pow(t, c.gamma[ch]) * c.white * c.gain[ch]);
}
const CAL_DIR = path.join(DATA_DIR, 'calibration');
const CAL_FX = path.join(CAL_DIR, 'tessera-calibration.fx');
const CAL_FAILED = path.join(path.dirname(LOG_DIR), 'calibration-failed'); // written by tessera-session if Gamescope wouldn't start with the shader
const f5 = (n) => Number(n).toFixed(5);
function calFx(c) {
  return `// Tessera display calibration. Written by Tessera (Settings > Display calibration). Don't edit.
texture2D texColor : COLOR;
sampler2D samplerColor { Texture = texColor; AddressU = Clamp; AddressV = Clamp; MinFilter = Point; MagFilter = Point; };
void PostProcessVS(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
	texcoord.x = (id == 2) ? 2.0 : 0.0;
	texcoord.y = (id == 1) ? 2.0 : 0.0;
	position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}
float4 PS_TesseraCalibration(float4 position : SV_Position, float2 texcoord : TEXCOORD) : SV_Target
{
	float3 c = tex2D(samplerColor, texcoord).rgb;
	c = saturate((c - ${f5(c.black)}) / ${f5(1 - c.black)});
	c = pow(c, float3(${c.gamma.map(f5).join(', ')}));
	c = saturate(c * ${f5(c.white)} * float3(${c.gain.map(f5).join(', ')}));
	float l = dot(c, float3(0.2126, 0.7152, 0.0722));
	c = saturate(lerp(float3(l, l, l), c, ${f5(c.sat)}));
	return float4(c, 1.0);
}
technique TesseraCalibration
{
	pass
	{
		VertexShader = PostProcessVS;
		PixelShader = PS_TesseraCalibration;
	}
}
`;
}
// Keep the shader file in step with what is saved: present only when the person turned it on.
function syncCalFx() {
  const want = settings.calibrationSystem && settings.calibration && settings.calibration.enabled && !calIsIdentity(settings.calibration);
  try {
    if (want) { fs.mkdirSync(CAL_DIR, { recursive: true }); fs.writeFileSync(CAL_FX, calFx(settings.calibration)); }
    else fs.rmSync(CAL_FX, { force: true });
  } catch { /* can't write: the page filter still works */ }
}
function calPayload() {
  const c = settings.calibration;
  const systemActive = process.env.TESSERA_CAL_SYSTEM === '1' && settings.calibrationSystem && Boolean(c && c.enabled);
  return {
    cal: c, // null = never calibrated
    system: settings.calibrationSystem,
    systemActive, // Gamescope is already applying it, so the page must not apply it a second time
    systemFailed: fs.existsSync(CAL_FAILED),
  };
}

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
// The places Tessera may browse. Looked up at most every few seconds: this is asked
// for every file it checks, and the answer almost never changes.
let browseRootsAt = 0;
let browseRootsList = [];
const browseRoots = () => {
  const now = Date.now();
  if (now - browseRootsAt > 5000) {
    browseRootsList = [os.homedir(), '/run/media', '/mnt', '/var/mnt'].map(real).filter((r) => r && isDir(r));
    browseRootsAt = now;
  }
  return browseRootsList;
};
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
  const v = real(VAULT_DIR);
  return [...(v ? [v] : []), ...(home ? [home] : []), ...driveList().map((d) => d.mount)];
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
const IMG_MAX_ART = 16 * 1024 * 1024; // bigger than this isn't a game picture. Big ones are shrunk before they reach the screen (see ART_SMALL)
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
const exists = (f) => { try { return Boolean(fs.statSync(f, { throwIfNoEntry: false })); } catch { return false; } };
const firstImage = (files) => {
  for (const f of files) {
    if (!exists(f)) continue; // nearly every guess is a miss: find out with one cheap call
    const rp = real(f);
    if (rp && underRoot(rp) && imageMime(rp)) return rp;
  }
  return null;
};
const EXTS = ['.jpg', '.png', '.jpeg', '.webp'];
// Steam keeps its pictures in appcache/librarycache. The folders are listed once
// in a while (not per game), and a game with nothing there costs nothing.
let steamIndexAt = 0;
let steamIndexList = [];
function steamBases() {
  const now = Date.now();
  if (now - steamIndexAt < 30000) return steamIndexList;
  const home = os.homedir();
  const seen = new Set();
  const list = [];
  for (const root of ['.local/share/Steam', '.steam/steam', '.steam/root', '.var/app/com.valvesoftware.Steam/.local/share/Steam']) {
    const base = path.join(home, root, 'appcache', 'librarycache');
    const rp = real(base);
    if (!rp || seen.has(rp)) continue;
    seen.add(rp);
    let names;
    try { names = fs.readdirSync(base); } catch { continue; }
    const ids = new Set();
    for (const n of names) { const m = /^(\d+)(?:_|$)/.exec(n); if (m) ids.add(m[1]); }
    list.push({ base, ids });
  }
  steamIndexAt = now;
  steamIndexList = list;
  return list;
}
function steamArt(id) {
  for (const { base, ids } of steamBases()) {
    if (!ids.has(id)) continue;
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
  if (hit && Date.now() - hit.at < (hit.file ? 600000 : 120000) && hit.custom === (item.art || '')) return hit.file;
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
// Box art is shown about 240 to 600 pixels wide, but people drop 4K pictures in. A
// 4K picture costs about 33 MB of memory once decoded, so a screenful of them
// stalls the screen. Pictures bigger than ART_SMALL are shrunk once, kept in the
// cache folder, and that copy is served. Anything that goes wrong serves the original.
const ART_SMALL = 400 * 1024;
const ART_FIT = { w: 600, h: 900 }; // the size of Steam's own box art: plenty for a 4K screen
const artThumbDir = () => path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'tessera', 'art');
const thumbBad = new Set(); // pictures that couldn't be shrunk: don't keep trying
let thumbQueue = Promise.resolve();
function makeThumb(file, st, key) {
  const native = require('electron').nativeImage;
  if (!native) return null;
  let img = native.createFromPath(file);
  if (!img || img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const scale = Math.min(1, ART_FIT.w / width, ART_FIT.h / height);
  if (scale < 1) img = img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' });
  // JPEG is much smaller and quicker to decode, but can't keep see-through corners.
  const px = img.toBitmap();
  let alpha = false;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) { alpha = true; break; }
  const out = alpha ? { ext: '.png', buf: img.toPNG() } : { ext: '.jpg', buf: img.toJPEG(88) };
  if (!out.buf || !out.buf.length || out.buf.length >= st.size) return null; // no smaller: keep the original
  const dir = artThumbDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, key + out.ext);
  const tmp = dest + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, out.buf);
  fs.renameSync(tmp, dest);
  return dest;
}
// The file to serve for a picture: its shrunken copy if it has one, else the original.
function artFile(file) {
  let st;
  try { st = fs.statSync(file); } catch { return Promise.resolve(file); }
  if (st.size <= ART_SMALL) return Promise.resolve(file);
  const key = crypto.createHash('sha1').update(`${file}\0${st.size}\0${st.mtimeMs}`).digest('hex').slice(0, 24);
  const dir = artThumbDir();
  for (const ext of ['.jpg', '.png']) {
    const hit = path.join(dir, key + ext);
    if (exists(hit)) return Promise.resolve(hit);
  }
  if (thumbBad.has(key)) return Promise.resolve(file);
  // One at a time, so a screenful of new pictures never blocks the whole launcher at once.
  const job = thumbQueue.then(() => new Promise((resolve) => setImmediate(() => {
    let out = null;
    try { out = makeThumb(file, st, key); } catch { out = null; }
    if (!out) thumbBad.add(key);
    resolve(out || file);
  })));
  thumbQueue = job.catch(() => {});
  return job;
}
async function serveArtAsync(id) {
  const notFound = { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not found' };
  const item = itemById(id);
  const file = item && resolveArt(item);
  const mime = file && imageMime(file);
  if (!mime) return notFound;
  const use = await artFile(file);
  const useMime = use === file ? mime : path.extname(use) === '.png' ? 'image/png' : 'image/jpeg';
  let body;
  try { body = await fs.promises.readFile(use); } catch { return notFound; }
  // The address carries ?v=<artRev>, which changes whenever a picture does, so it is safe to remember for a while.
  return { status: 200, headers: { 'Content-Type': useMime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=600' }, body };
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
      ...(real(VAULT_DIR) ? [{ name: 'Tessera folder', sub: display(VAULT_DIR), isDir: true, full: real(VAULT_DIR) }] : []),
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
    } else if (file && !['addRoot', 'backupTo', 'restoreFrom'].includes(b.purpose)) {
      try { fs.accessSync(full, fs.constants.X_OK); } catch { continue; }
      rows.push({ name: e.name, isDir: false, full });
    }
  }
  rows.sort((a, c) => (a.isDir === c.isDir ? a.name.localeCompare(c.name) : a.isDir ? -1 : 1));
  b.entries = rows.slice(0, BROWSE_MAX);
  return {
    crumb: friendly(b.dir).name,
    canUp: true,
    canChooseHere: ['addRoot', 'backupTo', 'restoreFrom'].includes(b.purpose),
    entries: pub(),
    truncated: rows.length > BROWSE_MAX,
  };
}

function browseOp(op, p) {
  if (op === 'start') {
    if (!['addGame', 'addApp', 'addRoot', 'pickImage', 'pickArt', 'backupTo', 'restoreFrom'].includes(p.purpose)) return { error: 'Bad request.' };
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
    if (browse.purpose === 'backupTo' || browse.purpose === 'restoreFrom') {
      const rp = browse.dir && real(browse.dir);
      if (!rp || !underRoot(rp)) return { error: 'Pick a folder first.' };
      const which = browse.purpose;
      browse = null;
      return which === 'backupTo' ? makeBackup(rp) : restoreBackup(rp);
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
//   packs/<id>/addon.json + addon.sig?    real code — see below; everything else here is DATA
//
// Widgets, themes, art, fonts and sounds are DATA. Tessera never runs code from those folders
// in its own process — a widget's page runs in a sandboxed frame with no network access, and a
// theme can only set values from a fixed whitelist.
//
// Shards (the 'packs' dir/key below — "Shards" is just the user-facing name) are the one
// exception: a shard IS code, with Tessera's own level of system access, by design — that's the
// whole point of one (see tools/README.md and addon-verify.js). Whether a shard is signed by the
// project ("Official") only says whose bytes they are, never whether they're safe to run; what
// actually happens with a dropped-in shard is the owner's own call, through settings.codeAddons
// (pinRequired / allowUnverified) above. Loading and running a shard's code is not wired up yet
// — right now this folder is reserved and scanned for listing only, nothing in it is require()'d.

const ADDON_DIRS = ['widgets', 'themes', 'art', 'fonts', 'sounds', 'packs'];
const WIDGET_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const WIDGET_MAX_FILE = 5 * 1024 * 1024;
// ------------------------------------------------------- the Tessera folder
// One folder (~/Tessera) holds what Tessera keeps: games, apps, themes, widgets,
// pictures and downloads. People can add their own folders inside it. Tessera
// itself only ever deletes things *inside* these folders, never the folders
// themselves, so nothing the system expects to find can be removed from here.
const VAULT_DIR = process.env.TESSERA_VAULT_DIR || path.join(process.env.TESSERA_DATA_DIR ? DATA_DIR : os.homedir(), 'Tessera');
const VAULT_FOLDERS = { games: 'Games', apps: 'Apps', themes: 'Themes', widgets: 'Widgets', art: 'Pictures', fonts: 'Fonts', sounds: 'Sounds', downloads: 'Downloads', packs: 'Shards' };
const addonDir = (name) => path.join(VAULT_DIR, VAULT_FOLDERS[name] || name);
const vaultFolder = (key) => path.join(VAULT_DIR, VAULT_FOLDERS[key]);
// Is this real path inside the Tessera folder? With strict, the folder itself and
// its fixed top-level folders don't count (those can never be deleted or renamed).
function inVault(rp, strict = false) {
  const v = real(VAULT_DIR);
  if (!v || !rp) return false;
  if (!(rp === v || rp.startsWith(v + path.sep))) return false;
  if (!strict) return true;
  return rp !== v && !Object.values(VAULT_FOLDERS).some((f) => rp === path.join(v, f));
}
// Delete something inside the Tessera folder (and only there).
function vaultDelete(target) {
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) { // a shortcut: remove the shortcut, never what it points to
      const dir = real(path.dirname(target));
      if (!dir || !inVault(path.join(dir, path.basename(target)), true)) return { ok: false, error: "That isn't inside your Tessera folder." };
      fs.unlinkSync(target);
      return { ok: true };
    }
    const rp = real(target);
    if (!rp || !inVault(rp, true)) return { ok: false, error: "That isn't inside your Tessera folder." };
    if (fs.statSync(rp).dev !== fs.statSync(real(VAULT_DIR)).dev) return { ok: false, error: "That is on another drive." };
    fs.rmSync(rp, { recursive: true, force: true });
    sizeCache.clear();
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't delete that." };
  }
}
// What "delete the files" means for a game or app: its own folder under Games or
// Apps (or the file itself if it sits straight in there). Null if it lives anywhere else.
const vaultRoots = () => ['games', 'apps'].map((key) => real(vaultFolder(key))).filter(Boolean);
function itemDeleteTarget(item, roots = vaultRoots()) {
  if (!roots.length) return null; // no Tessera folder yet: nothing in it to delete
  // Most games live elsewhere. Skip the (slow) path resolution unless the path starts in the Tessera folder.
  const raw = ['games', 'apps'].map((key) => vaultFolder(key));
  if (![...raw, ...roots].some((r) => item.path.startsWith(r + path.sep))) return null;
  const rp = real(item.path);
  if (!rp) return null;
  for (const root of roots) {
    if (rp.startsWith(root + path.sep)) return path.join(root, path.relative(root, rp).split(path.sep)[0]);
  }
  return null;
}
function migrateAddonDirs() {
  for (const d of ADDON_DIRS) {
    const old = path.join(DATA_DIR, d);
    const dest = addonDir(d);
    if (old === dest || !isDir(old)) continue;
    try {
      fs.mkdirSync(dest, { recursive: true });
      for (const name of fs.readdirSync(old)) {
        if (name === 'README.txt') { try { fs.unlinkSync(path.join(old, name)); } catch { /* ignore */ } continue; }
        const to = path.join(dest, name);
        if (fs.existsSync(to)) continue;
        try { fs.renameSync(path.join(old, name), to); }
        catch { fs.cpSync(path.join(old, name), to, { recursive: true }); fs.rmSync(path.join(old, name), { recursive: true, force: true }); }
      }
      try { fs.rmdirSync(old); } catch { /* something is left there: fine */ }
    } catch { /* leave it where it is */ }
  }
}

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
The frame is transparent: Tessera draws the widget's pane (glass, frosted,
outline or solid, chosen in Theme Settings) behind it, so the pane only shows
where your page leaves empty space. Leave your page background transparent to
let it through, or paint your own background to cover the pane.
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
Widget panes: set "widgetStyle" in defaults to "frosted", "glass", "outline"
or "solid", plus "widgetTint" (frosted opacity, 0-100), "widgetBlur" (0-40),
"widgetClear" (glass transparency, 0-100) and "widgetColor".
Tile layout: "layout" is "rails", "grid" or "flow"; "gridPreset" is like "c5r3".
Shell arrangement: "shellLayout" is "classic", "dock", "crossbar", "dashboard", "switch", "hero", "pivot", "cube" or "channel". Single parts can be set too: "partNav", "partTabs", "partClock", "partFrame", "partTitle", "partTile", "partSize", "partRow", "partCard", "partSpot", "partEmblem", "partHints" (each "auto" or one of its listed values).
This repositions approved navigation/content regions; it is not a freeform layout editor.
Home widget coordinates are preserved when switching shell arrangements.
Backdrop: "backdrop" is "none", "glow", "mystic" or "tiles" (the Mosaic tile field).
Selector glow: "selColor": "pastel" gives the glow around the selected tile, tab, menu row
or key a new random pastel every time the selector moves (fills keep their own colors;
the default, "accent", keeps one glow color: the highlight color).
Switch themes in Settings > Add-ons > Themes. Changes show in Settings > Theme Settings.
`,
  packs: `One folder per shard, with an addon.json inside. Unlike a theme or a widget, a shard
is real code with Tessera's own level of system access — it is not sandboxed and it is not
checked for safety by the folder name or by being here at all.

  my-shard/
    addon.json
    addon.sig     (only on shards signed by the Tessera project — see below)
    ...whatever the shard's own entry file needs

addon.json:
  {
    "id": "my-shard",
    "name": "My Shard",
    "author": "You",
    "version": "1.0.0",
    "description": "What it does",
    "entry": "index.js"
  }

"Official" means Tessera's own signing key actually signed these exact files (see
tools/README.md in the project repo) — it says whose bytes these are, nothing more. A missing
or non-matching addon.sig just means "unverified," not "broken" or "unsafe": whether an
unverified shard is allowed to run at all is your own call, in Settings > Add-ons > Shards.
Settings > Add-ons > Shards is also where installing or removing a shard can be asked to need
the PIN, same as everywhere else that only matters once you've set one.
`,
};

function ensureTree() {
  for (const f of Object.values(VAULT_FOLDERS)) {
    try { fs.mkdirSync(path.join(VAULT_DIR, f), { recursive: true }); } catch { /* read-only: skip */ }
  }
  migrateAddonDirs();
  try {
    const f = path.join(VAULT_DIR, 'README.txt');
    if (!fs.existsSync(f)) fs.writeFileSync(f, `This is the Tessera folder. Tessera keeps what it manages in here:

  Games, Apps       games and apps you install or download for Tessera
  Themes, Widgets   add-ons (see the README inside each)
  Pictures          game pictures and backgrounds
  Fonts, Sounds     for themes that use them
  Downloads         what the built-in browser saves, until you file it

Make your own folders inside any of these. The folders listed above can't be
renamed or deleted from Tessera, because Tessera expects to find them.
`);
  } catch { /* ignore */ }
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
  scanPacks(); // every place that rescans widgets rescans packs too, so the two never drift apart
}

let packs = new Map();  // id -> { dir, manifest, official, reason } — see addon-verify.js for official/reason
let rejectedPacks = []; // [{ id, reason }], same idea as rejected (widgets) above

function readPackManifest(dir) {
  const file = path.join(dir, 'addon.json');
  let st;
  try { st = fs.statSync(file); } catch { return { reason: 'no addon.json' }; }
  if (!st.isFile() || st.size > 16 * 1024) return { reason: 'addon.json is not a small file' };
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { reason: 'addon.json is not valid JSON' }; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { reason: 'addon.json has the wrong shape' };
  const name = cleanTitle(m.name);
  if (!name) return { reason: 'needs a "name"' };
  const entry = m.entry;
  if (typeof entry !== 'string' || !entry || entry.startsWith('/') || entry.split(/[\\/]/).includes('..'))
    return { reason: '"entry" must be a relative file inside the pack' };
  const opt = (v, max) => (typeof v === 'string' ? cleanTitle(v, max) || '' : '');
  return { manifest: { name, description: opt(m.description, 160), author: opt(m.author, 60), version: opt(m.version, 20), entry } };
}

// Lists what's in the Shards folder and whether each one is genuinely signed by the project.
// This only discovers and describes shards — nothing here loads or runs a single line of a
// shard's own code; that comes later, gated by settings.codeAddons.
function scanPacks() {
  packs = new Map();
  rejectedPacks = [];
  let names = [];
  try { names = fs.readdirSync(addonDir('packs'), { withFileTypes: true }); } catch { /* none yet */ }
  for (const e of names) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue;
    if (!WIDGET_ID_RE.test(e.name)) {
      rejectedPacks.push({ id: e.name, reason: 'folder name must be lowercase letters, numbers, . _ -' });
      continue;
    }
    const dir = path.join(addonDir('packs'), e.name);
    const r = readPackManifest(dir);
    if (r.reason) { rejectedPacks.push({ id: e.name, reason: r.reason }); continue; }
    const entryFile = path.join(dir, r.manifest.entry);
    const rp = real(entryFile);
    const base = real(dir);
    if (!rp || !base || !rp.startsWith(base + path.sep) || !fs.statSync(rp).isFile()) {
      rejectedPacks.push({ id: e.name, reason: `"${r.manifest.entry}" was not found inside the folder` });
      continue;
    }
    const v = verifyAddon(dir);
    packs.set(e.name, { dir, manifest: r.manifest, official: v.official, reason: v.reason });
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
      id, type: 'widget:' + id, name: w.manifest.name, description: w.manifest.description,
      author: w.manifest.author, size: w.manifest.size, min: w.manifest.min, max: w.manifest.max, resizable: w.manifest.resizable,
    })),
    rejected,
    dirs: Object.fromEntries(ADDON_DIRS.map((d) => [d, display(addonDir(d))])),
    themeCount: countDirs('themes'),
    themes: [...themes.values()].filter((t) => !t.builtin).map((t) => ({ id: t.id, name: t.name, author: t.author, settings: t.extra.length })),
    // Every theme, builtin and custom together — used by the Add-ons > Themes switcher, which
    // (unlike the remove-a-theme list above) needs to offer every factory theme too, not just
    // the ones you could delete.
    allThemes: [...themes.values()].map((t) => ({ id: t.id, name: t.name, author: t.author, builtin: Boolean(t.builtin) })),
    packs: [...packs].map(([id, p]) => ({
      id, name: p.manifest.name, description: p.manifest.description, author: p.manifest.author, version: p.manifest.version,
      official: p.official, reason: p.reason,
    })),
    rejectedPacks,
    codeAddons: { pinRequired: settings.codeAddons.pinRequired, allowUnverified: settings.codeAddons.allowUnverified },
  };
}

// ----------------------------------------------------------------- window

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// The background colour of the saved theme, read straight from the settings file (nothing
// else is loaded yet), so a light theme doesn't flash dark before the page draws.
function savedBackground() {
  try {
    const d = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const id = d && d.theme && typeof d.theme.active === 'string' ? d.theme.active : 'stock';
    const own = d && d.theme && d.theme.values && d.theme.values[id] && d.theme.values[id].bg;
    if (typeof own === 'string' && HEX_RE.test(own)) return own;
    const b = BUILTIN_THEMES.find((t) => t.id === id);
    if (b && HEX_RE.test(b.defaults.bg)) return b.defaults.bg;
  } catch { /* first start */ }
  return '#10151c';
}
function createGuideWindow() {
  const { screen } = require('electron');
  const area = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({
    x: area.x, y: area.y, width: area.width, height: area.height,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: DEV },
  });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.loadFile('index.html', { query: { guide: '1' } });
  mainWindow.webContents.on('did-finish-load', () => {
    ensureTree(); scanAddons(); scanThemes(); loadState(); loadSettings();
    send('init', buildView());
  });
  mainWindow.on('blur', () => { if (guideHelperShown) send('guide', { action: 'blur' }); });
}
let guideHelperShown = false;
// Is the Tessera launcher itself running (nested over the desktop, say)? Then it handles Guide.
function launcherRunning() {
  try {
    const pid = Number(fs.readFileSync(LAUNCHER_PID_FILE, 'utf8').trim());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}
// Steam on the desktop takes the Guide button for itself (Big Picture). Two menus at once is worse
// than one, so by default the helper steps aside while Steam is running.
function steamRunning() {
  try {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      let comm = '';
      try { comm = fs.readFileSync(`/proc/${d}/comm`, 'utf8').trim(); } catch { continue; }
      if (comm === 'steam' || comm === 'steamwebhelper') return true;
    }
  } catch { /* can't tell */ }
  return false;
}
function createWindow() {
  if (GUIDE_ONLY) return createGuideWindow();
  try { fs.mkdirSync(path.dirname(LAUNCHER_PID_FILE), { recursive: true }); fs.writeFileSync(LAUNCHER_PID_FILE, String(process.pid)); } catch { /* the helper just won't know */ }
  app.on('will-quit', () => { try { if (fs.readFileSync(LAUNCHER_PID_FILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(LAUNCHER_PID_FILE); } catch { /* gone */ } });
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: savedBackground(),
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
  mainWindow.on('resize', fitBrowserView);
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
      leaveTessera();
    } else if (!DEV && (input.key === 'F12' || (input.control && input.shift && /^[ijc]$/i.test(input.key)) || (input.control && /^[rw]$/i.test(input.key)) || input.key === 'F5' || (input.alt && input.key === 'F4'))) {
      event.preventDefault(); // no inspector, reload or close
    }
  });
}

// The helper keeps its own browser profile, so it never blocks or shares the launcher's single-instance lock.
if (GUIDE_ONLY) app.setPath('userData', path.join(app.getPath('userData'), 'guide'));
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // the default menu carries Reload and Toggle DevTools
    protocol.handle(ART_SCHEME, async (req) => {
      try {
        const m = /^\/([^/]+)$/.exec(new URL(req.url).pathname);
        const r = await serveArtAsync(m ? decodeURIComponent(m[1]) : '');
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
    if (!GUIDE_ONLY) watchDrives();
    padsCtl.start();
    if (GUIDE_ONLY) padsCtl.pause(); // Nintendo pads are read only while the guide is up
    guideWatch = watchGuideButtons();
  });
}

// ------------------------------------------------------------------ storage
// Drives, how full they are, what's using the space, and housekeeping. Sizes
// come from walking folders (never following shortcuts) and are cached for a
// while, so opening Storage twice is quick. Nothing here takes a path from the
// page: it names drives, games and choices, and this file resolves them.
const GB = 1024 ** 3;
const LOW_SPACE = { pct: 10, bytes: 10 * GB };
const EXTERNAL_PREFIXES = ['/run/media/', '/media/', '/mnt/', '/var/mnt/'];
const isMountedDir = (d) => {
  try { return fs.statSync(d).dev !== fs.statSync(path.dirname(d)).dev; } catch { return false; }
};
// Why can't this game's file be found? 'drive' = its drive isn't plugged in, 'missing' = the file is gone.
function offlineKind(it) {
  try { fs.accessSync(it.path); return null; } catch { /* not there */ }
  for (const pre of EXTERNAL_PREFIXES) {
    if (!it.path.startsWith(pre)) continue;
    const segs = it.path.slice(pre.length).split('/');
    const depth = pre === '/run/media/' || pre === '/media/' ? 2 : 1; // /run/media/<user>/<label>
    if (segs.length > depth) {
      const root = pre + segs.slice(0, depth).join('/');
      if (!isDir(root) || !isMountedDir(root)) return 'drive';
    }
  }
  return 'missing';
}
function allMounts() {
  const out = [];
  try {
    for (const line of fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n')) {
      const [left, right] = line.split(' - ');
      if (!right) continue;
      const mp = unescapeMount(left.split(' ')[4] || '');
      const [fstype, source] = right.split(' ');
      if (mp) out.push({ mount: mp, fstype, source: source || '' });
    }
  } catch { /* no mountinfo */ }
  return out;
}
// The drive a path lives on: the longest mount folder that contains it.
function mountOf(rp) {
  let best = null;
  for (const m of allMounts()) {
    if (rp === m.mount || m.mount === '/' || rp.startsWith(m.mount + path.sep)) {
      if (!best || m.mount.length > best.mount.length) best = m;
    }
  }
  return best;
}
const driveHasLibrary = (mount) => settings.scanRoots.some((r) => { const rp = real(r) || r; return rp === mount || rp.startsWith(mount + path.sep); });
const isRemovable = (source) => {
  try {
    const base = path.basename(source);
    const sys = fs.realpathSync('/sys/class/block/' + base);
    const parent = sys.includes('/block/') ? path.basename(path.dirname(sys)) : base;
    const dev = /^(sd[a-z]+|nvme\d+n\d+|mmcblk\d+|vd[a-z]+)/.exec(parent);
    const disk = dev ? dev[1] : parent;
    return fs.readFileSync(`/sys/block/${disk}/removable`, 'utf8').trim() === '1' || fs.realpathSync(`/sys/block/${disk}`).includes('/usb');
  } catch { return false; }
};
// Every drive worth showing: the one holding Tessera's folder, plugged-in drives, and any drive holding a library folder.
function storageDrives(includeHidden = false) {
  const out = new Map(); // mount -> info
  const labels = lsblkLabels();
  const named = driveList();
  const put = (mount, source, extra = {}) => {
    if (!mount || out.has(mount)) return;
    let st;
    try { st = fs.statfsSync(mount); } catch { return; }
    const total = st.blocks * st.bsize;
    if (!total) return;
    const info = labels.get(source) || {};
    const nd = named.find((d) => d.mount === mount);
    const key = nd ? nd.key : (info.uuid || 'dir:' + mount);
    const name = settings.driveNames[key] || (nd && nd.name) || info.label || extra.fallbackName || path.basename(mount) || 'Drive';
    out.set(mount, {
      key, mount, name, source, total,
      free: st.bavail * st.bsize,
      used: Math.max(0, (st.blocks - st.bfree) * st.bsize),
      external: Boolean(nd), system: Boolean(extra.system),
      removable: isRemovable(source),
      ejectable: Boolean(nd) && ['/run/media/', '/media/'].some((p) => mount.startsWith(p)),
      library: driveHasLibrary(mount),
      hidden: settings.hiddenDrives.includes(key),
      muted: settings.mutedDrives.includes(key),
    });
  };
  const v = real(VAULT_DIR);
  const vm = v && mountOf(v);
  if (vm) put(vm.mount, vm.source, { system: true, fallbackName: 'Main storage' });
  for (const d of named) { if (!isMountedDir(d.mount)) continue; const s = mountSources().get(d.mount); put(d.mount, s ? s.source : '', {}); }
  for (const r of settings.scanRoots) { const rp = real(r); const m = rp && mountOf(rp); if (m) put(m.mount, m.source, { fallbackName: 'Drive' }); }
  return [...out.values()].filter((d) => includeHidden || !d.hidden);
}
let lowCache = { at: 0, list: [] };
function lowSpace() {
  if (Date.now() - lowCache.at < 30000) return lowCache.list;
  let list = [];
  try {
    list = storageDrives()
      .filter((d) => !d.muted && d.free < LOW_SPACE.bytes || d.free / d.total < LOW_SPACE.pct / 100)
      .map((d) => ({ name: d.name, free: d.free }));
  } catch { /* skip */ }
  lowCache = { at: Date.now(), list };
  return list;
}

// ---- sizes
const sizeCache = new Map(); // folder -> { bytes, at }
const SIZE_TTL = 10 * 60 * 1000;
async function dirSize(dir, deadline) {
  const hit = sizeCache.get(dir);
  if (hit && Date.now() - hit.at < SIZE_TTL) return hit.bytes;
  let bytes = 0;
  try {
    const top = await fs.promises.lstat(dir);
    if (!top.isDirectory()) { // a single file
      bytes = top.isFile() ? top.blocks * 512 : 0;
      sizeCache.set(dir, { bytes, at: Date.now() });
      return bytes;
    }
  } catch { return 0; }
  const stack = [dir];
  while (stack.length) {
    if (Date.now() > deadline) return null;
    const d = stack.pop();
    let ents;
    try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
    await Promise.all(ents.map(async (e) => {
      const f = path.join(d, e.name);
      try {
        if (e.isDirectory()) stack.push(f);
        else if (e.isFile()) { const st = await fs.promises.lstat(f); bytes += st.blocks * 512; }
      } catch { /* vanished */ }
    }));
  }
  sizeCache.set(dir, { bytes, at: Date.now() });
  return bytes;
}
const cachedSize = (dir) => { const h = sizeCache.get(dir); return h && Date.now() - h.at < SIZE_TTL ? h.bytes : null; };
// The folder that holds all of a game: its own folder in Games/Apps, a Steam game's folder, or the first folder under a library folder.
function gameDir(it) {
  const rp = real(it.path);
  if (!rp) return null;
  const t = itemDeleteTarget(it);
  if (t) return t;
  for (const root of settings.scanRoots) {
    const r = real(root);
    if (!r || !rp.startsWith(r + path.sep)) continue;
    const segs = path.relative(r, rp).split(path.sep);
    if (segs[0] === 'steamapps' && segs[1] === 'common' && segs.length > 3) return path.join(r, 'steamapps', 'common', segs[2]);
    return segs.length > 1 ? path.join(r, segs[0]) : rp; // a file straight in the library folder is just itself
  }
  // A game added as a single file: its folder, unless that folder is a broad one (Home, Downloads, /usr…).
  const dir = path.dirname(rp);
  const home = real(os.homedir());
  const broad = dir === home || dir === '/' || dir.split(path.sep).filter(Boolean).length <= 2 ||
    /^\/(usr|bin|sbin|etc|lib|lib64|opt|var\/lib|app)(\/|$)/.test(dir) ||
    (home && path.dirname(dir) === home && ['Downloads', 'Documents', 'Desktop', 'Pictures', 'Music', 'Videos'].includes(path.basename(dir)));
  return broad ? rp : dir;
}
async function gameSizes(deadline) {
  const rows = [];
  const dirs = new Map();
  for (const it of state.items) {
    const off = offlineKind(it);
    const dir = off ? null : gameDir(it);
    rows.push({ it, off, dir });
    if (dir) dirs.set(dir, null);
  }
  let partial = false;
  for (const dir of dirs.keys()) {
    const b = await dirSize(dir, deadline);
    if (b === null) partial = true; else dirs.set(dir, b);
  }
  return { rows, dirs, partial };
}
const VAULT_LABELS = { games: 'Games', apps: 'Apps', themes: 'Themes', widgets: 'Widgets', art: 'Pictures', fonts: 'Fonts', sounds: 'Sounds', downloads: 'Downloads' };

async function storageOverview(measure) {
  const deadline = Date.now() + (measure ? 25000 : -1);
  const drives = storageDrives();
  const byMount = new Map(drives.map((d) => [d.mount, { ...d, games: 0, tessera: 0 }]));
  let partial = false;
  // games and apps, counted once per folder
  const gs = measure ? await gameSizes(deadline) : null;
  const counted = new Set();
  const vaultReal = real(VAULT_DIR);
  let gamesInVault = 0;
  if (gs) {
    partial = partial || gs.partial;
    for (const [dir, b] of gs.dirs) {
      if (b === null) continue;
      const m = mountOf(dir);
      const d = m && byMount.get(m.mount);
      if (!d || counted.has(dir)) continue;
      counted.add(dir);
      d.games += b;
      if (vaultReal && (dir === vaultReal || dir.startsWith(vaultReal + path.sep))) gamesInVault += b;
    }
  }
  // the Tessera folder, by sub-folder
  const vault = [];
  let vaultBytes = 0;
  if (vaultReal) {
    for (const [key, label] of Object.entries(VAULT_LABELS)) {
      const dir = path.join(vaultReal, VAULT_FOLDERS[key]);
      const b = measure ? await dirSize(dir, deadline) : cachedSize(dir);
      if (b === null) { partial = true; continue; }
      vault.push({ key, name: label, bytes: b });
      vaultBytes += b;
    }
    const vm = mountOf(vaultReal);
    const d = vm && byMount.get(vm.mount);
    if (d) d.tessera = Math.max(0, vaultBytes - gamesInVault);
  }
  return {
    ok: true, partial, measured: Boolean(measure),
    drives: [...byMount.values()].map((d) => ({
      key: d.key, name: d.name, total: d.total, free: d.free, used: d.used, games: d.games, tessera: d.tessera,
      external: d.external, system: d.system, ejectable: d.ejectable, library: d.library, muted: d.muted,
    })),
    vault: { path: display(VAULT_DIR), bytes: vaultBytes, parts: vault },
    hiddenCount: storageDrives(true).filter((d) => d.hidden).length,
    install: (() => { const t = installTarget(); return t ? friendly(t).name : ''; })(),
    low: lowSpace(),
  };
}
async function storageGames(measure) {
  const gs = await gameSizes(Date.now() + (measure ? 25000 : -1));
  const games = gs.rows.map(({ it, off, dir }) => {
    const m = dir && mountOf(dir);
    const dr = m && storageDrives().find((d) => d.mount === m.mount);
    return {
      id: it.id, title: it.title, kind: it.kind,
      bytes: dir ? gs.dirs.get(dir) : null,
      offline: off, drive: dr ? dr.name : '', deletable: Boolean(itemDeleteTarget(it)),
    };
  }).sort((a, b) => (b.bytes || 0) - (a.bytes || 0) || a.title.localeCompare(b.title));
  return { ok: true, games, partial: gs.partial };
}

// ---- install location, downloads
function installChoices() {
  const g = real(vaultFolder('games'));
  const roots = [...(g ? [g] : []), ...settings.scanRoots.map((r) => real(r)).filter((r) => r && r !== g && isDir(r))];
  return roots;
}
function installTarget() {
  const r = settings.installRoot && real(settings.installRoot);
  if (r && isDir(r) && installChoices().includes(r)) return r;
  return real(vaultFolder('games'));
}
function installView() {
  const cur = installTarget();
  const drives = storageDrives();
  return installChoices().map((r) => {
    const m = mountOf(r);
    const d = m && drives.find((x) => x.mount === m.mount);
    return { name: friendly(r).name, free: d ? d.free : null, current: r === cur };
  });
}
async function downloadsInfo() {
  const dir = real(vaultFolder('downloads'));
  if (!dir) return { ok: true, path: '', bytes: 0, count: 0 };
  let count = 0;
  try { count = fs.readdirSync(dir).filter((n) => n !== 'README.txt').length; } catch { /* ignore */ }
  sizeCache.delete(dir);
  const b = await dirSize(dir, Date.now() + 15000);
  return { ok: true, path: display(dir), bytes: b || 0, count };
}
function clearDownloads() {
  const dir = real(vaultFolder('downloads'));
  if (!dir) return { ok: false, error: 'No Downloads folder.' };
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'README.txt') continue;
    if (vaultDelete(path.join(dir, name)).ok) n++;
  }
  sizeCache.clear();
  return { ok: true, message: n ? `Cleared ${n} item${n === 1 ? '' : 's'} from Downloads.` : 'Downloads was already empty.' };
}

// ---- drives: use for games, ignore, eject, and the new-drive watcher
const LIB_FOLDER_NAMES = ['Games', 'games', 'SteamLibrary'];
function useDriveForGames(key) {
  const d = driveList().find((x) => x.key === key);
  if (!d) return { ok: false, error: "That drive isn't connected." };
  let added = [];
  const existing = LIB_FOLDER_NAMES.map((n) => path.join(d.mount, n)).filter(isDir);
  const targets = existing.length ? existing : [path.join(d.mount, 'Games')];
  for (const t of targets) {
    try { fs.mkdirSync(t, { recursive: true }); } catch { return { ok: false, error: "Couldn't use this drive. Is it read-only?" }; }
    const rp = real(t);
    if (rp && !settings.scanRoots.includes(rp)) { settings.scanRoots.push(rp); added.push(rp); }
  }
  saveSettings();
  lowCache.at = 0;
  return { ok: true, message: added.length ? `${d.name} is now a game library.` : `${d.name} is already a game library.` };
}
function sysfsParent(source) {
  const base = path.basename(source);
  try {
    const sys = fs.realpathSync('/sys/class/block/' + base);
    return sys.includes('/block/') && path.basename(path.dirname(sys)) !== 'block' ? path.basename(path.dirname(sys)) : base;
  } catch { return base; }
}
const runTool = (file, args) => new Promise((resolve) => {
  execFile(file, args, { timeout: 20000, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() }));
});
async function ejectDrive(key) {
  if (running) return { ok: false, error: 'Close the game first.' };
  const d = storageDrives().find((x) => x.key === key);
  if (!d || !d.ejectable) return { ok: false, error: d ? 'Only plugged-in drives can be ejected.' : "That drive isn't connected." };
  const home = real(os.homedir()); const v = real(VAULT_DIR);
  if ((home && (home === d.mount || home.startsWith(d.mount + path.sep))) || (v && v.startsWith(d.mount + path.sep))) return { ok: false, error: 'Tessera is using that drive.' };
  if (!/^\/dev\/[A-Za-z0-9]+$/.test(d.source)) return { ok: false, error: "Can't eject that." };
  const u = await runTool('udisksctl', ['unmount', '-b', d.source]);
  if (!u.ok) return { ok: false, error: /busy/i.test(u.out) ? 'Something is still using it. Close what is open from that drive and try again.' : "Couldn't eject it." };
  if (d.removable) await runTool('udisksctl', ['power-off', '-b', '/dev/' + sysfsParent(d.source)]);
  lowCache.at = 0; sizeCache.clear();
  return { ok: true, message: `${d.name} can be unplugged now.` };
}
let knownDrives = null;
let driveTimer = null;
function watchDrives() {
  const tick = () => {
    if (running) return;
    let list;
    try { list = driveList(); } catch { return; }
    const keys = new Set(list.map((d) => d.key));
    if (knownDrives) {
      let changed = knownDrives.size !== keys.size || [...keys].some((k) => !knownDrives.has(k));
      for (const d of list) {
        if (knownDrives.has(d.key) || settings.ignoredDrives.includes(d.key) || settings.hiddenDrives.includes(d.key) || driveHasLibrary(d.mount)) continue;
        let st; try { st = fs.statfsSync(d.mount); } catch { continue; }
        send('drive-added', { key: d.key, name: d.name, free: st.bavail * st.bsize, total: st.blocks * st.bsize });
      }
      if (changed) { lowCache.at = 0; send('init', buildView()); }
    }
    knownDrives = keys;
  };
  tick();
  driveTimer = setInterval(tick, 5000);
  if (driveTimer.unref) driveTimer.unref();
}

// ---- cleanup
function cleanScan() {
  const broken = []; const dupes = []; const seen = new Map();
  for (const it of state.items) {
    if (offlineKind(it) === 'missing') broken.push(it.id);
    const key = (real(it.path) || it.path) + '\0' + JSON.stringify(it.args || []);
    if (seen.has(key)) dupes.push({ id: it.id, keep: seen.get(key) }); else seen.set(key, it.id);
  }
  const known = new Set([...state.items.map((i) => i.id), ...state.categories.map((c) => c.id), ...state.inlays.map((i) => i.id)]);
  let orphans = 0;
  for (const c of state.categories) for (const e of c.entries) if (!known.has(e)) orphans++;
  let logBytes = 0; let logFiles = 0;
  try { for (const n of fs.readdirSync(LOG_DIR)) { const st = fs.statSync(path.join(LOG_DIR, n)); if (st.isFile()) { logBytes += st.size; logFiles++; } } } catch { /* none */ }
  return { ok: true, broken: broken.length, dupes: dupes.length, orphans, logBytes, logFiles, _broken: broken, _dupes: dupes };
}
function cleanRun(what) {
  if (state.locked) return { ok: false, error: `Can't edit: ${state.locked}` };
  const sc = cleanScan();
  const done = [];
  const drop = (id) => { state.items = state.items.filter((x) => x.id !== id); state.categories.forEach((c) => (c.entries = c.entries.filter((e) => e !== id))); };
  if (what.includes('broken') && sc._broken.length) { sc._broken.forEach(drop); done.push(`${sc._broken.length} broken`); }
  if (what.includes('dupes') && sc._dupes.length) {
    for (const d of sc._dupes) {
      state.categories.forEach((c) => { if (c.entries.includes(d.id)) c.entries = c.entries.includes(d.keep) ? c.entries.filter((e) => e !== d.id) : c.entries.map((e) => (e === d.id ? d.keep : e)); });
      state.items = state.items.filter((x) => x.id !== d.id);
    }
    done.push(`${sc._dupes.length} duplicate`);
  }
  if (what.includes('orphans') && sc.orphans) {
    const known = new Set([...state.items.map((i) => i.id), ...state.categories.map((c) => c.id), ...state.inlays.map((i) => i.id)]);
    state.categories.forEach((c) => (c.entries = c.entries.filter((e) => known.has(e))));
    done.push(`${sc.orphans} stray`);
  }
  if (what.includes('logs') && sc.logFiles) {
    try {
      const files = fs.readdirSync(LOG_DIR).map((n) => ({ n, t: fs.statSync(path.join(LOG_DIR, n)).mtimeMs })).sort((a, b) => b.t - a.t).slice(1);
      for (const f of files) { try { fs.unlinkSync(path.join(LOG_DIR, f.n)); } catch { /* skip */ } }
      done.push('old log');
    } catch { /* ignore */ }
  }
  if (!done.length) return { ok: true, message: 'Nothing to clean up.' };
  gc();
  saveState();
  return { ok: true, message: `Cleaned up: ${done.join(', ')}.` };
}

// ---- back up and restore: layout, library and settings (not the PIN) go to a folder the person picks
const BACKUP_FILES = ['library.json', 'settings.json'];
function makeBackup(dest) {
  const day = new Date().toISOString().slice(0, 10);
  let dir = path.join(dest, `Tessera-backup-${day}`);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(dest, `Tessera-backup-${day}-${n}`);
  try {
    fs.mkdirSync(dir);
    saveState(); saveSettings();
    fs.copyFileSync(LIBRARY_FILE, path.join(dir, 'library.json'));
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    delete s.pin; // a backup never carries the PIN
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s, null, 2));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ tessera: 1, created: new Date().toISOString() }, null, 2));
  } catch { return { ok: false, error: "Couldn't save the backup there. Is the drive full or read-only?" }; }
  return { ok: true, message: `Backup saved in ${friendly(dir).name}.` };
}
function readSmallJson(file) {
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > 8 * 1024 * 1024) throw new Error('size');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function restoreBackup(src) {
  let lib; let set;
  try {
    const man = readSmallJson(path.join(src, 'manifest.json'));
    if (!man || man.tessera !== 1) throw new Error('not a backup');
    lib = readSmallJson(path.join(src, 'library.json'));
    set = readSmallJson(path.join(src, 'settings.json'));
    if (!lib || typeof lib !== 'object' || !Array.isArray(lib.items) || !set || typeof set !== 'object') throw new Error('shape');
  } catch { return { ok: false, error: "That folder isn't a Tessera backup." }; }
  try {
    const keep = path.join(DATA_DIR, 'backups', `before-restore-${Date.now()}`);
    fs.mkdirSync(keep, { recursive: true });
    for (const f of [LIBRARY_FILE, SETTINGS_FILE]) { try { fs.copyFileSync(f, path.join(keep, path.basename(f))); } catch { /* none yet */ } }
    set.pin = settings.pin || undefined; // keep this install's PIN
    if (!set.pin) delete set.pin;
    set.firstRunDone = true;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify(lib, null, 2));
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ v: SETTINGS_VERSION, ...set }, null, 2));
    settings.scanRoots = [];
    loadSettings();
    loadState();
    artCache.clear(); artRev++; sizeCache.clear();
  } catch { return { ok: false, error: "Couldn't restore that backup. Your setup was left as it was." }; }
  return { ok: true, message: 'Backup restored.', view: buildView() };
}

async function storageOp(op, p) {
  try {
    const needsPin = ['useDrive', 'ignoreDrive', 'eject', 'setInstallRoot', 'clearDownloads', 'cleanRun', 'hideDrive', 'muteDrive'];
    if (needsPin.includes(op) && !pinOk()) return NEED_PIN;
    switch (op) {
      case 'overview': return await storageOverview(p.measure === true);
      case 'games': return await storageGames(p.measure === true);
      case 'installRoots': return { ok: true, roots: installView() };
      case 'setInstallRoot': {
        const list = installChoices();
        if (!Number.isInteger(p.index) || p.index < 0 || p.index >= list.length) return { ok: false, error: 'Pick one from the list.' };
        settings.installRoot = list[p.index]; saveSettings();
        return { ok: true, message: `New games will go to ${friendly(list[p.index]).name}.`, roots: installView() };
      }
      case 'downloads': return await downloadsInfo();
      case 'clearDownloads': return clearDownloads();
      case 'useDrive': return useDriveForGames(p.key);
      case 'ignoreDrive': {
        if (typeof p.key === 'string' && p.key.length < 200 && !settings.ignoredDrives.includes(p.key)) {
          settings.ignoredDrives.push(p.key);
          settings.ignoredDrives = settings.ignoredDrives.slice(-64);
          saveSettings();
        }
        return { ok: true };
      }
      case 'eject': return await ejectDrive(p.key);
      case 'cleanScan': { const { _broken, _dupes, ...r } = cleanScan(); return r; }
      case 'cleanRun': return cleanRun(Array.isArray(p.what) ? p.what.filter((x) => ['broken', 'dupes', 'orphans', 'logs'].includes(x)) : []);
      case 'hideDrive': case 'muteDrive': {
        const field = op === 'hideDrive' ? 'hiddenDrives' : 'mutedDrives';
        const on = op === 'hideDrive' ? p.hidden === true : p.muted === true;
        if (typeof p.key !== 'string' || p.key.length > 199) return { ok: false, error: 'Pick a drive first.' };
        settings[field] = settings[field].filter((k) => k !== p.key);
        if (on) settings[field] = [...settings[field], p.key].slice(-64);
        saveSettings(); lowCache.at = 0;
        return { ok: true, prefs: prefsPayload() };
      }
      case 'hiddenDrives': return { ok: true, drives: storageDrives(true).filter((d) => d.hidden).map((d) => ({ key: d.key, name: d.name, total: d.total })) };
      case 'forget': sizeCache.clear(); lowCache.at = 0; return { ok: true };
      default: return { ok: false, error: 'Unknown action.' };
    }
  } catch {
    return { ok: false, error: 'Something went wrong.' };
  }
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
  if (['deleteItem', 'deleteCategory', 'removeEntry', 'deleteFiles'].includes(op) && !pinOk()) return { ...NEED_PIN, view: buildView() };
  const r = libraryOp(op, p);
  if (r.ok) {
    try { saveState(); } catch { return { ok: false, error: "Couldn't save your library." }; }
  }
  return { ...r, view: buildView() };
}));

ipcMain.handle('browse', safe((op, p) => {
  if (op === 'choose' && ['addGame', 'addApp', 'addRoot', 'backupTo', 'restoreFrom'].includes(browse && browse.purpose) && !pinOk()) return NEED_PIN;
  return browseOp(op, p);
}));

ipcMain.handle('storage', (_e, op, p) => storageOp(typeof op === 'string' ? op : '', p && typeof p === 'object' ? p : {}));

ipcMain.handle('addons', safe((op, p) => {
  if (op === 'remove') {
    // Deletes one widget, theme or shard folder from the Tessera folder, never the folder itself.
    const dir = p.dir === 'widgets' || p.dir === 'themes' || p.dir === 'packs' ? p.dir : null;
    if (!dir || typeof p.id !== "string" || !(dir === "themes" ? THEME_ID_RE : WIDGET_ID_RE).test(p.id)) return { ok: false, error: 'Bad request.' };
    // A theme isn't blocked from being deleted just because it's active or in use — it's only
    // the PIN that's conditional on that. Whoever's relying on it falls back to stock. A shard's
    // PIN requirement is the owner's own setting (settings.codeAddons.pinRequired), separate
    // from everything else here, because a shard is a different kind of thing entirely.
    const inUse = dir === 'themes' && themeInUse(p.id);
    if (inUse && !pinOk()) return NEED_PIN;
    if (dir === 'packs' && settings.codeAddons.pinRequired && !pinOk()) return NEED_PIN;
    const r = vaultDelete(path.join(addonDir(dir), p.id));
    if (!r.ok) return r;
    let fellBack = [];
    if (dir === 'themes') {
      delete settings.theme.values[p.id];
      if (activeTheme() === p.id) { settings.theme.active = 'stock'; fellBack.push('the active theme'); themeRev++; }
      for (const pr of settings.profiles) if (pr.themeId === p.id) { pr.themeId = null; fellBack.push(pr.name); }
    }
    scanAddons(); scanThemes(); saveSettings();
    return { ok: true, info: addonsInfo(), theme: themePayload(), fellBack };
  }
  if (op === 'packsPinRequired') {
    if (!pinOk()) return NEED_PIN;
    settings.codeAddons.pinRequired = p.value === true;
    saveSettings();
    return { ok: true, info: addonsInfo() };
  }
  if (op === 'packsAllowUnverified') {
    if (!pinOk()) return NEED_PIN;
    settings.codeAddons.allowUnverified = p.value === true;
    saveSettings();
    return { ok: true, info: addonsInfo() };
  }
  if (op === 'saveTheme') {
    if (typeof p.name !== 'string' || !p.name.trim()) return { ok: false, error: 'Give it a name.' };
    const id = newThemeId(p.name);
    if (!id) return { ok: false, error: "Couldn't make room for a new theme." };
    const r = writeThemeFile(id, p.name, currentThemeValues(activeTheme()));
    if (!r.ok) return r;
    scanThemes();
    settings.theme.active = id;
    themeRev++;
    saveSettings();
    return { ok: true, info: addonsInfo(), theme: themePayload() };
  }
  if (op === 'renameTheme') {
    const t = themes.get(p.id);
    if (!t || t.builtin) return { ok: false, error: "That theme can't be renamed." };
    if (typeof p.name !== 'string' || !p.name.trim()) return { ok: false, error: 'Give it a name.' };
    const r = renameThemeFile(p.id, p.name);
    if (!r.ok) return r;
    scanThemes();
    return { ok: true, info: addonsInfo(), theme: themePayload() };
  }
  if (op === 'overwriteTheme') {
    const t = themes.get(p.id);
    if (!t || t.builtin) return { ok: false, error: "That theme can't be overwritten." };
    if (p.id !== activeTheme()) return { ok: false, error: 'Switch to it first.' };
    const r = writeThemeFile(p.id, t.name, currentThemeValues(p.id));
    if (!r.ok) return r;
    scanThemes();
    return { ok: true, info: addonsInfo(), theme: themePayload() };
  }
  if (op === 'rescan') { scanAddons(); scanThemes(); }
  if (op === 'list' || op === 'rescan') return addonsInfo();
  return { error: 'Unknown action.' };
}));

// ------------------------------------------------------------ profiles
// Minimal, on purpose: an id, a name, and an optional theme of their own. No switching session,
// no PIN-per-profile, no startup wizard yet — just enough real state for "is this theme being
// used by someone else" to mean something, instead of being permanently empty.
const activeProfile = () => (settings.profiles.some((p) => p.id === settings.activeProfile) ? settings.activeProfile : null);
const profilesInfo = () => ({ profiles: settings.profiles.map((p) => ({ id: p.id, name: p.name, themeId: p.themeId })), active: activeProfile() });
ipcMain.handle('profiles', safe((op, p) => {
  if (op === 'list') return profilesInfo();
  if (op === 'add') {
    if (!pinOk()) return NEED_PIN;
    const name = clip(p.name, 24);
    if (!name) return { ok: false, error: 'Give them a name.' };
    if (settings.profiles.length >= MAX_PROFILES) return { ok: false, error: `${MAX_PROFILES} is the most profiles at once.` };
    let id;
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'player';
    for (let i = 0; ; i++) {
      const cand = i === 0 ? base : `${base}-${i}`;
      if (PROFILE_ID_RE.test(cand) && !settings.profiles.some((pr) => pr.id === cand)) { id = cand; break; }
    }
    settings.profiles.push({ id, name, themeId: null });
    saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  if (op === 'rename') {
    if (!pinOk()) return NEED_PIN;
    const pr = settings.profiles.find((x) => x.id === p.id);
    if (!pr) return { ok: false, error: "That profile doesn't exist." };
    const name = clip(p.name, 24);
    if (!name) return { ok: false, error: 'Give them a name.' };
    pr.name = name;
    saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  if (op === 'remove') {
    if (!pinOk()) return NEED_PIN;
    const before = settings.profiles.length;
    settings.profiles = settings.profiles.filter((x) => x.id !== p.id);
    if (settings.profiles.length !== before) saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  // Who is playing. Switching needs no PIN (it is no more than picking a theme); the profile's
  // own theme, if it has one, comes with it.
  if (op === 'use') {
    if (p.id === null) { settings.activeProfile = null; saveSettings(); return { ok: true, ...profilesInfo(), theme: themePayload() }; }
    const pr = settings.profiles.find((x) => x.id === p.id);
    if (!pr) return { ok: false, error: "That profile doesn't exist." };
    settings.activeProfile = pr.id;
    if (pr.themeId && themes.has(pr.themeId)) { settings.theme.active = pr.themeId; themeRev++; }
    saveSettings();
    return { ok: true, ...profilesInfo(), theme: themePayload() };
  }
  if (op === 'setTheme') {
    // Giving a profile its own theme is the one profile change that doesn't need the PIN —
    // it's no more sensitive than switching the active theme already is.
    const pr = settings.profiles.find((x) => x.id === p.id);
    if (!pr) return { ok: false, error: "That profile doesn't exist." };
    if (p.themeId !== null && (typeof p.themeId !== 'string' || !themes.has(p.themeId))) return { ok: false, error: "That theme doesn't exist." };
    pr.themeId = p.themeId;
    saveSettings();
    return { ok: true, ...profilesInfo() };
  }
  return { error: 'Unknown action.' };
}));

// ------------------------------------------------------------ software updates
// Settings > Update software swaps in the newest system image with `bootc upgrade`, which needs
// root. The launcher never runs that itself. It starts three fixed systemd jobs
// (tessera-update-status, -check, -apply and -rollback, in usr/lib/systemd/system) that a polkit rule
// lets whoever is at the console start and stop, and it reads the notes those jobs leave in UPDATE_DIR.
// Nothing the page sends ever reaches a command line: it can only ask for "check", "apply" or "rollback".
const UPDATE_DIR = process.env.TESSERA_UPDATE_DIR || '/run/tessera-update';
const SYSTEMCTL = process.env.TESSERA_SYSTEMCTL || 'systemctl';
const UPDATE_UNIT = { status: 'tessera-update-status.service', check: 'tessera-update-check.service', apply: 'tessera-update-apply.service', rollback: 'tessera-update-rollback.service' };
const UPDATE_START_GRACE_MS = 15000; // how long a queued job may take to begin
const LAUNCHER_VERSION = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '').slice(0, 24); } catch { return ''; }
})();
let upJob = null; // the job being followed: { kind, unit, before, startedAt, seen, canceled }
let rolledBackNow = false; // a rollback was queued by this program: asking again would flip it back

const sysctl = (args, timeout = 15000) => new Promise((resolve) => {
  execFile(SYSTEMCTL, ['--no-ask-password', ...args], { timeout, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || '') });
  });
});
// Why a systemctl call failed, in words for the person at the TV.
function ctlWhy(r) {
  const t = `${r.err}\n${r.out}`;
  if (/not found|not-found|could not be found/i.test(t)) return 'missing';
  if (/access denied|authentication|not authorized|permission denied/i.test(t)) return 'denied';
  return 'failed';
}
const UPDATE_PROBLEM = {
  missing: "Updates aren't set up on this system yet.",
  denied: "This account isn't allowed to run updates.",
  failed: "Couldn't start the update.",
  unreadable: "This system can't update itself here. It needs to be running a Tessera image.",
};
async function unitProps(unit) {
  const r = await sysctl(['show', unit, '-p', 'ActiveState,Result,InvocationID,LoadState'], 5000);
  if (!r.ok) return null;
  const o = {};
  for (const line of r.out.split('\n')) { const i = line.indexOf('='); if (i > 0) o[line.slice(0, i)] = line.slice(i + 1).trim(); }
  return o;
}

// What the jobs leave behind is written by root. Read a bounded tail, and drop terminal control codes.
function readNote(name, max = 65536) {
  try {
    const fd = fs.openSync(path.join(UPDATE_DIR, name), 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, max);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}
const cleanLines = (text) => String(text)
  .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  .split(/[\r\n]+/)
  .map((l) => l.replace(/[\x00-\x1f\x7f]/g, ' ').trim())
  .filter(Boolean);
const lastLine = (text) => (cleanLines(text).pop() || '').slice(0, 120);
const shortText = (v, n) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n) : '');

// `bootc status --format=json`: the booted, staged and previous images. Anything missing stays empty.
function bootcImage(entry) {
  const im = entry && typeof entry === 'object' && entry.image && typeof entry.image === 'object' ? entry.image : null;
  if (!im) return null;
  const t = Date.parse(im.timestamp);
  return {
    ref: im.image && typeof im.image === 'object' ? shortText(im.image.image, 200) : '',
    version: shortText(im.version, 60),
    time: Number.isFinite(t) ? t : 0,
    digest: shortText(im.imageDigest, 100),
  };
}
function parseBootcStatus(text) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  const st = j && typeof j === 'object' ? j.status : null;
  if (!st || typeof st !== 'object') return null;
  const booted = bootcImage(st.booted);
  const staged = bootcImage(st.staged);
  return {
    booted,
    // an update only counts as waiting if it is a different image from the one that is running
    staged: staged && (!booted || !staged.digest || staged.digest !== booted.digest) ? staged : null,
    rollback: bootcImage(st.rollback),
    // "go back to the previous version" is already queued for the next restart (bootc says so in rollbackQueued)
    rollbackQueued: st.rollbackQueued === true,
  };
}
// `bootc upgrade --check` prints "No changes in: ..." or "Update available for: ..." with the new
// version and the layers it would fetch. Anything else is "unknown", and the caller carries on.
function parseCheck(text) {
  const t = cleanLines(text).join('\n');
  if (/^\s*Update available for\b/mi.test(t)) {
    const v = /^\s*Version:\s*(\S.*)$/mi.exec(t);
    const sz = /^\s*Added layers:.*?\bSize:\s*([0-9][0-9.,]*\s*[kKMGT]?i?B)\b/mi.exec(t);
    return { state: 'available', version: v ? shortText(v[1], 60) : '', size: sz ? sz[1].replace(/\s+/g, ' ') : '' };
  }
  if (/^\s*No changes in\b/mi.test(t)) return { state: 'uptodate', version: '', size: '' };
  return { state: 'unknown', version: '', size: '' };
}
// What `bootc upgrade` said, for when the status job cannot confirm the result.
function parseApply(text) {
  const t = cleanLines(text).join('\n');
  if (/Queued for next boot|Staged update present/i.test(t)) return 'staged';
  if (/No update available|No changes in/i.test(t)) return 'uptodate';
  return '';
}
function updateErrorText(log) {
  const t = cleanLines(log).join('\n');
  if (/could(?: not|n't) resolve|no such host|dial tcp|network is unreachable|name resolution|connection (?:refused|reset|timed out)|timed out|timeout|unable to connect|temporary failure|tls handshake|x509|certificate/i.test(t)) {
    return "Couldn't reach the update server. Check that this machine is online, then try again.";
  }
  if (/no space left|not enough (?:free )?space|disk quota/i.test(t)) return "There isn't enough free space for the update. Free some up in Settings > Storage, then try again.";
  if (/unauthorized|forbidden|denied|authentication required/i.test(t)) return "The update server wouldn't hand over the update.";
  return "The update didn't finish.";
}

// Runs the short status job to the end and reads what it found.
async function fetchStatus() {
  const r = await sysctl(['start', UPDATE_UNIT.status], 45000); // waits until the short job is done
  if (!r.ok) {
    // "failed" here means bootc itself refused: this is not a machine that runs from an image
    const why = ctlWhy(r);
    return { ok: false, why: why === 'failed' ? 'unreadable' : why, detail: lastLine(readNote('status.err')) };
  }
  const s = parseBootcStatus(readNote('status.json', 262144));
  if (!s || !s.booted) return { ok: false, why: 'unreadable', detail: lastLine(readNote('status.err')) };
  return { ok: true, ...s };
}
// A job that is already going (Tessera was restarted while it ran) is picked up again, not started twice.
async function runningJob() {
  if (upJob) return upJob;
  for (const kind of ['apply', 'check', 'rollback']) {
    const p = await unitProps(UPDATE_UNIT[kind]);
    if (p && ['activating', 'active', 'reloading'].includes(p.ActiveState)) {
      upJob = { kind, unit: UPDATE_UNIT[kind], before: '', startedAt: Date.now(), seen: true, canceled: false };
      return upJob;
    }
  }
  return null;
}
async function updateInfo() {
  const job = await runningJob();
  if (job) return { ok: true, launcher: LAUNCHER_VERSION, supported: true, job: job.kind };
  const st = await fetchStatus();
  if (!st.ok) return { ok: true, launcher: LAUNCHER_VERSION, supported: false, job: null, problem: UPDATE_PROBLEM[st.why] || UPDATE_PROBLEM.unreadable, detail: st.detail };
  return { ok: true, launcher: LAUNCHER_VERSION, supported: true, job: null, booted: st.booted, staged: st.staged, rollback: st.rollback, rollbackQueued: st.rollbackQueued || rolledBackNow };
}
async function startUpdate(kind) {
  if (kind !== 'check' && kind !== 'apply' && kind !== 'rollback') return { ok: false, error: 'Unknown action.' };
  if (running) return { ok: false, error: 'Close the game first.' };
  const cur = await runningJob();
  if (cur) return { ok: true, job: cur.kind };
  if (kind === 'rollback') {
    // Going back twice would undo itself, so look first: there has to be an older version, and it must not be queued already.
    const st = await fetchStatus();
    if (!st.ok) return { ok: false, error: UPDATE_PROBLEM[st.why] || UPDATE_PROBLEM.unreadable };
    if (st.rollbackQueued || rolledBackNow) return { ok: false, error: 'Already set. Restart to go back to the previous version.' };
    if (st.staged) return { ok: false, error: 'An update is waiting for a restart. Restart first, then you can go back if you need to.' };
    if (!st.rollback) return { ok: false, error: "There's no earlier version to go back to." };
  }
  const unit = UPDATE_UNIT[kind];
  const before = await unitProps(unit);
  if (!before || before.LoadState === 'not-found') return { ok: false, error: UPDATE_PROBLEM.missing };
  const r = await sysctl(['start', '--no-block', unit], 15000);
  if (!r.ok) return { ok: false, error: UPDATE_PROBLEM[ctlWhy(r)] };
  upJob = { kind, unit, before: before.InvocationID || '', startedAt: Date.now(), seen: false, canceled: false };
  return { ok: true, job: kind };
}
// Called about once a second while the progress screen is up.
async function pollUpdate() {
  if (!upJob) await runningJob();
  const job = upJob;
  if (!job) return { ok: true, phase: 'idle' };
  const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
  const p = await unitProps(job.unit);
  if (!p) return { ok: true, phase: 'running', job: job.kind, elapsed, line: '' }; // a hiccup in systemctl: keep waiting
  const log = readNote(`${job.kind}.log`);
  if (['activating', 'active', 'reloading', 'deactivating'].includes(p.ActiveState)) {
    job.seen = true;
    return { ok: true, phase: 'running', job: job.kind, elapsed, line: lastLine(log) };
  }
  if (!job.seen && (p.InvocationID || '') === job.before) {
    // queued but not begun yet, or it never will
    if (Date.now() - job.startedAt < UPDATE_START_GRACE_MS) return { ok: true, phase: 'running', job: job.kind, elapsed, line: '' };
    upJob = null;
    return { ok: true, phase: 'done', job: job.kind, result: 'error', error: "The update service didn't start.", detail: '' };
  }
  upJob = null;
  const done = { ok: true, phase: 'done', job: job.kind };
  if (job.canceled) return { ...done, result: 'canceled' };
  if (p.Result !== 'success' || p.ActiveState === 'failed') return { ...done, result: 'error', error: job.kind === 'rollback' ? "Couldn't go back to the previous version." : updateErrorText(log), detail: lastLine(log) };
  if (job.kind === 'rollback') {
    rolledBackNow = true;
    return { ...done, result: 'rolledback' };
  }
  if (job.kind === 'check') {
    const c = parseCheck(log);
    if (c.state === 'available') return { ...done, result: 'available', version: c.version, size: c.size };
    // "No changes" is also what a check says when the newest build is already downloaded and waiting for a restart
    const st = await fetchStatus();
    if (st.ok && st.staged) return { ...done, result: 'staged', version: st.staged.version, time: st.staged.time };
    return { ...done, result: c.state === 'uptodate' ? 'uptodate' : 'unknown' };
  }
  const st = await fetchStatus();
  if (st.ok) return st.staged ? { ...done, result: 'staged', version: st.staged.version, time: st.staged.time } : { ...done, result: 'uptodate' };
  const said = parseApply(log);
  return { ...done, result: said || 'unknown' };
}
async function cancelUpdate() {
  const job = upJob || (await runningJob());
  if (!job) return { ok: true };
  job.canceled = true;
  const r = await sysctl(['stop', job.unit], 30000);
  return r.ok ? { ok: true } : { ok: false, error: UPDATE_PROBLEM[ctlWhy(r)] };
}
async function restartNow() {
  if (running) return { ok: false, error: 'Close the game first.' };
  const r = await sysctl(['reboot'], 15000);
  return r.ok ? { ok: true } : { ok: false, error: "Couldn't restart from here. Use the power button, or Desktop Mode." };
}
async function updateOp(op, p) {
  try {
    if (['start', 'reboot'].includes(op) && !pinOk()) return NEED_PIN;
    switch (op) {
      case 'info': return await updateInfo();
      case 'start': return await startUpdate(p.job);
      case 'poll': return await pollUpdate();
      case 'cancel': return await cancelUpdate();
      case 'reboot': return await restartNow();
      default: return { ok: false, error: 'Unknown action.' };
    }
  } catch {
    return { ok: false, error: 'Something went wrong.' };
  }
}
ipcMain.handle('update', (_e, op, p) => updateOp(typeof op === 'string' ? op : '', p && typeof p === 'object' ? p : {}));

// ------------------------------------------------------------ power
// Restart, shut down, sleep: the normal permissions of someone sitting at the console, through logind.
const POWER_VERB = { restart: 'reboot', shutdown: 'poweroff', sleep: 'suspend' };
const POWER_FAIL = {
  restart: "Couldn't restart from here. Use the power button, or Desktop Mode.",
  shutdown: "Couldn't shut down from here. Hold the power button, or use Desktop Mode.",
  sleep: "Couldn't go to sleep from here.",
};
ipcMain.handle('power', async (_e, op) => {
  try {
    const verb = typeof op === 'string' && Object.prototype.hasOwnProperty.call(POWER_VERB, op) ? POWER_VERB[op] : null;
    if (!verb) return { ok: false, error: 'Unknown action.' };
    if (!pinOk()) return NEED_PIN;
    if (running) return { ok: false, error: 'Close the game first.' };
    const r = await sysctl([verb], 15000);
    return r.ok ? { ok: true } : { ok: false, error: POWER_FAIL[op] };
  } catch {
    return { ok: false, error: 'Something went wrong.' };
  }
});

// ------------------------------------------------------------ sound, Bluetooth, Wi-Fi
// The work is in devices.js. What is asked for here is the operation name plus values that are
// checked there; pairing, joining, forgetting and the Wi-Fi switch need the PIN (when there is one).
const devices = require('./devices');

// Nintendo Switch controllers, read straight from the kernel (Chromium leaves them out; see pads.js).
// While the browser has the screen, LB / RB on them close it, like on any other controller.
const browserGamepad = require('./browser-gamepad');
const browserNavigation = require('./browser-navigation');
let browserShoulder = null;
const padBits = new Map();
const browserPadNavigation = new Map();
const padsCtl = require('./pads').create({
  prefs: () => ({ joycons: settings.pad.joycons }),
  onList: (p) => {
    const ids = new Set((p.pads || []).map(pad => pad.id));
    for (const id of padBits.keys()) {
      if (!ids.has(id)) { padBits.delete(id); clearBrowserPadNavigation(id); }
    }
    send('pads', { type: 'list', ...p });
  },
  onMotion: (m) => send('pads', { type: 'motion', ...m }),
  onFrame: (f) => {
    const before = padBits.get(f.id) || 0;
    padBits.set(f.id, f.b);

    const view = browserView;
    const browserViewActive = Boolean(
      view && mainWindow && !mainWindow.isDestroyed() &&
      browserViewAttached &&
      !view.webContents.isDestroyed()
    );

    if (browserShoulder || browserViewActive) {
      const down = f.b & ~before;
      const pressKey = browserViewActive ? sendBrowserViewKey : sendExternalBrowserKey;
      const axes = Array.isArray(f.a) ? f.a : [];

      if (browserViewActive) {
        // BrowserView receives page-navigation input directly. Browser controls which
        // operate Tessera itself go to the hidden launcher through a narrow IPC event.
        const actions = browserGamepad.standardButtonActions(down);
        actions.browserActions.forEach(sendBrowserAction);
        actions.keys.forEach(pressKey);
      } else {
        // Preserve the existing external-browser shoulder-button close behavior.
        if (browserShoulder && (down & (1 << 4))) { browserShoulder(-1); return; }
        if (browserShoulder && (down & (1 << 5))) { browserShoulder(1); return; }
        if (down & (1 << 0)) pressKey('ENTER');
        if (down & (1 << 1)) pressKey('ESC');
        if (down & (1 << 2)) pressKey('TAB');
      }

      const navigation = browserPadDirectionRepeater(f.id);
      for (const [bit, key] of [[12, 'UP'], [13, 'DOWN'], [14, 'LEFT'], [15, 'RIGHT']]) {
        navigation.set('dpad:' + bit, f.b & (1 << bit) ? key : '');
      }
      const lx = Number(axes[0]) || 0;
      const ly = Number(axes[1]) || 0;
      const rx = Number(axes[2]) || 0;
      const ry = Number(axes[3]) || 0;
      if (browserViewActive) {
        // The embedded page gets a real pointer: cursor, analog scrolling, trigger clicks.
        const src = 'pad:' + f.id;
        browserAnalog(src, 'lx', lx); browserAnalog(src, 'ly', ly);
        browserAnalog(src, 'rx', rx); browserAnalog(src, 'ry', ry);
        browserAnalog(src, 'lt', f.b & (1 << 6) ? 1 : 0);
        browserAnalog(src, 'rt', f.b & (1 << 7) ? 1 : 0);
        return; // Keep browser input away from the hidden launcher UI.
      }
      const left = Math.abs(lx) > Math.abs(ly)
        ? (Math.abs(lx) > 0.65 ? (lx < 0 ? 'LEFT' : 'RIGHT') : '')
        : (Math.abs(ly) > 0.65 ? (ly < 0 ? 'UP' : 'DOWN') : '');
      const right = Math.abs(rx) > Math.abs(ry)
        ? (Math.abs(rx) > 0.65 ? (rx < 0 ? 'LEFT' : 'RIGHT') : '')
        : (Math.abs(ry) > 0.65 ? (ry < 0 ? 'PAGEUP' : 'PAGEDOWN') : '');
      navigation.set('left-stick', left);
      navigation.set('right-stick', right);
      return; // Keep browser input away from the hidden launcher UI.
    }

    clearBrowserPadNavigation(f.id);
    send('pads', { type: 'frame', ...f });
  },
});
ipcMain.handle('pads', (_e, op, p) => {
  const on = Boolean(p && p.on);
  if (op === 'list') return padsCtl.list();
  if (op === 'grip') return padsCtl.setGrip(on);
  if (op === 'motion') return padsCtl.setMotion(on);
  if (op === 'regroup') return padsCtl.regroup();
  return { ok: false };
});
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const str = (v) => (typeof v === 'string' ? v : '');
function deviceHandler(table, needPin) {
  return async (_e, op, p) => {
    try {
      op = typeof op === 'string' ? op : '';
      p = p && typeof p === 'object' ? p : {};
      if (!Object.prototype.hasOwnProperty.call(table, op)) return { ok: false, error: 'Unknown action.' };
      if (needPin.includes(op) && !pinOk()) return NEED_PIN;
      return await table[op](p);
    } catch {
      return { ok: false, error: 'Something went wrong.' };
    }
  };
}
ipcMain.handle('audio', deviceHandler({
  info: () => devices.audio.info(),
  setDefault: (p) => devices.audio.setDefault(str(p.kind), str(p.id)),
  volume: (p) => devices.audio.setVolume(str(p.kind), str(p.id), num(p.pct)),
  mute: (p) => devices.audio.setMute(str(p.kind), str(p.id), p.on === true),
  profile: (p) => devices.audio.setProfile(str(p.card), str(p.profile)),
}, []));
ipcMain.handle('bluetooth', deviceHandler({
  info: () => devices.bluetooth.info(),
  power: (p) => devices.bluetooth.power(p.on === true),
  scan: (p) => devices.bluetooth.scan(p.on === true),
  stop: () => devices.bluetooth.stop(),
  pair: (p) => devices.bluetooth.pair(str(p.id)),
  connect: (p) => devices.bluetooth.connect(str(p.id)),
  disconnect: (p) => devices.bluetooth.disconnect(str(p.id)),
  forget: (p) => devices.bluetooth.forget(str(p.id)),
  poll: () => devices.bluetooth.poll(),
  ack: () => devices.bluetooth.ack(),
  cancel: () => devices.bluetooth.cancel(),
}, ['pair', 'forget']));
ipcMain.handle('wifi', deviceHandler({
  info: (p) => devices.wifi.info({ rescan: p.rescan === true }),
  rescan: () => devices.wifi.rescan(),
  radio: (p) => devices.wifi.radio(p.on === true),
  join: (p) => devices.wifi.join({ ssid: str(p.ssid), password: str(p.password), hidden: p.hidden === true }),
  connect: (p) => devices.wifi.connect({ ssid: str(p.ssid) }),
  disconnect: () => devices.wifi.disconnect(),
  forget: (p) => devices.wifi.forget({ ssid: str(p.ssid) }),
  poll: () => devices.wifi.poll(),
  ack: () => devices.wifi.ack(),
  cancel: () => devices.wifi.cancel(),
}, ['radio', 'join', 'forget']));
// Short notes for the Settings tiles ("HomeNetwork", "WH-1000XM5"). Each is given a few seconds and then left blank.
ipcMain.handle('summaries', async () => {
  const quick = (f) => Promise.race([Promise.resolve().then(f).catch(() => ''), new Promise((r) => setTimeout(() => r(''), 4000))]);
  const [w, b, a] = await Promise.all([quick(() => devices.wifi.summary()), quick(() => devices.bluetooth.summary()), quick(() => devices.audio.summary())]);
  // For the notes under the other Settings tiles: free space where the games live, add-ons, version.
  let home = null;
  try { const st = fs.statfsSync(os.homedir()); home = { free: st.bavail * st.bsize, total: st.blocks * st.bsize }; } catch { /* unknown */ }
  const addonsCount = widgets.size + [...themes.values()].filter((t) => !t.builtin).length;
  return { wifi: w || '', bluetooth: b || '', audio: a || '', home, addons: addonsCount, version: LAUNCHER_VERSION };
});

// ---- system info, for the built-in CPU/Memory/Storage/Battery/Network/Uptime widgets.
// Everything here is a read; nothing here is ever written, and nothing here ever spawns a
// process — just /proc, /sys and Node's own os module, cheap enough for the renderer to poll
// once a second while one of these widgets is actually on screen (see tickInlays in renderer.js).
let cpuPrev = null; // { idle, total } from the last sample, so usage is a rate, not a snapshot
function cpuPct() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; }
  let pct = null;
  if (cpuPrev) {
    const dIdle = idle - cpuPrev.idle, dTotal = total - cpuPrev.total;
    if (dTotal > 0) pct = Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)));
  }
  cpuPrev = { idle, total };
  return pct; // null only on the very first call this process ever makes
}
function ramInfo() {
  try {
    const text = fs.readFileSync('/proc/meminfo', 'utf8');
    const get = (k) => { const m = new RegExp(`^${k}:\\s*(\\d+)`, 'm').exec(text); return m ? Number(m[1]) * 1024 : null; };
    const total = get('MemTotal');
    const avail = get('MemAvailable');
    if (total == null || avail == null) throw new Error('unreadable');
    return { total, used: Math.max(0, total - avail) };
  } catch {
    const total = os.totalmem(), free = os.freemem(); // older kernels without MemAvailable
    return { total, used: Math.max(0, total - free) };
  }
}
function storageInfo() {
  try {
    const drives = storageDrives();
    const d = drives.find((x) => x.system) || drives[0];
    return d ? { free: d.free, total: d.total } : null;
  } catch { return null; }
}
function batteryInfo() {
  try {
    const base = '/sys/class/power_supply';
    const names = fs.readdirSync(base);
    // Controllers report their batteries here too, as scope "Device": those aren't the computer's.
    const bat = names.find((n) => {
      const r = (f) => { try { return fs.readFileSync(path.join(base, n, f), 'utf8').trim(); } catch { return ''; } };
      return r('type') === 'Battery' && r('scope') !== 'Device';
    });
    if (!bat) return { present: false };
    const read = (f) => { try { return fs.readFileSync(path.join(base, bat, f), 'utf8').trim(); } catch { return ''; } };
    const pct = Number(read('capacity'));
    const status = read('status'); // "Charging", "Discharging", "Full", "Not charging", "Unknown"
    return { present: true, pct: Number.isFinite(pct) ? pct : null, charging: status === 'Charging' || status === 'Full' };
  } catch { return { present: false }; }
}
let netPrev = null; // { at, rx, tx } from the last sample, so speed is a rate, not a snapshot
function networkInfo() {
  try {
    const base = '/sys/class/net';
    const names = fs.readdirSync(base).filter((n) => n !== 'lo');
    let rx = 0, tx = 0, up = false;
    for (const n of names) {
      try {
        if (fs.readFileSync(path.join(base, n, 'operstate'), 'utf8').trim() === 'up') up = true;
        rx += Number(fs.readFileSync(path.join(base, n, 'statistics', 'rx_bytes'), 'utf8').trim()) || 0;
        tx += Number(fs.readFileSync(path.join(base, n, 'statistics', 'tx_bytes'), 'utf8').trim()) || 0;
      } catch { /* that interface came or went between the readdir and the read; skip it */ }
    }
    const now = Date.now();
    let rxRate = null, txRate = null;
    if (netPrev) {
      const dt = (now - netPrev.at) / 1000;
      if (dt > 0) { rxRate = Math.max(0, (rx - netPrev.rx) / dt); txRate = Math.max(0, (tx - netPrev.tx) / dt); }
    }
    netPrev = { at: now, rx, tx };
    return { connected: up, rxRate, txRate };
  } catch { return { connected: false, rxRate: null, txRate: null }; }
}
// Controller batteries (Xbox, PlayStation, Nintendo drivers all list them as scope "Device").
function controllerBatteries() {
  const out = [];
  try {
    const base = '/sys/class/power_supply';
    for (const n of fs.readdirSync(base)) {
      const r = (f) => { try { return fs.readFileSync(path.join(base, n, f), 'utf8').trim(); } catch { return ''; } };
      if (r('type') !== 'Battery' || r('scope') !== 'Device') continue;
      const pct = Number(r('capacity'));
      const level = r('capacity_level'); // some pads only say "Low"/"Normal"/"Full"
      const status = r('status');
      const model = r('model_name') || (/nintendo|joycon/i.test(n) ? 'Nintendo controller' : /ps-controller|dualsense|sony/i.test(n) ? 'PlayStation controller' : /xpad|xbox|gip/i.test(n) ? 'Xbox controller' : 'Controller');
      out.push({ name: model.slice(0, 40), pct: Number.isFinite(pct) && r('capacity') !== '' ? pct : null, level: level || null, charging: status === 'Charging' || status === 'Full' });
      if (out.length >= 8) break;
    }
  } catch { /* none */ }
  return out;
}
function systemInfo() {
  return { cpu: cpuPct(), ram: ramInfo(), storage: storageInfo(), battery: batteryInfo(), network: networkInfo(), uptime: os.uptime(), pads: controllerBatteries() };
}
ipcMain.handle('systemInfo', () => systemInfo());
app.on('before-quit', () => { try { devices.bluetooth.stop(); } catch { /* going away anyway */ } });

// ------------------------------------------------------------ PIN
// Only a salted hash is kept. A PIN keeps whoever is holding the controller out
// of Settings, deleting and adding things; the login password is the real lock.
let pinUnlockedUntil = 0;
let pinFails = 0;
let pinLockedUntil = 0;
const PIN_RE = /^\d{4,8}$/;
const pinIsSet = () => Boolean(settings.pin);
const pinOk = () => !pinIsSet() || Date.now() < pinUnlockedUntil;
const pinHash = (pin, salt) => crypto.scryptSync(pin, Buffer.from(salt, 'hex'), 32).toString('hex');
function pinMatches(pin) {
  if (!pinIsSet() || typeof pin !== 'string' || !PIN_RE.test(pin)) return false;
  const a = Buffer.from(pinHash(pin, settings.pin.salt), 'hex');
  const b = Buffer.from(settings.pin.hash, 'hex');
  return crypto.timingSafeEqual(a, b);
}
function pinInfo() {
  return { set: pinIsSet(), browser: settings.pinBrowser !== false, firstRun: !settings.firstRunDone, unlocked: pinOk() };
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
  if (pinFails >= 5) { pinLockedUntil = now + Math.min(300, 30 * 2 ** Math.floor((pinFails - 5) / 5)) * 1000; return { ok: false, wait: 30, error: 'Too many tries. Wait a little and try again.' }; }
  return { ok: false, error: `That isn't the PIN. ${5 - pinFails} ${5 - pinFails === 1 ? 'try' : 'tries'} left.` };
}
const NEED_PIN = { ok: false, needPin: true, error: 'Enter the PIN first.' };

ipcMain.handle('settings', safe((op, p) => {
  if (op === 'pinStatus') return pinInfo();
  if (op === 'pinCheck') return pinTry(p.pin);
  if (op === 'pinLock') { pinUnlockedUntil = 0; return { ok: true }; }
  if (op === 'firstRunDone') { settings.firstRunDone = true; saveSettings(); return { ok: true, prefs: prefsPayload() }; }
  if (op === 'pinSet') {
    if (typeof p.pin !== 'string' || !PIN_RE.test(p.pin)) return { ok: false, error: 'Use 4 to 8 digits.' };
    if (pinIsSet()) { const t = pinTry(p.old); if (!t.ok) return t; }
    const salt = crypto.randomBytes(16).toString('hex');
    settings.pin = { salt, hash: pinHash(p.pin, salt) };
    settings.firstRunDone = true;
    pinUnlockedUntil = Date.now() + 5 * 60 * 1000;
    saveSettings();
    return { ok: true, prefs: prefsPayload() };
  }
  if (op === 'pinRemove') {
    if (!pinIsSet()) return { ok: true, prefs: prefsPayload() };
    const t = pinTry(p.pin);
    if (!t.ok) return t;
    settings.pin = null;
    saveSettings();
    return { ok: true, prefs: prefsPayload() };
  }
  if (op === 'pinBrowser') {
    if (!pinOk()) return NEED_PIN;
    settings.pinBrowser = p.value === true;
    saveSettings();
    return { ok: true, prefs: prefsPayload() };
  }
  // Changing what the library can reach, or what's installed, needs the PIN when one is set.
  if (['removeRoot', 'themeUse', 'driveName'].includes(op) && !pinOk()) return NEED_PIN;
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
  if (['calSet', 'calReset', 'calToggle', 'calSystem'].includes(op) && !pinOk()) return NEED_PIN;
  if (op === 'calGet') return { ok: true, calibration: calPayload() };
  if (op === 'calSet') {
    const c = cleanCal({ ...p.cal, enabled: true, at: new Date().toISOString() });
    if (!c || !p.cal) return { ok: false, error: "That calibration isn't valid." };
    settings.calibration = c;
    saveSettings(); syncCalFx();
    return { ok: true, prefs: prefsPayload() };
  }
  if (op === 'calReset') {
    settings.calibration = null; settings.calibrationSystem = false;
    saveSettings(); syncCalFx();
    try { fs.rmSync(CAL_FAILED, { force: true }); } catch { /* ignore */ }
    return { ok: true, prefs: prefsPayload() };
  }
  if (op === 'calToggle') {
    if (!settings.calibration) return { ok: false, error: 'Calibrate first.' };
    settings.calibration.enabled = p.enabled === true;
    saveSettings(); syncCalFx();
    return { ok: true, prefs: prefsPayload() };
  }
  if (op === 'calSystem') {
    if (!settings.calibration) return { ok: false, error: 'Calibrate first.' };
    settings.calibrationSystem = p.on === true;
    if (p.on === true) { try { fs.rmSync(CAL_FAILED, { force: true }); } catch { /* ignore */ } }
    saveSettings(); syncCalFx();
    return { ok: true, prefs: prefsPayload() };
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
  if (op === 'pageGridSet') {
    // cols and rows for one page; leaving them out goes back to the theme's grid size
    if (p.cols === undefined && p.rows === undefined) {
      if (typeof p.key !== 'string') return { ok: false };
      delete settings.pageGrid[p.key];
    } else {
      const g = cleanPageGrid(p.key, p.cols, p.rows);
      if (!g) return { ok: false };
      settings.pageGrid[p.key] = g;
      const keys = Object.keys(settings.pageGrid);
      if (keys.length > 200) delete settings.pageGrid[keys[0]];
    }
    saveSettings();
    return { ok: true, prefs: prefsPayload() };
  }
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
    if (k === 'joycons') padsCtl.regroup();
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
  const view = browserView;
  if (!view || !mainWindow || mainWindow.isDestroyed() ||
      !browserViewAttached || view.webContents.isDestroyed()) return;
  try {
    for (const event of browserNavigation.keyEvents(key)) view.webContents.sendInputEvent(event);
  } catch {}
}
// ---- the browser pointer: a cursor on one stick, scrolling on the other, clicks on the triggers.
// A small transparent view floats above the page to draw the cursor, since synthetic mouse
// events don't move a real pointer. It hides itself after a few seconds without use.
const browserPointerLib = require('./browser-pointer');
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
  const view = browserView;
  return view && mainWindow && !mainWindow.isDestroyed() && browserViewAttached && !view.webContents.isDestroyed() ? view : null;
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
    if (!mainWindow || mainWindow.isDestroyed()) return { width: 1280, height: 720 };
    const { width, height } = mainWindow.getContentBounds();
    return { width, height };
  },
  settings: () => settings.pad,
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
if (DEV) globalThis.__tesseraBrowserAnalog = browserAnalog;
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
  send('browser-action', action);
}
function browserNavigationKey(key) {
  const view = browserView;
  const embeddedActive = Boolean(
    view && mainWindow && !mainWindow.isDestroyed() && browserViewAttached && !view.webContents.isDestroyed()
  );
  if (embeddedActive) sendBrowserViewKey(key);
  else if (browserShoulder) sendExternalBrowserKey(key);
}
function browserPadDirectionRepeater(id) {
  let navigation = browserPadNavigation.get(id);
  if (!navigation) {
    navigation = browserGamepad.createDirectionRepeater({ onAction: browserNavigationKey });
    browserPadNavigation.set(id, navigation);
  }
  return navigation;
}
function clearBrowserPadNavigation(id) {
  if (id !== undefined) browserPointer.removeSource('pad:' + id);
  if (id !== undefined) {
    const navigation = browserPadNavigation.get(id);
    if (navigation) navigation.dispose();
    browserPadNavigation.delete(id);
    return;
  }
  for (const navigation of browserPadNavigation.values()) navigation.dispose();
  browserPadNavigation.clear();
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
  running = true;
  let finished = false;
  let closing = 0;
  let stopWatching = null;
  // 'error' and 'close' can both fire; only the first one counts.
  const finish = (message) => {
    if (finished) return;
    finished = true;
    running = false;
    runningInfo = null;
    guideOverGame = false;
    if (stopWatching) stopWatching();
    browserShoulder = null;
    clearBrowserPadNavigation();
    padsCtl.resume();
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
  // Its own process group, so "Close game" in the guide can end it and anything it started.
  const child = spawn(file, args, { cwd, shell: false, stdio: ['ignore', out, out], detached: true });
  runningInfo = {
    kind: isBrowser ? 'browser' : 'game',
    title: title || label,
    since: Date.now(),
    close: () => {
      if (isBrowser && browserShoulder) return browserShoulder(0);
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
      setTimeout(() => { if (!finished) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } } }, 5000);
    },
  };
  if (typeof out === 'number') try { fs.closeSync(out); } catch { /* the child has its own copy */ }
  child.once('error', (err) => finish(`Launch failed: ${err.message}`));
  child.once('close', (code, signal) =>
    finish(isBrowser || code === 0 ? null : `${label} exited (${code !== null ? 'code ' + code : signal}).` + (logFile ? ` Details: ${display(logFile)}` : ''))
  );
  if (!isBrowser) padsCtl.pause(); // a game reads its controllers itself; Tessera reads nothing meanwhile
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
    browserShoulder = closeBrowser;
  }
}

ipcMain.on('launch', (_event, id) => {
  if (typeof id !== 'string') return;
  if (running) return send('launch-failed', `${runningInfo ? runningInfo.title : 'A game'} is still running. Close it from the guide first.`);
  if (id === '_browser') {
    if (settings.pinBrowser !== false && !pinOk()) return send('launch-failed', 'Enter the PIN first.');
    const b = resolveBrowser();
    if (!b) return send('launch-failed', "Couldn't find a web browser to open.");
    return runChild(b.file, b.args, os.homedir(), 'Browser', null, 'Browser');
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
  runChild(game.path, game.args || [], path.dirname(game.path), 'Game', game.id, game.title);
});

// ------------------------------------------------------------------ the Guide button
// Watched here, not in the page: during a game the launcher window is hidden and Chromium
// gives hidden windows no controller input. Every controller's Guide button (evdev BTN_MODE)
// is read directly, read-only, so games keep seeing it too. guide-button.js tells a quick
// press from a long hold; Settings > Controller > Guide button says what each one does.
const guideButtonLib = require('./guide-button');
let runningInfo = null;     // what is running: { kind, title, since, close }
let guideOverGame = false;  // the launcher is up in front of a running game
const guideButton = guideButtonLib.createGuideButton({ mode: () => settings.pad.guideButton, onAction: guideAction });
function guideAction(action, how) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (GUIDE_ONLY) return guideHelperAction(action);
  const inGame = Boolean(running && runningInfo);
  if (inGame && !guideOverGame) {
    // Bring Tessera up in front of the game. Most games stop reading the controller once they
    // lose focus, so the guide's buttons don't leak into the game. The game keeps running.
    guideOverGame = true;
    if (runningInfo.kind === 'game') padsCtl.resume();
    mainWindow.show();
    mainWindow.focus();
  }
  send('guide', { action, how, inGame, overGame: guideOverGame, title: inGame ? runningInfo.title : '' });
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
  if (launcherRunning()) return;
  const when = settings.pad.guideDesktop || 'auto';
  if (when === 'off' || (when === 'auto' && steamRunning())) return;
  if (action === 'home') {
    // Holding Guide on the desktop means "take me to Tessera".
    return execFile('/usr/bin/tessera-return', [], () => {});
  }
  if (guideHelperShown) return send('guide', { action: 'menu', desktop: true });
  guideHelperShown = true;
  padsCtl.resume();
  mainWindow.show();
  mainWindow.focus();
  send('guide', { action: 'menu', desktop: true });
}
let guideWatch = null;
ipcMain.handle('guide', (_e, op, p) => {
  p = p && typeof p === 'object' ? p : {};
  if (op === 'status') {
    return { watching: guideWatch ? guideWatch.count() : 0, running: Boolean(running && runningInfo), title: runningInfo ? runningInfo.title : '', kind: runningInfo ? runningInfo.kind : '', since: runningInfo ? runningInfo.since : 0, overGame: guideOverGame, mode: settings.pad.guideButton, helper: GUIDE_ONLY };
  }
  // The page saw Guide itself (keyboard, or a controller this process can't read).
  if (op === 'press') {
    const action = p.action === 'home' || p.action === 'menu' ? p.action : null;
    if (action) guideAction(action, 'press');
    return { ok: Boolean(action) };
  }
  if (op === 'resume') {
    if (!running || !runningInfo) { guideOverGame = false; return { ok: false }; }
    guideOverGame = false;
    if (runningInfo.kind === 'game') padsCtl.pause();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); // the game comes back to the front
    return { ok: true };
  }
  // Desktop helper: the guide closed, hide the window again. Or go back to Tessera.
  if (op === 'hideHelper') {
    if (!GUIDE_ONLY) return { ok: false };
    guideHelperShown = false;
    padsCtl.pause();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    return { ok: true };
  }
  if (op === 'returnToTessera') {
    if (!GUIDE_ONLY) return { ok: false };
    execFile('/usr/bin/tessera-return', [], () => {});
    return { ok: true };
  }
  if (op === 'closeGame') {
    if (!running || !runningInfo) return { ok: false, error: 'Nothing is running.' };
    runningInfo.close();
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
});
// Integration tests (TESSERA_DEV=1 only) press the Guide button through this, standing in for a pad.
if (DEV) globalThis.__tesseraGuide = { down: (s) => guideButton.down(s || 'qa'), up: (s) => guideButton.up(s || 'qa') };

// Desktop Mode. tessera-session has to tell "the person chose Desktop Mode" from "Tessera crashed"
// (which it restarts). Gamescope's exit code cannot tell it: at shutdown it is not reliable, and a
// non-zero code on a normal exit made Tessera start again instead of leaving. So leaving writes a
// note first and the session goes by the note. tessera-session sets TESSERA_LEAVE_FILE.
const LEAVE_FILE = process.env.TESSERA_LEAVE_FILE || path.join(path.dirname(LOG_DIR), 'leave-requested');
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
// ------------------------------------------------------------- embedded browser view
// WebContentsView is the supported Electron 44 API; the browser remains inside Tessera.
let browserView = null;
let browserViewAttached = false;
let browserSessionOpen = false;
const BROWSER_PARTITION = 'persist:tessera-browser';
function isLauncherMainFrame(event) {
  return Boolean(
    event && mainWindow && !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    event.senderFrame && event.senderFrame === mainWindow.webContents.mainFrame
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
      sendBrowserAction(input.key === 'ArrowLeft' ? 'lb' : 'rb');
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
  if (!browserView || !mainWindow || mainWindow.isDestroyed() || browserViewAttached) return;
  mainWindow.contentView.addChildView(browserView);
  browserViewAttached = true;
  // The cursor view goes on after the page so it draws above it.
  mainWindow.contentView.addChildView(ensureBrowserCursorView());
  startBrowserPointer();
  try { browserView.webContents.focus(); } catch { /* browser closed while attaching */ }
}
function detachBrowserView() {
  if (!browserView || !mainWindow || mainWindow.isDestroyed() || !browserViewAttached) return;
  clearBrowserPadNavigation();
  stopBrowserPointer();
  if (browserCursorView) { try { mainWindow.contentView.removeChildView(browserCursorView); } catch { /* not attached */ } }
  mainWindow.contentView.removeChildView(browserView);
  browserViewAttached = false;
  try { mainWindow.focus(); } catch { /* window is closing */ }
}
function fitBrowserView() {
  if (!browserView || !mainWindow || mainWindow.isDestroyed()) return;
  const { width, height } = mainWindow.getContentBounds();
  browserView.setBounds({ x: 0, y: 0, width, height });
}
// The renderer provides the interactive PIN prompt, but the privileged navigation
// entry point verifies it too so a compromised renderer cannot bypass browser policy.
ipcMain.handle('browser', async (event, op, payload) => {
  if (!isLauncherMainFrame(event)) return { ok: false, error: 'Unauthorized browser request.' };
  if (op === 'open' || op === 'go') {
    const url = payload && typeof payload.url === 'string' ? payload.url : null;
    if (settings.pinBrowser !== false && !pinOk()) return NEED_PIN;
    const checked = browserNavigation.validateHttpUrl(url);
    if (!checked.ok) return checked;
    const fresh = !browserView;
    const view = ensureBrowserView();
    browserSessionOpen = true;
    attachBrowserView();
    startBrowserViewJoystickWatch();
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
    const view = embeddedBrowserView();
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
    stopBrowserViewJoystickWatch();
    return { ok: true };
  }
  if (op === 'show') {
    if (settings.pinBrowser !== false && !pinOk()) return NEED_PIN;
    if (!browserSessionOpen) return { ok: false, error: 'Open the browser first.' };
    if (browserView) { attachBrowserView(); startBrowserViewJoystickWatch(); fitBrowserView(); }
    return { ok: true };
  }
  if (op === 'close') {
    browserSessionOpen = false;
    detachBrowserView();
    stopBrowserViewJoystickWatch();
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
});
ipcMain.handle('quit', () => {
  if (!pinOk()) return NEED_PIN;
  leaveTessera();
  return { ok: true };
});
app.on('window-all-closed', () => app.quit());
