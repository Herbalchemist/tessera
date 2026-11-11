'use strict';
// Profiles, PINs and Guest, on the real main process (the same one Ludus runs behind its screen):
// each person's own pages, controls and theme; switching; the PIN rules (a profile's PIN never grants
// admin rights, the admin PIN never waits); Guest locked down; stored controls checked like a fresh load.
// (What Ludus shows for these is checked in its own run: tools/ludus-qt-test, ludus.py --qa.)
const test = require('node:test');
test.after(() => { setImmediate(() => process.exit()); });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./xbox-harness');

const LAUNCHER = path.join(__dirname, '..');
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

async function boot(settings, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
  made.push(tmp);
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'data', 'settings.json'), JSON.stringify({ firstRunDone: true, ...(settings || {}) }));
  for (const [f, v] of Object.entries(files || {})) fs.writeFileSync(path.join(tmp, 'data', f), JSON.stringify(v));
  for (const k of Object.keys(require.cache)) if (k.startsWith(LAUNCHER + path.sep) && !k.includes(path.sep + 'test' + path.sep)) delete require.cache[k]; // a fresh main process each time
  const h = await H.load({ launcher: LAUNCHER, tmp });
  const P = (op, x) => h.call('profiles', op, x || {});
  const S = (op, x) => h.call('settings', op, x || {});
  const prefs = require(path.join(LAUNCHER, 'main', 'prefs'));
  const mosaics = (view) => view.tabOrder.filter((t) => t.startsWith('m:')).map((t) => view.folders[t.slice(2)].title).sort();
  const view = async () => (await P('list')).view || require(path.join(LAUNCHER, 'main', 'library')).buildView();
  return { h, tmp, P, S, prefs, mosaics, view, dataDir: path.join(tmp, 'data') };
}

test('each person has their own pages, controls and theme, and switching swaps them', async () => {
  const { h, P, S, prefs, mosaics, dataDir } = await boot();
  assert.strictEqual((await P('guestCheck', { perm: 'apps' })).ok, true, 'no profiles: no Guest restrictions');
  await h.call('library', 'newCategory', { title: 'Shared page' });
  await S('padSet', { key: 'repeat', value: 'fast' });
  await S('padRemap', { family: 'xbox', map: [5, 1, 2, 3, 4, 0] });
  const ana = (await P('add', { name: 'Ana', start: 'copy' })).id;
  const bo = (await P('add', { name: 'Bo', start: 'fresh' })).id;
  assert.deepStrictEqual([ana, bo], ['ana', 'bo']);
  for (const key of ['browser', 'controls', 'pages']) await P('guestSet', { key, value: true });
  const sharedTheme = (await S('themeGet')).active;

  let u = await P('use', { id: ana });
  assert.ok(u.ok);
  assert.deepStrictEqual(mosaics(u.view), ['Shared page'], 'Ana starts with a copy of the shared pages');
  assert.strictEqual(prefs.settings.pad.repeat, 'fast');
  assert.deepStrictEqual(prefs.settings.pad.remap.xbox, [5, 1, 2, 3, 4, 0], 'and the shared controls');
  await h.call('library', 'newCategory', { title: "Ana's page" });
  await S('padSet', { key: 'repeat', value: 'slow' });
  await S('padSet', { key: 'oskSize', value: 'wide' });
  const t = await S('themeUse', { id: 'arcade-marquee' });
  assert.ok(t.ok);

  u = await P('use', { id: bo });
  assert.strictEqual((await S('themeGet')).active, sharedTheme, "Bo has no theme of his own: he gets the shared one, not Ana's");
  assert.deepStrictEqual(mosaics(u.view), [], 'Bo starts fresh: no mosaics');
  assert.strictEqual(prefs.settings.pad.repeat, 'standard');
  assert.ok(!prefs.settings.pad.remap.xbox, 'and the usual controls');

  u = await P('use', { id: null });
  assert.deepStrictEqual(mosaics(u.view), ['Shared page'], "Ana's page stays hers");
  assert.strictEqual(prefs.settings.pad.repeat, 'fast');
  assert.notStrictEqual((await S('themeGet')).active, 'arcade-marquee', "Ana's theme went with her");

  u = await P('use', { id: ana });
  assert.deepStrictEqual(mosaics(u.view), ["Ana's page", 'Shared page']);
  assert.strictEqual(prefs.settings.pad.repeat, 'slow');
  assert.strictEqual(prefs.settings.pad.oskSize, 'wide');
  assert.deepStrictEqual(prefs.settings.pad.remap.xbox, [5, 1, 2, 3, 4, 0]);
  assert.strictEqual((await S('themeGet')).active, 'arcade-marquee');

  // removing someone deletes what was theirs, and nothing else
  const r = await P('remove', { id: 'ana' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.active, null, 'removing who is playing goes back to Everyone');
  const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
  const library = JSON.parse(fs.readFileSync(path.join(dataDir, 'library.json'), 'utf8'));
  assert.deepStrictEqual(settings.profiles.map((p) => p.id), ['bo']);
  assert.ok(!('ana' in settings.profileData) && !('ana' in library.layouts), 'her controls and pages are gone');
  assert.ok('bo' in settings.profileData && 'bo' in library.layouts, "Bo's are kept");
  assert.deepStrictEqual(mosaics(r.view), ['Shared page']);
  assert.strictEqual((await P('add', { name: 'Ana', start: 'fresh' })).id, 'ana');
});

test('stored controls are checked like a fresh load: bad values dropped, unknown profiles ignored', async () => {
  const { prefs, P } = await boot({
    profiles: [{ id: 'bo', name: 'Bo', themeId: null, color: '#7fb2ff', pin: null, browserLock: true, login: 'admin' }],
    profileData: { bo: { pad: { repeat: 'warp', remap: { xbox: [0, 0, 0, 0, 0, 0] }, deadzone: 999 }, keys: { back: 0 } }, ghost: { pad: { repeat: 'slow' } } },
  }, { 'library.json': { items: [], categories: [], layouts: { bo: {} } } });
  assert.ok((await P('use', { id: 'bo' })).ok);
  assert.strictEqual(prefs.settings.pad.repeat, 'standard');
  assert.ok(!prefs.settings.pad.remap.xbox);
  assert.strictEqual(prefs.settings.pad.deadzone, 15);
  assert.strictEqual(prefs.settings.keys.back, 2, 'a reserved button is refused');
  assert.ok(!('ghost' in prefs.settings.profileData), 'unknown profiles are ignored');
});

test('PINs: a profile PIN logs in and never grants admin; the admin PIN overrides and never waits', async () => {
  const { P, S } = await boot();
  const adminUnlocked = async () => (await S('pinStatus')).unlocked;
  assert.ok((await S('pinSet', { pin: '1357' })).ok);
  const kid = (await P('add', { name: 'Kid', start: 'fresh' })).id;
  const mom = (await P('add', { name: 'Mom', start: 'fresh' })).id;
  assert.ok((await P('setPin', { id: kid, pin: '2468' })).ok, 'the admin gives Kid a PIN');
  assert.ok((await P('setAdmin', { id: mom })).ok);
  await S('pinLock');
  assert.strictEqual(await adminUnlocked(), false);

  let u = await P('use', { id: kid });
  assert.strictEqual(u.needProfilePin, true, "Kid's profile asks for a PIN");
  assert.strictEqual((await P('use', { id: kid, pin: '0000' })).ok, false);
  u = await P('use', { id: kid, pin: '2468' });
  assert.ok(u.ok && u.active === kid, 'their own PIN logs them in');
  assert.strictEqual(await adminUnlocked(), false, 'and grants no admin rights');
  assert.strictEqual((await S('pinBrowser', { value: false })).needPin, true, 'admin things still ask for the admin PIN');
  assert.strictEqual((await P('setPin', { id: mom, pin: '9999' })).needPin, true, "Kid can't change someone else's PIN");
  assert.ok((await P('setPin', { id: kid, pin: '2469' })).ok, 'but can change their own while logged in');
  assert.strictEqual((await P('browserCheck')).ok, true, 'their browser is open to them right after logging in');

  await P('use', { id: null });
  u = await P('use', { id: kid, pin: '1357' });
  assert.ok(u.ok && u.active === kid, 'the admin PIN opens any profile');
  assert.strictEqual(await adminUnlocked(), true, '(entering it is an admin unlock, as anywhere)');
  await S('pinLock');
  await P('use', { id: null });
  assert.strictEqual((await P('use', { id: mom, pin: '2469' })).ok, false, "Kid's PIN doesn't open Mom");
  u = await P('use', { id: mom, pin: '1357' });
  assert.ok(u.ok && u.active === mom, 'the admin profile logs in with the admin PIN');
  assert.strictEqual(await adminUnlocked(), true);

  // Mom chooses a login PIN of her own: then the admin PIN is asked separately for admin things
  assert.ok((await P('setPin', { id: mom, pin: '4321' })).ok);
  assert.strictEqual((await P('list')).profiles.find((x) => x.id === mom).login, 'own');
  await S('pinLock');
  await P('use', { id: null });
  u = await P('use', { id: mom, pin: '4321' });
  assert.ok(u.ok && u.active === mom, 'her own login PIN logs her in');
  assert.strictEqual(await adminUnlocked(), false, 'without admin rights');
  assert.strictEqual((await S('pinBrowser', { value: false })).needPin, true);
  assert.ok((await S('pinCheck', { pin: '1357' })).ok);
  assert.ok((await P('adminLogin', { login: 'admin' })).ok, 'and she can go back to logging in with the admin PIN');
  assert.strictEqual((await P('use', { id: null })).ok, true);
  assert.strictEqual((await P('use', { id: mom, pin: '4321' })).ok, false, 'her old login PIN is gone');

  // wrong guesses: a profile PIN waits a while; the admin PIN never waits, and opens it anyway
  await S('pinCheck', { pin: '1357' });
  await P('use', { id: null });
  let last;
  for (let i = 0; i < 5; i++) last = await P('use', { id: kid, pin: '0000' });
  assert.ok(last.wait > 0, "Kid's login waits after five misses");
  assert.strictEqual((await P('use', { id: kid, pin: '2469' })).ok, false, 'even the right Kid PIN waits it out');
  u = await P('use', { id: kid, pin: '1357' });
  assert.ok(u.ok && u.active === kid, 'the admin PIN skips the wait');
  await P('use', { id: null });
  assert.strictEqual((await P('use', { id: kid, pin: '2469' })).ok, true, 'and cleared it for Kid');
  await S('pinLock');
  for (let i = 0; i < 12; i++) assert.strictEqual((await S('pinCheck', { pin: '9999' })).wait, undefined, 'a wrong admin PIN never makes anyone wait');
  assert.strictEqual((await S('pinCheck', { pin: '1357' })).ok, true);
});

test("Guest is locked down once profiles exist, until the admin allows more; the admin can hide Guest", async () => {
  const { P, S, h } = await boot();
  assert.ok((await S('pinSet', { pin: '1357' })).ok);
  const kid = (await P('add', { name: 'Kid', start: 'fresh' })).id;
  assert.ok((await P('setPin', { id: kid, pin: '2469' })).ok);
  await S('pinLock');
  assert.strictEqual((await P('use', { id: null })).active, null);
  assert.strictEqual((await P('guestCheck', { perm: 'games' })).ok, true, 'Guest plays games');
  for (const [perm, ch, op, x] of [['apps', 'profiles', 'guestCheck', { perm: 'apps' }], ['browser', 'browser', 'open', { url: 'http://127.0.0.1/' }],
    ['pages', 'library', 'newCategory', { title: 'Guest page' }], ['controls', 'settings', 'padSet', { key: 'repeat', value: 'fast' }]]) {
    const r = await h.call(ch, op, x);
    assert.strictEqual(r.ok, false, `Guest can't (${perm})`);
    assert.strictEqual(r.needPin, true, `and the admin PIN is offered (${perm})`);
  }
  assert.strictEqual((await P('guestSet', { key: 'apps', value: true })).needPin, true, 'only the admin changes what Guest may do');
  assert.ok((await S('pinCheck', { pin: '1357' })).ok);
  assert.strictEqual((await h.call('settings', 'padSet', { key: 'repeat', value: 'fast' })).ok, true, 'with the admin PIN it goes through');
  assert.strictEqual((await P('guestSet', { key: 'apps', value: true })).guest.apps, true, 'and the admin can allow more');
  assert.ok((await P('guestSet', { key: 'show', value: false })).ok);
  await S('pinLock');
  assert.ok((await P('use', { id: kid, pin: '2469' })).ok);
  assert.strictEqual((await P('use', { id: null })).needPin, true, 'a hidden Guest only with the admin PIN');
  assert.deepStrictEqual((await P('list')).guest, { show: false, games: true, apps: true, browser: false, pages: false, look: false, controls: false });
});
