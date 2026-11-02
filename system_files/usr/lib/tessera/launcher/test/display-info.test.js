// SPDX-License-Identifier: GPL-3.0-or-later
// /usr/libexec/tessera/display-info: Settings > Screens turned into gamescope options. Only modes
// the screen reports are passed on, a setting being tried is used for one start only, and a
// built-in screen is the only one that can be turned.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER = path.resolve(__dirname, '../../../../libexec/tessera/display-info');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-display-'));
const FIX = path.join(dir, 'screens.json');
const FILE = path.join(dir, 'display.json');
const mode = (width, height, refresh, preferred = false) => ({ width, height, refresh, hz: refresh, preferred, interlaced: false });
fs.writeFileSync(FIX, JSON.stringify([
  { name: 'DP-1', label: 'AW3423DW', internal: false, modes: [mode(3440, 1440, 175, true), mode(3440, 1440, 144), mode(2560, 1080, 60), mode(1920, 1080, 60)] },
  { name: 'eDP-1', label: '', internal: true, modes: [mode(1280, 800, 60, true)] },
]));
const run = (...args) => spawnSync('python3', [HELPER, ...args], { env: { ...process.env, TESSERA_DRM_FIXTURE: FIX, TESSERA_DISPLAY_FILE: FILE }, encoding: 'utf8' });
const args = () => run('args').stdout.trim().split('\n').filter(Boolean);
const set = (d) => fs.writeFileSync(FILE, JSON.stringify(d));
const saved = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));

test('nothing chosen: gamescope picks', () => {
  try { fs.unlinkSync(FILE); } catch { /* none yet */ }
  assert.deepEqual(args(), []);
});

test('a chosen screen, resolution and refresh rate the screen reports', () => {
  set({ output: 'DP-1', width: 3440, height: 1440, refresh: 144 });
  assert.deepEqual(args(), ['--prefer-output', 'DP-1', '-W', '3440', '-H', '1440', '-r', '144']);
});

test('a mode the screen does not report is left out (the screen picks)', () => {
  set({ output: 'DP-1', width: 5120, height: 2160, refresh: 240 });
  assert.deepEqual(args(), ['--prefer-output', 'DP-1']);
  set({ output: 'DP-1', width: 3440, height: 1440, refresh: 240 });
  assert.deepEqual(args(), ['--prefer-output', 'DP-1', '-W', '3440', '-H', '1440']);
});

test('a screen that is not connected: only the preference, no mode', () => {
  set({ output: 'HDMI-A-2', width: 1920, height: 1080, refresh: 60 });
  assert.deepEqual(args(), ['--prefer-output', 'HDMI-A-2']);
});

test('only a built-in screen is turned', () => {
  set({ output: 'DP-1', orientation: 'left' });
  assert.deepEqual(args(), ['--prefer-output', 'DP-1']);
  set({ output: 'eDP-1', orientation: 'left' });
  assert.deepEqual(args(), ['--prefer-output', 'eDP-1', '--force-orientation', 'left']);
});

test('bad values never reach gamescope', () => {
  set({ output: 'DP-1;rm -rf /', width: '3440', height: 1440, refresh: true, orientation: 'sideways' });
  assert.deepEqual(args(), []);
});

test('a setting being tried is used once; without a yes the next start goes back', () => {
  set({ output: 'DP-1', width: 1920, height: 1080, trying: { output: 'DP-1', width: 3440, height: 1440, refresh: 175 }, tried: false });
  assert.deepEqual(args(), ['--prefer-output', 'DP-1', '-W', '3440', '-H', '1440', '-r', '175']);
  assert.equal(saved().tried, true);
  assert.deepEqual(args(), ['--prefer-output', 'DP-1', '-W', '1920', '-H', '1080']);
  assert.equal(saved().trying, undefined);
});

test('confirm keeps what was tried, revert drops it', () => {
  set({ output: 'DP-1', width: 1920, height: 1080, ignore: ['HDMI-A-1'], trying: { output: 'DP-1', width: 3440, height: 1440, refresh: 175 }, tried: true });
  run('confirm');
  assert.deepEqual(saved(), { ignore: ['HDMI-A-1'], output: 'DP-1', width: 3440, height: 1440, refresh: 175 });
  set({ output: 'DP-1', trying: { output: 'eDP-1' }, tried: true });
  run('revert');
  assert.deepEqual(saved(), { output: 'DP-1' });
});

test('list reports the screens and the settings', () => {
  set({ output: 'DP-1', width: 3440, height: 1440 });
  const l = JSON.parse(run('list').stdout);
  assert.equal(l.ok, true);
  assert.deepEqual(l.screens.map((s) => s.name), ['DP-1', 'eDP-1']);
  assert.deepEqual(l.settings, { output: 'DP-1', width: 3440, height: 1440 });
});
