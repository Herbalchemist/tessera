// SPDX-License-Identifier: GPL-3.0-or-later
// Normalize Linux evdev button codes and joydev-normalized axes for browser navigation.
// evdev button codes are position-based (BTN_SOUTH/EAST/TL/TR), unlike joydev button indexes,
// which can shift depending on which buttons a controller reports.
'use strict';

const EV_KEY = 1;
const EV_ABS = 3;
const BTN_SOUTH = 0x130;
const BTN_EAST = 0x131;
const BTN_TL = 0x136;
const BTN_TR = 0x137;
const BTN_DPAD_UP = 0x220;
const BTN_DPAD_DOWN = 0x221;
const BTN_DPAD_LEFT = 0x222;
const BTN_DPAD_RIGHT = 0x223;
const ABS_X = 0x00;
const ABS_Y = 0x01;
const ABS_RX = 0x03;
const ABS_RY = 0x04;
const ABS_HAT0X = 0x10;
const ABS_HAT0Y = 0x11;

function parseJsEvents(buffer, onEvent) {
  for (let i = 0; i + 8 <= buffer.length; i += 8) {
    const rawType = buffer[i + 6];
    if (rawType & 0x80) continue; // Ignore initial state; no navigation until the user moves.
    const type = rawType & ~0x80;
    if (type !== 0x02) continue;
    onEvent({ type: 'axis', number: buffer[i + 7], value: buffer.readInt16LE(i + 4) });
  }
}

function parseInputEvents(buffer, onEvent) {
  for (let i = 0; i + 24 <= buffer.length; i += 24) {
    const type = buffer.readUInt16LE(i + 16);
    if (type !== EV_KEY) continue;
    onEvent({ type: 'button', code: buffer.readUInt16LE(i + 18), value: buffer.readInt32LE(i + 20) });
  }
}

function axisCodesFromSysfs(hex) {
  let bits;
  try { bits = BigInt('0x' + String(hex || '').trim()); } catch { return []; }
  const codes = [];
  for (let code = 0; code <= 0x3f; code++) {
    if ((bits & (1n << BigInt(code))) !== 0n) codes.push(code);
  }
  return codes;
}

function createMapper({ onShoulder, onAction = () => {} } = {}) {
  if (typeof onShoulder !== 'function') onShoulder = () => {};
  const axes = new Map();
  const directions = new Map();
  const pressed = new Set();
  const emitDirection = (key, dir) => {
    const old = directions.get(key) || '';
    if (dir && dir !== old) onAction(dir);
    directions.set(key, dir);
  };
  const get = (code) => axes.get(code) || 0;
  const dir = (x, y, threshold) => Math.abs(get(x)) > Math.abs(get(y))
    ? (Math.abs(get(x)) > threshold ? (get(x) < 0 ? 'LEFT' : 'RIGHT') : '')
    : (Math.abs(get(y)) > threshold ? (get(y) < 0 ? 'UP' : 'DOWN') : '');

  function handleAxis(code, value) {
    axes.set(code, Math.max(-1, Math.min(1, value / 32767)));
    if (code === ABS_X || code === ABS_Y) emitDirection('left', dir(ABS_X, ABS_Y, 0.65));
    if (code === ABS_HAT0X || code === ABS_HAT0Y) {
      const hx = get(ABS_HAT0X), hy = get(ABS_HAT0Y);
      const hat = Math.abs(hx) > Math.abs(hy)
        ? (Math.abs(hx) > 0.5 ? (hx < 0 ? 'LEFT' : 'RIGHT') : '')
        : (Math.abs(hy) > 0.5 ? (hy < 0 ? 'UP' : 'DOWN') : '');
      emitDirection('hat', hat);
    }
    if (code === ABS_RX || code === ABS_RY) {
      const right = dir(ABS_RX, ABS_RY, 0.65);
      emitDirection('right', right === 'UP' ? 'PAGEUP' : right === 'DOWN' ? 'PAGEDOWN' : right);
    }
  }

  function handleButton(code, value) {
    if (value === 0) { pressed.delete(code); return; }
    if (value !== 1 || pressed.has(code)) return; // Ignore key repeat.
    pressed.add(code);
    if (code === BTN_TL) return onShoulder(-1);
    if (code === BTN_TR) return onShoulder(1);
    const keys = {
      [BTN_SOUTH]: 'ENTER', [BTN_EAST]: 'ESC',
      [BTN_DPAD_UP]: 'UP', [BTN_DPAD_DOWN]: 'DOWN',
      [BTN_DPAD_LEFT]: 'LEFT', [BTN_DPAD_RIGHT]: 'RIGHT',
    };
    if (keys[code]) onAction(keys[code]);
  }

  return { handleAxis, handleButton };
}

module.exports = { parseJsEvents, parseInputEvents, axisCodesFromSysfs, createMapper };
