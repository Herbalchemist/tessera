// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: full profiles on the real launcher. Each person has their own controls, pages,
// browser storage and theme; switching swaps them, a restart keeps them, removing someone deletes theirs.
//   xvfb-run -a -s "-screen 0 1280x720x24 -noreset" node qa/profiles.cjs
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');

const launcher = process.argv[2] || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher');
const output = process.env.TESSERA_QA_OUTPUT || path.resolve(process.cwd(), 'qa-output');
const executablePath = process.env.TESSERA_ELECTRON || require('electron');
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-profiles-'));
const dataDir = path.join(temp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ firstRunDone: true }));
const checks = [];
const errors = [];

// A page that shows its cookie, and one that sets it (a stand-in for "being logged in").
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/login')) res.setHeader('Set-Cookie', 'who=' + req.url.split('=')[1] + '; Max-Age=86400; Path=/');
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>Cookie QA</title><body>cookie page</body>');
});

async function start() {
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: temp, TESSERA_DATA_DIR: dataDir, TESSERA_DEV: '1', XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.stack || String(e)));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });
  await page.waitForFunction(() => typeof switchProfile === 'function' && typeof api !== 'undefined' && document.querySelectorAll('.tab').length >= 4, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  return { app, page };
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let { app, page } = await start();
  try {
    const mosaics = () => page.evaluate(() => data.mosaics.map((m) => m.title).sort());
    const pad = () => page.evaluate(() => ({ repeat: prefs.pad.repeat, remap: prefs.pad.remap.xbox || null, osk: prefs.pad.oskSize }));
    const use = (id) => page.evaluate((id) => switchProfile(id, id || 'Everyone').then((r) => Boolean(r)), id);
    const add = (name, start) => page.evaluate(([name, start]) => api.profiles('add', { name, start }).then((r) => r.id), [name, start]);
    const cookie = async () => {
      // open the browser on the cookie page, read the page's cookie from the main process, leave
      await page.evaluate((u) => { browserUrl = u; }, base + '/');
      await page.evaluate(() => launchBrowser(1));
      await page.waitForFunction(() => browserOpen && !browserMoving);
      await page.waitForTimeout(400);
      const c = await app.evaluate(({ webContents }, b) => webContents.getAllWebContents().find((w) => w.getURL().startsWith(b)).executeJavaScript('document.cookie'), base);
      await page.evaluate(() => closeBrowser(-1));
      await page.waitForFunction(() => !browserOpen && !browserMoving);
      return c;
    };
    const login = async (who) => {
      await page.evaluate(() => launchBrowser(1));
      await page.waitForFunction(() => browserOpen && !browserMoving);
      await page.evaluate((u) => api.browser('go', { url: u }), `${base}/login?who=${who}`); // like typing the address
      await page.waitForTimeout(600);
      await page.evaluate(() => closeBrowser(-1));
      await page.waitForFunction(() => !browserOpen && !browserMoving);
    };

    // Everyone sets things up: a mosaic, a faster repeat, Select on RB, a browser login.
    await page.evaluate(() => lib('newCategory', { title: 'Shared page' }));
    await page.evaluate(() => padSet('repeat', 'fast'));
    await page.evaluate(() => api.settings('padRemap', { family: 'xbox', map: [5, 1, 2, 3, 4, 0] }).then((r) => { prefs.pad = { ...PAD_DEFAULTS, ...r.pad }; }));
    await login('everyone');
    assert.equal(await cookie(), 'who=everyone');

    // Ana starts as a copy of that; Bo from scratch.
    const ana = await add('Ana', 'copy');
    const bo = await add('Bo', 'fresh');
    assert.deepEqual([ana, bo], ['ana', 'bo']);

    const sharedTheme = await page.evaluate(() => api.settings('themeGet').then((t) => t.active));
    assert.ok(await use(ana));
    assert.deepEqual(await mosaics(), ['Shared page'], 'Ana starts with a copy of the shared pages');
    assert.deepEqual(await pad(), { repeat: 'fast', remap: [5, 1, 2, 3, 4, 0], osk: 'dock' }, 'and the shared controls');
    assert.equal(await cookie(), '', 'but a browser of her own: not logged in as Everyone');
    await page.evaluate(() => lib('newCategory', { title: "Ana's page" }));
    await page.evaluate(() => padSet('repeat', 'slow'));
    await page.evaluate(() => padSet('oskSize', 'wide'));
    await login('ana');
    await page.evaluate(async () => { const r = await api.settings('themeUse', { id: 'arcade-marquee' }); applyTheme(r.theme); });
    checks.push('A new profile can start as a copy of the shared setup: same pages and controls, its own (empty) browser');

    assert.ok(await use(bo));
    assert.equal(await page.evaluate(() => api.settings('themeGet').then((t) => t.active)), sharedTheme, "Bo has no theme of his own: he gets the shared one, not Ana's");
    assert.deepEqual(await mosaics(), [], 'Bo starts fresh: no mosaics');
    assert.deepEqual(await pad(), { repeat: 'standard', remap: null, osk: 'dock' }, 'and the usual controls');
    assert.equal(await cookie(), '');
    assert.equal(await page.evaluate(() => hoverId), 'home');
    checks.push('Or from scratch: an empty Home and the usual controls');

    assert.ok(await use(null));
    assert.deepEqual(await mosaics(), ['Shared page'], "Ana's page stays hers");
    assert.deepEqual(await pad(), { repeat: 'fast', remap: [5, 1, 2, 3, 4, 0], osk: 'dock' });
    assert.equal(await cookie(), 'who=everyone');
    assert.notEqual(await page.evaluate(() => prefs.theme && prefs.theme.active), 'arcade-marquee', "Ana's theme went with her");

    assert.ok(await use(ana));
    assert.deepEqual(await mosaics(), ["Ana's page", 'Shared page']);
    assert.deepEqual(await pad(), { repeat: 'slow', remap: [5, 1, 2, 3, 4, 0], osk: 'wide' });
    assert.equal(await cookie(), 'who=ana', 'still logged in as Ana');
    assert.equal(await page.evaluate(() => prefs.theme && prefs.theme.active), 'arcade-marquee');
    await page.screenshot({ path: path.join(output, 'profiles-ana.png') });
    checks.push('Switching swaps everything personal: pages, controls (button layout too), browser logins and theme');

    // The guide switches too, and lists Everyone.
    await page.evaluate(() => { openGuide(); });
    await page.waitForFunction(() => modal && modal.title === 'Guide');
    const whoList = await page.evaluate(() => modal.items.filter((x) => x.op === 'profile').map((x) => [x.label, x.sub]));
    assert.deepEqual(whoList, [['Ana', 'playing now'], ['Bo', ''], ['Everyone', '']]);
    await page.evaluate(() => guideChoose(modal.items.find((x) => x.op === 'profile' && x.id === 'bo')));
    await page.waitForFunction(() => modal && modal.items.find((x) => x.id === 'bo' && x.sub === 'playing now'));
    assert.deepEqual(await mosaics(), []);
    await page.evaluate(() => closeGuide());
    await page.waitForTimeout(300);
    checks.push('The guide lists everyone (and Everyone) and switches in place');

    // Ask at start; a restart keeps it all.
    await page.evaluate(() => api.profiles('ask', { on: true }));
    await app.close();
    ({ app, page } = await start());
    await page.waitForFunction(() => modal && modal.title === "Who's playing?", null, { timeout: 8000 });
    assert.deepEqual(await page.evaluate(() => modal.items.map((x) => x.label)), ['Ana', 'Bo', 'Everyone']);
    await page.screenshot({ path: path.join(output, 'profiles-who.png') });
    await page.evaluate(() => { modal.index = 0; modalPress('a'); });
    await page.waitForFunction(() => !modal && data.mosaics.length === 2);
    assert.deepEqual(await mosaics(), ["Ana's page", 'Shared page']);
    assert.deepEqual(await pad(), { repeat: 'slow', remap: [5, 1, 2, 3, 4, 0], osk: 'wide' });
    assert.equal(await cookie(), 'who=ana');
    checks.push("After a restart: \"Who's playing?\" (when turned on), and everyone's things are where they left them");

    // Removing someone deletes what was theirs, and nothing else.
    const r = await page.evaluate(() => api.profiles('remove', { id: 'ana' }));
    assert.equal(r.ok, true);
    assert.equal(r.active, null, 'removing who is playing goes back to Everyone');
    await page.evaluate((v) => applyView(v), r.view);
    const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
    const library = JSON.parse(fs.readFileSync(path.join(dataDir, 'library.json'), 'utf8'));
    assert.deepEqual(settings.profiles.map((p) => p.id), ['bo']);
    assert.ok(!('ana' in settings.profileData) && !('ana' in library.layouts), 'her controls and pages are gone');
    assert.ok('bo' in settings.profileData && 'bo' in library.layouts, "Bo's are kept");
    assert.deepEqual(await mosaics(), ['Shared page']);
    assert.equal(await cookie(), 'who=everyone');
    // A new person who gets the same name must not inherit the old one's logins.
    const again = await add('Ana', 'fresh');
    assert.equal(again, 'ana');
    assert.ok(await use('ana'));
    assert.equal(await cookie(), '', "the new Ana isn't logged in as the old one");
    page.evaluate(() => { flowProfiles(); });
    await page.waitForFunction(() => modal && modal.title === 'Profiles');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(output, 'profiles-screen.png') });
    await page.evaluate(() => closeModal());
    await page.evaluate(() => api.profiles('remove', { id: 'ana' }).then((r) => applyView(r.view)));
    checks.push("Removing a profile deletes its pages, controls and browser data (a new one with the same name starts clean); everyone else's stay");

    // A tampered settings file can't plant bad controls in someone's stash.
    await app.close();
    const s2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
    s2.profileData.bo = { pad: { repeat: 'warp', remap: { xbox: [0, 0, 0, 0, 0, 0] }, deadzone: 999 }, keys: { back: 0 } };
    s2.profileData.ghost = { pad: { repeat: 'slow' } };
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(s2));
    ({ app, page } = await start());
    await page.waitForTimeout(600);
    if (await page.evaluate(() => Boolean(modal))) await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.label === 'Bo'); modalPress('a'); });
    else await use('bo');
    await page.waitForFunction(() => !modal);
    await page.waitForTimeout(400);
    assert.deepEqual(await pad(), { repeat: 'standard', remap: null, osk: 'dock' });
    assert.equal(await page.evaluate(() => prefs.pad.deadzone), 15);
    assert.equal(await page.evaluate(() => keymap.back), 2, 'a reserved button is refused');
    checks.push('Stored controls are checked like a fresh load: bad values are dropped, unknown profiles ignored');
  } finally { await app.close().catch(() => {}); server.close(); }
  assert.deepEqual(errors, [], 'no page errors');
  for (const c of checks) console.log('ok -', c);
  console.log(`profiles: ${checks.length} checks passed`);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
