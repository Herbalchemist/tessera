// SPDX-License-Identifier: GPL-3.0-or-later
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');

// Widgets are shown through their own scheme so the app can control exactly
// what they may load. Must be registered before the app is ready.
const WIDGET_SCHEME = 'tessera-widget';
protocol.registerSchemesAsPrivileged([
  { scheme: WIDGET_SCHEME, privileges: { standard: true, secure: true } },
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
};
const WIDGET_TYPE_RE = /^widget:[a-z0-9][a-z0-9._-]{0,63}$/;
const TAB_ID_RE = /^(home|library|apps|m:[A-Za-z0-9._-]{1,80})$/;
const HOME_ID = '_home'; // Home is a built-in page that holds entries like any mosaic
const MAX_TITLE = 40;
const SCAN_DEPTH = 3;       // folders below a library folder
const SCAN_MAX_VISITS = 20000;
const BROWSE_MAX = 500;

let mainWindow = null;
let running = false;

// ---------------------------------------------------------------- library

// items:      [{ id, kind: "game"|"app", title, path, args? }]
// inlays:     [{ id, type }]
// categories: [{ id, title, entries: [id...], top?: true, builtin?: true }]
// An entry is an item, an inlay, or another category (shown as a folder tile).
// A "top" category is a mosaic: it gets its own tab, in the order listed.
// The built-in Home category holds Home's tiles and cannot be renamed or deleted.
let state = { items: [], inlays: [], categories: [], tabOrder: [], warn: null, locked: null };

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
  state = {
    items,
    inlays,
    categories,
    tabOrder,
    warn: skipped ? `${skipped} entry(ies) skipped: check ids, titles and absolute paths.` : null,
    locked: null,
  };
}

function saveState() {
  fs.mkdirSync(path.dirname(LIBRARY_FILE), { recursive: true });
  const tmp = LIBRARY_FILE + '.tmp';
  fs.writeFileSync(
    tmp,
    JSON.stringify({ items: state.items, inlays: state.inlays, categories: state.categories, tabOrder: state.tabOrder }, null, 2)
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
    if (it) return { id: it.id, title: it.title, kind: it.kind };
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
  const tileOf = (it) => ({ id: it.id, title: it.title, kind: it.kind });
  const games = state.items.filter((i) => i.kind === 'game').map(tileOf);
  const apps = state.items.filter((i) => i.kind === 'app').map(tileOf);
  // Library and Apps are automatic: everything you've added, filed or not.
  const tabs = {
    library: games.length ? [{ id: '_all_games', title: 'All games', tiles: games }] : [],
    apps: apps.length ? [{ id: '_all_apps', title: 'All apps', tiles: apps }] : [],
  };
  const mosaics = state.categories.filter((c) => c.top).map((c) => ({ id: c.id, title: c.title }));
  return { tabs, folders, mosaics, tabOrder: computeTabOrder(), keys: settings.keys, error: state.warn };
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
// 8 View, 9 Menu. A always types, and the D-pad always moves.
const DEFAULT_KEYS = { back: 1, space: 2, shift: 3, done: 9, cancel: 8 };
const RESERVED_BUTTONS = [0, 12, 13, 14, 15];

let settings = { scanRoots: [], keys: { ...DEFAULT_KEYS } };

function loadSettings() {
  try {
    const d = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (d && Array.isArray(d.scanRoots))
      settings.scanRoots = d.scanRoots.filter((r) => typeof r === 'string' && path.isAbsolute(r));
    if (d && d.keys && typeof d.keys === 'object') {
      for (const k of Object.keys(DEFAULT_KEYS)) {
        const v = d.keys[k];
        if (Number.isInteger(v) && v >= 0 && v < 32 && !RESERVED_BUTTONS.includes(v)) settings.keys[k] = v;
      }
    }
  } catch {
    /* none yet */
  }
}
function saveSettings() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
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
const browseRoots = () =>
  [os.homedir(), '/run/media', '/mnt', '/var/mnt'].map(real).filter((r) => r && isDir(r));
const underRoot = (rp) => browseRoots().some((r) => rp === r || rp.startsWith(r + path.sep));

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
  const pub = () => b.entries.map((e) => ({ name: e.name, isDir: e.isDir }));
  if (!b.dir) {
    b.entries = browseRoots().map((r) => ({ name: display(r), isDir: true, full: r }));
    if (b.purpose === 'addApp')
      b.entries.unshift({ name: 'Suggested apps', isDir: true, virtual: true });
    return { crumb: 'Choose a location', canUp: false, canChooseHere: false, entries: pub() };
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
    else if (file && b.purpose !== 'addRoot') {
      try { fs.accessSync(full, fs.constants.X_OK); } catch { continue; }
      rows.push({ name: e.name, isDir: false, full });
    }
  }
  rows.sort((a, c) => (a.isDir === c.isDir ? a.name.localeCompare(c.name) : a.isDir ? -1 : 1));
  b.entries = rows.slice(0, BROWSE_MAX);
  return {
    crumb: display(b.dir),
    canUp: true,
    canChooseHere: b.purpose === 'addRoot',
    entries: pub(),
    truncated: rows.length > BROWSE_MAX,
  };
}

function browseOp(op, p) {
  if (op === 'start') {
    if (!['addGame', 'addApp', 'addRoot'].includes(p.purpose)) return { error: 'Bad request.' };
    browse = {
      purpose: p.purpose,
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
  if (op === 'up') {
    if (browse.dir === SUGGESTED) browse.dir = null;
    else if (browse.dir) {
      const here = real(browse.dir);
      browse.dir = browseRoots().includes(here) ? null : path.dirname(here);
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
    if (browse.purpose === 'addRoot') {
      const rp = browse.dir && real(browse.dir);
      if (!rp || !underRoot(rp)) return { error: 'Pick a folder first.' };
      if (settings.scanRoots.includes(rp)) return { error: 'That folder is already on the list.' };
      settings.scanRoots.push(rp);
      saveSettings();
      browse = null;
      return { ok: true, message: `Added ${display(rp)} to your library folders.` };
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

function runScan() {
  found = new Map();
  const notes = [];
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

    // AnyPS5 output: an executable next to sce_module/ and app0/
    const names = new Set(ents.filter((e) => e.isDirectory()).map((e) => e.name));
    if (names.has('sce_module') && names.has('app0')) {
      const exes = ents
        .filter((e) => e.isFile() && !/\.(so|sh|txt|json|md)$/i.test(e.name) && !e.name.includes('.so.'))
        .map((e) => e.name)
        .filter((n) => { try { fs.accessSync(path.join(dir, n), fs.constants.X_OK); return true; } catch { return false; } })
        .sort((a, b) => Number(/^eboot/i.test(b)) - Number(/^eboot/i.test(a)));
      if (exes.length) {
        offer({
          title: cleanTitle(path.basename(dir), 60) || exes[0],
          source: 'PS5 (AnyPS5)', kind: 'game', file: path.join(dir, exes[0]), args: [],
        });
      }
      return; // don't dig into the game's own folders
    }

    for (const e of ents) {
      if (e.isDirectory() && !e.isSymbolicLink()) walk(path.join(dir, e.name), depth + 1);
    }
  };

  const roots = settings.scanRoots.filter(isDir);
  if (roots.length < settings.scanRoots.length) notes.push('Some library folders are missing (is a drive unplugged?).');
  roots.forEach((r) => walk(r, 0));
  if (steamSeen && !steam) notes.push('Found Steam games but no Steam launcher is installed.');
  if (visits > SCAN_MAX_VISITS) notes.push('Scan stopped early: that is a lot of files. Try a more specific folder.');

  return {
    found: [...found].map(([cid, c]) => ({ cid, title: c.title, source: c.source })),
    notes: notes.join(' ') || null,
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
  themes: `Themes go here, one folder each. Theme support is coming; for now this
folder just reserves the spot so downloads have somewhere to land.
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
    backgroundColor: '#10151c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => {
    ensureTree();
    scanAddons();
    loadState();
    loadSettings();
    send('init', buildView());
  });
  // Keyboard fallback exit. Local to this window, so it never steals keys from a game.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      app.quit();
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
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
  if (op === 'rescan') scanAddons();
  if (op === 'list' || op === 'rescan') return addonsInfo();
  return { error: 'Unknown action.' };
}));

ipcMain.handle('settings', safe((op, p) => {
  if (op === 'get') return { roots: settings.scanRoots.map(display) };
  if (op === 'removeRoot') {
    if (Number.isInteger(p.index) && p.index >= 0 && p.index < settings.scanRoots.length) {
      settings.scanRoots.splice(p.index, 1);
      saveSettings();
    }
    return { roots: settings.scanRoots.map(display) };
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
function runChild(file, args, cwd, label) {
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
  const child = spawn(file, args, { cwd, shell: false, stdio: 'ignore', detached: isBrowser });
  child.once('error', (err) => finish(`Launch failed: ${err.message}`));
  child.once('close', (code, signal) =>
    finish(isBrowser || code === 0 ? null : `${label} exited (${code !== null ? 'code ' + code : signal}).`)
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
    return send(
      'launch-failed',
      `Can't run ${path.basename(game.path)}. Check that it exists and is executable.`
    );
  }
  // The game runs from its own folder so AnyPS5 can find libs/ and app0/.
  runChild(game.path, game.args || [], path.dirname(game.path), 'Game');
});

ipcMain.on('quit', () => app.quit());
app.on('window-all-closed', () => app.quit());
