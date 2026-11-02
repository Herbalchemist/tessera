'use strict';
// Xbox games need the PIN: the rule itself, and the launcher's real main process with a stand-in for
// Electron (xbox-harness.js) and a small test shard that offers games the way the Xbox add-on does.
// No real window, Steam, Xodus Nexus or game is involved.
const test = require('node:test');
// The real main process starts timers that repeat for ever (the guide's scan, the drive check): once
// the tests are done the file must end by itself, or `node --test` waits on it (for ever on CI).
test.after(() => { setImmediate(() => process.exit()); });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const G = require('../xbox-gate');
const H = require('./xbox-harness');

const LAUNCHER = path.join(__dirname, '..');
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'xg-')); made.push(d); return d; };
const NEXUS_ARGS = ['/home/u/.config/Xodus Nexus/shortcuts/launch-game', '0123456789abcdef'];

// ------------------------------------------------------------------ the rule on its own
test('the PIN rule', () => {
  const g = (o) => G.xboxGate({ isXbox: true, enabled: true, pinSet: true, pinOk: true, ...o });
  assert.strictEqual(g({}), null);
  assert.match(g({ pinSet: false }), /need a PIN/);
  assert.match(g({ enabled: false }), /are off/);
  assert.match(g({ pinOk: false }), /Enter the PIN/);
  assert.match(g({ pinSet: false, enabled: false, pinOk: false }), /need a PIN/); // the most basic reason first
  assert.strictEqual(g({ isXbox: false, pinSet: false, enabled: false, pinOk: false }), null);
  assert.strictEqual(G.xboxOn({ pin: { salt: 'a', hash: 'b' }, xboxEnabled: true }), true);
  assert.strictEqual(G.xboxOn({ pin: null, xboxEnabled: true }), false);
  assert.strictEqual(G.xboxOn({ pin: { salt: 'a', hash: 'b' }, xboxEnabled: false }), false);
});

test('isXbox, and the Nexus commands Tessera recognises', () => {
  assert.strictEqual(G.isXbox({ xbox: true }), true);
  assert.strictEqual(G.isXbox({ xbox: 'yes' }), false);
  assert.strictEqual(G.isXbox({ path: '/bin/sh', args: NEXUS_ARGS }), true);
  assert.strictEqual(G.isXbox({ path: '/usr/bin/steam', args: ['-silent', 'steam://rungameid/1'] }), false);
  assert.strictEqual(G.isXbox(null), false);
  assert.strictEqual(G.looksLikeNexus(['/h/shortcuts/launch-nexus']), true);
  assert.strictEqual(G.looksLikeNexus(['/h/shortcuts/launch-game-extra']), false);
  assert.strictEqual(G.nexusSteamOptions('"/h/Xodus Nexus/shortcuts/launch-game" "0123456789abcdef"'), true);
  assert.strictEqual(G.nexusSteamOptions('"/h/x/shortcuts/launch-nexus"'), true);
  assert.strictEqual(G.nexusSteamOptions('-fullscreen'), false);
  assert.strictEqual(G.nexusSteamOptions('"/h/shortcuts/launch-games"'), false);
  assert.strictEqual(G.nexusSteamOptions(undefined), false);
});

// ------------------------------------------------------------------ through the real main process
// A shard offering two Xbox games (only when Tessera says it holds them behind the PIN, as the Xbox
// add-on does) and one ordinary game, as a library source.
function testShard(vault) {
  const dir = path.join(vault, 'Shards', 'xtest');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'addon.json'), JSON.stringify({ id: 'xtest', name: 'X Test', author: 't', version: '1.0.0', description: 'test', entry: 'index.js', tessera: { api: 1 } }));
  fs.writeFileSync(path.join(dir, 'index.js'), `module.exports = { activate(t) { const gate = Array.isArray(t.features) && t.features.includes('xbox-pin'); t.addLibrarySource({ name: 'Xbox (Nexus)', scan(offer) {
    if (gate) {
    offer({ title: 'Gears of War E-Day', kind: 'game', file: '/bin/sh', args: ${JSON.stringify(NEXUS_ARGS)}, xbox: true });
    offer({ title: 'Hades', kind: 'game', file: '/bin/sh', args: ['/x/shortcuts/launch-game', 'fedcba9876543210'], xbox: true });
    }
    offer({ title: 'Plain', kind: 'game', file: '/bin/true', args: [] });
  } }); } };`);
}

async function setup({ settings = {}, library = null, steam = null } = {}) {
  const tmp = mk();
  const data = path.join(tmp, 'data');
  fs.mkdirSync(data, { recursive: true });
  testShard(path.join(tmp, 'vault'));
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ v: 2, firstRunDone: true, codeAddons: { enabled: ['xtest'], allowUnverified: true, pinRequired: false }, ...settings }));
  if (library) fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify({ items: library, categories: [] }));
  if (steam) steam(path.join(tmp, 'home'));
  const spawned = [];
  const realExists = fs.existsSync;
  if (steam) fs.existsSync = (p) => (p === '/usr/bin/steam' ? true : realExists(p));
  Object.keys(require.cache).filter((k) => k.startsWith(LAUNCHER) && !k.includes(`${path.sep}test${path.sep}`)).forEach((k) => delete require.cache[k]);
  const app = await H.load({ launcher: LAUNCHER, tmp, spawned });
  return { app, tmp, spawned, dataDir: data, restore: () => { fs.existsSync = realExists; } };
}
const failures = (app) => app.sent.filter(([c]) => c === 'launch-failed').map(([, m]) => m);
const pinOn = async (app, pin = '2468') => { const r = await app.call('settings', 'pinSet', { pin }); assert.ok(r.ok, JSON.stringify(r)); return pin; };
const libItems = (s) => (fs.existsSync(path.join(s.dataDir, 'library.json')) ? JSON.parse(fs.readFileSync(path.join(s.dataDir, 'library.json'), 'utf8')).items : []);
const addAll = async (app) => {
  const r = await app.call('scan', 'run');
  return { r, add: await app.call('scan', 'add', { cids: r.found.map((f) => f.cid) }) };
};
const tiles = async (app) => JSON.stringify((await app.call('library', 'noop')).view);

test('Xbox off: a shard\'s Xbox games are only counted; its other games are offered as usual', async () => {
  const s = await setup();
  const r = await s.app.call('scan', 'run');
  assert.deepStrictEqual(r.found.map((f) => f.title), ['Plain']);
  assert.match(r.notes, /2 Xbox games found\. Turn on Xbox games in Settings > PIN/);
  s.restore();
});

test('Xbox needs a PIN to be switched on, and the PIN unlocked to change it', async () => {
  const s = await setup();
  let r = await s.app.call('settings', 'xboxEnabled', { value: true });
  assert.strictEqual(r.ok, false); assert.match(r.error, /Set a PIN first/);
  const pin = await pinOn(s.app);
  await s.app.call('settings', 'pinLock');
  r = await s.app.call('settings', 'xboxEnabled', { value: true });
  assert.strictEqual(r.needPin, true);
  assert.strictEqual((await s.app.call('settings', 'pinStatus')).xbox, false);
  assert.ok((await s.app.call('settings', 'pinCheck', { pin })).ok);
  assert.ok((await s.app.call('settings', 'xboxEnabled', { value: true })).ok);
  assert.strictEqual((await s.app.call('settings', 'pinStatus')).xbox, true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'settings.json'), 'utf8')).xboxEnabled, true);
  s.restore();
});

test('Xbox on: offered, marked, and adding them needs the PIN unlocked', async () => {
  const s = await setup();
  const pin = await pinOn(s.app);
  await s.app.call('settings', 'xboxEnabled', { value: true });
  const r = await s.app.call('scan', 'run');
  assert.deepStrictEqual(r.found.map((f) => f.title).sort(), ['Gears of War E-Day', 'Hades', 'Plain']);
  assert.strictEqual(r.notes, null);
  const cids = r.found.map((f) => f.cid);
  await s.app.call('settings', 'pinLock');
  assert.strictEqual((await s.app.call('scan', 'add', { cids })).needPin, true);
  assert.strictEqual(libItems(s).length, 0);
  await s.app.call('settings', 'pinCheck', { pin });
  assert.match((await s.app.call('scan', 'add', { cids })).message, /Added 3 games/);
  assert.deepStrictEqual(Object.fromEntries(libItems(s).map((i) => [i.title, i.xbox || null])), { 'Gears of War E-Day': true, Hades: true, Plain: null });
  const t = await tiles(s.app);
  assert.ok(/"title":"Hades"[^}]*"xbox":true/.test(t) && /"title":"Plain"[^}]*"xbox":false/.test(t));
  s.restore();
});

test('adding scanned Xbox games after Xbox was switched off is refused', async () => {
  const s = await setup();
  await pinOn(s.app);
  await s.app.call('settings', 'xboxEnabled', { value: true });
  const cids = (await s.app.call('scan', 'run')).found.map((f) => f.cid);
  await s.app.call('settings', 'xboxEnabled', { value: false });
  const add = await s.app.call('scan', 'add', { cids });
  assert.strictEqual(add.ok, false); assert.match(add.error, /are off/);
  assert.strictEqual(libItems(s).length, 0);
  s.restore();
});

test('launching: locked is refused, unlocked starts; ordinary games never ask', async () => {
  const s = await setup();
  const pin = await pinOn(s.app);
  await s.app.call('settings', 'xboxEnabled', { value: true });
  await addAll(s.app);
  const items = libItems(s);
  const gears = items.find((i) => i.title === 'Gears of War E-Day');
  const plain = items.find((i) => i.title === 'Plain');
  await s.app.call('settings', 'pinLock');
  s.app.launch(gears.id);
  assert.match(failures(s.app).pop(), /Enter the PIN/);
  assert.strictEqual(s.spawned.length, 0);
  s.app.launch(plain.id);
  assert.strictEqual(s.spawned.length, 1);
  assert.strictEqual(s.spawned[0].file, '/bin/true');
  s.restore();
  // a fresh start (nothing running), unlocked
  const t = await setup({ settings: JSON.parse(fs.readFileSync(path.join(s.dataDir, 'settings.json'), 'utf8')), library: items });
  await t.app.call('settings', 'pinCheck', { pin });
  t.app.launch(gears.id);
  assert.strictEqual(t.spawned.length, 1);
  assert.strictEqual(t.spawned[0].file, '/bin/sh');
  t.restore();
});

test('switching Xbox off, or removing the PIN, refuses the launch; a new PIN does not bring it back', async () => {
  const s = await setup();
  const pin = await pinOn(s.app);
  await s.app.call('settings', 'xboxEnabled', { value: true });
  await addAll(s.app);
  const gears = libItems(s).find((i) => i.xbox);
  await s.app.call('settings', 'xboxEnabled', { value: false });
  s.app.launch(gears.id);
  assert.match(failures(s.app).pop(), /are off/);
  await s.app.call('settings', 'xboxEnabled', { value: true });
  assert.ok((await s.app.call('settings', 'pinRemove', { pin })).ok);
  s.app.launch(gears.id);
  assert.match(failures(s.app).pop(), /need a PIN/);
  await pinOn(s.app, '1357');
  assert.strictEqual((await s.app.call('settings', 'pinStatus')).xbox, false);
  s.app.launch(gears.id);
  assert.match(failures(s.app).pop(), /are off/);
  assert.strictEqual(s.spawned.length, 0);
  s.restore();
});

test('a Nexus game that got in without the mark is held back, and marked on its tile', async () => {
  const s = await setup({ library: [
    { id: 'byhand', kind: 'game', title: 'By hand', path: '/bin/sh', args: NEXUS_ARGS },
    { id: 'marked', kind: 'game', title: 'Marked', path: '/bin/sh', args: ['x'], xbox: true },
  ] });
  await pinOn(s.app);
  const t = await tiles(s.app);
  assert.ok(/"id":"byhand"[^}]*"xbox":true/.test(t) && /"id":"marked"[^}]*"xbox":true/.test(t));
  s.app.launch('byhand'); assert.match(failures(s.app).pop(), /are off/);
  s.app.launch('marked'); assert.match(failures(s.app).pop(), /are off/);
  assert.strictEqual(s.spawned.length, 0);
  s.restore();
});

test('Tessera\'s own scans never offer Nexus games as ordinary games (Steam shortcuts, desktop entries)', async () => {
  const enc = (obj) => Buffer.concat([...Object.entries(obj).map(([k, v]) => {
    if (typeof v === 'string') return Buffer.concat([Buffer.from([1]), Buffer.from(k + '\0' + v + '\0')]);
    if (typeof v === 'number') { const b = Buffer.alloc(4); b.writeInt32LE(v); return Buffer.concat([Buffer.from([2]), Buffer.from(k + '\0'), b]); }
    return Buffer.concat([Buffer.from([0]), Buffer.from(k + '\0'), enc(v)]);
  }), Buffer.from([8])]);
  const s = await setup({ settings: { codeAddons: { enabled: [] } }, steam: (home) => {
    const dir = path.join(home, '.local/share/Steam/userdata/4242/config');
    fs.mkdirSync(dir, { recursive: true });
    const list = {
      0: { appid: -1111111, AppName: 'Doom Eternal', Exe: '"/bin/sh"', LaunchOptions: '"/h/Xodus Nexus/shortcuts/launch-game" "00000000000000aa"' },
      1: { appid: -3333333, AppName: 'Xodus Nexus', Exe: '"/bin/sh"', LaunchOptions: '"/h/Xodus Nexus/shortcuts/launch-nexus"' },
      2: { appid: -4444444, AppName: 'Some Other Game', Exe: '"/usr/bin/other"', LaunchOptions: '' },
    };
    fs.writeFileSync(path.join(dir, 'shortcuts.vdf'), Buffer.concat([Buffer.from([0]), Buffer.from('shortcuts\0'), enc(list), Buffer.from([8])]));
    const apps = path.join(home, '.local/share/applications');
    fs.mkdirSync(apps, { recursive: true });
    fs.writeFileSync(path.join(apps, 'gears.desktop'), '[Desktop Entry]\nType=Application\nName=Gears\nExec=/bin/sh "/h/Xodus Nexus/shortcuts/launch-game" "0123456789abcdef"\nCategories=Game;\nX-Xodus-Nexus-Profile=abc\nX-Xodus-Nexus-Game=0123456789abcdef\n');
    fs.writeFileSync(path.join(apps, 'gears2.desktop'), '[Desktop Entry]\nType=Application\nName=Gears copy\nExec=/bin/sh "/h/Xodus Nexus/shortcuts/launch-game" "0123456789abcdef"\nCategories=Game;\n');
  } });
  const r = await s.app.call('scan', 'run');
  assert.deepStrictEqual(r.found.map((f) => f.title), ['Some Other Game']);
  s.restore();
});

test('a settings file that says Xbox on but has no PIN comes up with Xbox off', async () => {
  const s = await setup({ settings: { xboxEnabled: true } });
  assert.strictEqual((await s.app.call('settings', 'pinStatus')).xbox, false);
  const r = await s.app.call('scan', 'run');
  assert.deepStrictEqual(r.found.map((f) => f.title), ['Plain']);
  s.restore();
});

