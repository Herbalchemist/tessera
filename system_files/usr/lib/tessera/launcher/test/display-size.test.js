// SPDX-License-Identifier: GPL-3.0-or-later
// /usr/libexec/tessera/display-size: the main screen's size for Ludus on top of Opus (nested
// gamescope stretches 1280x720 without it, so an ultrawide lost its shape).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER = path.resolve(__dirname, '../../../../libexec/tessera/display-size');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-size-'));
function size(kscreen, xrandr = '') {
  const k = path.join(dir, 'k.json'); const x = path.join(dir, 'x.txt');
  fs.writeFileSync(k, typeof kscreen === 'string' ? kscreen : JSON.stringify(kscreen));
  fs.writeFileSync(x, xrandr);
  const r = spawnSync('python3', [HELPER], { env: { ...process.env, TESSERA_KSCREEN_JSON: k, TESSERA_XRANDR: x }, encoding: 'utf8' });
  return r.stdout.trim();
}
const out = (o) => ({ enabled: true, connected: true, rotation: 1, ...o });

test('the main screen of several, at its current mode: an ultrawide stays ultrawide', () => {
  assert.equal(size({ outputs: [
    out({ priority: 2, currentModeId: '1', modes: [{ id: '1', size: { width: 1920, height: 1080 } }] }),
    out({ priority: 1, currentModeId: '7', modes: [{ id: '3', size: { width: 2560, height: 1080 } }, { id: '7', size: { width: 3440, height: 1440 } }] }),
    out({ enabled: false, priority: 0, currentModeId: '1', modes: [{ id: '1', size: { width: 800, height: 600 } }] }),
  ] }), '3440 1440');
});

test('a screen turned on its side', () => {
  assert.equal(size({ outputs: [out({ priority: 1, currentModeId: 'a', rotation: 8, modes: [{ id: 'a', size: { width: 2560, height: 1440 } }] })] }), '1440 2560');
});

test('without KDE: xrandr, the primary output first', () => {
  const xr = 'Screen 0: current 5360 x 1440\nHDMI-1 connected 1920x1080+3440+0 (normal)\n   1920x1080     60.00*+\nDP-1 connected primary 3440x1440+0+0 (normal)\n   3440x1440    144.00*+\n';
  assert.equal(size('not json', xr), '3440 1440');
  assert.equal(size('', 'DP-1 connected 2560x1080+0+0\n   2560x1080 75.00*\n'), '2560 1080');
});

test('nothing known, nothing printed (gamescope keeps its own default)', () => {
  assert.equal(size('', ''), '');
  assert.equal(size({ outputs: [out({ priority: 1, currentModeId: 'x', modes: [] })] }, ''), '');
});
