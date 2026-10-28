'use strict';
// The one input system's button meanings: the positional default, and Nintendo's label profile.
const test = require('node:test');
const assert = require('node:assert');
const I = require('../input-actions');
const KB = require('../keyboard-map');

test('the actions are the keyboard\'s actions', () => {
  assert.deepStrictEqual(I.ACTIONS, KB.ACTIONS);
});

test('controller families', () => {
  assert.strictEqual(I.familyOf('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'xbox');
  assert.strictEqual(I.familyOf('DualSense Wireless Controller (Vendor: 054c Product: 0ce6)'), 'playstation');
  assert.strictEqual(I.familyOf('Nintendo Switch Pro Controller'), 'nintendo');
  assert.strictEqual(I.familyOf('Joy-Con (L/R)'), 'nintendo');
  assert.strictEqual(I.familyOf('Pro Controller (Vendor: 057e Product: 2009)'), 'nintendo');
  assert.strictEqual(I.familyOf(''), 'xbox');
});

test('default: positional on every controller (nothing changes)', () => {
  for (const fam of ['xbox', 'playstation', 'nintendo']) {
    const swap = I.swaps(fam, 'position');
    assert.strictEqual(swap, false);
    for (let n = 0; n <= 16; n++) assert.strictEqual(I.physicalFor(n, swap), n);
    assert.strictEqual(I.actionFor(0, swap), 'a');
    assert.strictEqual(I.actionFor(1, swap), 'b');
    assert.strictEqual(I.roleBits(0b1011, swap), 0b1011);
  }
});

test('label profile: only Nintendo controllers, only the four face buttons trade places', () => {
  assert.strictEqual(I.swaps('xbox', 'label'), false);
  assert.strictEqual(I.swaps('playstation', 'label'), false);
  const swap = I.swaps('nintendo', 'label');
  assert.strictEqual(swap, true);
  assert.strictEqual(I.actionFor(1, swap), 'a'); // A, on the right, confirms
  assert.strictEqual(I.actionFor(0, swap), 'b'); // B, at the bottom, goes back
  assert.strictEqual(I.actionFor(3, swap), 'x');
  assert.strictEqual(I.actionFor(2, swap), 'y');
  for (const n of [4, 5, 12, 13, 14, 15, 16]) assert.strictEqual(I.physicalFor(n, swap), n);
  assert.strictEqual(I.buttonFor('a', swap), 1);
  assert.strictEqual(I.buttonFor('y', swap), 2);
  assert.strictEqual(I.buttonFor('nope', swap), null);
  for (let n = 0; n <= 16; n++) assert.strictEqual(I.roleOf(I.physicalFor(n, swap), swap), n, 'the swap undoes itself');
});

test('bit masks follow the same rule', () => {
  const swap = true;
  assert.strictEqual(I.roleBits(1 << 1, swap), 1 << 0);     // physical A -> confirm role
  assert.strictEqual(I.roleBits(1 << 0, swap), 1 << 1);
  assert.strictEqual(I.roleBits(1 << 2, swap), 1 << 3);
  assert.strictEqual(I.roleBits((1 << 4) | (1 << 12) | (1 << 3), swap), (1 << 4) | (1 << 12) | (1 << 2));
  assert.strictEqual(I.roleBits(0b1111, swap), 0b1111);
});

test('in the browser, a Nintendo A confirms (Enter) and B goes back, under "A confirms"', () => {
  const B = require('../browser-gamepad');
  const swap = I.swaps('nintendo', 'label');
  const press = (physical, s) => B.standardButtonActions(I.roleBits(1 << physical, s));
  assert.deepStrictEqual(press(1, swap).keys, ['ENTER']);         // A (right)
  assert.deepStrictEqual(press(0, swap).browserActions, ['b']);   // B (bottom)
  assert.deepStrictEqual(press(0, false).keys, ['ENTER']);        // by position (the default): bottom confirms
  assert.deepStrictEqual(press(1, false).browserActions, ['b']);
});
