// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: the one input system on the real launcher. Stand-in Xbox and Nintendo
// controllers (Gamepad API objects) press buttons; the check is what those presses do, and what the
// on-screen hints call them, with Settings > Controller > Confirm button on either choice.
//   xvfb-run -a -s "-screen 0 1280x720x24 -noreset" node qa/input.cjs
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const launcher = process.argv[2] || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher');
const output = process.env.TESSERA_QA_OUTPUT || path.resolve(process.cwd(), 'qa-output');
const executablePath = process.env.TESSERA_ELECTRON || require('electron');
fs.mkdirSync(output, { recursive: true });
const checks = [];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-input-'));
// Past the first-run welcome, so its pages don't open over the test's menus.
fs.mkdirSync(path.join(temp, 'data'), { recursive: true });
fs.writeFileSync(path.join(temp, 'data', 'settings.json'), JSON.stringify({ firstRunDone: true }));

(async () => {
  const errors = [];
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: temp, TESSERA_DATA_DIR: path.join(temp, 'data'), TESSERA_DEV: '1', XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });
    await page.waitForFunction(() => typeof pick === 'function' && typeof api !== 'undefined', null, { timeout: 15000 });
    await page.evaluate(() => { if (modal) closeModal(); });
    // One stand-in controller at a time, swapped in through the Gamepad API.
    const usePad = (id) => page.evaluate((id) => {
      window.__qaPad = { id, index: 0, connected: true, mapping: 'standard', timestamp: performance.now(), axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })) };
      navigator.getGamepads = () => [window.__qaPad];
      setInputMode('pad');
    }, id);
    const tap = async (n) => {
      // Held long enough for the page's frame loop to see it, however slowly a hidden test window ticks.
      await page.evaluate((n) => { __qaPad.buttons[n] = { pressed: true, touched: true, value: 1 }; }, n);
      await page.waitForTimeout(300);
      await page.evaluate((n) => { __qaPad.buttons[n] = { pressed: false, touched: false, value: 0 }; }, n);
      await page.waitForTimeout(300);
    };
    // A two-item menu; returns what the next press did to it: 'chose' (confirm) or 'left' (back).
    const menuAnswer = async (n) => {
      await page.evaluate(() => { window.__qaAnswer = null; pick('QA menu', [{ label: 'One', v: 1 }, { label: 'Two', v: 2 }]).then((r) => { window.__qaAnswer = r ? 'chose' : 'left'; }); });
      await page.waitForFunction(() => modal && modal.title === 'QA menu');
      await tap(n);
      try { await page.waitForFunction(() => window.__qaAnswer !== null, null, { timeout: 3000 }); }
      catch { throw new Error('no answer; state: ' + await page.evaluate(() => JSON.stringify({ modal: modal && modal.title, busy, suspended, pad: currentPad, prev: prevBtn.slice(0, 4), hold: document.body.className }))); }
      return page.evaluate(() => window.__qaAnswer);
    };
    const hints = () => page.evaluate(() => ['0', '1', '3'].map((g) => document.querySelector(`footer [data-g="${g}"]`).textContent));
    const setConfirm = async (value) => {
      await page.evaluate((value) => padSet('confirm', value), value);
      assert.equal(await page.evaluate(() => prefs.pad.confirm), value);
    };
    const NINTENDO = 'Nintendo Switch Pro Controller'; // as pads.js names the ones it reads (native ones with Nintendo's vendor id are left to it)
    const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';

    // The default: the bottom button confirms on every controller, as it always has.
    assert.equal(await page.evaluate(() => prefs.pad.confirm), 'position');
    await usePad(XBOX);
    await page.waitForTimeout(200);
    assert.equal(await menuAnswer(0), 'chose');
    assert.equal(await menuAnswer(1), 'left');
    await usePad(NINTENDO);
    await page.waitForTimeout(200);
    assert.equal(await menuAnswer(0), 'chose', 'Nintendo, by position: the bottom button (B) confirms');
    assert.equal(await menuAnswer(1), 'left');
    await page.evaluate(() => applyGlyphs());
    assert.deepEqual(await hints(), ['B', 'A', 'X'], 'the hints name the buttons that do those jobs');
    checks.push('Default unchanged: the bottom button confirms on Xbox and Nintendo controllers, and the hints say so');

    // "A confirms" on Nintendo controllers: A (right) confirms, B (bottom) goes back, X and Y follow.
    await setConfirm('label');
    assert.equal(await menuAnswer(1), 'chose', 'A, on the right, confirms');
    assert.equal(await menuAnswer(0), 'left', 'B, at the bottom, goes back');
    await page.evaluate(() => applyGlyphs());
    assert.deepEqual(await hints(), ['A', 'B', 'Y'], 'Open says A, Back says B, Options says Y');
    await page.screenshot({ path: path.join(output, 'input-nintendo-label.png') });
    checks.push('With "A confirms", a Nintendo controller confirms with A and goes back with B, and the hints follow');

    // Other controllers are never affected by the Nintendo setting.
    await usePad(XBOX);
    await page.waitForTimeout(200);
    assert.equal(await menuAnswer(0), 'chose');
    assert.equal(await menuAnswer(1), 'left');
    await page.evaluate(() => applyGlyphs());
    assert.deepEqual(await hints(), ['A', 'B', 'Y']);
    checks.push('The Nintendo setting leaves Xbox controllers as they are');

    // The setting is kept, and Settings shows it.
    const saved = JSON.parse(fs.readFileSync(path.join(temp, 'data', 'settings.json'), 'utf8'));
    assert.equal(saved.pad.confirm, 'label');
    const bad = await page.evaluate(() => api.settings('padSet', { key: 'confirm', value: 'sideways' }));
    assert.equal(bad.ok, false);
    await setConfirm('position');
    checks.push('The choice is saved, and only its two values are accepted');
  } finally { await app.close(); }
  assert.deepEqual(errors, [], 'no page errors');
  for (const c of checks) console.log('ok -', c);
  console.log(`input: ${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
