'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPointer, shape } = require('../browser-pointer');
const { createMapper } = require('../browser-gamepad');

function rig(settings = {}) {
  const log = { moves: [], wheels: [], buttons: [] };
  const p = createPointer({
    bounds: () => ({ width: 1000, height: 500 }),
    settings: () => ({ deadzone: 15, cursorSpeed: 50, scrollSpeed: 50, ...settings }),
    onMove: (x, y) => log.moves.push([x, y]),
    onWheel: (x, y, dx, dy) => log.wheels.push([dx, dy]),
    onButton: (side, down) => log.buttons.push([side, down]),
  });
  return { p, log };
}

test('deadzone swallows small pushes and the curve keeps half-tilt slow', () => {
  assert.deepEqual(shape(0.1, 0.05, 0.15), { x: 0, y: 0 });
  const half = shape(0.575, 0, 0.15).x; // halfway past the deadzone
  const full = shape(1, 0, 0.15).x;
  assert.ok(Math.abs(half - 0.25) < 1e-9, 'half tilt gives a quarter speed');
  assert.equal(full, 1);
});

test('right stick moves the cursor by default; speed follows how far it is pushed', () => {
  const { p, log } = rig();
  p.setAxis('a', 'rx', 0.5);
  p.tick(100);
  const slow = log.moves.at(-1)[0] - 500;
  p.recenter(); log.moves.length = 0;
  p.setAxis('a', 'rx', 1);
  p.tick(100);
  const fast = log.moves.at(-1)[0] - 500;
  assert.ok(slow > 0 && fast > slow * 3, `full tilt is much faster than half tilt (${slow} vs ${fast})`);
  assert.equal(log.wheels.length, 0, 'the cursor stick never scrolls');
});

test('left stick scrolls, analog: pushing down scrolls the page down (negative deltaY)', () => {
  const { p, log } = rig();
  p.setAxis('a', 'ly', 0.4);
  for (let i = 0; i < 5; i++) p.tick(16);
  const gentle = log.wheels.reduce((t, w) => t + w[1], 0);
  log.wheels.length = 0;
  p.setAxis('a', 'ly', 1);
  for (let i = 0; i < 5; i++) p.tick(16);
  const hard = log.wheels.reduce((t, w) => t + w[1], 0);
  assert.ok(gentle < 0 && hard < gentle * 4, `harder push scrolls faster (${gentle} vs ${hard})`);
  p.setAxis('a', 'ly', -1);
  log.wheels.length = 0;
  p.tick(16);
  assert.ok(log.wheels[0][1] > 0, 'pushing up scrolls up');
  assert.equal(log.moves.length, 0, 'the scroll stick never moves the cursor');
});

test('the setting swaps the sticks', () => {
  const { p, log } = rig({ browserCursor: 'left' });
  p.setAxis('a', 'lx', 1);
  p.setAxis('a', 'ry', 1);
  p.tick(50);
  assert.ok(log.moves.length === 1 && log.moves[0][0] > 500, 'left stick moved the cursor');
  assert.ok(log.wheels.length === 1 && log.wheels[0][1] < 0, 'right stick scrolled');
});

test('the cursor stays on screen', () => {
  const { p, log } = rig();
  p.setAxis('a', 'rx', -1); p.setAxis('a', 'ry', -1);
  for (let i = 0; i < 100; i++) p.tick(100);
  assert.deepEqual(log.moves.at(-1), [0, 0]);
  p.setAxis('a', 'rx', 1); p.setAxis('a', 'ry', 1);
  for (let i = 0; i < 100; i++) p.tick(100);
  assert.deepEqual(log.moves.at(-1), [999, 499]);
});

test('RT is a left click and LT a right click, with press and release (so dragging works)', () => {
  const { p, log } = rig();
  p.setTrigger('a', 'right', 0.2);
  assert.equal(log.buttons.length, 0, 'a light touch is not a click');
  p.setTrigger('a', 'right', 0.9);
  p.setTrigger('a', 'right', 0.4); // between thresholds: still held
  p.setTrigger('a', 'right', 0.0);
  p.setTrigger('a', 'left', 1);
  p.setTrigger('a', 'left', 0);
  assert.deepEqual(log.buttons, [['right', true], ['right', false], ['left', true], ['left', false]]);
});

test('a controller that disconnects mid-click lets go of the button', () => {
  const { p, log } = rig();
  p.setTrigger('a', 'right', 1);
  p.removeSource('a');
  assert.deepEqual(log.buttons, [['right', true], ['right', false]]);
  p.setAxis('b', 'rx', 1); p.reset(); p.tick(50);
  assert.equal(log.moves.length, 0, 'reset forgets stick state');
});

test('evdev mapper reports raw sticks and triggers when the pointer asks for them', () => {
  const got = [];
  const keys = [];
  const m = createMapper({ onAction: (k) => keys.push(k), onAnalog: (n, v) => got.push([n, Math.round(v * 100) / 100]) });
  m.handleAxis(0x00, 32767);   // ABS_X
  m.handleAxis(0x04, -16384);  // ABS_RY
  m.handleAxis(0x05, 32767);   // ABS_RZ: right trigger fully pulled
  m.handleAxis(0x02, -32767);  // ABS_Z: left trigger at rest
  m.handleButton(0x139, 1);    // BTN_TR2 digital trigger
  m.handleButton(0x139, 0);
  assert.deepEqual(got, [['lx', 1], ['ry', -0.5], ['rt', 1], ['lt', 0], ['rt', 1], ['rt', 0]]);
  assert.deepEqual(keys, [], 'sticks no longer send arrow/page keys in pointer mode');
  m.handleButton(0x223, 1);    // the D-pad still steps through the page
  assert.deepEqual(keys, ['RIGHT']);
  m.dispose();
});

test('pads without ABS_RX/RY carry the right stick on ABS_Z/RZ', () => {
  const got = [];
  const m = createMapper({ onAnalog: (n, v) => got.push(n), hasRightStick: false });
  m.handleAxis(0x02, 1000);
  m.handleAxis(0x05, 1000);
  assert.deepEqual(got, ['rx', 'ry']);
  m.dispose();
});
