// SPDX-License-Identifier: GPL-3.0-or-later
// Drives: what lsblk says is plugged in.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get driveList() { return driveList; },
  get friendly() { return friendly; },
  get lsblkCache() { return lsblkCache; },
  get lsblkLabels() { return lsblkLabels; },
  get mountSources() { return mountSources; },
  get topLevels() { return topLevels; },
  get unescapeMount() { return unescapeMount; },
};

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const prefs = require('./prefs');
const calibration = require('./calibration');
const folderBrowser = require('./folderBrowser');

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
      if (mp && source && source.startsWith('/dev/')) out.set(folderBrowser.real(mp) || mp, { fstype, source });
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
  const add = (p) => { const rp = folderBrowser.real(p); if (rp && folderBrowser.isDir(rp) && !found.has(rp)) found.set(rp, p); };
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
    let name = prefs.settings.driveNames[key] || auto;
    if (taken.has(name)) name = `${name} (${path.basename(rp)})`;
    taken.add(name);
    return { key, mount: rp, name, auto, custom: Boolean(prefs.settings.driveNames[key]), tech: [s && s.source, calibration.display(rp)].filter(Boolean).join(' · ') };
  });
}
// Home first, then every drive. Going "up" from any of these lands on this list.
const topLevels = () => {
  const home = folderBrowser.real(os.homedir());
  const v = folderBrowser.real(addons.VAULT_DIR);
  return [...(v ? [v] : []), ...(home ? [home] : []), ...driveList().map((d) => d.mount)];
};
// A path shown the way a person would say it: "Games SSD / SteamLibrary".
function friendly(p) {
  const rp = folderBrowser.real(p) || p;
  const d = driveList().find((x) => rp === x.mount || rp.startsWith(x.mount + path.sep));
  if (d) return { name: [d.name, ...rp.slice(d.mount.length).split(path.sep).filter(Boolean)].join(' / '), tech: calibration.display(rp) };
  return { name: calibration.display(rp), tech: '' };
}

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const addons = require('./addons');
