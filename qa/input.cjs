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
if (process.env.QA_VERBOSE) { const push = checks.push.bind(checks); checks.push = (c) => { console.error('.. ' + c); return push(c); }; }
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

    // Every menu shows what it takes, under it, named for what's in use.
    const menuHints = async (extra) => {
      await page.evaluate((extra) => { pick('Hints menu', [{ label: 'One' }, { label: 'Two' }], 0, extra ? { onY: () => {}, yLabel: 'Rename' } : {}); }, extra);
      await page.waitForFunction(() => modal && modal.title === 'Hints menu');
      const t = await page.evaluate(() => [...document.querySelectorAll('#modal .mhints span')].map((s) => s.textContent));
      await page.evaluate(() => closeModal());
      return t;
    };
    await page.evaluate(() => setInputMode('pad'));
    assert.deepEqual(await menuHints(true), ['ASelect', 'BBack', 'YRename']);
    assert.deepEqual(await menuHints(false), ['ASelect', 'BBack']);
    await page.evaluate(() => setInputMode('keyboard'));
    assert.deepEqual(await menuHints(true), ['EnterSelect', 'EscBack', 'YRename']);
    await page.evaluate(() => setInputMode('pad'));
    await usePad(NINTENDO);
    await page.waitForTimeout(200);
    assert.deepEqual(await menuHints(true), ['ASelect', 'BBack', 'YRename'], 'Nintendo with A confirms: A selects, B goes back, Y does Y');
    await setConfirm('position');
    assert.deepEqual(await menuHints(false), ['BSelect', 'ABack'], 'Nintendo by position: the bottom button (B) selects');
    await setConfirm('label');
    await usePad(XBOX);
    await page.waitForTimeout(200);
    checks.push('Every menu shows its own hints (Select, Back, and its Y action) for the controller, keyboard or Nintendo setting in use');

    // Holding a direction: one repeater, at the speed chosen; a new direction moves at once.
    const held = async (ms) => {
      await page.evaluate(() => { window.__qaHold = null; pick('Long menu', Array.from({ length: 40 }, (_, i) => ({ label: 'Row ' + i }))); });
      await page.waitForFunction(() => modal && modal.title === 'Long menu');
      await page.evaluate(() => { __qaPad.buttons[13] = { pressed: true, touched: true, value: 1 }; });
      await page.waitForTimeout(ms);
      await page.evaluate(() => { __qaPad.buttons[13] = { pressed: false, touched: false, value: 0 }; });
      await page.waitForTimeout(150);
      const moved = await page.evaluate(() => modal.index);
      await page.evaluate(() => closeModal());
      return moved;
    };
    const std = await held(1300);
    assert.ok(std >= 4 && std <= 8, `standard: a step every 200 ms (moved ${std} in 1.3 s)`);
    await page.evaluate(() => padSet('repeat', 'fast'));
    const fast = await held(1300);
    assert.ok(fast > std, `faster is faster (${fast} > ${std})`);
    await page.evaluate(() => padSet('repeat', 'standard'));
    checks.push(`Holding down repeats at the chosen speed (standard ${std}, faster ${fast} rows in 1.3 s)`);

    // The setting is kept, and Settings shows it.
    const saved = JSON.parse(fs.readFileSync(path.join(temp, 'data', 'settings.json'), 'utf8'));
    assert.equal(saved.pad.confirm, 'label');
    const bad = await page.evaluate(() => api.settings('padSet', { key: 'confirm', value: 'sideways' }));
    assert.equal(bad.ok, false);
    await setConfirm('position');
    checks.push('The choice is saved, and only its two values are accepted');

    // Settings > Button mapping: Select onto RB, on Xbox controllers only.
    await usePad(XBOX);
    await page.waitForTimeout(200);
    page.evaluate(() => { flowControls(); });
    await page.waitForFunction(() => modal && modal.title === 'Button mapping');
    assert.ok(await page.evaluate(() => modal.items.some((x) => x.header && x.label === 'Xbox controller buttons')));
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.role === 0); modalPress('a'); });
    await page.waitForFunction(() => modal && modal.kind === 'capture');
    await tap(9); // Menu: not one it takes
    assert.match(await page.evaluate(() => modal.note), /face button/);
    await tap(5); // RB
    await page.waitForFunction(() => modal && modal.title === 'Button mapping');
    assert.deepEqual(await page.evaluate(() => prefs.pad.remap.xbox), [5, 1, 2, 3, 4, 0]);
    assert.equal(await page.evaluate(() => modal.items.find((x) => x.role === 0).sub), 'RB');
    assert.equal(await page.evaluate(() => modal.items.find((x) => x.role === 5).sub), 'A', 'the bottom button took over Next tab');
    await page.evaluate(() => closeModal());
    await page.waitForTimeout(300);
    assert.equal(await menuAnswer(5), 'chose', 'RB now selects');
    assert.equal(await menuAnswer(1), 'left', 'Back is where it was');
    assert.deepEqual(await menuHints(false), ['RBSelect', 'BBack']);
    await usePad(NINTENDO);
    await page.waitForTimeout(200);
    assert.equal(await menuAnswer(0), 'chose', 'Nintendo controllers keep their own layout');
    checks.push('Button mapping: Select moved to RB on Xbox controllers (it trades jobs with A); menus and hints follow; Nintendo untouched');

    // Only full rearrangements are taken, and it all goes back.
    const r1 = await page.evaluate(() => api.settings('padRemap', { family: 'xbox', map: [0, 0, 2, 3, 4, 5] }));
    assert.equal(r1.ok, false, 'a job on no button is refused');
    const r2 = await page.evaluate(() => api.settings('padRemap', { family: 'arcade', map: [0, 1, 2, 3, 4, 5] }));
    assert.equal(r2.ok, false);
    const r3 = await page.evaluate(() => api.settings('padRemap', { family: 'nintendo', map: [2, 1, 0, 3, 4, 5] }));
    assert.equal(r3.ok, true);
    await page.evaluate(() => padSet('confirm', 'label'));
    assert.equal(await page.evaluate(() => prefs.pad.remap.nintendo), undefined, 'choosing a confirm button replaces a Nintendo remap');
    await page.evaluate(() => padSet('confirm', 'position'));
    await usePad(XBOX);
    await page.waitForTimeout(200);
    page.evaluate(() => { flowControls(); });
    await page.waitForFunction(() => modal && modal.title === 'Button mapping');
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.op === 'padReset'); modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Button mapping' && !prefs.pad.remap.xbox);
    await page.evaluate(() => closeModal());
    await page.waitForTimeout(300);
    assert.equal(await menuAnswer(0), 'chose');
    const saved2 = JSON.parse(fs.readFileSync(path.join(temp, 'data', 'settings.json'), 'utf8'));
    assert.deepEqual(saved2.pad.remap, {});
    checks.push('Remaps must keep every job on one button; choosing a confirm button or "Put these buttons back" undoes them');

    // A right Joy-Con on its own, held sideways (as pads.js hands it over): read by position, labelled
    // as it's held (A at the bottom), and the Nintendo "A confirms" setting leaves it alone.
    await page.evaluate(() => {
      applyPadList({ ok: true, grip: false, mode: 'separate', pads: [{ id: 'jr:qa/jr', name: 'Joy-Con (R) (Nintendo)', kind: 'jr', player: 1, parts: ['jr'], sideways: true, battery: null, error: '' }] });
      navigator.getGamepads = () => [];
      window.__qaPad = vpads.get('jr:qa/jr');
      setInputMode('pad');
    });
    await page.waitForTimeout(200);
    for (const confirm of ['position', 'label']) {
      await setConfirm(confirm);
      assert.equal(await menuAnswer(0), 'chose', `sideways, ${confirm}: the bottom button (A) selects`);
      assert.equal(await menuAnswer(1), 'left', `sideways, ${confirm}: the right button (X) goes back`);
      assert.deepEqual(await menuHints(false), ['ASelect', 'XBack']);
    }
    await setConfirm('position');
    await page.evaluate(() => applyPadList({ ok: true, grip: false, mode: 'separate', pads: [] }));
    checks.push('A single Joy-Con held sideways: the bottom button (A) selects and the hints say A / X, with either Confirm setting');
    await usePad(XBOX);
    await page.waitForTimeout(200);

    // The guide: moving through it redraws in place (no slide-in again, scroll kept).
    await page.evaluate(() => { for (let i = 0; i < 8; i++) setStatus('QA note ' + i); });
    await page.evaluate(() => openGuide());
    await page.waitForFunction(() => modal && modal.title === 'Guide');
    await page.waitForTimeout(400);
    const guideState = () => page.evaluate(() => ({ cls: document.getElementById('modal').className, anims: document.getElementById('modal').getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length, top: document.querySelector('#modal .mlist').scrollTop }));
    for (let i = 0; i < 14; i++) await page.evaluate(() => modalPress('down'));
    const g1 = await guideState();
    assert.match(g1.cls, /\bagain\b/);
    assert.equal(g1.anims, 0, 'nothing replays while moving');
    await page.evaluate(() => modalPress('down'));
    const g2 = await guideState();
    assert.ok(g2.top >= g1.top, 'the list stays scrolled');
    checks.push('The guide redraws in place as you move: no slide-in again, and it keeps its scroll');

    // Notifications: a panel on the right; X hides it (still queued), Y clears it.
    const notes = () => page.evaluate(() => { const p = document.querySelector('#modal .gnotes'); return p ? { hidden: p.classList.contains('hidden'), items: p.querySelectorAll('.gn-item').length, title: p.querySelector('h4').textContent } : null; });
    assert.equal(await page.evaluate(() => modal.items.some((x) => /QA note/.test(x.label))), false, 'not in the guide list');
    assert.deepEqual(await notes(), { hidden: false, items: 6, title: 'Notifications' });
    await page.screenshot({ path: path.join(output, 'input-guide-notes.png') });
    await tap(2);
    assert.deepEqual(await notes(), { hidden: true, items: 0, title: '6 notifications' });
    assert.equal(await page.evaluate(() => statusLog.length), 6, 'hiding keeps them');
    await tap(2);
    assert.equal((await notes()).hidden, false);
    await tap(3);
    assert.equal(await notes(), null, 'cleared: the panel goes');
    assert.equal(await page.evaluate(() => statusLog.length), 0);
    assert.equal(await page.evaluate(() => modal.onX), null);
    await page.evaluate(() => closeGuide());
    await page.waitForTimeout(300);
    await page.evaluate(() => setStatus('Controller: QA pad', false, { log: false }));
    assert.equal(await page.evaluate(() => statusLog.length), 0, 'a controller taking over is not a notification');
    checks.push('Notifications sit in their own panel: X hides or shows them (kept), Y clears them; controller changes aren\'t notifications');

    // Guide styles.
    await page.evaluate(() => padSet('guideStyle', 'float'));
    await page.evaluate(() => openGuide());
    await page.waitForFunction(() => modal && modal.title === 'Guide');
    assert.match(await page.evaluate(() => document.getElementById('modal').className), /guide-float/);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(output, 'input-guide-float.png') });
    await page.evaluate(() => closeGuide());
    await page.waitForTimeout(300);
    // Each style places notifications its own way.
    await page.evaluate(() => { setStatus('QA style note'); });
    const placement = async (st) => {
      await page.evaluate((st) => padSet('guideStyle', st), st);
      await page.evaluate(() => { openGuide(); });
      await page.waitForFunction(() => modal && modal.title === 'Guide' && document.querySelector('#modal .gnotes'));
      const where = await page.evaluate(() => { const n = document.querySelector('#modal .gnotes'); return { cls: n.className.replace(/\s*hidden/, ''), inBox: Boolean(n.closest('.box')), beforeList: n.nextElementSibling ? n.nextElementSibling.className : '' }; });
      await page.evaluate(() => closeGuide());
      await page.waitForTimeout(300);
      return where;
    };
    assert.deepEqual(await placement('side'), { cls: 'gnotes gn-side', inBox: false, beforeList: '' });
    assert.deepEqual(await placement('float'), { cls: 'gnotes gn-float', inBox: true, beforeList: '' });
    assert.deepEqual(await placement('compact'), { cls: 'gnotes gn-compact', inBox: true, beforeList: 'mlist' });
    await page.evaluate(() => { statusLog.length = 0; });
    await page.evaluate(() => padSet('guideStyle', 'side'));
    checks.push('Guide style: side panel, floating card or compact, each with its own notifications (side panel, tucked card, inline strip)');

    // On-screen keyboard size: docked (default) or wide.
    const kbClass = async () => { page.evaluate(() => { ask('QA', ''); }); await page.waitForFunction(() => modal && modal.kind === 'keys'); const c = await page.evaluate(() => document.getElementById('modal').className); await page.evaluate(() => finishKeys(false)); return c; };
    assert.doesNotMatch(await kbClass(), /osk-wide/);
    await page.evaluate(() => padSet('oskSize', 'wide'));
    assert.match(await kbClass(), /osk-wide/);
    page.evaluate(() => { ask('PIN', '', { digits: true }); });
    await page.waitForFunction(() => modal && modal.kind === 'keys');
    assert.doesNotMatch(await page.evaluate(() => document.getElementById('modal').className), /osk-wide/, 'the PIN pad keeps its own size');
    await page.evaluate(() => finishKeys(false));
    assert.equal((await page.evaluate(() => api.settings('padSet', { key: 'oskSize', value: 'huge' }))).ok, false);
    await page.evaluate(() => padSet('oskSize', 'dock'));
    checks.push('On-screen keyboard: docked or wide (saved, validated; the PIN pad keeps its size)');

    // Bumping past the browser tab doesn't open it; pausing on it does; presses while it closes are kept.
    await page.evaluate(() => { page = 'home'; hoverId = 'home'; focus = 'tabs'; render(); window.__qaOpens = 0; const real = api.browser; api.browser = (op, ...r) => { if (op === 'open') window.__qaOpens++; return real(op, ...r); }; });
    const order = await page.evaluate(() => tabList());
    const hops = order.indexOf('home') - order.indexOf('browser'); // LB presses from Home to Browser
    for (let i = 0; i < hops + 1; i++) await page.evaluate(() => press('lb')); // past it, quickly
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__qaOpens), 0, 'passing over Browser leaves it shut');
    await page.evaluate(() => press('rb')); // back onto Browser, and stay
    await page.waitForFunction(() => browserOpen, null, { timeout: 5000 });
    await page.waitForFunction(() => !browserMoving);
    const t0 = Date.now();
    await page.evaluate(() => { press('rb'); press('rb'); press('lb'); }); // out, then on, then back while it closes
    await page.waitForFunction(() => !browserOpen && !browserMoving && !queuedTabs.length, null, { timeout: 5000 });
    const where = await page.evaluate(() => hoverId);
    assert.equal(where, order[(order.indexOf('browser') + 1) % order.length], 'every press counted: out, +1, -1');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => browserOpen), false);
    checks.push(`Bumpers: passing Browser doesn't open it, staying does, and presses during its exit are kept (settled in ${Date.now() - t0} ms)`);
  } finally { await app.close(); }
  assert.deepEqual(errors, [], 'no page errors');
  for (const c of checks) console.log('ok -', c);
  console.log(`input: ${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
