// SPDX-License-Identifier: GPL-3.0-or-later
// The game scanner: library folders, Steam, Heroic, Lutris and desktop entries.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get found() { return found; },
  get runScan() { return runScan; },
};

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const config = require('./config');
const library = require('./library');
const prefs = require('./prefs');
const folderBrowser = require('./folderBrowser');
const steamShortcuts = require('../steam-shortcuts');

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
    folderBrowser.isDir(path.join(os.homedir(), '.var', 'app', 'com.valvesoftware.Steam'))
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
  const native = web.whichOnPath(bin);
  if (native) return { file: native, pre: [] };
  const fp = web.whichOnPath('flatpak');
  if (fp && folderBrowser.isDir(path.join(os.homedir(), '.var', 'app', flatpakId))) return { file: fp, pre: ['run', flatpakId] };
  return null;
}

// Installed apps that call themselves games (freedesktop "Game" category). They
// are offered unticked: system folders hold plenty you may not want here.
function scanDesktopGames(offer) {
  const skipExec = /(^|\/)(steam|lutris|heroic)$/;
  const seen = new Set();
  for (const dir of web.desktopDirs()) {
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
      const cmd = web.parseDesktopExec(kv.Exec || '');
      const file = cmd && web.whichOnPath(cmd.file);
      if (!file || skipExec.test(file) || cmd.args.some((a) => /^(steam:|lutris:|heroic:)/.test(a))) continue;
      const title = library.cleanTitle(kv.Name || '', 60);
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
    const title = library.cleanTitle(g.name, 60);
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
    const t = library.cleanTitle(typeof title === 'string' && title ? title : path.basename(String(installPath || appName)), 60);
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

// Games added to Steam by hand ("non-Steam games", Steam's shortcuts.vdf). Xodus Nexus and other
// launchers put their games there, so this finds them without knowing those launchers. Heroic and
// Lutris are read directly above, so their own shortcuts are left out here (no doubles).
function scanSteamShortcuts(offer) {
  const steam = steamLauncher();
  if (!steam) return;
  for (const s of steamShortcuts.read(os.homedir())) {
    if (s.hidden || /heroic|lutris/i.test(`${s.exe} ${s.options}`)) continue;
    const title = library.cleanTitle(s.name, 60);
    if (title && !STEAM_SKIP.test(title)) offer({ title, source: 'Steam (added game)', kind: 'game', file: steam.file, args: [...steam.pre, `steam://rungameid/${s.launchId}`] });
  }
}

function runScan() {
  found = new Map();
  const notes = new Set();
  const known = new Set(library.state.items.map((i) => i.path + '\0' + JSON.stringify(i.args || [])));
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
    if (depth > config.SCAN_DEPTH || visits > config.SCAN_MAX_VISITS) return;
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
          const title = nm && library.cleanTitle(nm[1], 60);
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
          title: library.cleanTitle(path.basename(dir), 60) || exes[0],
          source: 'PS5 (AnyPS5)', kind: 'game', file, args: [],
        });
      }
      return; // don't dig into the game's own folders
    }

    for (const e of ents) {
      if (e.isDirectory() && !e.isSymbolicLink()) walk(path.join(dir, e.name), depth + 1);
    }
  };

  const roots = prefs.settings.scanRoots.filter(folderBrowser.isDir);
  if (roots.length < prefs.settings.scanRoots.length) notes.add('Some library folders are missing (is a drive unplugged?).');
  roots.forEach((r) => walk(r, 0));
  if (steamSeen && !steam) notes.add('Found Steam games but no Steam launcher is installed.');
  if (visits > config.SCAN_MAX_VISITS) notes.add('Scan stopped early: that is a lot of files. Try a more specific folder.');
  // Launchers that keep their own game lists are read from their usual places.
  for (const source of [scanHeroic, scanLutris, scanSteamShortcuts, scanDesktopGames, shards.scanSources]) {
    try { source(offer, notes); } catch { /* one broken source never stops the rest */ }
  }

  return {
    found: [...found].map(([cid, c]) => ({ cid, title: c.title, source: c.source, optional: Boolean(c.optional) })),
    notes: [...notes].join(' ') || null,
  };
}

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const web = require('./web');
const shards = require('./shards');
