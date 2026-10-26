// SPDX-License-Identifier: GPL-3.0-or-later
// The Guide (Home / PS / Xbox) button: a quick press and a long hold do different things,
// which ones being a setting (Settings > Controller > Guide button). Pure logic: the main
// process feeds button down/up events from every controller; this decides what they mean.
'use strict';

const BTN_MODE = 0x13c; // Linux evdev code of the Guide button on every common controller
const HOLD_MS = 600;
// mode -> [what a press does, what a hold does]
const MODES = Object.freeze({
  'menu-home': ['menu', 'home'],   // press opens the guide, hold goes Home (the default)
  'home-menu': ['home', 'menu'],   // press goes Home, hold opens the guide
  menu: ['menu', 'menu'],          // the guide either way
});

function actionsFor(mode) { return MODES[mode] || MODES['menu-home']; }

function createGuideButton({
  onAction = () => {},
  mode = () => 'menu-home',
  holdMs = HOLD_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const held = new Set(); // which controllers have it down right now
  let timer = null;
  let firedHold = false;

  function down(source) {
    if (held.has(source)) return; // key repeat, or a second pad already holding it
    held.add(source);
    if (held.size > 1) return; // one gesture at a time
    firedHold = false;
    if (timer !== null) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      timer = null;
      if (!held.size) return;
      firedHold = true;
      onAction(actionsFor(mode())[1], 'hold');
    }, holdMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function up(source) {
    if (!held.delete(source) || held.size) return;
    if (timer !== null) { clearTimeoutFn(timer); timer = null; }
    if (!firedHold) onAction(actionsFor(mode())[0], 'press');
    firedHold = false;
  }

  // A controller went away mid-press: forget it without acting.
  function drop(source) {
    if (!held.delete(source) || held.size) return;
    if (timer !== null) { clearTimeoutFn(timer); timer = null; }
    firedHold = false;
  }

  return { down, up, drop };
}

module.exports = { BTN_MODE, HOLD_MS, MODES, actionsFor, createGuideButton };
