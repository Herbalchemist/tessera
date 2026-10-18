// SPDX-License-Identifier: GPL-3.0-or-later
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

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

const TABS = ['home', 'library', 'apps'];
const KINDS = ['game', 'app'];
const MAX_TITLE = 40;
const SCAN_DEPTH = 3;       // folders below a library folder
const SCAN_MAX_VISITS = 20000;
const BROWSE_MAX = 500;

let mainWindow = null;
let running = false;

// ---------------------------------------------------------------- library

// items:      [{ id, kind: "game"|"app", title, path, args? }]
// categories: [{ id, title, tab?: "home"|"library"|"apps", entries: [id...] }]
// An entry is an item id or another category id (shown as a folder tile).
// A category with a tab is a row on that tab; without one it is only a folder.
let state = { items: [], categories: [], warn: null, locked: null };

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
    state = { items: [], categories: [], warn: error, locked: error };
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
  const catIds = new Set();
  const categories = [];
  for (const c of Array.isArray(data.categories) ? data.categories : []) {
    const ok =
      c &&
      typeof c.id === 'string' &&
      typeof c.title === 'string' &&
      Array.isArray(c.entries) &&
      (c.tab === undefined || TABS.includes(c.tab)) &&
      !ids.has(c.id) &&
      !catIds.has(c.id);
    if (!ok) { skipped++; continue; }
    catIds.add(c.id);
    const cat = { id: c.id, title: c.title, entries: c.entries.filter((e) => typeof e === 'string') };
    if (c.tab) cat.tab = c.tab;
    categories.push(cat);
  }
  state = {
    items,
    categories,
    warn: skipped ? `${skipped} entry(ies) skipped: check ids, titles and absolute paths.` : null,
    locked: null,
  };
}

function saveState() {
  fs.mkdirSync(path.dirname(LIBRARY_FILE), { recursive: true });
  const tmp = LIBRARY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ items: state.items, categories: state.categories }, null, 2));
  fs.renameSync(tmp, LIBRARY_FILE); // atomic: a crash never leaves half a file
}

const itemById = (id) => state.items.find((i) => i.id === id);
const catById = (id) => state.categories.find((c) => c.id === id);

// What the renderer is allowed to see: ids, titles, kinds. Never paths.
function buildView() {
  const tilesFor = (c) =>
    c.entries
      .map((ref) => {
        if (ref === c.id) return null;
        const it = itemById(ref);
        if (it) return { id: it.id, title: it.title, kind: it.kind };
        const sub = catById(ref);
        return sub ? { id: sub.id, title: sub.title, kind: 'folder' } : null;
      })
      .filter(Boolean);

  const tabs = { home: [], library: [], apps: [] };
  const folders = {};
  for (const c of state.categories) {
    const tiles = tilesFor(c);
    folders[c.id] = { title: c.title, tiles };
    if (c.tab) tabs[c.tab].push({ id: c.id, title: c.title, tiles });
  }
  const tileOf = (it) => ({ id: it.id, title: it.title, kind: it.kind });
  const games = state.items.filter((i) => i.kind === 'game').map(tileOf);
  const apps = state.items.filter((i) => i.kind === 'app').map(tileOf);
  // Library and Apps always end with an "All" row, so nothing can get lost
  // just because it isn't filed in a category.
  if (games.length) tabs.library.push({ id: '_all_games', title: 'All games', tiles: games });
  if (apps.length) tabs.apps.push({ id: '_all_apps', title: 'All apps', tiles: apps });
  if (!tabs.home.length) {
    if (games.length) tabs.home.push({ id: '_home_games', title: 'Games', tiles: games });
    if (apps.length) tabs.home.push({ id: '_home_apps', title: 'Apps', tiles: apps });
  }
  return { tabs, folders, error: state.warn };
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
    if (!itemById(id) && !catById(id)) return id;
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

function libraryOp(op, p) {
  if (state.locked) return { ok: false, error: `Can't edit: ${state.locked} Fix the file first.` };
  switch (op) {
    case 'newCategory': {
      const title = cleanTitle(p.title);
      if (!title) return { ok: false, error: 'Give it a name first.' };
      const cat = { id: newId(title, 'category'), title, entries: [] };
      if (p.parentId !== undefined) {
        const parent = catById(p.parentId);
        if (!parent) return { ok: false, error: 'That folder no longer exists.' };
        parent.entries.push(cat.id);
      } else if (TABS.includes(p.tab)) {
        cat.tab = p.tab;
      } else if (p.tab === 'none') {
        // Lives only in the "+" tab until the user puts it somewhere.
      } else {
        return { ok: false, error: 'Pick where it should appear.' };
      }
      state.categories.push(cat);
      return { ok: true, message: `Created ${title}.`, id: cat.id };
    }
    case 'renameCategory': {
      const c = catById(p.id);
      const title = cleanTitle(p.title);
      if (!c || !title) return { ok: false, error: 'Could not rename that.' };
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
      state.categories = state.categories.filter((x) => x.id !== c.id);
      state.categories.forEach((x) => (x.entries = x.entries.filter((e) => e !== c.id)));
      return { ok: true, message: `Deleted ${c.title}. Things inside were not deleted.` };
    }
    case 'addEntry': {
      const c = catById(p.catId);
      if (!c) return { ok: false, error: 'That no longer exists.' };
      const isItem = Boolean(itemById(p.ref));
      const isCat = Boolean(catById(p.ref));
      if (!isItem && !isCat) return { ok: false, error: 'That no longer exists.' };
      if (c.entries.includes(p.ref)) return { ok: false, error: 'It is already in there.' };
      if (isCat && (p.ref === c.id || reaches(p.ref, c.id)))
        return { ok: false, error: 'That would put a folder inside itself.' };
      c.entries.push(p.ref);
      return { ok: true, message: `Added to ${c.title}.` };
    }
    case 'removeEntry': {
      const c = catById(p.catId);
      if (!c) return { ok: false, error: 'That no longer exists.' };
      c.entries = c.entries.filter((e) => e !== p.ref);
      return { ok: true, message: 'Removed from this row.' };
    }
    case 'deleteItem': {
      const it = itemById(p.id);
      if (!it) return { ok: false, error: 'That no longer exists.' };
      state.items = state.items.filter((x) => x.id !== it.id);
      state.categories.forEach((x) => (x.entries = x.entries.filter((e) => e !== it.id)));
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

let settings = { scanRoots: [] };

function loadSettings() {
  try {
    const d = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (d && Array.isArray(d.scanRoots))
      settings.scanRoots = d.scanRoots.filter((r) => typeof r === 'string' && path.isAbsolute(r));
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
  app.whenReady().then(createWindow);
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

ipcMain.handle('settings', safe((op, p) => {
  if (op === 'get') return { roots: settings.scanRoots.map(display) };
  if (op === 'removeRoot') {
    if (Number.isInteger(p.index) && p.index >= 0 && p.index < settings.scanRoots.length) {
      settings.scanRoots.splice(p.index, 1);
      saveSettings();
    }
    return { roots: settings.scanRoots.map(display) };
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

ipcMain.on('launch', (_event, id) => {
  if (running || typeof id !== 'string') return;
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

  running = true;
  let finished = false;
  // 'error' and 'close' can both fire; only the first one counts.
  const finish = (message) => {
    if (finished) return;
    finished = true;
    running = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    send('game-exited', message || null);
  };

  mainWindow.hide();
  // No shell, args passed separately, game runs from its own folder so
  // AnyPS5 can find libs/ and app0/. stdio is ignored so an unread pipe
  // can never fill up and freeze the game.
  const child = spawn(game.path, game.args || [], {
    cwd: path.dirname(game.path),
    shell: false,
    stdio: 'ignore',
  });
  child.once('error', (err) => finish(`Launch failed: ${err.message}`));
  child.once('close', (code, signal) =>
    finish(code === 0 ? null : `Game exited (${code !== null ? 'code ' + code : signal}).`)
  );
});

ipcMain.on('quit', () => app.quit());
app.on('window-all-closed', () => app.quit());
