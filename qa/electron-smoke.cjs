// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA harness. Requires playwright and the pinned Electron executable.
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');
const http = require('node:http');

const launcher = process.argv[2] || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher');
const output = process.env.TESSERA_QA_OUTPUT || path.resolve(process.cwd(), 'qa-output');
const executablePath = process.env.TESSERA_ELECTRON || require('electron');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-integration-'));
const dataDir = path.join(temp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ firstRunDone: true }));
const games = ['Starfall', 'Coastal Circuit', 'Lantern Quest', 'Deep Orbit', 'Pixel Garden', 'Moonlight Rally', 'Cloudbound', 'Neon Frontier'].map((title, i) => ({ id: `g${i}`, title, kind: 'game', path: '/usr/bin/true' }));
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
  items: games.concat([{ id: 'app0', title: 'Files', kind: 'app', path: '/usr/bin/true' }]),
  inlays: [{ id: 'clock0', type: 'clock' }, { id: 'cpu0', type: 'cpu' }, { id: 'ram0', type: 'ram' }],
  categories: [{ id: '_home', title: 'Home', builtin: true, entries: ['clock0', 'cpu0', 'ram0'] }, { id: 'favorites', title: 'Favorites', top: true, entries: ['g0', 'g1', 'g2', 'g3'] }],
}));

(async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Browser QA</title><button id="first" onclick="document.body.dataset.clicked=\'yes\'">Activate</button><a id="second" href="#second">Second link</a><input id="third" aria-label="Third field">');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browserUrl = `http://127.0.0.1:${server.address().port}/`;
  const app = await electron.launch({ executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':97', HOME: temp, TESSERA_DATA_DIR: dataDir, TESSERA_DEV: '1',
      XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  const errors = [], checks = [], geometry = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', e => errors.push(String(e)));
    await page.waitForFunction(() => !document.body.classList.contains('hold') && document.querySelectorAll('.tab').length >= 5);
    const resize = async (w, h) => {
      await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setFullScreen(false); win.setContentSize(...size); }, [w, h]);
      await page.waitForTimeout(500);
    };
    const useTheme = async id => {
      await page.evaluate(async id => { const r = await launcherAPI.settings('themeUse', { id }); if (!r.ok) throw Error('Theme unavailable: ' + id); applyTheme(r.theme); const motion = await launcherAPI.settings('themeSet', { id: 'motion', value: false }); applyTheme(motion.theme); }, id);
      await page.waitForTimeout(250);
    };
    const goto = async id => { await page.evaluate(id => { page = id; hoverId = id; stack = []; focus = 'content'; render(); }, id); await page.waitForTimeout(250); };
    const factory = ['stock', 'cartridge-pop', 'arcade-marquee', 'dashboard-steel'];
    for (const [w, h] of [[1920, 1080], [1280, 720]]) {
      await resize(w, h);
      for (const id of factory) {
        await useTheme(id);
        await goto('library');
        const g = await page.evaluate(() => {
          const rect = sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
          return { shell: document.body.dataset.shellLayout, width: innerWidth, height: innerHeight, header: rect('header'), main: rect('main'), footer: rect('footer'), activeCard: rect('.card.active'), cards: document.querySelectorAll('.card').length };
        });
        assert(g.cards >= 8, id + ': games visible in model');
        assert(g.main.width > 0 && g.main.height > 0, id + ': content area non-empty');
        assert(g.footer.height > 0 && g.footer.y + g.footer.height <= h + 1, id + ': controller hints remain visible');
        assert(g.activeCard.x >= -1 && g.activeCard.y >= -1 && g.activeCard.x + g.activeCard.width <= w + 1 && g.activeCard.y + g.activeCard.height <= h + 1, id + ': selected tile stays on-screen');
        geometry.push({ theme: id, ...g });
        await page.screenshot({ path: path.join(output, `${id}-${w}.png`) });
        checks.push(`${id} library at ${w}x${h}`);
        await goto('settings');
        assert(await page.locator('.card').count() > 5);
        await goto('home');
        assert.equal(await page.locator('#canvas .card').count(), 3);
        checks.push(`${id} Settings and Home preserve content at ${w}x${h}`);
      }
    }
    await useTheme('dashboard-steel');
    const saved = await page.evaluate(async () => {
      const invalid = await launcherAPI.settings('themeSet', { id: 'shellLayout', value: 'run-arbitrary-code' });
      const r = await launcherAPI.addons('saveTheme', { name: 'QA Saved Dashboard' });
      if (r.theme) applyTheme(r.theme);
      return { invalid: invalid.ok, ok: r.ok, active: r.theme.active, shell: r.theme.settings.find(s => s.id === 'shellLayout').value };
    });
    assert.equal(saved.invalid, false);
    assert.equal(saved.ok, true);
    assert.equal(saved.shell, 'dashboard');
    const themeFile = path.join(dataDir, 'Tessera', 'Themes', saved.active, 'theme.json');
    assert.equal(JSON.parse(fs.readFileSync(themeFile, 'utf8')).defaults.shellLayout, 'dashboard');
    checks.push('Saved theme round-trips structural shell; invalid choice rejected');
    await goto('library');
    await page.evaluate(() => {
      window.__qaPad = { id: 'QA virtual Xbox controller', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(), axes: [0,0,0,0], buttons: Array.from({length: 18}, () => ({ pressed: false, touched: false, value: 0 })) };
      navigator.getGamepads = () => [window.__qaPad];
    });
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => selectedTile().id);
    await page.evaluate(() => { __qaPad.buttons[15] = { pressed: true, touched: true, value: 1 }; });
    await page.waitForTimeout(250);
    await page.evaluate(() => { __qaPad.buttons[15] = { pressed: false, touched: false, value: 0 }; });
    assert.notEqual(await page.evaluate(() => selectedTile().id), before);
    checks.push('Real renderer gamepad polling moves Library selection using virtual D-pad');
    await page.evaluate(async url => { browserUrl = url; await launchBrowser(); }, browserUrl);
    await page.waitForTimeout(400);
    const browserState = await app.evaluate(({ webContents, session }, url) => {
      const view = webContents.getAllWebContents().find(w => w.getURL().startsWith(url));
      if (!view) throw Error('Browser view was not loaded');
      const p = view.getLastWebPreferences();
      return { focused: view.isFocused(), node: p.nodeIntegration, isolated: p.contextIsolation, sandbox: p.sandbox, partition: view.session === session.fromPartition('persist:tessera-browser'), preload: p.preload };
    }, browserUrl);
    assert.equal(browserState.focused, true);
    assert.equal(browserState.node, false);
    assert.equal(browserState.isolated, true);
    assert.equal(browserState.sandbox, true);
    assert.equal(browserState.partition, true);
    assert(!browserState.preload);
    const key = async code => {
      const events = require(path.join(launcher, 'browser-navigation.js')).keyEvents(code);
      await app.evaluate(({ webContents }, { url, events }) => {
        const view = webContents.getAllWebContents().find(w => w.getURL().startsWith(url));
        for (const event of events) view.sendInputEvent(event);
      }, { url: browserUrl, events });
      await page.waitForTimeout(100);
    };
    await key('TAB');
    assert.equal(await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(w => w.getURL().startsWith(url)).executeJavaScript('document.activeElement.id'), browserUrl), 'first');
    await key('ENTER');
    assert.equal(await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(w => w.getURL().startsWith(url)).executeJavaScript('document.body.dataset.clicked'), browserUrl), 'yes');
    checks.push('Embedded view receives focus-next and confirm keys; no remote preload/Node bridge');
    const action = async action => app.evaluate(({ BrowserWindow }, action) => BrowserWindow.getAllWindows()[0].webContents.send('browser-action', action), action);
    await action('y');
    await action('y');
    await page.waitForFunction(() => document.querySelector('#modal.keys') && !document.querySelector('#modal').hidden);
    assert.equal(await page.evaluate(() => modal.kind), 'keys');
    await page.evaluate(() => onButton(1));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => browserOpen && !modal), true);
    checks.push('Main-to-renderer address action opens one visible keyboard; cancel restores browser');
    await action('rb');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => browserOpen), false);
    assert.equal(await page.evaluate(() => launcherAPI.browser('show').then(r => r.ok)), false);
    checks.push('Bumper exits browser; closed session cannot resume through show');
    await page.evaluate(async url => { browserUrl = url; await launchBrowser(); }, browserUrl);
    await action('b');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => browserOpen), false);
    checks.push('Browser Back action restores launcher state');
    const blocked = await page.evaluate(async url => {
      await launcherAPI.settings('pinSet', { pin: '1234' });
      await launcherAPI.settings('pinLock');
      const r = await launcherAPI.browser('open', { url });
      const s = await launcherAPI.browser('show');
      return { open: r.needPin, show: s.needPin };
    }, browserUrl);
    assert.equal(blocked.open, true);
    assert.equal(blocked.show, true);
    checks.push('Main process requires PIN for open and show, independently of renderer prompts');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'integration-results.json'), JSON.stringify({ ok: true, electron: await app.evaluate(() => process.versions.electron), checks, geometry, errors }, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, checks, errors }, null, 2));
  } finally { await app.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
