'use strict';
// Settings > Screens, on the real main process and the real display-info helper, with stand-in screens:
// only what the screen reports is offered, Apply saves a trial and asks the session to start Ludus again,
// the session's next start uses the trial once, Keep makes it the setting, Revert goes back, and a plugged-in
// screen can be told not to ask again.
const test = require('node:test');
test.after(() => { setImmediate(() => process.exit()); });
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./xbox-harness');

const LAUNCHER = path.join(__dirname, '..');
const HELPER = path.resolve(LAUNCHER, '../../../libexec/tessera/display-info');
const mode = (width, height, refresh, preferred = false) => ({ width, height, refresh, hz: refresh, preferred, interlaced: false });

test('screens: what is offered, the trial, Keep, Revert, and a screen not to ask about', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-'));
  const data = path.join(tmp, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ firstRunDone: true }));
  const screens = path.join(tmp, 'screens.json');
  fs.writeFileSync(screens, JSON.stringify([
    { name: 'DP-1', label: 'AW3423DW', internal: false, current: mode(3440, 1440, 175), modes: [mode(3440, 1440, 175, true), mode(3440, 1440, 144), mode(3440, 1440, 60), mode(2560, 1080, 60), mode(1920, 1080, 60)] },
    { name: 'HDMI-A-1', label: 'LG TV', internal: false, current: null, modes: [mode(3840, 2160, 60, true), mode(1920, 1080, 120)] },
  ]));
  const sys = path.join(tmp, 'sys');
  for (const [n, on] of [['DP-1', 1], ['HDMI-A-1', 1], ['DP-2', 0]]) { fs.mkdirSync(path.join(sys, `card1-${n}`), { recursive: true }); fs.writeFileSync(path.join(sys, `card1-${n}`, 'status'), on ? 'connected\n' : 'disconnected\n'); }
  const restartFile = path.join(tmp, 'restart-requested');
  const displayFile = path.join(data, 'display.json');
  Object.assign(process.env, { TESSERA_DISPLAY_INFO: HELPER, TESSERA_DRM_FIXTURE: screens, TESSERA_DRM_SYS: sys, TESSERA_RESTART_FILE: restartFile, TESSERA_DISPLAY_FILE: displayFile });
  for (const k of Object.keys(require.cache)) if (k.startsWith(LAUNCHER + path.sep) && !k.includes(path.sep + 'test' + path.sep)) delete require.cache[k];
  const h = await H.load({ launcher: LAUNCHER, tmp });
  const D = (op, x) => h.call('display', op, x || {});
  const read = () => JSON.parse(fs.readFileSync(displayFile, 'utf8'));

  // it lists only what the screens report
  const list = await D('list');
  assert.ok(list.ok, JSON.stringify(list));
  assert.deepStrictEqual(list.screens.map((s) => s.name), ['DP-1', 'HDMI-A-1']);
  assert.deepStrictEqual(list.screens[0].modes.filter((m) => m.width === 3440).map((m) => m.refresh).sort((a, b) => b - a), [175, 144, 60]);
  // nothing the screen doesn't offer is accepted
  assert.strictEqual((await D('try', { output: 'DP-1', width: 1234, height: 567 })).ok, false);
  assert.strictEqual((await D('try', { output: 'DP-9', width: 1920, height: 1080 })).ok, false);
  // Apply: saved as a trial, and the session is asked to start Ludus again
  const t = await D('try', { output: 'DP-1', width: 3440, height: 1440, refresh: 144 });
  assert.ok(t.ok && t.restarted, JSON.stringify(t));
  assert.ok(fs.existsSync(restartFile), 'the session is asked to start Ludus again');
  assert.deepStrictEqual(read(), { trying: { output: 'DP-1', width: 3440, height: 1440, refresh: 144 }, tried: false });
  // the session's next start: display-info args uses the trial once
  const args = spawnSync('python3', [HELPER, 'args'], { env: { ...process.env }, encoding: 'utf8' }).stdout.trim().split('\n');
  assert.deepStrictEqual(args, ['--prefer-output', 'DP-1', '-W', '3440', '-H', '1440', '-r', '144']);
  // Keep makes the trial the setting
  assert.ok((await D('confirm')).ok);
  assert.deepStrictEqual(read(), { output: 'DP-1', width: 3440, height: 1440, refresh: 144 });
  // a screen plugged in is offered; "don't ask for this screen" is remembered
  assert.ok((await D('ignore', { output: 'DP-2' })).ok);
  assert.deepStrictEqual(read().ignore, ['DP-2']);
  assert.strictEqual((await D('ignore', { output: '../x' })).ok, false);
  // a trial that isn't kept goes back
  fs.writeFileSync(displayFile, JSON.stringify({ output: 'DP-1', trying: { output: 'HDMI-A-1' }, tried: true }));
  fs.rmSync(restartFile, { force: true });
  assert.ok((await D('revert', { restart: true })).ok);
  assert.deepStrictEqual(read(), { output: 'DP-1' });
  assert.ok(fs.existsSync(restartFile), 'and Ludus starts again on the settings before');
  // with a PIN set and locked, applying asks for it
  await h.call('settings', 'pinSet', { pin: '2468' });
  await h.call('settings', 'pinLock');
  assert.strictEqual((await D('try', { output: 'DP-1', width: 1920, height: 1080, refresh: 60 })).needPin, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});
