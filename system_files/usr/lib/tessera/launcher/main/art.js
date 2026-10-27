// SPDX-License-Identifier: GPL-3.0-or-later
// Game pictures: Steam art, thumbnails and the tessera-art scheme.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get artCache() { return artCache; },
  get artRev() { return artRev; }, set artRev(v) { artRev = v; },
  get browse() { return browse; },
  get browseOp() { return browseOp; },
  get resolveArt() { return resolveArt; },
  get serveArtAsync() { return serveArtAsync; },
};

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const config = require('./config');
const library = require('./library');
const prefs = require('./prefs');
const theming = require('./theming');
const calibration = require('./calibration');
const folderBrowser = require('./folderBrowser');
const driveList = require('./driveList');

// ------------------------------------------------------------- game pictures
// A tile's picture is, in order: one the person picked, or one Tessera finds
// (Steam's library cache, Lutris cover art, a PS5 game's own icon, or a
// cover.png next to the game). The page only ever asks for a library id, so
// it never learns a path, and every file is checked before it is served.
const IMG_MAX_ART = 16 * 1024 * 1024; // bigger than this isn't a game picture. Big ones are shrunk before they reach the screen (see ART_SMALL)
const imageMime = (file) => {
  const mime = theming.IMG_EXT[path.extname(file).toLowerCase()];
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
    const rp = folderBrowser.real(f);
    if (rp && folderBrowser.underRoot(rp) && imageMime(rp)) return rp;
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
    const rp = folderBrowser.real(base);
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
  const item = library.itemById(id);
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
      ].some(folderBrowser.isDir);
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
    const home = folderBrowser.real(os.homedir());
    b.entries = [
      ...(folderBrowser.real(addons.VAULT_DIR) ? [{ name: 'Tessera folder', sub: calibration.display(addons.VAULT_DIR), isDir: true, full: folderBrowser.real(addons.VAULT_DIR) }] : []),
      ...(home ? [{ name: 'Home folder', sub: calibration.display(home), isDir: true, full: home }] : []),
      ...driveList.driveList().map((d) => ({ name: d.name, sub: d.tech, key: d.key, isDir: true, full: d.mount })),
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
      if (theming.IMG_EXT[path.extname(e.name).toLowerCase()]) rows.push({ name: e.name, isDir: false, full });
    } else if (file && !['addRoot', 'backupTo', 'restoreFrom'].includes(b.purpose)) {
      try { fs.accessSync(full, fs.constants.X_OK); } catch { continue; }
      rows.push({ name: e.name, isDir: false, full });
    }
  }
  rows.sort((a, c) => (a.isDir === c.isDir ? a.name.localeCompare(c.name) : a.isDir ? -1 : 1));
  b.entries = rows.slice(0, config.BROWSE_MAX);
  return {
    crumb: driveList.friendly(b.dir).name,
    canUp: true,
    canChooseHere: ['addRoot', 'backupTo', 'restoreFrom'].includes(b.purpose),
    entries: pub(),
    truncated: rows.length > config.BROWSE_MAX,
  };
}

function browseOp(op, p) {
  if (op === 'start') {
    if (!['addGame', 'addApp', 'addRoot', 'pickImage', 'pickArt', 'backupTo', 'restoreFrom'].includes(p.purpose)) return { error: 'Bad request.' };
    if (p.purpose === 'pickArt' && !library.itemById(p.item)) return { error: 'That no longer exists.' };
    browse = {
      purpose: p.purpose,
      item: p.purpose === 'pickArt' ? p.item : null,
      into: typeof p.into === 'string' && library.catById(p.into) ? p.into : null,
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
      const here = folderBrowser.real(browse.dir);
      browse.dir = driveList.topLevels().includes(here) ? null : path.dirname(here);
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
    const rp = folderBrowser.real(entry.full);
    if (!rp || !folderBrowser.underRoot(rp)) return { error: "Tessera can't browse there." };
    browse.dir = rp;
    return browseView();
  }
  if (op === 'choose') {
    if (browse.purpose === 'pickArt') {
      if (!entry || entry.isDir) return { error: 'Pick a picture.' };
      const rp = folderBrowser.real(entry.full);
      const item = library.itemById(browse.item);
      if (!item || !rp || !folderBrowser.underRoot(path.dirname(rp))) return { error: "Tessera can't use that file." };
      if (!imageMime(rp)) return { error: "That isn't a usable picture (PNG, JPEG or WebP, up to 8 MB)." };
      item.art = rp;
      artCache.delete(item.id);
      artRev++;
      library.saveState();
      browse = null;
      return { ok: true, message: 'Picture set.', view: library.buildView() };
    }
    if (browse.purpose === 'pickImage') {
      if (!entry || entry.isDir) return { error: 'Pick a picture.' };
      const rp = folderBrowser.real(entry.full);
      if (!rp || !folderBrowser.underRoot(path.dirname(rp))) return { error: "Tessera can't use that file." };
      if (!theming.setThemeValue('background', rp)) return { error: "This theme doesn't use a background picture." };
      const t = theming.themeImage('background');
      if (!t.dataUrl) { theming.setThemeValue('background', ''); return { error: t.error || "That picture can't be used." }; }
      browse = null;
      return { ok: true, message: 'Background set.', theme: theming.themePayload() };
    }
    if (browse.purpose === 'addRoot') {
      const rp = browse.dir && folderBrowser.real(browse.dir);
      if (!rp || !folderBrowser.underRoot(rp)) return { error: 'Pick a folder first.' };
      if (prefs.settings.scanRoots.includes(rp)) return { error: 'That folder is already on the list.' };
      prefs.settings.scanRoots.push(rp);
      prefs.saveSettings();
      browse = null;
      return { ok: true, message: `Added ${driveList.friendly(rp).name} to your library folders.` };
    }
    if (browse.purpose === 'backupTo' || browse.purpose === 'restoreFrom') {
      const rp = browse.dir && folderBrowser.real(browse.dir);
      if (!rp || !folderBrowser.underRoot(rp)) return { error: 'Pick a folder first.' };
      const which = browse.purpose;
      browse = null;
      return which === 'backupTo' ? storage.makeBackup(rp) : storage.restoreBackup(rp);
    }
    if (library.state.locked) return { error: `Can't edit: ${library.state.locked}` };
    if (!entry || entry.isDir) return { error: 'Pick a file.' };
    // The listing was built by this file inside an allowed place (or from the
    // fixed suggested list), so entry.full is trusted as-is.
    const file = entry.full;
    if (!entry.virtual && !folderBrowser.underRoot(path.dirname(file))) return { error: "Tessera can't use that file." };
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
    const into = browse.into && library.catById(browse.into);
    let item = library.addItem({ title, kind, file, args });
    if (!item) {
      // Already in the library: if we're filling a mosaic, just file it there.
      item = library.state.items.find((i) => i.path === file && JSON.stringify(i.args || []) === JSON.stringify(args));
      if (!(into && item && !into.entries.includes(item.id)))
        return { error: `That ${kind} is already in your library.` };
    }
    if (into) into.entries.push(item.id);
    library.saveState();
    browse = null;
    return { ok: true, message: `Added ${library.cleanTitle(item.title, 60)}.`, view: library.buildView() };
  }
  return { error: 'Unknown action.' };
}

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const addons = require('./addons');
const storage = require('./storage');
