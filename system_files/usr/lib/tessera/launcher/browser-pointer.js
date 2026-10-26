// SPDX-License-Identifier: GPL-3.0-or-later
// Analog pointer for the embedded browser: one stick moves a cursor, the other
// scrolls, and the triggers click. Speed follows how far the stick is pushed.
// Pure logic: the main process feeds stick/trigger values in, calls tick() on a
// timer, and receives move/wheel/button callbacks it turns into Electron
// sendInputEvent calls. Nothing here touches Electron, so node:test covers it.
'use strict';

const STICKS = ['lx', 'ly', 'rx', 'ry'];
const TRIGGER_DOWN = 0.5;   // pressed once past halfway...
const TRIGGER_UP = 0.3;     // ...and released below this, so a resting finger can't chatter

// Speed settings are 10..100 (%). 50 is the default and should feel right on a TV.
function cursorPxPerSecond(speed) { return 300 + 18 * clampNumber(speed, 10, 100, 50); }   // 50 -> 1200 px/s at full tilt
function scrollPxPerSecond(speed) { return 400 + 32 * clampNumber(speed, 10, 100, 50); }   // 50 -> 2000 px/s at full tilt

function clampNumber(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

// Radial deadzone, then a curve: small pushes give fine control, a full push is fast.
function shape(x, y, deadzone) {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone || mag === 0) return { x: 0, y: 0 };
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  const curved = scaled * scaled;
  return { x: (x / mag) * curved, y: (y / mag) * curved };
}

function createPointer({
  onMove = () => {},
  onWheel = () => {},
  onButton = () => {},
  bounds = () => ({ width: 1280, height: 720 }),
  settings = () => ({}),
} = {}) {
  // Values per source (each controller), so two pads never fight over one stick.
  const sources = new Map();
  let x = null;
  let y = null;
  let scrollCarryX = 0;
  let scrollCarryY = 0;
  const buttons = { left: false, right: false };

  const read = () => {
    const s = settings() || {};
    return {
      cursorStick: s.browserCursor === 'left' ? 'left' : 'right',
      cursorSpeed: s.cursorSpeed,
      scrollSpeed: s.scrollSpeed,
      deadzone: clampNumber(s.deadzone, 0, 40, 15) / 100,
    };
  };
  const combined = (name) => {
    let best = 0;
    for (const src of sources.values()) {
      const v = src[name] || 0;
      if (Math.abs(v) > Math.abs(best)) best = v;
    }
    return best;
  };
  const center = () => {
    const b = bounds();
    if (x === null) { x = Math.round(b.width / 2); y = Math.round(b.height / 2); }
  };

  function setAxis(source, name, value) {
    if (!STICKS.includes(name)) return;
    const v = clampNumber(value, -1, 1, 0);
    const src = sources.get(source) || {};
    src[name] = v;
    sources.set(source, src);
  }

  function setTrigger(source, side, value) {
    if (side !== 'left' && side !== 'right') return;
    const src = sources.get(source) || {};
    src[side + 'Trigger'] = clampNumber(value, 0, 1, 0);
    sources.set(source, src);
    // A trigger is pressed if any controller holds it.
    let held = buttons[side];
    let pull = 0;
    for (const s of sources.values()) pull = Math.max(pull, s[side + 'Trigger'] || 0);
    if (!held && pull >= TRIGGER_DOWN) held = true;
    else if (held && pull <= TRIGGER_UP) held = false;
    if (held === buttons[side]) return;
    buttons[side] = held;
    center();
    onButton(side, held, Math.round(x), Math.round(y));
  }

  // dt in milliseconds. Returns true while anything is moving, so the caller can idle.
  function tick(dt) {
    const step = Math.max(0, Math.min(100, Number(dt) || 0)) / 1000;
    if (!step) return false;
    const cfg = read();
    const cur = cfg.cursorStick === 'left' ? ['lx', 'ly'] : ['rx', 'ry'];
    const scr = cfg.cursorStick === 'left' ? ['rx', 'ry'] : ['lx', 'ly'];
    let active = false;

    const c = shape(combined(cur[0]), combined(cur[1]), cfg.deadzone);
    if (c.x || c.y) {
      center();
      const b = bounds();
      const speed = cursorPxPerSecond(cfg.cursorSpeed) * step;
      const nx = Math.max(0, Math.min(b.width - 1, x + c.x * speed));
      const ny = Math.max(0, Math.min(b.height - 1, y + c.y * speed));
      if (Math.round(nx) !== Math.round(x) || Math.round(ny) !== Math.round(y)) {
        x = nx; y = ny;
        onMove(Math.round(x), Math.round(y));
      } else { x = nx; y = ny; }
      active = true;
    }

    const s = shape(combined(scr[0]), combined(scr[1]), cfg.deadzone);
    if (s.x || s.y) {
      center();
      const speed = scrollPxPerSecond(cfg.scrollSpeed) * step;
      // Chromium wheel deltas are "content moves by": negative deltaY scrolls the page down.
      scrollCarryX += -s.x * speed;
      scrollCarryY += -s.y * speed;
      const dx = Math.trunc(scrollCarryX);
      const dy = Math.trunc(scrollCarryY);
      scrollCarryX -= dx; scrollCarryY -= dy;
      if (dx || dy) onWheel(Math.round(x), Math.round(y), dx, dy);
      active = true;
    } else { scrollCarryX = 0; scrollCarryY = 0; }
    return active;
  }

  function removeSource(source) {
    sources.delete(source);
    for (const side of ['left', 'right']) {
      if (!buttons[side]) continue;
      let pull = 0;
      for (const s of sources.values()) pull = Math.max(pull, s[side + 'Trigger'] || 0);
      if (pull <= TRIGGER_UP) { buttons[side] = false; center(); onButton(side, false, Math.round(x), Math.round(y)); }
    }
  }

  // Leaving the browser: let go of any held click and forget stick state.
  function reset() {
    for (const side of ['left', 'right']) {
      if (buttons[side]) { buttons[side] = false; onButton(side, false, x === null ? 0 : Math.round(x), y === null ? 0 : Math.round(y)); }
    }
    sources.clear();
    scrollCarryX = 0; scrollCarryY = 0;
  }

  return {
    setAxis, setTrigger, tick, removeSource, reset,
    position: () => (x === null ? null : { x: Math.round(x), y: Math.round(y) }),
    recenter: () => { x = null; y = null; center(); },
  };
}

module.exports = { createPointer, shape, cursorPxPerSecond, scrollPxPerSecond };
