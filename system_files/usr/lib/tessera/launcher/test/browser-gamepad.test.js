// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseJsEvents, parseInputEvents, axisCodesFromSysfs,
  isJoystickNodeName, isEventNodeName, createMapper,
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
  assert.deepEqual(axisCodesFromSysfs('3003f'), [0, 1, 2, 3, 4, 5, 16, 17]);
  assert.deepEqual(axisCodesFromSysfs('not-hex'), []);
});

test('recognizes actual Linux joystick and event node names', () => {
  assert.equal(isJoystickNodeName('js0'), true);
  assert.equal(isJoystickNodeName('js12'), true);
  assert.equal(isJoystickNodeName('js\\d'), false);
  assert.equal(isJoystickNodeName('event0'), false);
  assert.equal(isEventNodeName('event0'), true);
  assert.equal(isEventNodeName('event12'), true);
  assert.equal(isEventNodeName('event\\d'), false);
  assert.equal(isEventNodeName('mouse0'), false);
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
  mapper.dispose();
});

test('sends embedded-browser B, Y, and shoulders as launcher actions', () => {
  const keys = [], actions = [];
  const mapper = createMapper({
    onAction: key => keys.push(key),
    onBrowserAction: action => actions.push(action),
  });
  for (const [code, value] of [
    [0x130, 1], // BTN_SOUTH: page activate
    [0x131, 1], // BTN_EAST: B / leave browser
    [0x133, 1], // BTN_NORTH: standard gamepad Y / address prompt
    [0x136, 1], // BTN_TL: previous tab
    [0x137, 1], // BTN_TR: next tab
  ]) mapper.handleButton(code, value);
  assert.deepEqual(keys, ['ENTER']);
  assert.deepEqual(actions, ['b', 'y', 'lb', 'rb']);
  mapper.dispose();
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
  mapper.dispose();
});

test('repeats a held D-pad direction and cancels the repeat on release', () => {
  const keys = [];
  const pending = new Map();
  let nextTimer = 0;
  const mapper = createMapper({
    onAction: key => keys.push(key),
    initialDelay: 300,
    repeatInterval: 80,
    setTimeoutFn(fn, delay) {
      const id = ++nextTimer;
      pending.set(id, { fn, delay });
      return id;
    },
    clearTimeoutFn(id) { pending.delete(id); },
  });
  mapper.handleButton(0x223, 1); // BTN_DPAD_RIGHT
  assert.deepEqual(keys, ['RIGHT']);
  const first = pending.entries().next().value;
  assert.equal(first[1].delay, 300);
  pending.delete(first[0]);
  first[1].fn();
  assert.deepEqual(keys, ['RIGHT', 'RIGHT']);
  const second = pending.entries().next().value;
  assert.equal(second[1].delay, 80);
  mapper.handleButton(0x223, 2); // EV_KEY repeat must not cancel the held direction.
  pending.delete(second[0]);
  second[1].fn();
  assert.deepEqual(keys, ['RIGHT', 'RIGHT', 'RIGHT']);
  const stale = pending.entries().next().value[1].fn;
  mapper.handleButton(0x223, 0);
  stale();
  assert.deepEqual(keys, ['RIGHT', 'RIGHT', 'RIGHT']);
  mapper.dispose();
});

test('ignores initial axis state and incomplete trailing events', () => {
  const keys = [];
  const mapper = createMapper({ onAction: k => keys.push(k) });
  parseJsEvents(Buffer.concat([jsAxis(0, -32767, true), jsAxis(0, -32767)]), e => mapper.handleAxis(0, e.value));
  assert.deepEqual(keys, ['LEFT']);
  mapper.dispose();
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
  mapper.dispose();
});
