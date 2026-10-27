// SPDX-License-Identifier: GPL-3.0-or-later
// Shards: add-ons that are code. Turning them on and off, running them, and installing add-ons
// from the catalog (Settings > Add-ons > Get add-ons).
// Part of the launcher's main process (see main.js for the order the parts load in).
//
// A shard runs in Tessera's main process with Tessera's own reach, so:
//   - nothing in the Shards folder runs until its owner turns it on (Settings > Add-ons > Shards);
//   - it only runs if it's Official (signed by the project, checked again every time it starts) or
//     the owner allows unverified shards (Shard safety);
//   - turning one on or off, installing and removing need the PIN when Shard safety asks for it.
//
// What a shard's entry file looks like (API version 1):
//
//   module.exports = {
//     activate(tessera) {
//       tessera.addPanel({ title, render, action })   // a page in Settings > Add-ons > Shards
//       tessera.addLibrarySource({ name, scan })       // games or apps for Settings > Find games
//     },
//     deactivate() {},                                 // optional: called when it's turned off
//   };
//
//   render()        -> { body, items: [{ label, sub, action }] } (may be async)
//   action(name)    -> { body, items } to show next, { message } for the status line,
//                      or { openUrl: 'https://...' } to open Tessera's browser there (may be async)
//   scan(offer)     -> calls offer({ title, kind: 'game' | 'app', file, args }) for each one found;
//                      must not be async (the scan is not)
//   tessera.dataDir -> a folder of the shard's own, kept across updates
//   tessera.log(...)-> a line in Tessera's log folder (shards.log)

module.exports = {
  get forget() { return forget; },
  get scanSources() { return scanSources; },
  get startEnabled() { return startEnabled; },
  get statusOf() { return statusOf; },
};

const fs = require('fs');
const path = require('path');
const { ipcMain, net } = require('electron');
const { verifyAddon } = require('../addon-verify');
const addonPackage = require('../addon-package');
const config = require('./config');
const library = require('./library');
const prefs = require('./prefs');
const theming = require('./theming');
const addons = require('./addons');

const API_VERSION = 1;
const CATALOG_URL = process.env.TESSERA_ADDON_CATALOG || 'https://raw.githubusercontent.com/Herbalchemist/tessera-addons/main/catalog.json';
// Where packages may come from: GitHub (release downloads redirect to its asset hosts), or the same
// place as the catalog (a test catalog on this machine).
const PACKAGE_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'raw.githubusercontent.com']);
const RENDER_TIMEOUT_MS = 15000;
const SHARD_DATA = path.join(config.DATA_DIR, 'shards');

const running = new Map(); // id -> { mod, panels: [], sources: [], error, official }
const failed = new Map();  // id -> why it isn't running

const shardLog = (id, ...args) => {
  try {
    fs.mkdirSync(config.LOG_DIR, { recursive: true });
    const line = `${new Date().toISOString()} [${id}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`.slice(0, 2000);
    fs.appendFileSync(path.join(config.LOG_DIR, 'shards.log'), line + '\n');
  } catch { /* logging never breaks anything */ }
};

const withTimeout = (p, ms, what) => Promise.race([
  Promise.resolve(p),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took too long`)), ms)),
]);

const clip = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max) : '');
const ACTION_RE = /^[A-Za-z0-9._:-]{1,64}$/;

// What a panel shows, cleaned: only short strings make it to the page.
function cleanView(v) {
  if (!v || typeof v !== 'object') return { body: '', items: [] };
  const items = (Array.isArray(v.items) ? v.items : []).slice(0, 60).map((it) => ({
    label: clip(it && it.label, 80) || '·',
    sub: clip(it && it.sub, 240),
    action: it && typeof it.action === 'string' && ACTION_RE.test(it.action) ? it.action : null,
  }));
  const out = { body: clip(v.body, 1500), items };
  if (typeof v.message === 'string') out.message = clip(v.message, 200);
  if (typeof v.openUrl === 'string') {
    try { const u = new URL(v.openUrl); if (u.protocol === 'https:' || u.protocol === 'http:') out.openUrl = u.href; } catch { /* dropped */ }
  }
  return out;
}

// ---------------------------------------------------------------------- running shards

function enabledIds() { return prefs.settings.codeAddons.enabled; }

function startShard(id) {
  if (running.has(id)) return { ok: true };
  failed.delete(id);
  const fail = (why) => { failed.set(id, why); shardLog(id, 'not started:', why); return { ok: false, error: why }; };
  const p = addons.packs.get(id);
  if (!p) return fail('It is not in the Shards folder.');
  // Checked again now, not at the last scan: the files may have changed since.
  const v = verifyAddon(p.dir);
  if (!v.official && !prefs.settings.codeAddons.allowUnverified) return fail('It is unverified, and Shard safety only allows Official shards.');
  if (p.manifest.api !== API_VERSION) return fail(`It is made for add-on API ${p.manifest.api}; this Tessera has API ${API_VERSION}.`);
  const entry = path.join(p.dir, p.manifest.entry);
  const record = { panels: [], sources: [], official: v.official, name: p.manifest.name, mod: null };
  const dataDir = path.join(SHARD_DATA, id);
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch { /* read-only data folder: it gets the path anyway */ }
  const api = Object.freeze({
    apiVersion: API_VERSION,
    id,
    tesseraVersion: require('./updates').LAUNCHER_VERSION,
    dataDir,
    log: (...a) => shardLog(id, ...a),
    addPanel(def) {
      if (!def || typeof def.render !== 'function' || record.panels.length >= 8) return false;
      record.panels.push({ title: clip(def.title, 60) || p.manifest.name, render: def.render, action: typeof def.action === 'function' ? def.action : null });
      return true;
    },
    addLibrarySource(def) {
      if (!def || typeof def.scan !== 'function' || record.sources.length >= 8) return false;
      record.sources.push({ name: clip(def.name, 40) || p.manifest.name, scan: def.scan });
      return true;
    },
  });
  try {
    delete require.cache[require.resolve(entry)]; // a reinstalled shard starts from its new files
    record.mod = require(entry);
    const r = record.mod && typeof record.mod.activate === 'function' ? record.mod.activate(api) : null;
    if (r && typeof r.then === 'function') r.catch((e) => { record.error = clip(String(e && e.message || e), 200); shardLog(id, 'activate failed:', record.error); });
  } catch (e) {
    return fail(`It stopped with an error: ${clip(String(e && e.message || e), 200)}`);
  }
  running.set(id, record);
  shardLog(id, `started (${v.official ? 'Official' : 'unverified'})`);
  return { ok: true };
}

function stopShard(id) {
  const r = running.get(id);
  running.delete(id);
  failed.delete(id);
  if (r && r.mod && typeof r.mod.deactivate === 'function') {
    try { r.mod.deactivate(); } catch (e) { shardLog(id, 'deactivate failed:', String(e && e.message || e)); }
  }
  if (r) shardLog(id, 'stopped');
  return Boolean(r);
}

// Called once the page has loaded and settings are read; safe to call again (only starts what isn't running).
function startEnabled() {
  for (const id of enabledIds()) if (!running.has(id)) startShard(id);
}

// A shard folder was removed: stop it and forget it was on.
function forget(id) {
  stopShard(id);
  const list = enabledIds();
  const i = list.indexOf(id);
  if (i >= 0) { list.splice(i, 1); prefs.saveSettings(); }
}

function statusOf(id) {
  const on = enabledIds().includes(id);
  const r = running.get(id);
  return {
    enabled: on,
    running: Boolean(r),
    error: (r && r.error) || failed.get(id) || null,
    panels: r ? r.panels.map((pn, i) => ({ index: i, title: pn.title })) : [],
  };
}

// Library sources, for the scanner: each shard's games and apps, checked before they're offered.
function scanSources(offer, notes) {
  for (const [id, r] of running) {
    for (const src of r.sources) {
      let count = 0;
      const check = (c) => {
        if (!c || typeof c !== 'object' || ++count > 2000) return;
        const title = library.cleanTitle(c.title, 60);
        const kind = c.kind === 'app' ? 'app' : c.kind === 'game' ? 'game' : null;
        const file = typeof c.file === 'string' && path.isAbsolute(c.file) && c.file.length < 4096 && !c.file.includes('\0') ? c.file : null;
        const args = Array.isArray(c.args) && c.args.length <= 32 && c.args.every((a) => typeof a === 'string' && a.length < 2048 && !a.includes('\0')) ? c.args.slice() : null;
        if (title && kind && file && args) offer({ title, source: src.name, kind, file, args });
      };
      try {
        const r2 = src.scan(check);
        if (r2 && typeof r2.then === 'function') notes.add(`${r.name}: its library source must not be async.`);
      } catch (e) {
        shardLog(id, 'scan failed:', String(e && e.message || e));
        notes.add(`${r.name} couldn't look for games.`);
      }
    }
  }
}

// ---------------------------------------------------------------------- the catalog

async function fetchBytes(url, max) {
  const res = await withTimeout(net.fetch(url, { redirect: 'follow', cache: 'no-store' }), 60000, 'The download');
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new Error('That download is too big.');
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch { /* gone */ } throw new Error('That download is too big.'); }
    chunks.push(Buffer.from(value));
  }
  return { buf: Buffer.concat(chunks), finalUrl: res.url || url };
}

function packageUrlAllowed(url) {
  try {
    const u = new URL(url);
    const cat = new URL(CATALOG_URL);
    if (u.origin === cat.origin && (u.protocol === 'https:' || process.env.TESSERA_ADDON_CATALOG)) return true;
    return u.protocol === 'https:' && PACKAGE_HOSTS.has(u.hostname);
  } catch { return false; }
}

let catalogCache = { at: 0, data: null };
async function getCatalog(fresh) {
  if (!fresh && catalogCache.data && Date.now() - catalogCache.at < 5 * 60 * 1000) return catalogCache.data;
  const { buf } = await fetchBytes(CATALOG_URL, 256 * 1024);
  const data = addonPackage.parseCatalog(buf);
  catalogCache = { at: Date.now(), data };
  return data;
}

const kindDir = (kind) => addons.addonDir(kind === 'shard' ? 'packs' : kind === 'widget' ? 'widgets' : 'themes');

function installedVersion(a) {
  try {
    const top = addonPackage.KINDS[a.kind];
    const m = JSON.parse(fs.readFileSync(path.join(kindDir(a.kind), a.id, top), 'utf8'));
    return typeof m.version === 'string' ? m.version.slice(0, 20) : '';
  } catch { return null; }
}

async function catalogView(fresh) {
  const c = await getCatalog(fresh);
  return c.addons.map((a) => {
    const have = installedVersion(a);
    return {
      id: a.id, kind: a.kind, name: a.name, version: a.version, author: a.author, description: a.description,
      size: a.size, requires: a.requires,
      installed: have !== null, installedVersion: have || '', update: have !== null && have !== '' && have !== a.version,
    };
  });
}

async function install(id) {
  const c = await getCatalog(true); // always the current list, so its SHA-256 matches what the server has now
  const a = c.addons.find((x) => x.id === id);
  if (!a) return { ok: false, error: "That add-on isn't in the list any more." };
  if (!packageUrlAllowed(a.url)) return { ok: false, error: "That add-on's download isn't from a place Tessera trusts." };
  const { buf, finalUrl } = await fetchBytes(a.url, addonPackage.LIMITS.packageBytes);
  if (!packageUrlAllowed(finalUrl)) return { ok: false, error: "That add-on's download went somewhere Tessera doesn't trust." };
  const wasRunning = a.kind === 'shard' && running.has(id);
  const r = addonPackage.installPackage(buf, a, kindDir(a.kind));
  addons.scanAddons();
  theming.scanThemes();
  let note = '';
  if (a.kind === 'shard') {
    const v = verifyAddon(r.dir);
    note = v.official ? ' It is Official (signed by Tessera).' : ' It is unverified (not signed by Tessera).';
    if (wasRunning) {
      stopShard(id);
      const s = startShard(id);
      note += s.ok ? ' Restarted with the new version.' : ` It didn't start again: ${s.error}`;
    } else note += ' Turn it on in Add-ons > Shards when you want it.';
  }
  return { ok: true, message: `${r.replaced ? 'Updated' : 'Installed'} ${a.name}.${note}` };
}

// ---------------------------------------------------------------------- requests from the page

const needPinFor = (kind) => {
  if (kind === 'shard') return prefs.settings.codeAddons.pinRequired && !pinLock.pinOk();
  return pinLock.pinIsSet() && !pinLock.pinOk();
};

ipcMain.handle('shards', async (_e, op, p) => {
  op = typeof op === 'string' ? op : '';
  p = p && typeof p === 'object' ? p : {};
  const id = typeof p.id === 'string' && addons.WIDGET_ID_RE.test(p.id) ? p.id : null;
  try {
    if (op === 'enable' || op === 'disable') {
      if (!id || !addons.packs.has(id)) return { ok: false, error: 'That shard is not installed.' };
      if (needPinFor('shard')) return pinLock.NEED_PIN;
      const list = enabledIds();
      if (op === 'enable') {
        const r = startShard(id);
        if (!r.ok) return { ok: false, error: r.error, info: addons.addonsInfo() }; // it stays off
        if (!list.includes(id)) { list.push(id); prefs.saveSettings(); }
        return { ok: true, message: `${addons.packs.get(id).manifest.name} is on.`, info: addons.addonsInfo() };
      }
      const i = list.indexOf(id);
      if (i >= 0) { list.splice(i, 1); prefs.saveSettings(); }
      stopShard(id);
      return { ok: true, message: `${addons.packs.get(id).manifest.name} is off. Anything it already started stops when Tessera restarts.`, info: addons.addonsInfo() };
    }
    if (op === 'panel' || op === 'action') {
      const r = id && running.get(id);
      const pn = r && Number.isInteger(p.panel) ? r.panels[p.panel] : null;
      if (!pn) return { ok: false, error: "That shard isn't running." };
      if (op === 'panel') return { ok: true, view: cleanView(await withTimeout(pn.render(), RENDER_TIMEOUT_MS, 'The shard')) };
      if (!pn.action || typeof p.action !== 'string' || !ACTION_RE.test(p.action)) return { ok: false, error: 'Bad request.' };
      return { ok: true, view: cleanView(await withTimeout(pn.action(p.action), RENDER_TIMEOUT_MS, 'The shard')) };
    }
    if (op === 'catalog') return { ok: true, addons: await catalogView(p.fresh === true) };
    if (op === 'install') {
      if (typeof p.id !== 'string' || !addonPackage.ID_RE.test(p.id)) return { ok: false, error: 'Bad request.' };
      const c = await getCatalog(true);
      const a = c.addons.find((x) => x.id === p.id);
      if (!a) return { ok: false, error: "That add-on isn't in the list any more." };
      if (needPinFor(a.kind)) return pinLock.NEED_PIN;
      const r = await install(p.id);
      return { ...r, info: addons.addonsInfo() };
    }
    return { ok: false, error: 'Unknown action.' };
  } catch (e) {
    const msg = String((e && e.message) || e);
    shardLog(id || (typeof p.id === 'string' ? p.id.slice(0, 64) : '?'), `${op} failed:`, msg);
    return { ok: false, error: /^(The |That |It )/.test(msg) ? msg : (op === 'catalog' || op === 'install' ? "Couldn't reach the add-on list. Check the internet connection." : 'The shard ran into a problem.') };
  }
});

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const pinLock = require('./pinLock');
