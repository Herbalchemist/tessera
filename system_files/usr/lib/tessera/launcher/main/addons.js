// SPDX-License-Identifier: GPL-3.0-or-later
// Add-ons and the Tessera folder: widgets, themes, shards and the folders that hold them.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get addonDir() { return addonDir; },
  get addonsInfo() { return addonsInfo; },
  get ensureTree() { return ensureTree; },
  get inlayDef() { return inlayDef; },
  get itemDeleteTarget() { return itemDeleteTarget; },
  get scanAddons() { return scanAddons; },
  get serveWidget() { return serveWidget; },
  get VAULT_DIR() { return VAULT_DIR; },
  get VAULT_FOLDERS() { return VAULT_FOLDERS; },
  get vaultDelete() { return vaultDelete; },
  get vaultFolder() { return vaultFolder; },
  get vaultRoots() { return vaultRoots; },
  get WIDGET_ID_RE() { return WIDGET_ID_RE; },
  get widgets() { return widgets; },
  get packs() { return packs; },
};

const path = require('path');
const os = require('os');
const fs = require('fs');
const { verifyAddon } = require('../addon-verify');
const config = require('./config');
const library = require('./library');
const prefs = require('./prefs');
const theming = require('./theming');
const calibration = require('./calibration');
const folderBrowser = require('./folderBrowser');

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
// (pinRequired / allowUnverified) above. Nothing in this folder runs until its owner turns it on
// in Settings > Add-ons > Shards; shards.js runs the ones that are on.

const ADDON_DIRS = ['widgets', 'themes', 'art', 'fonts', 'sounds', 'packs'];
const WIDGET_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const WIDGET_MAX_FILE = 5 * 1024 * 1024;
// ------------------------------------------------------- the Tessera folder
// One folder (~/Tessera) holds what Tessera keeps: games, apps, themes, widgets,
// pictures and downloads. People can add their own folders inside it. Tessera
// itself only ever deletes things *inside* these folders, never the folders
// themselves, so nothing the system expects to find can be removed from here.
const VAULT_DIR = process.env.TESSERA_VAULT_DIR || path.join(process.env.TESSERA_DATA_DIR ? config.DATA_DIR : os.homedir(), 'Tessera');
const VAULT_FOLDERS = { games: 'Games', apps: 'Apps', themes: 'Themes', widgets: 'Widgets', art: 'Pictures', fonts: 'Fonts', sounds: 'Sounds', downloads: 'Downloads', packs: 'Shards' };
const addonDir = (name) => path.join(VAULT_DIR, VAULT_FOLDERS[name] || name);
const vaultFolder = (key) => path.join(VAULT_DIR, VAULT_FOLDERS[key]);
// Is this real path inside the Tessera folder? With strict, the folder itself and
// its fixed top-level folders don't count (those can never be deleted or renamed).
function inVault(rp, strict = false) {
  const v = folderBrowser.real(VAULT_DIR);
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
      const dir = folderBrowser.real(path.dirname(target));
      if (!dir || !inVault(path.join(dir, path.basename(target)), true)) return { ok: false, error: "That isn't inside your Tessera folder." };
      fs.unlinkSync(target);
      return { ok: true };
    }
    const rp = folderBrowser.real(target);
    if (!rp || !inVault(rp, true)) return { ok: false, error: "That isn't inside your Tessera folder." };
    if (fs.statSync(rp).dev !== fs.statSync(folderBrowser.real(VAULT_DIR)).dev) return { ok: false, error: "That is on another drive." };
    fs.rmSync(rp, { recursive: true, force: true });
    storage.sizeCache.clear();
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't delete that." };
  }
}
// What "delete the files" means for a game or app: its own folder under Games or
// Apps (or the file itself if it sits straight in there). Null if it lives anywhere else.
const vaultRoots = () => ['games', 'apps'].map((key) => folderBrowser.real(vaultFolder(key))).filter(Boolean);
function itemDeleteTarget(item, roots = vaultRoots()) {
  if (!roots.length) return null; // no Tessera folder yet: nothing in it to delete
  // Most games live elsewhere. Skip the (slow) path resolution unless the path starts in the Tessera folder.
  const raw = ['games', 'apps'].map((key) => vaultFolder(key));
  if (![...raw, ...roots].some((r) => item.path.startsWith(r + path.sep))) return null;
  const rp = folderBrowser.real(item.path);
  if (!rp) return null;
  for (const root of roots) {
    if (rp.startsWith(root + path.sep)) return path.join(root, path.relative(root, rp).split(path.sep)[0]);
  }
  return null;
}
function migrateAddonDirs() {
  for (const d of ADDON_DIRS) {
    const old = path.join(config.DATA_DIR, d);
    const dest = addonDir(d);
    if (old === dest || !folderBrowser.isDir(old)) continue;
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
Backdrop: "backdrop" is "none", "glow", "mystic", "tiles" (the Mosaic tile field), "cubes" or "stripes".
Browser transition: "browserAnim" is "slide", "zoom", "fade", "rise", "flip", "doors" or "none". Browser frame: "browserFrame" is "framed" or "full". Address bubble: "addressBubble" is "wide", "narrow" or "detached".
The full guide, with every setting: docs/theming.md in the Tessera repository (github.com/Herbalchemist/tessera).
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
  const name = library.cleanTitle(m.name);
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
      v.w >= 1 && v.w <= config.GRID.cols && v.h >= 1 && v.h <= config.GRID.rows;
    if (!ok) throw new Error(`"${label}" must look like { "w": 3, "h": 2 } within ${config.GRID.cols} x ${config.GRID.rows}`);
    return { w: v.w, h: v.h };
  };
  let size, min, max;
  const resizable = m.resizable === true;
  try {
    size = dims(m.size, { w: 3, h: 2 }, 'size');
    min = resizable ? dims(m.min, { w: 1, h: 1 }, 'min') : size;
    max = resizable ? dims(m.max, { w: config.GRID.cols, h: config.GRID.rows }, 'max') : size;
  } catch (e) { return { reason: e.message }; }
  if (min.w > size.w || min.h > size.h || max.w < size.w || max.h < size.h)
    return { reason: '"size" must be between "min" and "max"' };
  const opt = (v, max) => (typeof v === 'string' ? library.cleanTitle(v, max) || '' : '');
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
    const rp = folderBrowser.real(entryFile);
    const base = folderBrowser.real(dir);
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
  const name = library.cleanTitle(m.name);
  if (!name) return { reason: 'needs a "name"' };
  const entry = m.entry;
  if (typeof entry !== 'string' || !entry || entry.startsWith('/') || entry.split(/[\\/]/).includes('..'))
    return { reason: '"entry" must be a relative file inside the pack' };
  const opt = (v, max) => (typeof v === 'string' ? library.cleanTitle(v, max) || '' : '');
  // Which version of the shard API it's written for (see shards.js); 1 if it doesn't say.
  const api = m.tessera && typeof m.tessera === 'object' && Number.isInteger(m.tessera.api) ? m.tessera.api : 1;
  return { manifest: { name, description: opt(m.description, 160), author: opt(m.author, 60), version: opt(m.version, 20), entry, api } };
}

// Lists what's in the Shards folder and whether each one is genuinely signed by the project.
// This only discovers and describes shards — nothing here loads or runs a single line of a
// shard's own code; shards.js does that, for the ones their owner turned on.
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
    const rp = folderBrowser.real(entryFile);
    const base = folderBrowser.real(dir);
    if (!rp || !base || !rp.startsWith(base + path.sep) || !fs.statSync(rp).isFile()) {
      rejectedPacks.push({ id: e.name, reason: `"${r.manifest.entry}" was not found inside the folder` });
      continue;
    }
    const v = verifyAddon(dir);
    packs.set(e.name, { dir, manifest: r.manifest, official: v.official, reason: v.reason });
  }
}

function inlayDef(type) {
  if (config.BUILTIN_INLAYS[type]) return { ...config.BUILTIN_INLAYS[type], widget: null };
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
  const rp = folderBrowser.real(full);
  const base = folderBrowser.real(w.dir);
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
    presets: Object.entries(config.BUILTIN_INLAYS).map(([type, d]) => ({
      type, name: d.name, description: d.description, size: d.size, min: d.min, max: d.max, resizable: d.resizable,
    })),
    widgets: [...widgets].map(([id, w]) => ({
      id, type: 'widget:' + id, name: w.manifest.name, description: w.manifest.description,
      author: w.manifest.author, size: w.manifest.size, min: w.manifest.min, max: w.manifest.max, resizable: w.manifest.resizable,
    })),
    rejected,
    dirs: Object.fromEntries(ADDON_DIRS.map((d) => [d, calibration.display(addonDir(d))])),
    themeCount: countDirs('themes'),
    themes: [...theming.themes.values()].filter((t) => !t.builtin).map((t) => ({ id: t.id, name: t.name, author: t.author, settings: t.extra.length })),
    // Every theme, builtin and custom together — used by the Add-ons > Themes switcher, which
    // (unlike the remove-a-theme list above) needs to offer every factory theme too, not just
    // the ones you could delete.
    allThemes: [...theming.themes.values()].map((t) => ({ id: t.id, name: t.name, author: t.author, builtin: Boolean(t.builtin) })),
    packs: [...packs].map(([id, p]) => ({
      id, name: p.manifest.name, description: p.manifest.description, author: p.manifest.author, version: p.manifest.version,
      official: p.official, reason: p.reason, ...shards.statusOf(id),
    })),
    rejectedPacks,
    codeAddons: { pinRequired: prefs.settings.codeAddons.pinRequired, allowUnverified: prefs.settings.codeAddons.allowUnverified },
  };
}

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const storage = require('./storage');
const shards = require('./shards');
