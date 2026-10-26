// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMapper, standardButtonActions } = require('../browser-gamepad');

test('raw evdev and virtual standard frames use the same confirm, cancel, focus, address and bumper roles', () => {
  const codes = [0x130, 0x131, 0x134, 0x133, 0x136, 0x137];
  codes.forEach((code, bit) => {
    const keys = [], browserActions = [];
    const mapper = createMapper({ onAction: key => keys.push(key), onBrowserAction: action => browserActions.push(action) });
    mapper.handleButton(code, 1);
    assert.deepEqual({ keys, browserActions }, standardButtonActions(1 << bit));
    mapper.handleButton(code, 0);
    mapper.dispose();
  });
});

test('virtual standard frames do not emit actions for releases or unrelated buttons', () => {
  assert.deepEqual(standardButtonActions(0), { keys: [], browserActions: [] });
  assert.deepEqual(standardButtonActions(1 << 16), { keys: [], browserActions: [] });
  assert.deepEqual(standardButtonActions(3), { keys: ['ENTER'], browserActions: ['b'] });
});
