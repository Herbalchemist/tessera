// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: Settings > Screens. The screens come from a stand-in for display-info (a real
// ultrawide and a laptop panel's modes); the real display-info turns the choice into gamescope
// options (its own tests: system_files/usr/lib/tessera/launcher/test/display-info.test.js).
// Checks: only reported modes are offered; Apply saves the choice as a trial and restarts Ludus
// (through the session's restart file); after the restart "Keep these settings?" counts down and
// goes back by itself; a screen plugged in is offered.
//   xvfb-run -a -s "-screen 0 1280x720x24" node qa/screens.cjs
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

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-screens-'));
const data = path.join(temp, 'data');
fs.mkdirSync(data, { recursive: true });
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ firstRunDone: true }));
const mode = (width, height, refresh, preferred = false) => ({ width, height, refresh, hz: refresh, preferred, interlaced: false });
fs.writeFileSync(path.join(temp, 'screens.json'), JSON.stringify([
  { name: 'DP-1', label: 'AW3423DW', internal: false, current: mode(3440, 1440, 175), modes: [mode(3440, 1440, 175, true), mode(3440, 1440, 144), mode(3440, 1440, 60), mode(2560, 1080, 60), mode(1920, 1080, 60)] },
  { name: 'HDMI-A-1', label: 'LG TV', internal: false, current: null, modes: [mode(3840, 2160, 60, true), mode(1920, 1080, 120)] },
]));
// the real display-info, reading the stand-in screens
const realHelper = path.resolve(launcher, '../../../libexec/tessera/display-info');
const sys = path.join(temp, 'sys');
const plug = (name, on) => { fs.mkdirSync(path.join(sys, `card1-${name}`), { recursive: true }); fs.writeFileSync(path.join(sys, `card1-${name}`, 'status'), on ? 'connected\n' : 'disconnected\n'); };
plug('DP-1', true); plug('HDMI-A-1', true); plug('DP-2', false);
const restartFile = path.join(temp, 'restart-requested');
const displayFile = path.join(data, 'display.json');

function launch() {
  return electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: temp, TESSERA_DATA_DIR: data, TESSERA_DEV: '1', TESSERA_DISPLAY_INFO: realHelper, TESSERA_DRM_FIXTURE: path.join(temp, 'screens.json'),
      TESSERA_DRM_SYS: sys, TESSERA_RESTART_FILE: restartFile, XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
}
const ready = (page) => page.waitForFunction(() => typeof flowScreens === 'function' && document.querySelectorAll('.tab').length >= 4, null, { timeout: 20000 });

(async () => {
  const errors = [];
  let app = await launch();
  try {
    let page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await ready(page);
    await page.waitForTimeout(1600);
    await page.evaluate(() => { if (modal) closeModal(); runAction('_screens'); });
    await page.waitForFunction(() => modal && modal.title === 'Screens', null, { timeout: 10000 });
    const top = await page.evaluate(() => ({ items: modal.items.map((x) => [x.label, x.sub]), body: modal.body }));
    assert.deepEqual(top.items.slice(0, 3), [['Screen', 'AW3423DW (DP-1)'], ['Resolution', "3440 × 1440 (the screen's own)"], ['Refresh rate', 'the highest it offers']]);
    assert.ok(!top.items.some((x) => x[0] === 'Orientation'), 'no orientation for an external screen');
    assert.match(top.body, /one screen at a time; the other stays dark/);
    // Resolution: exactly the sizes the screen reports
    await page.evaluate(() => { modal.index = 1; modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Resolution');
    assert.deepEqual(await page.evaluate(() => modal.items.map((x) => x.label)), ["The screen's own (3440 × 1440)", '3440 × 1440', '2560 × 1080', '1920 × 1080']);
    await page.evaluate(() => { modal.index = 1; modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Screens');
    // Refresh rate: the rates at that size
    await page.evaluate(() => { modal.index = 2; modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Refresh rate');
    assert.deepEqual(await page.evaluate(() => modal.items.map((x) => x.label)), ['The highest it offers', '175 Hz', '144 Hz', '60 Hz']);
    await page.screenshot({ path: path.join(output, 'screens-refresh.png') });
    await page.evaluate(() => { modal.index = 2; modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Screens');
    checks.push('Screens lists only what the screen reports: its sizes, and the refresh rates at the chosen size');

    // Apply: saved as a trial, and Ludus is restarted through the session
    const closed = new Promise((resolve) => app.process().once('exit', resolve));
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.op === 'apply'); modalPress('a'); });
    await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('Ludus did not restart')), 10000))]);
    assert.ok(fs.existsSync(restartFile), 'the session is asked to start Ludus again');
    assert.deepEqual(JSON.parse(fs.readFileSync(displayFile, 'utf8')), { trying: { output: 'DP-1', width: 3440, height: 1440, refresh: 144 }, tried: false });
    checks.push('Apply saves the choice as a trial and asks the session to start Ludus again');

    // The session's next start: display-info args uses the trial once (tried), then Ludus asks
    const { spawnSync } = require('node:child_process');
    const a = spawnSync('python3', [realHelper, 'args'], { env: { ...process.env, TESSERA_DRM_FIXTURE: path.join(temp, 'screens.json'), TESSERA_DISPLAY_FILE: displayFile }, encoding: 'utf8' }).stdout.trim().split('\n');
    assert.deepEqual(a, ['--prefer-output', 'DP-1', '-W', '3440', '-H', '1440', '-r', '144']);
    fs.unlinkSync(restartFile);
    app = await launch();
    page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await ready(page);
    await page.waitForFunction(() => modal && modal.title === 'Keep these screen settings?', null, { timeout: 10000 });
    assert.match(await page.evaluate(() => modal.body), /in 1[45] seconds/);
    await page.screenshot({ path: path.join(output, 'screens-keep.png') });
    await page.evaluate(() => { modal.index = 0; modalPress('a'); });
    await page.waitForFunction(() => !modal || modal.title !== 'Keep these screen settings?');
    await page.waitForTimeout(500);
    assert.deepEqual(JSON.parse(fs.readFileSync(displayFile, 'utf8')), { output: 'DP-1', width: 3440, height: 1440, refresh: 144 });
    checks.push('After the restart, "Keep these screen settings?" counts down; Keep makes them the settings');

    // A screen plugged in is offered
    plug('DP-2', true);
    fs.writeFileSync(path.join(temp, 'screens.json'), JSON.stringify([...JSON.parse(fs.readFileSync(path.join(temp, 'screens.json'), 'utf8')), { name: 'DP-2', label: 'Dell U2723QE', internal: false, current: null, modes: [mode(3840, 2160, 60, true)] }]));
    await page.waitForFunction(() => modal && modal.title === 'New screen', null, { timeout: 10000 });
    assert.match(await page.evaluate(() => modal.body), /Dell U2723QE \(DP-2\) was connected/);
    await page.evaluate(() => { modal.index = 2; modalPress('a'); });
    await page.waitForTimeout(500);
    assert.deepEqual(JSON.parse(fs.readFileSync(displayFile, 'utf8')).ignore, ['DP-2']);
    checks.push("A screen plugged in is offered; \"Don't ask for this screen\" is remembered");

    // A trial that isn't kept goes back by itself
    fs.writeFileSync(displayFile, JSON.stringify({ output: 'DP-1', trying: { output: 'HDMI-A-1' }, tried: true }));
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    const closed2 = new Promise((resolve) => app.process().once('exit', resolve));
    await ready(page);
    await page.waitForFunction(() => modal && modal.title === 'Keep these screen settings?', null, { timeout: 10000 });
    await Promise.race([closed2, new Promise((_, rej) => setTimeout(() => rej(new Error('no going back after 15 s')), 22000))]);
    assert.deepEqual(JSON.parse(fs.readFileSync(displayFile, 'utf8')), { output: 'DP-1' });
    assert.ok(fs.existsSync(restartFile), 'and Ludus starts again on the settings before');
    checks.push('Without an answer the trial goes back by itself after 15 seconds, and Ludus starts again');

    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    try { await app.close(); } catch { /* already gone */ }
    fs.rmSync(temp, { recursive: true, force: true });
  }
  for (const c of checks) console.log('PASS', c);
  console.log(`${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
