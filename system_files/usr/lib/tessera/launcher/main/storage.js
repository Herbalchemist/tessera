// SPDX-License-Identifier: GPL-3.0-or-later
// Storage: sizes, install location, drives for games, cleanup, back up and restore.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get lowSpace() { return lowSpace; },
  get makeBackup() { return makeBackup; },
  get offlineKind() { return offlineKind; },
  get restoreBackup() { return restoreBackup; },
  get sizeCache() { return sizeCache; },
  get storageDrives() { return storageDrives; },
  get storageOp() { return storageOp; },
  get watchDrives() { return watchDrives; },
};

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const config = require('./config');
const library = require('./library');
const prefs = require('./prefs');
const theming = require('./theming');
const calibration = require('./calibration');
const folderBrowser = require('./folderBrowser');
const driveList = require('./driveList');
const art = require('./art');
const addons = require('./addons');
const appWindow = require('./appWindow');

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
      if (!folderBrowser.isDir(root) || !isMountedDir(root)) return 'drive';
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
      const mp = driveList.unescapeMount(left.split(' ')[4] || '');
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
const driveHasLibrary = (mount) => prefs.settings.scanRoots.some((r) => { const rp = folderBrowser.real(r) || r; return rp === mount || rp.startsWith(mount + path.sep); });
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
  const labels = driveList.lsblkLabels();
  const named = driveList.driveList();
  const put = (mount, source, extra = {}) => {
    if (!mount || out.has(mount)) return;
    let st;
    try { st = fs.statfsSync(mount); } catch { return; }
    const total = st.blocks * st.bsize;
    if (!total) return;
    const info = labels.get(source) || {};
    const nd = named.find((d) => d.mount === mount);
    const key = nd ? nd.key : (info.uuid || 'dir:' + mount);
    const name = prefs.settings.driveNames[key] || (nd && nd.name) || info.label || extra.fallbackName || path.basename(mount) || 'Drive';
    out.set(mount, {
      key, mount, name, source, total,
      free: st.bavail * st.bsize,
      used: Math.max(0, (st.blocks - st.bfree) * st.bsize),
      external: Boolean(nd), system: Boolean(extra.system),
      removable: isRemovable(source),
      ejectable: Boolean(nd) && ['/run/media/', '/media/'].some((p) => mount.startsWith(p)),
      library: driveHasLibrary(mount),
      hidden: prefs.settings.hiddenDrives.includes(key),
      muted: prefs.settings.mutedDrives.includes(key),
    });
  };
  const v = folderBrowser.real(addons.VAULT_DIR);
  const vm = v && mountOf(v);
  if (vm) put(vm.mount, vm.source, { system: true, fallbackName: 'Main storage' });
  for (const d of named) { if (!isMountedDir(d.mount)) continue; const s = driveList.mountSources().get(d.mount); put(d.mount, s ? s.source : '', {}); }
  for (const r of prefs.settings.scanRoots) { const rp = folderBrowser.real(r); const m = rp && mountOf(rp); if (m) put(m.mount, m.source, { fallbackName: 'Drive' }); }
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
  const rp = folderBrowser.real(it.path);
  if (!rp) return null;
  const t = addons.itemDeleteTarget(it);
  if (t) return t;
  for (const root of prefs.settings.scanRoots) {
    const r = folderBrowser.real(root);
    if (!r || !rp.startsWith(r + path.sep)) continue;
    const segs = path.relative(r, rp).split(path.sep);
    if (segs[0] === 'steamapps' && segs[1] === 'common' && segs.length > 3) return path.join(r, 'steamapps', 'common', segs[2]);
    return segs.length > 1 ? path.join(r, segs[0]) : rp; // a file straight in the library folder is just itself
  }
  // A game added as a single file: its folder, unless that folder is a broad one (Home, Downloads, /usr…).
  const dir = path.dirname(rp);
  const home = folderBrowser.real(os.homedir());
  const broad = dir === home || dir === '/' || dir.split(path.sep).filter(Boolean).length <= 2 ||
    /^\/(usr|bin|sbin|etc|lib|lib64|opt|var\/lib|app)(\/|$)/.test(dir) ||
    (home && path.dirname(dir) === home && ['Downloads', 'Documents', 'Desktop', 'Pictures', 'Music', 'Videos'].includes(path.basename(dir)));
  return broad ? rp : dir;
}
async function gameSizes(deadline) {
  const rows = [];
  const dirs = new Map();
  for (const it of library.state.items) {
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
  const vaultReal = folderBrowser.real(addons.VAULT_DIR);
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
      const dir = path.join(vaultReal, addons.VAULT_FOLDERS[key]);
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
    vault: { path: calibration.display(addons.VAULT_DIR), bytes: vaultBytes, parts: vault },
    hiddenCount: storageDrives(true).filter((d) => d.hidden).length,
    install: (() => { const t = installTarget(); return t ? driveList.friendly(t).name : ''; })(),
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
      offline: off, drive: dr ? dr.name : '', deletable: Boolean(addons.itemDeleteTarget(it)),
    };
  }).sort((a, b) => (b.bytes || 0) - (a.bytes || 0) || a.title.localeCompare(b.title));
  return { ok: true, games, partial: gs.partial };
}

// ---- install location, downloads
function installChoices() {
  const g = folderBrowser.real(addons.vaultFolder('games'));
  const roots = [...(g ? [g] : []), ...prefs.settings.scanRoots.map((r) => folderBrowser.real(r)).filter((r) => r && r !== g && folderBrowser.isDir(r))];
  return roots;
}
function installTarget() {
  const r = prefs.settings.installRoot && folderBrowser.real(prefs.settings.installRoot);
  if (r && folderBrowser.isDir(r) && installChoices().includes(r)) return r;
  return folderBrowser.real(addons.vaultFolder('games'));
}
function installView() {
  const cur = installTarget();
  const drives = storageDrives();
  return installChoices().map((r) => {
    const m = mountOf(r);
    const d = m && drives.find((x) => x.mount === m.mount);
    return { name: driveList.friendly(r).name, free: d ? d.free : null, current: r === cur };
  });
}
async function downloadsInfo() {
  const dir = folderBrowser.real(addons.vaultFolder('downloads'));
  if (!dir) return { ok: true, path: '', bytes: 0, count: 0 };
  let count = 0;
  try { count = fs.readdirSync(dir).filter((n) => n !== 'README.txt').length; } catch { /* ignore */ }
  sizeCache.delete(dir);
  const b = await dirSize(dir, Date.now() + 15000);
  return { ok: true, path: calibration.display(dir), bytes: b || 0, count };
}
function clearDownloads() {
  const dir = folderBrowser.real(addons.vaultFolder('downloads'));
  if (!dir) return { ok: false, error: 'No Downloads folder.' };
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'README.txt') continue;
    if (addons.vaultDelete(path.join(dir, name)).ok) n++;
  }
  sizeCache.clear();
  return { ok: true, message: n ? `Cleared ${n} item${n === 1 ? '' : 's'} from Downloads.` : 'Downloads was already empty.' };
}

// ---- drives: use for games, ignore, eject, and the new-drive watcher
const LIB_FOLDER_NAMES = ['Games', 'games', 'SteamLibrary'];
function useDriveForGames(key) {
  const d = driveList.driveList().find((x) => x.key === key);
  if (!d) return { ok: false, error: "That drive isn't connected." };
  let added = [];
  const existing = LIB_FOLDER_NAMES.map((n) => path.join(d.mount, n)).filter(folderBrowser.isDir);
  const targets = existing.length ? existing : [path.join(d.mount, 'Games')];
  for (const t of targets) {
    try { fs.mkdirSync(t, { recursive: true }); } catch { return { ok: false, error: "Couldn't use this drive. Is it read-only?" }; }
    const rp = folderBrowser.real(t);
    if (rp && !prefs.settings.scanRoots.includes(rp)) { prefs.settings.scanRoots.push(rp); added.push(rp); }
  }
  prefs.saveSettings();
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
  if (config.running) return { ok: false, error: 'Close the game first.' };
  const d = storageDrives().find((x) => x.key === key);
  if (!d || !d.ejectable) return { ok: false, error: d ? 'Only plugged-in drives can be ejected.' : "That drive isn't connected." };
  const home = folderBrowser.real(os.homedir()); const v = folderBrowser.real(addons.VAULT_DIR);
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
    if (config.running) return;
    let list;
    try { list = driveList.driveList(); } catch { return; }
    const keys = new Set(list.map((d) => d.key));
    if (knownDrives) {
      let changed = knownDrives.size !== keys.size || [...keys].some((k) => !knownDrives.has(k));
      for (const d of list) {
        if (knownDrives.has(d.key) || prefs.settings.ignoredDrives.includes(d.key) || prefs.settings.hiddenDrives.includes(d.key) || driveHasLibrary(d.mount)) continue;
        let st; try { st = fs.statfsSync(d.mount); } catch { continue; }
        appWindow.send('drive-added', { key: d.key, name: d.name, free: st.bavail * st.bsize, total: st.blocks * st.bsize });
      }
      if (changed) { lowCache.at = 0; appWindow.send('init', library.buildView()); }
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
  for (const it of library.state.items) {
    if (offlineKind(it) === 'missing') broken.push(it.id);
    const key = (folderBrowser.real(it.path) || it.path) + '\0' + JSON.stringify(it.args || []);
    if (seen.has(key)) dupes.push({ id: it.id, keep: seen.get(key) }); else seen.set(key, it.id);
  }
  const known = new Set([...library.state.items.map((i) => i.id), ...library.state.categories.map((c) => c.id), ...library.state.inlays.map((i) => i.id)]);
  let orphans = 0;
  for (const c of library.state.categories) for (const e of c.entries) if (!known.has(e)) orphans++;
  let logBytes = 0; let logFiles = 0;
  try { for (const n of fs.readdirSync(config.LOG_DIR)) { const st = fs.statSync(path.join(config.LOG_DIR, n)); if (st.isFile()) { logBytes += st.size; logFiles++; } } } catch { /* none */ }
  return { ok: true, broken: broken.length, dupes: dupes.length, orphans, logBytes, logFiles, _broken: broken, _dupes: dupes };
}
function cleanRun(what) {
  if (library.state.locked) return { ok: false, error: `Can't edit: ${library.state.locked}` };
  const sc = cleanScan();
  const done = [];
  const drop = (id) => { library.state.items = library.state.items.filter((x) => x.id !== id); library.state.categories.forEach((c) => (c.entries = c.entries.filter((e) => e !== id))); };
  if (what.includes('broken') && sc._broken.length) { sc._broken.forEach(drop); done.push(`${sc._broken.length} broken`); }
  if (what.includes('dupes') && sc._dupes.length) {
    for (const d of sc._dupes) {
      library.state.categories.forEach((c) => { if (c.entries.includes(d.id)) c.entries = c.entries.includes(d.keep) ? c.entries.filter((e) => e !== d.id) : c.entries.map((e) => (e === d.id ? d.keep : e)); });
      library.state.items = library.state.items.filter((x) => x.id !== d.id);
    }
    done.push(`${sc._dupes.length} duplicate`);
  }
  if (what.includes('orphans') && sc.orphans) {
    const known = new Set([...library.state.items.map((i) => i.id), ...library.state.categories.map((c) => c.id), ...library.state.inlays.map((i) => i.id)]);
    library.state.categories.forEach((c) => (c.entries = c.entries.filter((e) => known.has(e))));
    done.push(`${sc.orphans} stray`);
  }
  if (what.includes('logs') && sc.logFiles) {
    try {
      const files = fs.readdirSync(config.LOG_DIR).map((n) => ({ n, t: fs.statSync(path.join(config.LOG_DIR, n)).mtimeMs })).sort((a, b) => b.t - a.t).slice(1);
      for (const f of files) { try { fs.unlinkSync(path.join(config.LOG_DIR, f.n)); } catch { /* skip */ } }
      done.push('old log');
    } catch { /* ignore */ }
  }
  if (!done.length) return { ok: true, message: 'Nothing to clean up.' };
  library.gc();
  library.saveState();
  return { ok: true, message: `Cleaned up: ${done.join(', ')}.` };
}

// ---- back up and restore: layout, library and settings (not the PIN) go to a folder the person picks
function makeBackup(dest) {
  const day = new Date().toISOString().slice(0, 10);
  let dir = path.join(dest, `Tessera-backup-${day}`);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(dest, `Tessera-backup-${day}-${n}`);
  try {
    fs.mkdirSync(dir);
    library.saveState(); prefs.saveSettings();
    fs.copyFileSync(config.LIBRARY_FILE, path.join(dir, 'library.json'));
    const s = JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf8'));
    delete s.pin; // a backup never carries the PIN
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s, null, 2));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ tessera: 1, created: new Date().toISOString() }, null, 2));
  } catch { return { ok: false, error: "Couldn't save the backup there. Is the drive full or read-only?" }; }
  return { ok: true, message: `Backup saved in ${driveList.friendly(dir).name}.` };
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
    const keep = path.join(config.DATA_DIR, 'backups', `before-restore-${Date.now()}`);
    fs.mkdirSync(keep, { recursive: true });
    for (const f of [config.LIBRARY_FILE, config.SETTINGS_FILE]) { try { fs.copyFileSync(f, path.join(keep, path.basename(f))); } catch { /* none yet */ } }
    set.pin = prefs.settings.pin || undefined; // keep this install's PIN
    if (!set.pin) delete set.pin;
    set.firstRunDone = true;
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    fs.writeFileSync(config.LIBRARY_FILE, JSON.stringify(lib, null, 2));
    fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({ v: prefs.SETTINGS_VERSION, ...set }, null, 2));
    prefs.settings.scanRoots = [];
    prefs.loadSettings();
    library.loadState();
    art.artCache.clear(); art.artRev++; sizeCache.clear();
  } catch { return { ok: false, error: "Couldn't restore that backup. Your setup was left as it was." }; }
  return { ok: true, message: 'Backup restored.', view: library.buildView() };
}

async function storageOp(op, p) {
  try {
    const needsPin = ['useDrive', 'ignoreDrive', 'eject', 'setInstallRoot', 'clearDownloads', 'cleanRun', 'hideDrive', 'muteDrive'];
    if (needsPin.includes(op) && !pinLock.pinOk()) return pinLock.NEED_PIN;
    switch (op) {
      case 'overview': return await storageOverview(p.measure === true);
      case 'games': return await storageGames(p.measure === true);
      case 'installRoots': return { ok: true, roots: installView() };
      case 'setInstallRoot': {
        const list = installChoices();
        if (!Number.isInteger(p.index) || p.index < 0 || p.index >= list.length) return { ok: false, error: 'Pick one from the list.' };
        prefs.settings.installRoot = list[p.index]; prefs.saveSettings();
        return { ok: true, message: `New games will go to ${driveList.friendly(list[p.index]).name}.`, roots: installView() };
      }
      case 'downloads': return await downloadsInfo();
      case 'clearDownloads': return clearDownloads();
      case 'useDrive': return useDriveForGames(p.key);
      case 'ignoreDrive': {
        if (typeof p.key === 'string' && p.key.length < 200 && !prefs.settings.ignoredDrives.includes(p.key)) {
          prefs.settings.ignoredDrives.push(p.key);
          prefs.settings.ignoredDrives = prefs.settings.ignoredDrives.slice(-64);
          prefs.saveSettings();
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
        prefs.settings[field] = prefs.settings[field].filter((k) => k !== p.key);
        if (on) prefs.settings[field] = [...prefs.settings[field], p.key].slice(-64);
        prefs.saveSettings(); lowCache.at = 0;
        return { ok: true, prefs: theming.prefsPayload() };
      }
      case 'hiddenDrives': return { ok: true, drives: storageDrives(true).filter((d) => d.hidden).map((d) => ({ key: d.key, name: d.name, total: d.total })) };
      case 'forget': sizeCache.clear(); lowCache.at = 0; return { ok: true };
      default: return { ok: false, error: 'Unknown action.' };
    }
  } catch {
    return { ok: false, error: 'Something went wrong.' };
  }
}

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const pinLock = require('./pinLock');
