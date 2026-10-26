// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: the guide (Guide button menu), first-run setup and the desktop helper mode,
// on the real launcher in real Electron. The Guide button is pressed through the TESSERA_DEV hook
// in place of a physical pad; a "game" is /usr/bin/sleep.
//   xvfb-run -a -s "-screen 0 1280x720x24" node qa/guide.cjs
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');
const http = require('node:http');

const launcher = process.argv[2] || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher');
const output = process.env.TESSERA_QA_OUTPUT || path.resolve(process.cwd(), 'qa-output');
const executablePath = process.env.TESSERA_ELECTRON || require('electron');
fs.mkdirSync(output, { recursive: true });
const checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fixture({ firstRun = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-guide-'));
  const dataDir = path.join(temp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  // A fresh install has no settings file at all (an empty one counts as an install from before the welcome existed).
  if (!firstRun) fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ firstRunDone: true }));
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
    items: [{ id: 'g0', title: 'Test Game', kind: 'game', path: '/usr/bin/sleep', args: ['60'] }],
    categories: [{ id: '_home', title: 'Home', builtin: true, entries: [] }],
  }));
  return { temp, dataDir };
}
async function start(fx, extraEnv = {}) {
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: fx.temp, TESSERA_DATA_DIR: fx.dataDir, TESSERA_DEV: '1',
      XDG_CONFIG_HOME: path.join(fx.temp, 'config'), XDG_STATE_HOME: path.join(fx.temp, 'state'), ...extraEnv },
  });
  return app;
}
const guide = (app, how = 'press') => app.evaluate(async (_e, how) => {
  globalThis.__tesseraGuide.down('qa');
  await new Promise((r) => setTimeout(r, how === 'hold' ? 750 : 60));
  globalThis.__tesseraGuide.up('qa');
}, how);
const visible = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());

(async () => {
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body style="background:#2a6"><h1>page</h1></body>'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const errors = [];

  // ================= the launcher
  let fx = fixture();
  let app = await start(fx);
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForFunction(() => !document.body.classList.contains('hold') && document.querySelectorAll('.tab').length >= 5);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });
    const state = () => page.evaluate(() => ({ open: guideOpen, cls: modal && modal.cls, labels: modal && modal.items ? modal.items.map((i) => i.label) : [], page, suspended, gameOn: Boolean(gameOn) }));

    await guide(app);
    await page.waitForTimeout(400);
    let s = await state();
    assert.equal(s.open, true, 'a press opens the guide');
    assert.equal(s.cls, 'guide');
    for (const want of ['Home', 'Settings', 'Profiles', 'Power', 'Sleep', 'Restart', 'Shut down', 'Desktop Mode']) assert.ok(s.labels.includes(want), 'guide has ' + want + ': ' + s.labels);
    await page.screenshot({ path: path.join(output, 'guide-launcher.png') });
    await page.evaluate(() => onButton(1));
    await page.waitForTimeout(200);
    assert.equal((await state()).open, false, 'B closes it');
    await guide(app);
    await page.waitForTimeout(300);
    await guide(app);
    await page.waitForTimeout(300);
    assert.equal((await state()).open, false, 'Guide again closes it too');
    checks.push('Guide press opens the guide panel in the launcher; B or Guide closes it');

    await page.evaluate(() => { page = 'library'; hoverId = 'library'; render(); });
    await guide(app, 'hold');
    await page.waitForTimeout(300);
    s = await state();
    assert.equal(s.page, 'home', 'a hold goes Home');
    assert.equal(s.open, false);
    checks.push('Holding Guide goes Home');

    let r = await page.evaluate(() => launcherAPI.settings('padSet', { key: 'guideButton', value: 'home-menu' }));
    assert.equal(r.ok, true);
    await page.evaluate(() => { page = 'library'; hoverId = 'library'; render(); });
    await guide(app);
    await page.waitForTimeout(300);
    assert.equal((await state()).page, 'home', 'swapped: a press goes Home');
    await guide(app, 'hold');
    await page.waitForTimeout(300);
    assert.equal((await state()).open, true, 'swapped: a hold opens the guide');
    await page.evaluate(() => onButton(1));
    await page.evaluate(() => launcherAPI.settings('padSet', { key: 'guideButton', value: 'menu-home' }));
    checks.push('Guide button setting swaps press and hold');

    // ---- in front of a running game
    await page.evaluate(() => { suspended = true; launcherAPI.launch('g0'); });
    await page.waitForTimeout(800);
    assert.equal(await visible(app), false, 'the launcher hides while the game runs');
    let st = await page.evaluate(() => launcherAPI.guide('status'));
    assert.equal(st.running, true);
    assert.equal(st.title, 'Test Game');
    await guide(app);
    await page.waitForTimeout(600);
    assert.equal(await visible(app), true, 'Guide brings Tessera up in front of the game');
    s = await state();
    assert.equal(s.open, true);
    assert.equal(s.suspended, false);
    assert.ok(s.labels.includes('Resume Test Game') && s.labels.includes('Close Test Game'), s.labels.join(' | '));
    await page.screenshot({ path: path.join(output, 'guide-in-game.png') });
    await page.evaluate(() => onButton(1)); // B: back to the game
    await page.waitForTimeout(500);
    assert.equal(await visible(app), false, 'B resumes the game (Tessera hides again)');
    assert.equal((await state()).suspended, true);
    checks.push('In a game, Guide brings the guide up in front; B resumes the game');

    await guide(app, 'hold');
    await page.waitForTimeout(600);
    s = await state();
    assert.equal(await visible(app), true);
    assert.equal(s.page, 'home');
    assert.equal(s.gameOn, true, 'Home over a running game keeps it running');
    r = await page.evaluate(() => new Promise((res) => { launcherAPI.onLaunchFailed((m) => res(m)); launcherAPI.launch('g0'); setTimeout(() => res(null), 1500); }));
    assert.ok(r && /still running/.test(r), 'starting another game says the first is still running: ' + r);
    checks.push('In a game, holding Guide shows Home while the game keeps running');

    await guide(app);
    await page.waitForTimeout(500);
    await page.evaluate(() => { const i = modal.items.findIndex((x) => x.op === 'closeGame'); modal.index = i; modalPress('a'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { const i = modal.items.findIndex((x) => x.yes); modal.index = i; modalPress('a'); });
    await page.waitForTimeout(1500);
    st = await page.evaluate(() => launcherAPI.guide('status'));
    s = await state();
    assert.equal(st.running, false, 'Close game ended it');
    assert.equal(s.suspended, false);
    assert.equal(s.gameOn, false);
    checks.push('Close game (with a confirmation) ends the running game');

    // ---- over the embedded browser
    await page.evaluate(async (u) => { browserUrl = u; await launchBrowser(1); }, url);
    await page.waitForTimeout(900);
    await guide(app);
    await page.waitForTimeout(800);
    s = await state();
    assert.equal(s.open, true);
    assert.ok(s.labels.includes('Back to the browser'));
    const attached = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);
    assert.equal(await attached(), 0, 'the page steps aside for the guide');
    await page.evaluate(() => onButton(1));
    await page.waitForTimeout(600);
    assert.ok((await attached()) >= 1, 'closing the guide brings the page back');
    assert.equal(await page.evaluate(() => browserOpen), true);
    checks.push('Over the browser, the guide steps the page aside and brings it back');

    // ---- profiles switch from the guide
    await page.evaluate(() => launcherAPI.profiles('add', { name: 'Sam' }));
    await page.evaluate(() => closeBrowser());
    await page.waitForTimeout(600);
    await guide(app);
    await page.waitForTimeout(500);
    await page.evaluate(() => { const i = modal.items.findIndex((x) => x.op === 'profile' && x.label === 'Sam'); modal.index = i; modalPress('a'); });
    await page.waitForTimeout(400);
    const pr = await page.evaluate(() => launcherAPI.profiles('list'));
    assert.equal(pr.active, 'sam', 'choosing a profile in the guide makes it the active one');
    await page.evaluate(() => onButton(1));
    checks.push('Profiles can be switched from the guide');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fx.temp, { recursive: true, force: true });
  }

  // ================= first-run setup
  fx = fixture({ firstRun: true });
  app = await start(fx);
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForFunction(() => modal && modal.title === 'Welcome to Tessera', null, { timeout: 15000 });
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });
    const choose = async (title, pickFn) => {
      await page.waitForFunction((t) => modal && modal.title === t, title, { timeout: 8000 });
      await page.evaluate((src) => { const f = new Function('x', 'return (' + src + ')(x)'); const i = modal.items.findIndex((x) => f(x)); modal.index = i; modalPress('a'); }, pickFn.toString());
      await page.waitForTimeout(300);
    };
    await page.screenshot({ path: path.join(output, 'setup-1-welcome.png') });
    await choose('Welcome to Tessera', (x) => x.op === 'go');
    await choose("Who's playing?", (x) => x.op === 'name');
    await page.waitForFunction(() => modal && modal.kind === 'keys');
    await page.keyboard.type('Alex');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => modal && modal.title === 'Pick a look', null, { timeout: 8000 });
    await choose('Pick a look', (x) => x.id === 'nova-black');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(output, 'setup-3-look.png') });
    await choose('Pick a look', (x) => x.op === 'keep');
    await choose('A PIN?', (x) => x.op === 'skip');
    await page.screenshot({ path: path.join(output, 'setup-5-done.png') });
    await page.waitForFunction(() => modal && modal.title === "You're all set", null, { timeout: 8000 });
    assert.ok(await page.evaluate(() => modal.items.some((x) => x.tour)), 'the end of setup offers the tour');
    await choose("You're all set", (x) => x.ok);
    await page.waitForTimeout(500);
    const after = await page.evaluate(async () => ({ prof: await launcherAPI.profiles('list'), theme: (await launcherAPI.settings('themeGet')).active, pin: (await launcherAPI.settings('pinStatus')) }));
    assert.equal(after.prof.active, 'alex', 'the new profile is the one playing');
    assert.equal(after.prof.profiles[0].themeId, 'nova-black', 'and keeps the look picked during setup');
    assert.equal(after.theme, 'nova-black');
    const settings = JSON.parse(fs.readFileSync(path.join(fx.dataDir, 'settings.json'), 'utf8'));
    assert.equal(settings.firstRunDone, true, 'setup does not come back next time');
    checks.push('First-run setup: name a profile, pick a look (live), optional PIN, offer of a tour, done');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fx.temp, { recursive: true, force: true });
  }

  // ================= the desktop helper (guide only)
  fx = fixture();
  app = await start(fx, { TESSERA_GUIDE_ONLY: '1' });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForFunction(() => typeof GUIDE_ONLY !== 'undefined' && GUIDE_ONLY && document.querySelectorAll('.tab').length >= 5, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    assert.equal(await visible(app), false, 'the helper window stays hidden until Guide is pressed');
    await guide(app);
    await page.waitForTimeout(600);
    assert.equal(await visible(app), true, 'Guide shows it over the desktop');
    const s = await page.evaluate(() => ({ open: guideOpen, labels: modal.items.map((i) => i.label) }));
    assert.equal(s.open, true);
    assert.ok(s.labels.includes('Return to Tessera') && !s.labels.includes('Desktop Mode') && !s.labels.includes('Settings'), s.labels.join(' | '));
    await page.screenshot({ path: path.join(output, 'guide-desktop.png') });
    await page.evaluate(() => onButton(1));
    await page.waitForTimeout(400);
    assert.equal(await visible(app), false, 'closing the guide hides the helper again');
    // The launcher is running (it left its pid): the helper stays out of its way.
    fs.mkdirSync(path.join(fx.temp, 'state', 'tessera'), { recursive: true });
    fs.writeFileSync(path.join(fx.temp, 'state', 'tessera', 'launcher.pid'), String(process.pid));
    await guide(app);
    await page.waitForTimeout(500);
    assert.equal(await visible(app), false, 'with Tessera itself open, the helper does nothing');
    checks.push('Desktop helper: hidden until Guide, shows only the guide, steps aside for Tessera');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(fx.temp, { recursive: true, force: true });
  }

  server.close();
  assert.deepEqual(errors, [], 'no page errors');
  console.log('OK ' + checks.length + ' checks\n- ' + checks.join('\n- '));
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
