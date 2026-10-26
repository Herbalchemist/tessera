'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuideButton, actionsFor } = require('../guide-button');

function rig(mode = 'menu-home') {
  const got = [];
  const timers = new Map();
  let n = 0;
  const g = createGuideButton({
    mode: () => mode,
    onAction: (a, how) => got.push(`${a}:${how}`),
    setTimeoutFn: (fn) => { const id = ++n; timers.set(id, fn); return id; },
    clearTimeoutFn: (id) => timers.delete(id),
  });
  const elapse = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  return { g, got, elapse, setMode: (m) => { mode = m; } };
}

test('default: a press opens the guide, a hold goes Home', () => {
  const { g, got, elapse } = rig();
  g.down('pad1'); g.up('pad1');
  g.down('pad1'); elapse(); g.up('pad1');
  assert.deepEqual(got, ['menu:press', 'home:hold'], 'releasing after a hold does nothing more');
});

test('the setting swaps press and hold, or makes both open the guide', () => {
  const a = rig('home-menu');
  a.g.down('p'); a.g.up('p'); a.g.down('p'); a.elapse(); a.g.up('p');
  assert.deepEqual(a.got, ['home:press', 'menu:hold']);
  const b = rig('menu');
  b.g.down('p'); b.g.up('p'); b.g.down('p'); b.elapse(); b.g.up('p');
  assert.deepEqual(b.got, ['menu:press', 'menu:hold']);
  assert.deepEqual(actionsFor('nonsense'), ['menu', 'home'], 'unknown modes fall back to the default');
});

test('two controllers pressing together are one gesture; repeats and drops are ignored', () => {
  const { g, got } = rig();
  g.down('a'); g.down('a'); g.down('b'); g.up('a');
  assert.deepEqual(got, [], 'still held on b');
  g.up('b');
  assert.deepEqual(got, ['menu:press']);
  g.down('c'); g.drop('c'); g.up('c');
  assert.deepEqual(got, ['menu:press'], 'a pad unplugged mid-press does nothing');
});
