// SPDX-License-Identifier: GPL-3.0-or-later
// The library: games, apps, pages (mosaics) and where entries sit on the grid.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get addItem() { return addItem; },
  get buildView() { return buildView; },
  get catById() { return catById; },
  get cleanTitle() { return cleanTitle; },
  get gc() { return gc; },
  get itemById() { return itemById; },
  get libraryOp() { return libraryOp; },
  get loadState() { return loadState; },
  get switchLayout() { return switchLayout; },
  get layoutOf() { return layoutOf; },
  get setLayout() { return setLayout; },
  get freshLayout() { return freshLayout; },
  get recordPlay() { return recordPlay; },
  get saveState() { return saveState; },
  get state() { return state; },
};

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

// ---------------------------------------------------------------- library

// items:      [{ id, kind: "game"|"app", title, path, args? }]
// inlays:     [{ id, type }]
// categories: [{ id, title, entries: [id...], top?: true, builtin?: true }]
// An entry is an item, an inlay, or another category (shown as a folder tile).
// A "top" category is a mosaic: it gets its own tab, in the order listed.
// The built-in Home category holds Home's tiles and cannot be renamed or deleted.
let state = { items: [], inlays: [], categories: [], tabOrder: [], recent: [], warn: null, locked: null };

function homeCat() {
  return { id: config.HOME_ID, title: 'Home', entries: [], builtin: true };
}

function readLibraryFile() {
  for (const file of [config.LIBRARY_FILE, config.LEGACY_FILE]) {
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
      (g.kind === undefined || config.KINDS.includes(g.kind)) &&
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
  const itemIds = new Set(items.map((i) => i.id));
  const live = parseLayout(data, itemIds);
  skipped += live.skipped;
  // The other people's pages, kept while someone else is playing (see switchLayout).
  const layouts = {};
  if (data.layouts && typeof data.layouts === 'object') {
    for (const [key, lay] of Object.entries(data.layouts).slice(0, 20)) {
      if (!LAYOUT_KEY_RE.test(key) || !lay || typeof lay !== 'object') continue;
      const parsed = parseLayout(lay, itemIds);
      delete parsed.skipped;
      layouts[key] = parsed;
    }
  }
  const layoutKey = typeof data.layoutKey === 'string' && LAYOUT_KEY_RE.test(data.layoutKey) ? data.layoutKey : EVERYONE;
  delete layouts[layoutKey];
  const { inlays, categories, tabOrder, recent } = live;
  state = {
    items,
    inlays,
    categories,
    tabOrder,
    recent,
    layouts,
    layoutKey,
    warn: skipped ? `${skipped} entry(ies) skipped: check ids, titles and absolute paths.` : null,
    locked: null,
  };
}

// One person's pages: the categories (Home and the mosaics), the widgets placed on them, the tab
// order and Recently played. The games and apps themselves (items) are shared by everyone.
function parseLayout(data, itemIds) {
  let skipped = 0;
  const ids = new Set(itemIds);
  const inlays = [];
  const autoPlace = [];
  for (const n of Array.isArray(data.inlays) ? data.inlays : []) {
    const ok =
      n &&
      typeof n.id === 'string' &&
      typeof n.type === 'string' &&
      (config.BUILTIN_INLAYS[n.type] || config.WIDGET_TYPE_RE.test(n.type)) &&
      !ids.has(n.id);
    if (!ok) { skipped++; continue; }
    ids.add(n.id);
    const inlay = { id: n.id, type: n.type, ...fitRect(addons.inlayDef(n.type), n) };
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
    if (c.id === config.HOME_ID) cat.builtin = true;
    // Older files placed categories as rows on tabs; they become mosaics.
    else if (c.top === true || config.LEGACY_TABS.includes(c.tab)) cat.top = true;
    categories.push(cat);
  }
  if (!catIds.has(config.HOME_ID)) categories.unshift(homeCat());
  const tabOrder = (Array.isArray(data.tabOrder) ? data.tabOrder : [])
    .filter((t) => typeof t === 'string' && config.TAB_ID_RE.test(t))
    .slice(0, 200);
  const recent = (Array.isArray(data.recent) ? data.recent : [])
    .filter((r) => r && typeof r.id === 'string' && itemIds.has(r.id) && Number.isFinite(r.at))
    .slice(0, config.RECENT_MAX)
    .map((r) => ({ id: r.id, at: r.at }));
  return { inlays, categories, tabOrder, recent, skipped };
}

function saveState() {
  fs.mkdirSync(path.dirname(config.LIBRARY_FILE), { recursive: true });
  const tmp = config.LIBRARY_FILE + '.tmp';
  fs.writeFileSync(
    tmp,
    JSON.stringify({ items: state.items, inlays: state.inlays, categories: state.categories, tabOrder: state.tabOrder, recent: state.recent, layoutKey: state.layoutKey || EVERYONE, layouts: state.layouts || {} }, null, 2)
  );
  fs.renameSync(tmp, config.LIBRARY_FILE); // atomic: a crash never leaves half a file
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
  const max = def ? def.max : { w: config.GRID.cols, h: config.GRID.rows };
  const dflt = def ? def.size : { w: 3, h: 2 };
  const num = (v, d) => (Number.isInteger(v) ? v : d);
  const w = Math.max(min.w, Math.min(max.w, num(r.w, dflt.w)));
  const h = Math.max(min.h, Math.min(max.h, num(r.h, dflt.h)));
  const x = Math.max(0, Math.min(config.GRID.cols - w, num(r.x, 0)));
  const y = Math.max(0, Math.min(config.GRID.rows - h, num(r.y, 0)));
  return { x, y, w, h };
}
function findFree(w, h, others) {
  for (let y = 0; y + h <= config.GRID.rows; y++)
    for (let x = 0; x + w <= config.GRID.cols; x++)
      if (!others.some((o) => overlaps({ x, y, w, h }, o))) return { x, y };
  return { x: 0, y: 0 };
}
const catById = (id) => state.categories.find((c) => c.id === id);

// What the renderer is allowed to see: ids, titles, kinds. Never paths.
function buildView() {
  const roots = addons.vaultRoots(); // looked up once for the whole list, not for every tile
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const tileOf = (it) => ({ id: it.id, title: it.title, kind: it.kind, art: Boolean(art.resolveArt(it)), custom: Boolean(it.art), deletable: Boolean(addons.itemDeleteTarget(it, roots)), offline: storage.offlineKind(it) });
  const tileFor = (ref, selfId) => {
    if (ref === selfId) return null;
    const it = byId.get(ref);
    if (it) return tileOf(it);
    const inl = inlayById(ref);
    if (inl) {
      // A widget that was removed from the folder stays on the page as a
      // placeholder, so putting it back restores it.
      const def = addons.inlayDef(inl.type);
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
  return { tabs, folders, mosaics, tabOrder: computeTabOrder(), recent, keys: prefs.settings.keys, prefs: theming.prefsPayload(), artRev: art.artRev, error: state.warn, nested: Boolean(process.env.TESSERA_NESTED) };
}

// Remember what was launched, newest first. Only the id and a time are stored.
function recordPlay(id) {
  state.recent = [{ id, at: Date.now() }, ...state.recent.filter((r) => r.id !== id)].slice(0, config.RECENT_MAX);
  if (!state.locked) {
    try { saveState(); } catch { /* not worth interrupting a game over */ }
  }
}

function cleanTitle(s, max = config.MAX_TITLE) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return t || null;
}

function newId(title, fallback) {
  const slug =
    title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || fallback;
  for (;;) {
    const id = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
    if (!itemById(id) && !catById(id) && !inlayById(id) && !storedLayoutUses(id)) return id;
  }
}
// Is an id used in someone else's pages? (A new game must never take the id of one of their pages.)
function storedLayoutUses(id) {
  return Object.values(state.layouts || {}).some((l) => l.categories.some((c) => c.id === id) || l.inlays.some((n) => n.id === id));
}

// ---- each person's pages (see parseLayout). The live ones are always the person playing.
const EVERYONE = '_everyone';
const LAYOUT_KEY_RE = /^(_everyone|[a-z0-9][a-z0-9._-]{0,23})$/;
const layoutNow = () => JSON.parse(JSON.stringify({ categories: state.categories, inlays: state.inlays, tabOrder: state.tabOrder, recent: state.recent }));
const freshLayout = () => ({ categories: [homeCat()], inlays: [], tabOrder: [], recent: [] });
// A copy of someone's pages, to start a new profile from.
function layoutOf(key) {
  if (key === (state.layoutKey || EVERYONE)) return layoutNow();
  const l = state.layouts && state.layouts[key];
  return l ? JSON.parse(JSON.stringify(l)) : null;
}
function setLayout(key, layout) {
  if (!LAYOUT_KEY_RE.test(key) || key === (state.layoutKey || EVERYONE)) return;
  state.layouts = state.layouts || {};
  if (layout) state.layouts[key] = layout;
  else delete state.layouts[key];
}
function switchLayout(to) {
  if (state.locked || !LAYOUT_KEY_RE.test(to)) return false;
  const from = state.layoutKey || EVERYONE;
  if (from === to) return true;
  state.layouts = state.layouts || {};
  state.layouts[from] = layoutNow();
  const next = state.layouts[to] || freshLayout();
  delete state.layouts[to];
  // Games removed while this person was away: drop them from their pages and history.
  const itemIds = new Set(state.items.map((i) => i.id));
  const parsed = parseLayout(next, itemIds);
  const known = new Set([...itemIds, ...parsed.categories.map((c) => c.id), ...parsed.inlays.map((n) => n.id)]);
  for (const c of parsed.categories) c.entries = c.entries.filter((e) => known.has(e));
  state.categories = parsed.categories;
  state.inlays = parsed.inlays;
  state.tabOrder = parsed.tabOrder;
  state.recent = parsed.recent;
  state.layoutKey = to;
  saveState();
  return true;
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
      art.artCache.delete(it.id);
      art.artRev++;
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
      const def = typeof p.type === 'string' ? addons.inlayDef(p.type) : null;
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
      const def = addons.inlayDef(inlay.type);
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
      const target = addons.itemDeleteTarget(it);
      if (!target) return { ok: false, error: "Tessera only deletes files it keeps in your Tessera folder. Remove it from the library instead, or uninstall it where you installed it." };
      const r = addons.vaultDelete(target);
      if (!r.ok) return r;
      const gone = (x) => { const rp = folderBrowser.real(x.path); return !rp || rp === target || rp.startsWith(target + path.sep); };
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

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const prefs = require('./prefs');
const theming = require('./theming');
const folderBrowser = require('./folderBrowser');
const art = require('./art');
const addons = require('./addons');
const storage = require('./storage');
