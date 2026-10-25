// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { capabilityBits, capabilityHas, axisCodesFromSysfs } = require('../browser-gamepad');
const { keyEvents } = require('../browser-navigation');

test('64-bit Linux sysfs bitmap words preserve South/East gamepad capability positions', () => {
  const mask = ((1n << 48n) | (1n << 49n)).toString(16) + ' 0 0 0 0';
  assert.equal(capabilityHas(mask, 0x130, 64), true);
  assert.equal(capabilityHas(mask, 0x131, 64), true);
  assert.equal(capabilityHas(mask, 0x132, 64), false);
  assert.equal(capabilityBits('1 0', 64), 1n << 64n);
});

test('32-bit bitmap words and invalid capabilities are handled without misidentifying devices', () => {
  assert.equal(capabilityBits('1 0', 32), 1n << 32n);
  for (const value of ['', 'garbage', '0x3', '1,,0', null]) assert.equal(capabilityBits(value), 0n);
  assert.equal(capabilityHas('3', -1), false);
  assert.equal(capabilityHas('3', 1.2), false);
  assert.deepEqual(axisCodesFromSysfs('30003'), [0, 1, 16, 17]);
});

test('browser confirm includes the character event needed for native button activation', () => {
  assert.deepEqual(keyEvents('ENTER'), [
    { type: 'keyDown', keyCode: 'ENTER' },
    { type: 'char', keyCode: 'ENTER' },
    { type: 'keyUp', keyCode: 'ENTER' },
  ]);
  assert.deepEqual(keyEvents('TAB'), [{ type: 'keyDown', keyCode: 'TAB' }, { type: 'keyUp', keyCode: 'TAB' }]);
  assert.deepEqual(keyEvents('arbitrary'), []);
});
