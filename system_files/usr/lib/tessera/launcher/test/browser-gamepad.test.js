// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJsEvents, createMapper } = require('../browser-gamepad');

function event(type, number, value, init = false) {
  const b = Buffer.alloc(8);
  b.writeInt16LE(value, 4);
  b[6] = type | (init ? 0x80 : 0);
  b[7] = number;
  return b;
}

test('decodes joydev button and axis events and skips initial state', () => {
  const got = [];
  parseJsEvents(Buffer.concat([event(1, 0, 1), event(2, 0, -32767), event(1, 1, 1, true)]), e => got.push(e));
  assert.deepEqual(got, [
    { type: 1, value: 1, number: 0 },
    { type: 2, value: -32767, number: 0 },
  ]);
});

test('maps standard confirm/back buttons, D-pad and shoulder close actions', () => {
  const keys = [], shoulders = [];
  const mapper = createMapper({ onAction: k => keys.push(k), onShoulder: d => shoulders.push(d) });
  [event(1, 0, 1), event(1, 1, 1), event(1, 12, 1), event(1, 4, 1), event(1, 5, 1)].forEach(b => parseJsEvents(b, mapper.handleEvent));
  assert.deepEqual(keys, ['ENTER', 'ESC', 'UP']);
  assert.deepEqual(shoulders, [-1, 1]);
});

test('maps analog sticks only on direction changes and recenters cleanly', () => {
  const keys = [];
  const mapper = createMapper({ onAction: k => keys.push(k) });
  for (const b of [event(2, 0, -30000), event(2, 0, -31000), event(2, 0, 0), event(2, 1, 30000), event(2, 1, 0), event(2, 3, -30000)]) parseJsEvents(b, mapper.handleEvent);
  assert.deepEqual(keys, ['LEFT', 'DOWN', 'PAGEUP']);
});

test('ignores repeated button presses and incomplete trailing bytes', () => {
  const keys = [];
  const mapper = createMapper({ onAction: k => keys.push(k) });
  const b = Buffer.concat([event(1, 0, 1), event(1, 0, 1), event(1, 0, 0)]);
  parseJsEvents(b.subarray(0, 23), mapper.handleEvent);
  assert.deepEqual(keys, ['ENTER']);
});

test('allows browser-view mapping when no shoulder-close callback is installed', () => {
  const keys = [];
  const mapper = createMapper({ onAction: key => keys.push(key) });
  assert.doesNotThrow(() => parseJsEvents(event(1, 4, 1), mapper.handleEvent));
  assert.deepEqual(keys, []);
});
