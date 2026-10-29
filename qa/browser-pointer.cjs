// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: the embedded browser's controller pointer, on the real launcher in real Electron.
// Stick and trigger values are fed through the TESSERA_DEV hook in place of a physical pad;
// everything after that (pointer engine, cursor view, Chromium input events) is the shipping code.
//   xvfb-run -a -s "-screen 0 1280x720x24" node qa/browser-pointer.cjs
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const launcher = process.argv[2] || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher');
const output = process.env.TESSERA_QA_OUTPUT || path.resolve(process.cwd(), 'qa-output');
const executablePath = process.env.TESSERA_ELECTRON || require('electron');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-pointer-'));
const dataDir = path.join(temp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ firstRunDone: true }));

const PAGE = `<!doctype html><title>Pointer QA</title>
<body style="margin:0;height:6000px;background:linear-gradient(#fafafa,#9ab)">
<p style="font:24px sans-serif;padding:20px">Pointer QA page</p>
<script>
  window.qa = { moves: 0, last: null, clicks: [], menus: 0 };
  addEventListener('mousemove', (e) => { qa.moves++; qa.last = [e.clientX, e.clientY]; });
  addEventListener('click', (e) => qa.clicks.push([e.button, e.clientX, e.clientY]));
  addEventListener('contextmenu', (e) => { qa.menus++; e.preventDefault(); });
</script></body>`;

(async () => {
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(PAGE); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: temp, TESSERA_DATA_DIR: dataDir, TESSERA_DEV: '1',
      XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  const checks = [];
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForFunction(() => !document.body.classList.contains('hold') && document.querySelectorAll('.tab').length >= 5);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });
    await page.waitForTimeout(300);
    await page.evaluate(async (u) => { browserUrl = u; await launchBrowser(); }, url);
    await page.waitForTimeout(800);

    const inPage = (js) => app.evaluate(({ webContents }, { url, js }) =>
      webContents.getAllWebContents().find((w) => w.getURL().startsWith(url)).executeJavaScript(js), { url, js });
    const feed = (name, value) => app.evaluate((_e, a) => globalThis.__tesseraBrowserAnalog('qa-pad', a[0], a[1]), [name, value]);
    const hold = async (name, value, ms) => { await feed(name, value); await page.waitForTimeout(ms); await feed(name, 0); await page.waitForTimeout(60); };
    const cursorView = () => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const v = w.contentView.children.find((c) => c.webContents && c.webContents.getURL().startsWith('data:text/html'));
      return v ? { visible: v.getVisible(), bounds: v.getBounds(), last: w.contentView.children.at(-1) === v } : null;
    });

    // Right stick moves the cursor, faster when pushed further.
    assert.equal((await cursorView()).visible, false, 'cursor hidden until the stick is used');
    await hold('rx', 0.55, 300);
    const a = await inPage('qa.last');
    await hold('rx', 1, 300);
    const b = await inPage('qa.last');
    assert.ok(a[0] > 640, 'cursor moved right from the centre: ' + a);
    const slow = a[0] - 640;
    const fast = b[0] - a[0];
    assert.ok(fast > slow * 2.5, `full tilt is much faster (${slow}px vs ${fast}px in the same time)`);
    const cv = await cursorView();
    assert.ok(cv.visible && cv.last, 'cursor view shown above the page');
    // The page may sit inside Tessera's frame: the cursor is drawn at the page's offset plus where the page sees the mouse.
    const pageAt = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getBounds());
    assert.equal(cv.bounds.x + 4, pageAt.x + b[0], 'cursor drawn where the page sees the mouse');
    assert.equal(cv.bounds.y + 3, pageAt.y + b[1], 'cursor drawn where the page sees the mouse (down)');
    checks.push('Right stick moves a visible cursor; speed follows stick deflection');

    // Left stick scrolls, down is down, harder is faster.
    await hold('ly', 0.5, 300);
    const s1 = await inPage('scrollY');
    await hold('ly', 1, 300);
    const s2 = await inPage('scrollY');
    assert.ok(s1 > 0, 'pushing down scrolls the page down: ' + s1);
    assert.ok(s2 - s1 > s1 * 2.5, `full tilt scrolls much faster (${s1} vs ${s2 - s1})`);
    await hold('ly', -1, 200);
    assert.ok((await inPage('scrollY')) < s2, 'pushing up scrolls back up');
    checks.push('Left stick scrolls with analog speed in the right direction');

    // Triggers click.
    // Each trigger on its own, so one can't be credited with the other's click.
    await feed('rt', 1); await page.waitForTimeout(40); await feed('rt', 0); await page.waitForTimeout(150);
    assert.equal((await inPage('qa.clicks')).length, 1, 'RT made a left click');
    assert.equal(await inPage('qa.menus'), 0, 'and no right click');
    await feed('lt', 1); await page.waitForTimeout(40); await feed('lt', 0); await page.waitForTimeout(150);
    const clicks = await inPage('qa.clicks');
    assert.equal(clicks.length, 1, 'LT made no left click');
    assert.equal(clicks[0][0], 0);
    assert.equal(clicks[0][1], b[0], 'the click lands under the cursor');
    assert.equal(await inPage('qa.menus'), 1, 'LT made a right click (context menu)');
    checks.push('RT left-clicks and LT right-clicks under the cursor');

    try { execFileSync('import', ['-window', 'root', path.join(output, 'browser-pointer.png')]); } catch { /* no X screenshot tool */ }

    // The setting swaps the sticks.
    const r = await page.evaluate(() => launcherAPI.settings('padSet', { key: 'browserCursor', value: 'left' }));
    assert.equal(r.ok, true);
    const before = await inPage('qa.last');
    const sBefore = await inPage('scrollY');
    await hold('lx', -1, 250);
    await hold('ry', 1, 250);
    const after = await inPage('qa.last');
    assert.ok(after[0] < before[0], 'left stick now moves the cursor');
    assert.ok((await inPage('scrollY')) > sBefore, 'right stick now scrolls');
    checks.push('Cursor stick setting swaps the sticks');

    // Leaving the browser hides the cursor and drops held state.
    await feed('rt', 1);
    await page.evaluate(() => closeBrowser());
    await page.waitForTimeout(300);
    const gone = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);
    assert.equal(gone, 0, 'page and cursor views both removed');
    checks.push('Closing the browser removes the page and the cursor');

    assert.deepEqual(errors, []);
    console.log('OK ' + checks.length + ' checks\n- ' + checks.join('\n- '));
  } finally {
    await app.close().catch(() => {});
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
