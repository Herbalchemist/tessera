(function () {
'use strict';
// Keyboard bindings for the console UI. Pure data and helpers, shared by the main
// process (which validates and stores them) and the renderer (which looks keys up).
//
// Keys are stored by KeyboardEvent.code, the physical position, so a binding keeps
// working whatever layout (QWERTY, AZERTY, Dvorak…) the keyboard is set to. Labels
// are worked out separately, from the layout when the browser can tell us.

const ACTIONS = ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'lb', 'rb', 'guide'];
const ACTION_LABELS = {
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  a: 'Select', b: 'Back', x: 'X action', y: 'Options', lb: 'Previous tab', rb: 'Next tab', guide: 'Guide',
};
const MAX_PER_ACTION = 4;

// Presets: the arrows always work; each preset adds keys for a different hand position.
const PRESETS = {
  standard: {
    up: ['ArrowUp', 'Numpad8'], down: ['ArrowDown', 'Numpad2'], left: ['ArrowLeft', 'Numpad4'], right: ['ArrowRight', 'Numpad6'],
    a: ['Enter', 'NumpadEnter', 'Space'], b: ['Escape', 'Backspace', 'BrowserBack'],
    x: ['KeyX'], y: ['KeyY', 'ContextMenu'], lb: ['PageUp', 'BracketLeft'], rb: ['PageDown', 'BracketRight'],
    guide: ['F1', 'Home', 'BrowserHome'],
  },
  // Gaming hand: WASD to move, Q/E for tabs, Space/F to pick, R/Tab for options.
  wasd: {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    a: ['Space', 'Enter', 'KeyF', 'NumpadEnter'], b: ['Escape', 'Backspace', 'BrowserBack'],
    x: ['KeyX'], y: ['KeyR', 'ContextMenu'], lb: ['KeyQ', 'PageUp'], rb: ['KeyE', 'PageDown'],
    guide: ['F1', 'Home', 'BrowserHome'],
  },
  // Home row, for people who live in vim: H J K L.
  vim: {
    up: ['KeyK', 'ArrowUp'], down: ['KeyJ', 'ArrowDown'], left: ['KeyH', 'ArrowLeft'], right: ['KeyL', 'ArrowRight'],
    a: ['Enter', 'Space', 'NumpadEnter'], b: ['Escape', 'Backspace', 'BrowserBack'],
    x: ['KeyX'], y: ['KeyO', 'ContextMenu'], lb: ['KeyU', 'PageUp'], rb: ['KeyI', 'PageDown'],
    guide: ['F1', 'Home', 'BrowserHome'],
  },
  // TV remotes and media keyboards: arrows, OK, Back, Home, Menu, channel keys.
  remote: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    a: ['Enter', 'NumpadEnter', 'MediaPlayPause'], b: ['BrowserBack', 'Escape', 'Backspace'],
    x: ['BrowserSearch', 'KeyX'], y: ['ContextMenu', 'KeyY'], lb: ['PageUp', 'MediaTrackPrevious'], rb: ['PageDown', 'MediaTrackNext'],
    guide: ['BrowserHome', 'Home', 'F1'],
  },
};
const PRESET_NAMES = { standard: 'Standard (arrows)', wasd: 'WASD (gaming)', vim: 'H J K L (vim)', remote: 'TV remote / media keys' };

// Keys that never get bound: they belong to the system or to typing modifiers.
const RESERVED = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'OSLeft', 'OSRight', 'Power', 'Sleep', 'WakeUp',
  'AudioVolumeUp', 'AudioVolumeDown', 'AudioVolumeMute', 'PrintScreen',
]);
const CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,30}$/;
const validCode = (c) => typeof c === 'string' && CODE_RE.test(c) && !RESERVED.has(c);

// A clean copy of a bindings object: known actions only, valid codes only, each code
// bound to one action at most (first wins), and every action keeps at least one key.
function normalize(input, preset) {
  const base = PRESETS[preset] || PRESETS.standard;
  const out = {};
  const used = new Set();
  const src = input && typeof input === 'object' ? input : {};
  for (const a of ACTIONS) {
    const list = Array.isArray(src[a]) ? src[a] : base[a];
    out[a] = [];
    for (const c of list) {
      if (!validCode(c) || used.has(c) || out[a].length >= MAX_PER_ACTION) continue;
      used.add(c);
      out[a].push(c);
    }
  }
  // An action left with nothing gets its preset keys back, where they're still free.
  for (const a of ACTIONS) {
    if (out[a].length) continue;
    for (const c of base[a]) if (!used.has(c)) { used.add(c); out[a].push(c); }
  }
  return out;
}

// code -> action
function lookup(bindings) {
  const m = new Map();
  for (const a of ACTIONS) for (const c of (bindings && bindings[a]) || []) if (!m.has(c)) m.set(c, a);
  return m;
}

// Put `code` on `action`: as its main key (first in the list), taking it off any other action.
function bind(bindings, action, code, preset) {
  if (!ACTIONS.includes(action) || !validCode(code)) return null;
  const next = {};
  for (const a of ACTIONS) next[a] = ((bindings && bindings[a]) || []).filter((c) => c !== code);
  next[action] = [code, ...next[action]].slice(0, MAX_PER_ACTION);
  return normalize(next, preset);
}

const NAMED = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab',
  PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins', Delete: 'Del',
  ContextMenu: 'Menu', BrowserBack: 'Back', BrowserForward: 'Forward', BrowserHome: 'Home', BrowserSearch: 'Search',
  BrowserRefresh: 'Refresh', BrowserFavorites: 'Favorites', MediaPlayPause: 'Play/Pause', MediaStop: 'Stop',
  MediaTrackNext: 'Next', MediaTrackPrevious: 'Previous', LaunchApp1: 'App 1', LaunchApp2: 'App 2',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Backslash: '\\', Backquote: '`', Minus: '-', Equal: '=', IntlBackslash: '\\',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
};
// A short label for a key. `layout` is an optional Map from navigator.keyboard.getLayoutMap(),
// so on an AZERTY keyboard KeyQ reads "A", which is what's printed on it.
function label(code, layout) {
  if (!code) return '';
  if (layout && typeof layout.get === 'function' && /^(Key|Digit|Bracket|Semicolon|Quote|Comma|Period|Slash|Backslash|Backquote|Minus|Equal|IntlBackslash)/.test(code)) {
    const ch = layout.get(code);
    if (ch && ch.trim()) return ch.length === 1 ? ch.toUpperCase() : ch;
  }
  if (NAMED[code]) return NAMED[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Num ${m[1]}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return code.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

const keyboardMap = { ACTIONS, ACTION_LABELS, PRESETS, PRESET_NAMES, MAX_PER_ACTION, validCode, normalize, lookup, bind, label };
if (typeof module !== 'undefined' && module.exports) module.exports = keyboardMap;
if (typeof window !== 'undefined') window.TesseraKeyboardMap = keyboardMap;
})();
