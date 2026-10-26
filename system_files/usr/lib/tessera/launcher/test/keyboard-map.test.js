'use strict';
const test = require('node:test');
const assert = require('node:assert');
const km = require('../keyboard-map');

test('every preset binds every action, with no key on two actions', () => {
  for (const name of Object.keys(km.PRESETS)) {
    const b = km.normalize(null, name);
    const seen = new Set();
    for (const a of km.ACTIONS) {
      assert.ok(b[a].length >= 1, `${name}.${a} has a key`);
      for (const c of b[a]) { assert.ok(!seen.has(c), `${name}: ${c} used twice`); seen.add(c); }
    }
    assert.ok(b.up.includes('ArrowUp') && b.left.includes('ArrowLeft'), `${name} keeps the arrows`);
  }
});

test('normalize drops junk, reserved keys and duplicates, and refills empty actions', () => {
  const b = km.normalize({ a: ['KeyZ', 'KeyZ', 'ShiftLeft', '<script>', 5], b: [], x: ['KeyZ', 'KeyV'], bogus: ['KeyQ'] }, 'standard');
  assert.deepStrictEqual(b.a, ['KeyZ']);
  assert.deepStrictEqual(b.b, km.PRESETS.standard.b); // empty -> the preset's keys
  assert.deepStrictEqual(b.x, ['KeyV']); // KeyZ already taken by a
  assert.strictEqual(b.bogus, undefined);
  const many = km.normalize({ a: ['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE'] }, 'standard');
  assert.strictEqual(many.a.length, km.MAX_PER_ACTION);
});

test('bind moves a key to the front of its new action and off its old one', () => {
  const base = km.normalize(null, 'standard');
  const b = km.bind(base, 'a', 'PageUp', 'standard');
  assert.strictEqual(b.a[0], 'PageUp');
  assert.ok(!b.lb.includes('PageUp'));
  assert.ok(b.lb.length >= 1);
  assert.strictEqual(km.lookup(b).get('PageUp'), 'a');
  assert.strictEqual(km.bind(base, 'a', 'ShiftLeft', 'standard'), null);
  assert.strictEqual(km.bind(base, 'nope', 'KeyQ', 'standard'), null);
});

test('labels: names, letters, and the keyboard layout when known', () => {
  assert.strictEqual(km.label('PageUp'), 'PgUp');
  assert.strictEqual(km.label('Escape'), 'Esc');
  assert.strictEqual(km.label('KeyQ'), 'Q');
  assert.strictEqual(km.label('Digit7'), '7');
  assert.strictEqual(km.label('Numpad8'), 'Num 8');
  assert.strictEqual(km.label('F1'), 'F1');
  assert.strictEqual(km.label('ArrowLeft'), '←');
  const azerty = new Map([['KeyQ', 'a'], ['BracketLeft', '^']]);
  assert.strictEqual(km.label('KeyQ', azerty), 'A');
  assert.strictEqual(km.label('BracketLeft', azerty), '^');
  assert.strictEqual(km.label('PageUp', azerty), 'PgUp');
});
