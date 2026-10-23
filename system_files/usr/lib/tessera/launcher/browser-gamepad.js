// SPDX-License-Identifier: GPL-3.0-or-later
// Generic Linux joydev event decoding and browser navigation mapping.
'use strict';

const JS_EVENT_BUTTON = 0x01;
const JS_EVENT_AXIS = 0x02;
const JS_EVENT_INIT = 0x80;

function parseJsEvents(buffer, onEvent) {
  for (let i = 0; i + 8 <= buffer.length; i += 8) {
    const rawType = buffer[i + 6];
    if (rawType & JS_EVENT_INIT) continue;
    const type = rawType & ~JS_EVENT_INIT;
    if (type !== JS_EVENT_BUTTON && type !== JS_EVENT_AXIS) continue;
    onEvent({ type, value: buffer.readInt16LE(i + 4), number: buffer[i + 7] });
  }
}

function createMapper({ onShoulder = () => {}, onAction = () => {} } = {}) {
  const axes = new Map();
  const directions = new Map();
  const pressed = new Set();
  const emitDirection = (key, dir) => {
    const old = directions.get(key) || '';
    if (dir && dir !== old) onAction(dir);
    directions.set(key, dir);
  };
  const axis = (number, value) => {
    axes.set(number, Math.max(-1, Math.min(1, value / 32767)));
    const get = (n) => axes.get(n) || 0;
    const dir = (x, y, threshold) => Math.abs(get(x)) > Math.abs(get(y))
      ? (Math.abs(get(x)) > threshold ? (get(x) < 0 ? 'LEFT' : 'RIGHT') : '')
      : (Math.abs(get(y)) > threshold ? (get(y) < 0 ? 'UP' : 'DOWN') : '');
    if (number === 0 || number === 1) emitDirection('left', dir(0, 1, 0.65));
    // Some drivers expose the hat as axes 6/7; others expose it as D-pad buttons.
    if (number === 6 || number === 7) emitDirection('hat', dir(6, 7, 0.5));
    if (number === 2 || number === 3) {
      const right = dir(2, 3, 0.65);
      emitDirection('right', right === 'UP' ? 'PAGEUP' : right === 'DOWN' ? 'PAGEDOWN' : right);
    }
  };
  function handleEvent(event) {
    if (event.type === JS_EVENT_AXIS) return axis(event.number, event.value);
    if (event.type !== JS_EVENT_BUTTON) return;
    const n = event.number;
    if (event.value === 0) { pressed.delete(n); return; }
    if (event.value !== 1 || pressed.has(n)) return;
    pressed.add(n);
    if (n === 4) return onShoulder(-1);
    if (n === 5) return onShoulder(1);
    // Linux joydev's common standard order: South confirms, East backs out.
    if (n === 0) onAction('ENTER');
    else if (n === 1) onAction('ESC');
    else if (n === 12) onAction('UP');
    else if (n === 13) onAction('DOWN');
    else if (n === 14) onAction('LEFT');
    else if (n === 15) onAction('RIGHT');
  }
  return { handleEvent };
}

module.exports = { parseJsEvents, createMapper };
