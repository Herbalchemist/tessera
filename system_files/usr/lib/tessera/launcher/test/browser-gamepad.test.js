// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseJsEvents, parseInputEvents, axisCodesFromSysfs, createMapper,
} = require('../browser-gamepad');

function jsAxis(number, value, init = false) {
  const b = Buffer.alloc(8);
  b.writeInt16LE(value, 4);
  b[6] = 0x02 | (init ? 0x80 : 0);
  b[7] = number;
  return b;
}
function inputEvent(type, code, value) {
  const b = Buffer.alloc(24);
  b.writeUInt16LE(type, 16);
  b.writeUInt16LE(code, 18);
  b.writeInt32LE(value, 20);
  return b;
}

test('maps joydev axis indices to Linux ABS codes in kernel order', () => {
  assert.deepEqual(axisCodesFromSysfs('3f003'), [0, 1, 2, 3, 4, 5, 16, 17]);
  assert.deepEqual(axisCodesFromSysfs('not-hex'), []);
});

test('decodes evdev button codes independent of joydev button index order', () => {
  const keys = [], shoulders = [];
  const mapper = createMapper({ onAction: k => keys.push(k), onShoulder: d => shoulders.push(d) });
  const events = [
    inputEvent(1, 0x130, 1), // BTN_SOUTH: confirm
    inputEvent(1, 0x131, 1), // BTN_EAST: back
    inputEvent(1, 0x220, 1), // BTN_DPAD_UP
    inputEvent(1, 0x136, 1), // BTN_TL
    inputEvent(1, 0x137, 1), // BTN_TR
    inputEvent(1, 0x130, 0),
    inputEvent(1, 0x130, 1), // next press is valid after release
  ];
  parseInputEvents(Buffer.concat(events), e => mapper.handleButton(e.code, e.value));
  assert.deepEqual(keys, ['ENTER', 'ESC', 'UP', 'ENTER']);
  assert.deepEqual(shoulders, [-1, 1]);
});

test('maps analog sticks and hat axes with normalized joydev values', () => {
  const keys = [];
  const mapper = createMapper({ onAction: k => keys.push(k) });
  const absCodes = [0, 1, 2, 3, 4, 5, 16, 17];
  const events = [
    jsAxis(0, -30000), jsAxis(0, -31000), jsAxis(0, 0),
    jsAxis(1, 30000), jsAxis(1, 0),
    jsAxis(7, -32767), // ABS_HAT0Y is axis 7 when ABS_X..ABS_RZ are present
    jsAxis(7, 0),
    jsAxis(4, -30000), // ABS_RY after the standard six stick/trigger axes
  ];
  parseJsEvents(Buffer.concat(events), e => {
    const code = absCodes[e.number];
    if (code !== undefined) mapper.handleAxis(code, e.value);
  });
  assert.deepEqual(keys, ['LEFT', 'DOWN', 'UP', 'PAGEUP']);
});

test('ignores initial axis state and incomplete trailing events', () => {
  const keys = [];
  const mapper = createMapper({ onAction: k => keys.push(k) });
  parseJsEvents(Buffer.concat([jsAxis(0, -32767, true), jsAxis(0, -32767)]), e => mapper.handleAxis(0, e.value));
  assert.deepEqual(keys, ['LEFT']);
  const events = Buffer.concat([inputEvent(1, 0x130, 1), inputEvent(1, 0x131, 1)]);
  const got = [];
  parseInputEvents(events.subarray(0, 25), e => got.push(e));
  assert.deepEqual(got, [{ type: 'button', code: 0x130, value: 1 }]);
});

test('allows browser-view mapping when no shoulder-close callback is installed', () => {
  const keys = [];
  const mapper = createMapper({ onAction: key => keys.push(key) });
  assert.doesNotThrow(() => mapper.handleButton(0x136, 1));
  assert.deepEqual(keys, []);
});
