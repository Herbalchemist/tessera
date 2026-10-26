// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, normalize, describe } = require('../shell-layout');

test('only the named structural shell preset ids are accepted', () => {
  assert.deepEqual(Object.keys(PRESETS), ['classic', 'dock', 'crossbar', 'dashboard', 'switch', 'hero', 'pivot', 'cube', 'channel']);
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
  // Navigation below the content enters with Up; a left sidebar enters with Right.
  for (const id of ['switch', 'channel']) assert.deepEqual(describe(id), { id, navigation: 'horizontal', contentEntry: 'up', contentExit: 'down' });
  for (const id of ['hero', 'pivot']) assert.deepEqual(describe(id), { id, navigation: 'horizontal', contentEntry: 'down', contentExit: 'up' });
  assert.deepEqual(describe('cube'), { id: 'cube', navigation: 'vertical', contentEntry: 'right', contentExit: 'left' });
});

const { PARTS, PART_IDS, PRESET_PARTS, resolveParts, handoffs } = require('../shell-layout');

test('every arrangement is a preset of valid parts, and its menu position gives its handoffs', () => {
  assert.deepEqual(Object.keys(PRESET_PARTS), Object.keys(PRESETS));
  for (const [id, parts] of Object.entries(PRESET_PARTS)) {
    assert.deepEqual(Object.keys(parts), PART_IDS, id);
    for (const p of PART_IDS) assert.ok(PARTS[p].includes(parts[p]), `${id}.${p}=${parts[p]}`);
    const { navigation, contentEntry, contentExit } = describe(id);
    assert.deepEqual(handoffs(parts.nav), { navigation, contentEntry, contentExit }, id);
  }
});

test('parts picked on their own override the arrangement; auto and junk fall back', () => {
  const mixed = resolveParts('channel', { spot: 'on', tabs: 'round', clock: 'auto', frame: 'lasers', nav: { evil: 1 } });
  assert.equal(mixed.spot, 'on');
  assert.equal(mixed.tabs, 'round');
  assert.equal(mixed.clock, 'bar', 'auto keeps the arrangement value');
  assert.equal(mixed.frame, 'halo', 'unknown values are ignored');
  assert.equal(mixed.nav, 'bottom-bar', 'non-strings are ignored');
  assert.deepEqual(resolveParts('nonsense', {}), PRESET_PARTS.classic);
  assert.equal(handoffs(resolveParts('classic', { nav: 'left' }).nav).navigation, 'vertical');
});
