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

test('repeat speeds: standard keeps the old timings, and faster is faster everywhere', () => {
  assert.deepStrictEqual(I.repeatTiming('standard', 'launcher'), { initialDelay: 200, repeatInterval: 200 });
  assert.deepStrictEqual(I.repeatTiming('standard', 'browser'), { initialDelay: 350, repeatInterval: 90 });
  assert.deepStrictEqual(I.repeatTiming('nonsense', 'launcher'), I.repeatTiming('standard', 'launcher'));
  assert.deepStrictEqual(I.REPEAT_CHOICES, ['slow', 'standard', 'fast']);
  for (const where of ['launcher', 'browser']) {
    const [s, n, f] = I.REPEAT_CHOICES.map((c) => I.repeatTiming(c, where).repeatInterval);
    assert.ok(s > n && n > f, where);
  }
});

test('the repeater: moves at once, waits, then repeats; the newest direction wins', () => {
  const timers = [];
  const out = [];
  const r = I.createDirectionRepeater({
    onAction: (a) => out.push(a), initialDelay: 200, repeatInterval: 100,
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeoutFn: () => {},
  });
  r.set('pad', 'down');
  assert.deepStrictEqual(out, ['down']);
  assert.strictEqual(timers.at(-1).ms, 200);
  timers.at(-1).fn();
  assert.deepStrictEqual(out, ['down', 'down']);
  assert.strictEqual(timers.at(-1).ms, 100);
  r.set('stick', 'left');
  assert.deepStrictEqual(out.at(-1), 'left');
  r.set('stick', '');
  assert.deepStrictEqual(out.at(-1), 'down', 'releasing the newer one goes back to the held one');
  r.dispose();
  r.set('pad', 'up');
  assert.strictEqual(out.at(-1), 'down');
});

test('remaps: a rearrangement of the face buttons and bumpers, per family, winning over "confirm"', () => {
  assert.ok(I.validRemap([0, 1, 2, 3, 4, 5]));
  assert.ok(!I.validRemap([0, 0, 2, 3, 4, 5]), 'a job on two buttons would leave another job on none');
  assert.ok(!I.validRemap([0, 1, 2, 3, 4]));
  assert.ok(!I.validRemap([0, 1, 2, 3, 4, 6]));
  assert.ok(!I.validRemap('012345'));
  const swapAB = [1, 0, 2, 3, 4, 5];
  const pad = { confirm: 'label', remap: { xbox: swapAB, playstation: [0, 0, 0, 0, 0, 0] } };
  assert.strictEqual(I.mapFor('xbox', pad), swapAB);
  assert.strictEqual(I.mapFor('playstation', pad), false, 'a broken remap is ignored');
  assert.strictEqual(I.mapFor('nintendo', pad), true, 'no remap: the confirm setting');
  assert.deepStrictEqual(I.mapFor('nintendo', { confirm: 'label', remap: { nintendo: [0, 1, 2, 3, 4, 5] } }), [0, 1, 2, 3, 4, 5], 'a remap wins over confirm');
  assert.strictEqual(I.actionFor(1, swapAB), 'a');
  assert.strictEqual(I.buttonFor('b', swapAB), 0);
  assert.strictEqual(I.physicalFor(12, swapAB), 12, 'the D-pad and the rest are never remapped');
  assert.strictEqual(I.roleBits((1 << 1) | (1 << 13), swapAB), (1 << 0) | (1 << 13));
});

test('assigning a job swaps it with the button that had it, so every job stays on one button', () => {
  // Confirm on RB (5): RB confirms, and the button that confirmed (0) takes RB's job.
  let m = I.assign(false, 0, 5);
  assert.deepStrictEqual(m, [5, 1, 2, 3, 4, 0]);
  assert.ok(I.validRemap(m));
  // Starting from the Nintendo letters, the list says what's in use now.
  assert.deepStrictEqual(I.asRemap(true), [1, 0, 3, 2, 4, 5]);
  m = I.assign(true, 1, 1); // back on the right button again
  assert.deepStrictEqual(m, [0, 1, 3, 2, 4, 5]);
  assert.ok(I.isIdentity(I.assign(I.assign(false, 2, 3), 2, 2)));
  assert.deepStrictEqual(I.assign(false, 9, 0), [0, 1, 2, 3, 4, 5], 'out of range does nothing');
  for (let r = 0; r < 6; r++) for (let p = 0; p < 6; p++) {
    const x = I.assign([2, 0, 1, 5, 3, 4], r, p);
    assert.ok(I.validRemap(x) && I.roleOf(p, x) === r);
  }
});

test('in the browser, a remap applies to evdev controllers too, at once', () => {
  const B = require('../browser-gamepad');
  const out = [];
  let map = false;
  const m = B.createMapper({ onAction: (k) => out.push(k), onBrowserAction: (a) => out.push('act:' + a), roleOf: (n) => I.roleOf(n, map), setTimeoutFn: () => 0, clearTimeoutFn: () => {} });
  const tap = (code) => { m.handleButton(code, 1); m.handleButton(code, 0); };
  tap(0x130); tap(0x131);
  assert.deepStrictEqual(out.splice(0), ['ENTER', 'act:b']);
  map = I.assign(false, 0, 5); // RB confirms; the bottom button does RB's job
  tap(0x137); tap(0x130);
  assert.deepStrictEqual(out.splice(0), ['ENTER', 'act:rb']);
  m.handleButton(0x137, 1); map = false; m.handleButton(0x137, 0); m.handleButton(0x137, 1);
  assert.deepStrictEqual(out.splice(0), ['ENTER', 'act:rb'], 'a remap mid-press leaves nothing stuck');
  m.dispose();
});
