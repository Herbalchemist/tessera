// SPDX-License-Identifier: GPL-3.0-or-later
// Normalize Linux evdev button codes and joydev-normalized axes for browser navigation.
// evdev button codes are position-based (BTN_SOUTH/EAST/TL/TR), unlike joydev button indexes,
// which can shift depending on which buttons a controller reports.
'use strict';

const EV_KEY = 1;
const BTN_SOUTH = 0x130;
const BTN_EAST = 0x131;
const BTN_NORTH = 0x133;
const BTN_WEST = 0x134;
const BTN_TL = 0x136;
const BTN_TR = 0x137;
// The face buttons and bumpers as standard button numbers 0-5 (bottom, right, left, top, LB, RB).
const MAPPABLE = [BTN_SOUTH, BTN_EAST, BTN_WEST, BTN_NORTH, BTN_TL, BTN_TR];
const BTN_DPAD_UP = 0x220;
const BTN_DPAD_DOWN = 0x221;
const BTN_DPAD_LEFT = 0x222;
const BTN_DPAD_RIGHT = 0x223;
const ABS_X = 0x00;
const ABS_Y = 0x01;
const ABS_Z = 0x02;
const ABS_RX = 0x03;
const ABS_RY = 0x04;
const ABS_RZ = 0x05;
const ABS_GAS = 0x09;
const ABS_BRAKE = 0x0a;
const BTN_TL2 = 0x138;
const BTN_TR2 = 0x139;
const ABS_HAT0X = 0x10;
const ABS_HAT0Y = 0x11;

function isJoystickNodeName(name) {
  return typeof name === 'string' && /^js\d+$/.test(name);
}
function isEventNodeName(name) {
  return typeof name === 'string' && /^event\d+$/.test(name);
}

// Linux prints sysfs input capabilities as space-separated unsigned-long words,
// highest word first. Even zero words have their full bit position; concatenating
// their unpadded hex text or passing the whole string to BigInt is incorrect.
function capabilityBits(value, wordBits = process.arch === 'ia32' || process.arch === 'arm' ? 32 : 64) {
  if (wordBits !== 32 && wordBits !== 64) return 0n;
  const words = String(value || '').trim().split(/\s+/);
  if (words.length > 32 || words.some(word => !/^[0-9a-f]+$/i.test(word) || word.length > wordBits / 4)) return 0n;
  return words.reduce((bits, word) => (bits << BigInt(wordBits)) | BigInt('0x' + word), 0n);
}
function capabilityHas(value, code, wordBits) {
  return Number.isInteger(code) && code >= 0 && code < 1024 &&
    (capabilityBits(value, wordBits) & (1n << BigInt(code))) !== 0n;
}

// Standard Gamepad API positions, also used by pads.js virtual Nintendo frames.
// Confirm/cancel follow the launcher's physical roles, not the printed letters.
function standardButtonActions(down) {
  const keys = [];
  const browserActions = [];
  if (down & (1 << 0)) keys.push('ENTER');
  if (down & (1 << 1)) browserActions.push('b');
  if (down & (1 << 2)) keys.push('TAB');
  for (const [bit, action] of [[3, 'y'], [4, 'lb'], [5, 'rb']]) {
    if (down & (1 << bit)) browserActions.push(action);
  }
  return { keys, browserActions };
}

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
  const bits = capabilityBits(hex);
  const codes = [];
  for (let code = 0; code <= 0x3f; code++) {
    if ((bits & (1n << BigInt(code))) !== 0n) codes.push(code);
  }
  return codes;
}

// The direction repeater is the one input system's (input-actions.js): one hold-to-repeat for the
// launcher and the browser.
const { createDirectionRepeater } = require('./input-actions');

function createMapper({
  onShoulder,
  onAction = () => {},
  onBrowserAction = null,
  initialDelay,
  repeatInterval,
  setTimeoutFn,
  clearTimeoutFn,
  // When set, sticks and triggers are reported as raw values for the browser pointer
  // instead of being turned into arrow/page keys: onAnalog('lx'|'ly'|'rx'|'ry', -1..1)
  // and onAnalog('lt'|'rt', 0..1).
  onAnalog = null,
  // Most pads put the right stick on ABS_RX/RY and the triggers on ABS_Z/RZ. Generic
  // DirectInput-style pads without ABS_RX/RY put the right stick on ABS_Z/RZ instead.
  hasRightStick = true,
  // Settings > Button mapping: (standard button number 0-5) -> the role it plays, asked at each
  // press so a change applies at once. Face buttons and bumpers only.
  roleOf = null,
} = {}) {
  if (typeof onShoulder !== 'function') onShoulder = () => {};
  if (typeof onBrowserAction !== 'function') onBrowserAction = null;
  if (typeof onAnalog !== 'function') onAnalog = null;
  const axes = new Map();
  const pressed = new Set();
  const directions = createDirectionRepeater({ onAction, initialDelay, repeatInterval, setTimeoutFn, clearTimeoutFn });
  const setDirection = (source, key) => directions.set(source, key);
  const get = (code) => axes.get(code) || 0;
  const dir = (x, y, threshold) => Math.abs(get(x)) > Math.abs(get(y))
    ? (Math.abs(get(x)) > threshold ? (get(x) < 0 ? 'LEFT' : 'RIGHT') : '')
    : (Math.abs(get(y)) > threshold ? (get(y) < 0 ? 'UP' : 'DOWN') : '');
  const browserAction = (action, fallback) => {
    if (onBrowserAction) onBrowserAction(action);
    else if (fallback) onAction(fallback);
  };

  function handleAxis(code, value) {
    const v = Math.max(-1, Math.min(1, value / 32767));
    axes.set(code, v);
    if (onAnalog) {
      // joydev stretches every axis to -32767..32767, so a trigger at rest reads -1.
      const trigger = (x) => Math.max(0, Math.min(1, (x + 1) / 2));
      if (code === ABS_X) return onAnalog('lx', v);
      if (code === ABS_Y) return onAnalog('ly', v);
      if (code === ABS_RX) return onAnalog('rx', v);
      if (code === ABS_RY) return onAnalog('ry', v);
      if (code === ABS_Z) return hasRightStick ? onAnalog('lt', trigger(v)) : onAnalog('rx', v);
      if (code === ABS_RZ) return hasRightStick ? onAnalog('rt', trigger(v)) : onAnalog('ry', v);
      if (code === ABS_BRAKE) return onAnalog('lt', trigger(v));
      if (code === ABS_GAS) return onAnalog('rt', trigger(v));
    }
    if (code === ABS_X || code === ABS_Y) setDirection('left-stick', dir(ABS_X, ABS_Y, 0.65));
    if (code === ABS_HAT0X || code === ABS_HAT0Y) {
      const hx = get(ABS_HAT0X), hy = get(ABS_HAT0Y);
      const hat = Math.abs(hx) > Math.abs(hy)
        ? (Math.abs(hx) > 0.5 ? (hx < 0 ? 'LEFT' : 'RIGHT') : '')
        : (Math.abs(hy) > 0.5 ? (hy < 0 ? 'UP' : 'DOWN') : '');
      setDirection('hat', hat);
    }
    if (code === ABS_RX || code === ABS_RY) {
      const right = dir(ABS_RX, ABS_RY, 0.65);
      setDirection('right-stick', right === 'UP' ? 'PAGEUP' : right === 'DOWN' ? 'PAGEDOWN' : right);
    }
  }

  function handleButton(code, value) {
    const dpad = {
      [BTN_DPAD_UP]: 'UP', [BTN_DPAD_DOWN]: 'DOWN',
      [BTN_DPAD_LEFT]: 'LEFT', [BTN_DPAD_RIGHT]: 'RIGHT',
    };
    if (Object.prototype.hasOwnProperty.call(dpad, code)) {
      if (value === 0) {
        pressed.delete(code);
        setDirection('dpad:' + code, '');
      } else if (value === 1 && !pressed.has(code)) {
        pressed.add(code);
        setDirection('dpad:' + code, dpad[code]);
      }
      return;
    }
    // Digital triggers (no analog axis) click the browser pointer too.
    if (onAnalog && (code === BTN_TL2 || code === BTN_TR2)) {
      if (value === 2) return; // key repeat
      return onAnalog(code === BTN_TL2 ? 'lt' : 'rt', value ? 1 : 0);
    }
    const raw = code; // held buttons are tracked as they are, so a remap mid-press can't strand one
    if (roleOf) {
      const n = MAPPABLE.indexOf(code);
      if (n >= 0) {
        const role = roleOf(n);
        if (Number.isInteger(role) && role >= 0 && role < MAPPABLE.length) code = MAPPABLE[role];
      }
    }
    if (value === 0) { pressed.delete(raw); return; }
    if (value !== 1 || pressed.has(raw)) return; // Ignore key repeat.
    pressed.add(raw);
    if (code === BTN_TL) {
      if (onBrowserAction) return onBrowserAction('lb');
      return onShoulder(-1);
    }
    if (code === BTN_TR) {
      if (onBrowserAction) return onBrowserAction('rb');
      return onShoulder(1);
    }
    if (code === BTN_SOUTH) return onAction('ENTER');
    if (code === BTN_WEST) return onAction('TAB');
    // B is a launcher-level browser action when this is the embedded view. It
    // intentionally remains Escape for callers without that semantic callback.
    if (code === BTN_EAST) return browserAction('b', 'ESC');
    // Standard gamepad button 3 is the top face button (Xbox Y / Nintendo X),
    // the documented controller equivalent of the browser address action.
    if (code === BTN_NORTH && onBrowserAction) return onBrowserAction('y');
  }

  return { handleAxis, handleButton, dispose: () => directions.dispose() };
}

module.exports = {
  parseJsEvents, parseInputEvents, axisCodesFromSysfs,
  capabilityBits, capabilityHas,
  isJoystickNodeName, isEventNodeName, standardButtonActions, createDirectionRepeater, createMapper,
};
