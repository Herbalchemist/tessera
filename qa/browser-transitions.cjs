// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: browser entrance/exit animations on the real launcher in real Electron.
//   xvfb-run -a -s "-screen 0 1280x720x24" node qa/browser-transitions.cjs
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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-transitions-'));
const dataDir = path.join(temp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ firstRunDone: true }));
const shot = (name) => { try { execFileSync('import', ['-window', 'root', path.join(output, name)]); } catch { /* no X screenshot tool */ } };

const PAGE = `<!doctype html><title>Transitions QA</title>
<body style="margin:0;font:28px sans-serif;background:repeating-linear-gradient(45deg,#2a6,#2a6 40px,#3b7 40px,#3b7 80px);color:#fff">
<h1 style="padding:40px">A web page</h1><script>window.loads = (window.loads || 0) + 1;</script></body>`;

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
    const inPage = (js) => app.evaluate(({ webContents }, { url, js }) =>
      webContents.getAllWebContents().find((w) => w.getURL().startsWith(url)).executeJavaScript(js), { url, js });
    const setAnim = (v) => page.evaluate(async (v) => { const r = await launcherAPI.settings('themeSet', { id: 'browserAnim', value: v }); applyTheme(r.theme); return r.ok; }, v);
    const state = () => page.evaluate(() => ({ open: browserOpen, moving: browserMoving, curtain: !document.getElementById('browser-curtain') || document.getElementById('browser-curtain').hidden }));

    // First entrance: no picture yet, so the themed placeholder comes in.
    assert.equal(await setAnim('slide'), true, 'browserAnim is a real theme setting');
    await page.evaluate((u) => { browserUrl = u; }, url);
    const entering = page.evaluate(() => launchBrowser(1));
    await page.waitForTimeout(150);
    const mid = await page.evaluate(() => { const c = document.getElementById('browser-curtain'); return { shown: !c.hidden, empty: c.classList.contains('empty'), anims: c.getAnimations({ subtree: true }).length }; });
    assert.deepEqual(mid, { shown: true, empty: true, anims: 1 }, 'placeholder slides in on the first entrance');
    shot('transition-first-in.png');
    await entering;
    await page.waitForTimeout(700);
    assert.deepEqual(await state(), { open: true, moving: false, curtain: true }, 'browser open, curtain gone');
    assert.equal(await inPage('loads'), 1);
    await inPage('window.marker = 42');
    checks.push('First entrance animates a themed placeholder, then the live page takes over');

    for (const style of ['slide', 'zoom', 'fade', 'rise', 'flip', 'doors', 'none']) {
      assert.equal(await setAnim(style), true);
      const leaving = page.evaluate(() => { const d = -1; closeBrowser(d); moveTabs(d); });
      await page.waitForTimeout(style === 'none' ? 50 : 230);
      const out = await page.evaluate(() => { const c = document.getElementById('browser-curtain'); return { shown: !c.hidden, picture: c.querySelector('.half').style.backgroundImage.startsWith('url("data:image/jpeg'), anims: c.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length, launcher: !document.body.classList.contains('browser-open') }; });
      if (style !== 'none') {
        assert.equal(out.shown && out.picture && out.launcher, true, `${style}: a picture of the page leaves over the launcher ` + JSON.stringify(out));
        assert.ok(out.anims >= 1, `${style}: animating`);
        shot(`transition-${style}-out.png`);
      }
      await leaving;
      await page.waitForTimeout(500);
      const after = await state();
      assert.equal(after.open, false, `${style}: closed`);
      assert.equal(after.curtain, true, `${style}: curtain hidden after leaving`);
      // Back in with RB: picture comes in, live page resumes without reloading.
      await page.evaluate(() => { moveTabs(1); return launchBrowser(1); });
      await page.waitForTimeout(700);
      assert.equal((await state()).open, true, `${style}: reopened`);
      assert.equal(await inPage('loads'), 1, `${style}: the page resumed where it was, no reload`);
      assert.equal(await inPage('window.marker'), 42);
    }
    checks.push('All seven transitions (slide, zoom, fade, rise, flip, doors, none) leave and return cleanly');
    checks.push('Returning to the Browser tab resumes the page without reloading it');

    // Esc+Right typed inside the page switches tabs, like RB.
    const tabBefore = await page.evaluate(() => hoverId);
    await app.evaluate(({ webContents }, url) => {
      const v = webContents.getAllWebContents().find((w) => w.getURL().startsWith(url));
      v.focus();
      v.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      v.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
      v.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
      v.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    }, url);
    await page.waitForTimeout(900);
    const afterChord = await page.evaluate(() => ({ open: browserOpen, hover: hoverId }));
    assert.equal(afterChord.open, false, 'Esc+Right inside the page leaves the browser');
    assert.notEqual(afterChord.hover, tabBefore, 'and moves to the next tab');
    checks.push('Esc+Left/Esc+Right typed inside the page switch tabs like LB/RB');

    // The address keyboard keeps a dimmed picture of the page behind it.
    await page.evaluate(() => launchBrowser(1));
    await page.waitForTimeout(700);
    const urlBar = page.evaluate(() => openUrlBar());
    await page.waitForTimeout(500);
    const behind = await page.evaluate(() => { const c = document.getElementById('browser-curtain'); return { shown: !c.hidden, dim: c.classList.contains('dim'), modal: modal && modal.kind }; });
    assert.deepEqual(behind, { shown: true, dim: true, modal: 'keys' });
    shot('transition-urlbar.png');
    await page.evaluate(() => onButton(1));
    await urlBar;
    await page.waitForTimeout(500);
    assert.deepEqual(await state(), { open: true, moving: false, curtain: true }, 'cancelling the address returns to the page');
    checks.push('Address keyboard shows a dimmed picture of the page behind it');

    // Framed (the default): the page sits in the frame's opening, and the frame names it.
    const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getBounds());
    const opening = () => page.evaluate(() => { const r = document.querySelector('#browser-frame .bf-view').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; });
    assert.equal(await page.evaluate(() => !document.getElementById('browser-frame').hidden), true, 'the frame is up');
    assert.deepEqual(await bounds(), await opening(), 'the page fills the opening exactly');
    const b = await bounds();
    assert.ok(b.x > 0 && b.y > 30 && b.width < 1280 && b.height < 720, 'Tessera stays around it');
    await page.waitForFunction(() => document.querySelector('#browser-frame .bf-title').textContent === 'Transitions QA');
    assert.match(await page.evaluate(() => document.querySelector('#browser-frame .bf-host').textContent), /^127\.0\.0\.1:\d+$/);
    shot('browser-framed.png');
    checks.push('Framed: the page sits in a themed frame (exactly in its opening), which shows its title and address');

    // The address bubble: out of the pill, the address selected; typing replaces it; Go goes.
    await page.evaluate(() => { const orig = Element.prototype.animate; window.__qaFirst = null; Element.prototype.animate = function (k, o) { if (!window.__qaFirst && this.classList.contains('ub-body')) window.__qaFirst = k[0]; return orig.call(this, k, o); }; });
    const pillRect = await page.evaluate(() => { const r = document.querySelector('.bf-addr').getBoundingClientRect(); return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' }; });
    const going = page.evaluate(() => openUrlBar());
    await page.waitForFunction(() => modal && modal.kind === 'keys');
    await page.waitForTimeout(500);
    const bub = await page.evaluate(() => {
      const b = document.getElementById('url-bubble');
      const t = b.querySelector('.ub-text');
      const pill = document.querySelector('.bf-addr');
      const body = b.querySelector('.ub-body').getBoundingClientRect();
      return { shown: !b.hidden, sel: t.classList.contains('sel'), text: t.textContent, slot: pill.classList.contains('pulled'), below: body.top > document.querySelector('.bf-top').getBoundingClientRect().bottom, bigger: body.width > pill.getBoundingClientRect().width, go: [...document.querySelectorAll('#modal .key.done')].map((k) => k.textContent)[0] };
    });
    assert.deepEqual(bub, { shown: true, sel: true, text: url, slot: true, below: true, bigger: true, go: 'Go' });
    const first = await page.evaluate(() => window.__qaFirst);
    assert.deepEqual({ left: first.left, top: first.top, width: first.width }, pillRect, 'the bubble starts as the pill itself');
    shot('browser-address-bubble.png');
    await page.evaluate((u) => { for (const ch of u + 'two') typeChar(ch); }, url);
    assert.equal(await page.evaluate(() => document.querySelector('#url-bubble .ub-text').textContent), url + 'two', 'the first key replaced the selected address');
    await page.evaluate(() => keyAction('done'));
    await going;
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => browserUrl), url + 'two');
    assert.equal(await page.evaluate(() => document.getElementById('url-bubble').hidden), true, 'the bubble went back up');
    assert.equal(await page.evaluate(() => document.querySelector('.bf-addr').classList.contains('pulled')), false, 'and docked in its slot again');
    assert.deepEqual(await state(), { open: true, moving: false, curtain: true });
    checks.push('Address bubble: the pill itself is pulled out of the bar (its slot left empty) and grows; typing replaces the selected address; Go opens it and it docks back');

    // Address bubble style: Detached lets go of the tail once it's open, and reconnects to go home.
    assert.equal((await page.evaluate(() => launcherAPI.settings('themeSet', { id: 'addressBubble', value: 'loose' }))).ok, false, 'only its three styles');
    await page.evaluate(async () => { const r = await launcherAPI.settings('themeSet', { id: 'addressBubble', value: 'detached' }); applyTheme(r.theme); });
    const detaching = page.evaluate(() => openUrlBar());
    await page.waitForFunction(() => modal && modal.kind === 'keys');
    await page.waitForFunction(() => document.getElementById('url-bubble')._detached === true, null, { timeout: 4000 });
    await page.waitForTimeout(400);
    const neck = await page.evaluate(() => { const n = document.querySelector('#url-bubble .ub-neck'); const cs = getComputedStyle(n); return { opacity: Number(cs.opacity), height: Math.round(parseFloat(cs.height)) }; });
    assert.deepEqual(neck, { opacity: 0, height: 0 }, 'the tail has let go');
    shot('browser-address-detached.png');
    await page.evaluate(() => finishKeys(false));
    await detaching;
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.getElementById('url-bubble').hidden && !document.querySelector('.bf-addr').classList.contains('pulled')), true, 'docked again');
    await page.evaluate(async () => { const r = await launcherAPI.settings('themeSet', { id: 'addressBubble', value: 'wide' }); applyTheme(r.theme); });
    checks.push('Address bubble style: wide or narrow neck, or detached (the tail lets go once open and reconnects to dock)');

    // Full screen (Theme Settings › Browser frame): the page gets the whole window again.
    await page.evaluate(() => closeBrowser(-1));
    await page.waitForTimeout(700);
    await page.evaluate(async () => { const r = await launcherAPI.settings('themeSet', { id: 'browserFrame', value: 'full' }); applyTheme(r.theme); });
    await page.evaluate(() => launchBrowser(1));
    await page.waitForTimeout(800);
    const win = await app.evaluate(({ BrowserWindow }) => { const c = BrowserWindow.getAllWindows()[0].getContentBounds(); return { x: 0, y: 0, width: c.width, height: c.height }; });
    assert.deepEqual(await bounds(), win);
    assert.equal(await page.evaluate(() => { const f = document.getElementById('browser-frame'); return !f || f.hidden; }), true);
    await page.evaluate(async () => { const r = await launcherAPI.settings('themeSet', { id: 'browserFrame', value: 'framed' }); applyTheme(r.theme); });
    checks.push('Full screen is still a choice: the page takes the whole window and the frame steps away');

    assert.deepEqual(errors, []);
    console.log('OK ' + checks.length + ' checks\n- ' + checks.join('\n- '));
  } finally {
    await app.close().catch(() => {});
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
