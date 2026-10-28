(function () {
'use strict';
// Tessera's one input system: what a controller button means.
//
// Every way in (the launcher page's controller loop, Nintendo controllers read by pads.js, the
// browser's controller handling in the main process) asks here, so a choice like "on Nintendo
// controllers, A confirms" means the same thing everywhere.
//
// Buttons are Standard Gamepad API positions (0 bottom, 1 right, 2 left, 3 top, 4 LB, 5 RB, 6 LT,
// 7 RT, 8 View, 9 Menu, 10 left stick, 11 right stick, 12-15 D-pad, 16 Guide). A "role" is the
// position whose job a button does: role 0 confirms, role 1 goes back, and so on. Tessera's
// long-standing rule (the default) is positional: the bottom face button confirms on every
// controller. The one other profile, for Nintendo controllers, follows the printed letters: A (on
// the right) confirms and B (at the bottom) goes back, with X and Y swapped to match.
//
// Pure data and helpers: used by the page (window.TesseraInputActions) and the main process
// (require), and by node:test.

const ACTIONS = ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'lb', 'rb', 'guide'];
const ACTION_OF_ROLE = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'guide' };
const ROLE_OF_ACTION = Object.fromEntries(Object.entries(ACTION_OF_ROLE).map(([r, a]) => [a, Number(r)]));

// Settings > Controller > "Confirm button": 'position' (bottom confirms, every controller; the
// default) or 'label' (Nintendo controllers follow their printed A/B/X/Y).
const CONFIRM_CHOICES = ['position', 'label'];
const NINTENDO_LABEL_SWAP = { 0: 1, 1: 0, 2: 3, 3: 2 };

// Who made a controller, from its Gamepad API id (USB vendor id, then the name).
function familyOf(id) {
  const s = String(id || '');
  const v = /vendor:\s*([0-9a-f]{4})/i.exec(s);
  const ven = v ? v[1].toLowerCase() : '';
  if (ven === '054c' || /dualsense|dualshock|playstation|sony/i.test(s)) return 'playstation';
  if (ven === '057e' || /nintendo|joy-?con|switch|pro controller/i.test(s)) return 'nintendo';
  return 'xbox';
}

// Whether this controller's face buttons trade places under this setting.
const swaps = (family, confirm) => family === 'nintendo' && confirm === 'label';

// The physical button that does `role`'s job (and the other way round: the swap is its own inverse).
function physicalFor(role, swap) {
  return swap && Object.prototype.hasOwnProperty.call(NINTENDO_LABEL_SWAP, role) ? NINTENDO_LABEL_SWAP[role] : role;
}
const roleOf = physicalFor;

// A pressed-buttons bit mask (bit n = physical button n), as roles.
function roleBits(bits, swap) {
  if (!swap) return bits;
  let out = bits & ~0xf;
  for (const [from, to] of Object.entries(NINTENDO_LABEL_SWAP)) if (bits & (1 << Number(from))) out |= 1 << to;
  return out;
}

// The action a physical button does, or null.
const actionFor = (physical, swap) => ACTION_OF_ROLE[roleOf(physical, swap)] || null;
// The physical button that does an action, or null.
const buttonFor = (action, swap) => (Object.prototype.hasOwnProperty.call(ROLE_OF_ACTION, action) ? physicalFor(ROLE_OF_ACTION[action], swap) : null);


// ---------------------------------------------------------------- holding a direction
// Keep keyboard-like navigation moving while a direction is held. Linux gamepad
// devices do not reliably generate EV_KEY repeats, and sticks report only when
// their position changes. The most recently engaged input wins; releasing it
// resumes an older held direction, which makes D-pad/stick handoffs predictable.
function createDirectionRepeater({
  onAction = () => {},
  initialDelay = 350,
  repeatInterval = 90,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const held = new Map();
  let sequence = 0;
  let active = '';
  let timer = null;
  let disposed = false;

  const stopTimer = () => {
    if (timer !== null) clearTimeoutFn(timer);
    timer = null;
  };
  const current = () => {
    let winner = null;
    for (const entry of held.values()) {
      if (!winner || entry.order > winner.order) winner = entry;
    }
    return winner ? winner.key : '';
  };
  const schedule = (delay) => {
    if (!active || disposed) return;
    timer = setTimeoutFn(() => {
      timer = null;
      if (!active || disposed) return;
      onAction(active);
      schedule(repeatInterval);
    }, delay);
    // Unref normal timers so a disconnected controller cannot keep the launcher alive.
    if (timer && typeof timer.unref === 'function') timer.unref();
  };
  const update = (source, key) => {
    if (disposed || typeof source !== 'string' || !source) return;
    const old = held.get(source);
    if (key) {
      if (old && old.key === key) return;
      held.set(source, { key, order: ++sequence });
    } else if (!old) {
      return;
    } else {
      held.delete(source);
    }
    const next = current();
    if (next === active) return;
    stopTimer();
    active = next;
    if (active) {
      onAction(active);
      schedule(initialDelay);
    }
  };

  return {
    set: update,
    clear() { held.clear(); active = ''; stopTimer(); },
    dispose() { disposed = true; held.clear(); active = ''; stopTimer(); },
  };
}

// How fast a held direction repeats (Settings > Controller > Repeat speed): [first pause, then every], in ms.
// "standard" is what each has always done: the launcher steps every 200 ms, the browser starts after
// 350 ms and then scrolls through links quickly.
const REPEAT_SPEEDS = {
  slow: { launcher: [300, 300], browser: [450, 150] },
  standard: { launcher: [200, 200], browser: [350, 90] },
  fast: { launcher: [200, 110], browser: [250, 60] },
};
const REPEAT_CHOICES = Object.keys(REPEAT_SPEEDS);
const repeatTiming = (speed, where) => {
  const t = (REPEAT_SPEEDS[speed] || REPEAT_SPEEDS.standard)[where === 'browser' ? 'browser' : 'launcher'];
  return { initialDelay: t[0], repeatInterval: t[1] };
};

const inputActions = { ACTIONS, ACTION_OF_ROLE, ROLE_OF_ACTION, CONFIRM_CHOICES, familyOf, swaps, physicalFor, roleOf, roleBits, actionFor, buttonFor, createDirectionRepeater, REPEAT_SPEEDS, REPEAT_CHOICES, repeatTiming };
if (typeof module !== 'undefined' && module.exports) module.exports = inputActions;
if (typeof window !== 'undefined') window.TesseraInputActions = inputActions;
})();
