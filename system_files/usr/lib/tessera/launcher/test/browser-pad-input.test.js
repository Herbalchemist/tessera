// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { actionsForFrame } = require('../browser-pad-input');

test('maps newly pressed D-pad and face buttons without repeating held buttons', () => {
  assert.deepEqual(actionsForFrame({ b: (1 << 12) | (1 << 1), a: [] }).keys, ['UP', 'ENTER']);
  assert.deepEqual(actionsForFrame({ b: (1 << 12) | (1 << 1), a: [] }, (1 << 12) | (1 << 1)).keys, []);
});

test('maps left stick directions only on threshold crossing or direction change', () => {
  assert.deepEqual(actionsForFrame({ b: 0, a: [-0.9, 0, 0, 0] }).keys, ['LEFT']);
  assert.deepEqual(actionsForFrame({ b: 0, a: [-0.9, 0, 0, 0] }, 0, 'LEFT').keys, []);
  assert.deepEqual(actionsForFrame({ b: 0, a: [0.9, 0, 0, 0] }, 0, 'LEFT').keys, ['RIGHT']);
  assert.deepEqual(actionsForFrame({ b: 0, a: [0.2, 0, 0, 0] }, 0, 'LEFT').keys, []);
});

test('maps B to Escape and right-stick vertical movement to page scrolling', () => {
  assert.deepEqual(actionsForFrame({ b: 1, a: [0, 0, 0, -0.9] }).keys, ['ESC', 'PAGEUP']);
  assert.deepEqual(actionsForFrame({ b: 0, a: [0, 0, 0, 0.9] }, 0, '', 'DOWN').keys, []);
});

test('does not emit keys for missing or malformed axes', () => {
  assert.deepEqual(actionsForFrame({ b: 0, a: null }).keys, []);
  assert.deepEqual(actionsForFrame(null).keys, []);
});
