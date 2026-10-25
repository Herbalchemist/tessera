// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, normalize, describe } = require('../shell-layout');

test('only the four structural shell preset ids are accepted', () => {
  assert.deepEqual(Object.keys(PRESETS), ['classic', 'dock', 'crossbar', 'dashboard']);
  for (const id of Object.keys(PRESETS)) assert.equal(normalize(id), id);
  for (const invalid of [undefined, null, '', 'freeform', 'DOCK', {}, 3]) {
    assert.equal(normalize(invalid), 'classic');
  }
});

test('shell presets retain logical controller handoffs between navigation and content', () => {
  assert.deepEqual(describe('classic'), { id: 'classic', navigation: 'horizontal', contentEntry: 'down', contentExit: 'up' });
  assert.deepEqual(describe('dock'), { id: 'dock', navigation: 'horizontal', contentEntry: 'up', contentExit: 'down' });
  assert.deepEqual(describe('crossbar'), { id: 'crossbar', navigation: 'horizontal', contentEntry: 'down', contentExit: 'up' });
  assert.deepEqual(describe('dashboard'), { id: 'dashboard', navigation: 'vertical', contentEntry: 'right', contentExit: 'left' });
});
