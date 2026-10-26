// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: keyboard & mouse in the console UI (input-aware button hints, rebindable
// keys, key layouts, the pointer) and the guided tour, on the real launcher in real Electron.
//   xvfb-run -a -s "-screen 0 1280x720x24" node qa/keyboard.cjs
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');

const launcher = process.argv[2] || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher');
const output = process.env.TESSERA_QA_OUTPUT || path.resolve(process.cwd(), 'qa-output');
const executablePath = process.env.TESSERA_ELECTRON || require('electron');
fs.mkdirSync(output, { recursive: true });
const checks = [];

function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-kb-'));
  const dataDir = path.join(temp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ firstRunDone: true }));
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
    items: [{ id: 'g0', title: 'Test Game', kind: 'game', path: '/usr/bin/true' }],
    categories: [{ id: '_home', title: 'Home', builtin: true, entries: [] }],
  }));
  return { temp, dataDir };
}
async function start(fx) {
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: fx.temp, TESSERA_DATA_DIR: fx.dataDir, TESSERA_DEV: '1',
      XDG_CONFIG_HOME: path.join(fx.temp, 'config'), XDG_STATE_HOME: path.join(fx.temp, 'state') },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !document.body.classList.contains('hold') && document.querySelectorAll('.tab').length >= 5);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });
  await page.waitForTimeout(300);
  return { app, page };
}
const hints = (page) => page.evaluate(() => ({
  tabs: document.querySelector('footer [data-g="4,5"]').textContent,
  a: document.querySelector('footer [data-g="0"]').textContent,
  b: document.querySelector('footer [data-g="1"]').textContent,
  keys: document.body.classList.contains('hint-keys'),
  input: document.body.dataset.input,
}));

(async () => {
  const errors = [];
  const fx = fixture();
  let { app, page } = await start(fx);
  try {
    page.on('pageerror', (e) => errors.push(String(e)));
    let h = await hints(page);
    assert.equal(h.tabs, 'LB / RB', 'controller hints at start: ' + JSON.stringify(h));
    assert.equal(h.keys, false);

    // A key press switches the hints to the keyboard.
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    h = await hints(page);
    assert.equal(h.tabs, 'PgUp / PgDn', 'keyboard hints: ' + JSON.stringify(h));
    assert.equal(h.a, 'Enter');
    assert.equal(h.b, 'Esc');
    assert.equal(h.keys, true);
    await page.screenshot({ path: path.join(output, 'kb-hints-keyboard.png'), clip: { x: 0, y: 600, width: 1280, height: 120 } });
    checks.push('A key press switches the hints from LB / RB to PgUp / PgDn, Enter, Esc (keycaps)');

    // Moving the mouse: Click / Right-click.
    await page.mouse.move(300, 300);
    await page.mouse.move(340, 320);
    await page.waitForTimeout(100);
    h = await hints(page);
    assert.equal(h.a, 'Click', 'mouse hints: ' + JSON.stringify(h));
    assert.equal(h.b, 'Right-click');
    assert.equal(h.input, 'mouse');
    checks.push('Moving the mouse switches A / B hints to Click / Right-click');

    // A fresh controller press switches back.
    await page.evaluate(() => setInputMode('pad'));
    h = await hints(page);
    assert.equal(h.tabs, 'LB / RB');
    // "Always controller" pins them.
    await page.evaluate(() => api.settings('kbSet', { key: 'hints', value: 'controller' }).then((r) => { prefs.kb = { ...KB_DEFAULTS, ...r.kb }; kbRefresh(); }));
    await page.keyboard.press('ArrowUp');
    h = await hints(page);
    assert.equal(h.tabs, 'LB / RB', 'pinned to controller: ' + JSON.stringify(h));
    await page.evaluate(() => api.settings('kbSet', { key: 'hints', value: 'auto' }).then((r) => { prefs.kb = { ...KB_DEFAULTS, ...r.kb }; kbRefresh(); }));
    checks.push('Hints follow a controller again; "Always controller buttons" pins them');

    // PageDown and ] switch tabs; Esc+Right too.
    const tab = () => page.evaluate(() => hoverId);
    const t0 = await tab();
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(150);
    const t1 = await tab();
    assert.notEqual(t1, t0, 'PageDown switches tab');
    await page.keyboard.press('BracketLeft');
    await page.waitForTimeout(150);
    assert.equal(await tab(), t0, '[ switches back');
    await page.keyboard.down('Escape');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Escape');
    await page.waitForTimeout(150);
    assert.equal(await tab(), t1, 'Esc+Right switches tab');
    await page.keyboard.press('PageUp');
    checks.push('PgDn / [ / Esc+Right switch tabs');

    // The Settings tile and its menu.
    await page.evaluate(() => { page = 'settings'; hoverId = 'settings'; render(); flowKeyboardMenu(); });
    await page.waitForTimeout(300);
    const labels = await page.evaluate(() => modal.items.map((i) => i.label));
    for (const want of ['Key layout', 'Button hints', 'Select', 'Back', 'Previous tab', 'Next tab', 'Guide', 'Hide the pointer after', 'Scroll wheel']) assert.ok(labels.includes(want), 'menu has ' + want + ': ' + labels);
    await page.screenshot({ path: path.join(output, 'kb-menu.png') });
    await page.evaluate(() => onButton(1));
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.card')].some((c) => /Keyboard & mouse/.test(c.textContent))), 'Settings has a Keyboard & mouse tile');
    checks.push('Settings has a Keyboard & mouse tile with layout, hints, every action, pointer and wheel');

    // The WASD layout: E is next tab, and the hints say Q / E.
    await page.evaluate(() => { page = 'home'; hoverId = 'home'; focus = 'tabs'; render(); });
    await page.evaluate(() => api.settings('kbSet', { key: 'preset', value: 'wasd' }).then((r) => { prefs.kb = { ...KB_DEFAULTS, ...r.kb }; kbRefresh(); }));
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(150);
    assert.equal(await tab(), t1, 'E switches tab on WASD');
    h = await hints(page);
    assert.equal(h.tabs, 'Q / E', 'WASD hints: ' + JSON.stringify(h));
    assert.equal(h.a, 'Space');
    await page.keyboard.press('KeyQ');
    await page.waitForTimeout(150);
    checks.push('The WASD layout: E / Q switch tabs and the hints say Q / E');

    // Rebinding: capture a key for Select, then it works; it survives a restart.
    await page.evaluate(() => { window.__cap = captureKey('Select'); });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => modal && modal.kind === 'capture' && modal.keyboard), true);
    await page.keyboard.press('KeyG');
    const code = await page.evaluate(() => window.__cap);
    assert.equal(code, 'KeyG');
    let r = await page.evaluate(() => api.settings('kbBind', { action: 'a', code: 'KeyG' }));
    assert.equal(r.ok, true);
    assert.equal(r.kb.bindings.a[0], 'KeyG');
    r = await page.evaluate(() => api.settings('kbBind', { action: 'a', code: 'ShiftLeft' }));
    assert.equal(r.ok, false, 'Shift can not be bound');
    // The only key for an action can't be taken away.
    await page.evaluate(() => api.settings('kbBind', { action: 'x', code: 'KeyZ' }));
    for (const c of (await page.evaluate(() => api.settings('padGet').then(() => kbBindings().x)))) if (c !== 'KeyZ') await page.evaluate((c) => api.settings('kbUnbind', { action: 'x', code: c }), c);
    r = await page.evaluate(() => api.settings('kbUnbind', { action: 'x', code: 'KeyZ' }));
    assert.equal(r.ok, false, 'last key stays');
    r = await page.evaluate(() => api.settings('kbBind', { action: 'a', code: 'KeyZ' }));
    assert.equal(r.ok, false, 'taking the only key of another action is refused');
    assert.match(r.error, /only key/);
    checks.push('Capturing a key, binding it, refusing Shift and refusing to leave an action without a key');
  } finally { await app.close(); }

  ({ app, page } = await start(fx));
  try {
    page.on('pageerror', (e) => errors.push(String(e)));
    const kb = await page.evaluate(() => ({ preset: prefs.kb.preset, a: kbBindings().a[0], idx: kbIndex.get('KeyG') }));
    assert.deepEqual(kb, { preset: 'wasd', a: 'KeyG', idx: 'a' }, 'kept after a restart');
    const saved = JSON.parse(fs.readFileSync(path.join(fx.dataDir, 'settings.json'), 'utf8'));
    assert.equal(saved.kb.preset, 'wasd');
    checks.push('Key layout and bindings are kept after a restart');

    // Volume keys never throw (no audio here) and don't count as navigation.
    const before = await page.evaluate(() => hoverId);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'AudioVolumeUp', key: 'AudioVolumeUp' })));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => hoverId), before);
    checks.push('Volume keys are handled without moving anything');

    // The tour.
    await page.keyboard.press('ArrowLeft'); // keyboard hints
    await page.evaluate(() => runTour());
    await page.waitForTimeout(400);
    let t = await page.evaluate(() => ({ kind: modal && modal.kind, n: modal.steps.length, ring: document.querySelector('.tour-ring') && document.querySelector('.tour-ring').getBoundingClientRect().width }));
    assert.equal(t.kind, 'tour');
    assert.ok(t.n >= 8, 'tour has steps');
    const seen = [];
    for (let i = 0; i < t.n; i++) {
      const st = await page.evaluate(() => {
        const c = document.querySelector('.tour-card').getBoundingClientRect();
        const ring = document.querySelector('.tour-ring').getBoundingClientRect();
        return { title: document.querySelector('.tour-card h3').textContent, text: document.querySelector('.tour-card .mbody').textContent, hover: hoverId, card: [c.left, c.top, c.right, c.bottom], ring: [ring.left, ring.top, ring.right, ring.bottom] };
      });
      assert.ok(st.card[0] >= 0 && st.card[1] >= 0 && st.card[2] <= 1280 && st.card[3] <= 720, `card on screen: ${st.title} ${st.card}`);
      const overlap = st.ring[2] - st.ring[0] > 4 && !(st.card[3] <= st.ring[1] || st.card[1] >= st.ring[3] || st.card[2] <= st.ring[0] || st.card[0] >= st.ring[2]);
      if (overlap && st.ring[3] - st.ring[1] < 400) throw new Error(`card covers the lit part: ${st.title}`);
      seen.push(st);
      await page.screenshot({ path: path.join(output, `tour-${i + 1}.png`) });
      await page.waitForTimeout(80);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(450);
    }
    assert.equal(await page.evaluate(() => modal), null, 'Enter on the last step ends it');
    assert.ok(seen.some((s) => s.hover === 'library'), 'tour visits Library');
    assert.ok(seen.some((s) => /PgUp|Q/.test(s.text)), 'tour texts name keyboard keys: ' + seen[1].text);
    assert.equal(await page.evaluate(() => hoverId), before, 'the tour puts you back where you were');
    await page.evaluate(() => runTour());
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => modal && modal.i), 0, 'Esc goes back a step');
    await page.keyboard.press('KeyR'); // Options on WASD = leave the tour
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => modal), null, 'Options leaves the tour');
    checks.push(`The tour: ${t.n} steps, ring and card on screen, visits the tabs, names the keys in use, back / leave work, and puts you back`);

    // In the guide.
    await page.evaluate(() => openGuide());
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => modal && modal.items.some((i) => i.op === 'tour')), 'the guide offers the tour');
    checks.push('The guide offers "Take the tour"');
  } finally { await app.close(); }

  assert.deepEqual(errors, [], 'no page errors');
  fs.writeFileSync(path.join(output, 'keyboard.json'), JSON.stringify({ checks }, null, 2));
  for (const c of checks) console.log('ok -', c);
  console.log(`keyboard: ${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
