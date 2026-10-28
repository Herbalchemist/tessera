// SPDX-License-Identifier: GPL-3.0-or-later
// Settings from the main process, keyboard & mouse hints, screen size and the active theme.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// --------------------------------------------------------------- settings

const KEY_ACTIONS = [
  { id: 'shift', label: 'Shift (capital letters)' },
  { id: 'space', label: 'Space' },
  { id: 'back', label: 'Delete' },
  { id: 'done', label: 'Done' },
  { id: 'cancel', label: 'Cancel' },
];
const BUTTON_NAMES = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
  8: 'View', 9: 'Menu', 10: 'L3', 11: 'R3', 16: 'Guide',
};
// Button labels follow the controller family the person picked (Settings → Controller).
const GLYPH_SETS = {
  xbox: BUTTON_NAMES,
  playstation: { 0: '✕', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'Create', 9: 'Options', 10: 'L3', 11: 'R3', 16: 'PS' },
  nintendo: { 0: 'B', 1: 'A', 2: 'Y', 3: 'X', 4: 'L', 5: 'R', 6: 'ZL', 7: 'ZR', 8: '−', 9: '+', 10: 'LS', 11: 'RS', 16: 'Home' },
  // One Joy-Con on its own, held sideways (rail up, stick on the left): its buttons turn with it.
  // Right Joy-Con: A is now at the bottom, X on the right, B on the left, Y on top.
  jr: { 0: 'A', 1: 'X', 2: 'B', 3: 'Y', 4: 'SL', 5: 'SR', 6: 'R', 7: 'ZR', 9: '+', 10: 'RS', 16: 'Home' },
  // Left Joy-Con: its arrow buttons are the face buttons, pointing the way they now face.
  jl: { 0: '▼', 1: '▶', 2: '◀', 3: '▲', 4: 'SL', 5: 'SR', 6: 'L', 7: 'ZL', 9: '−', 10: 'LS', 16: 'Capture' },
};
const PAD_DEFAULTS = { deadzone: 15, trigger: 8, rumble: 'normal', style: 'split', glyphs: 'auto', joycons: 'together', confirm: 'position', repeat: 'standard', browserCursor: 'right', cursorSpeed: 50, scrollSpeed: 50, guideButton: 'menu-home', guideDesktop: 'auto', guideStyle: 'side', oskSize: 'dock', remap: {} };
const KB_DEFAULTS = { preset: 'standard', hints: 'auto', mouseHide: 3, wheel: 'move', bindings: null };
let prefs = { pad: { ...PAD_DEFAULTS }, kb: { ...KB_DEFAULTS }, calib: {}, theme: null, pageGrid: {}, pin: { set: false, browser: true, firstRun: false, unlocked: true }, vault: '~/Tessera', storage: { low: [] }, calibration: { cal: null } };
// "Automatic" looks at who made the connected controller (USB vendor id, then the name).
// What each button means comes from the one input system (input-actions.js).
const IA = window.TesseraInputActions;
const detectFamily = (id) => IA.familyOf(id);
// How the controller in use is read: by position, Nintendo letters ("A confirms"), or its family's
// remap from Settings > Button mapping (input-actions.js).
// (Menus can open while the page is still loading, before input.js has defined activePad.)
const padInUse = () => (typeof activePad === 'function' ? activePad() : null);
// A Joy-Con held sideways on its own is its own kind: read by position, as the Switch does, so
// the Nintendo "A confirms" setting and Nintendo remaps leave it alone.
const sidewaysKind = (p) => (p && p.tessera && p.info && p.info.sideways ? p.info.kind : '');
const padFamilyOf = (p) => (sidewaysKind(p) ? 'sideways' : detectFamily(p ? p.id : ''));
const padMap = (p = padInUse()) => IA.mapFor(padFamilyOf(p), prefs.pad);
const glyphSet = () => {
  let g = prefs.pad.glyphs;
  const p = padInUse();
  if (g === 'auto' || g === 'nintendo') { const side = sidewaysKind(p); if (side) return GLYPH_SETS[side]; }
  if (g === 'auto') g = detectFamily(p ? p.id : '');
  return GLYPH_SETS[g] || BUTTON_NAMES;
};
const glyph = (n) => glyphSet()[n];
const buttonName = (n) => glyph(n) || `Button ${n}`; // physical button n
// The label of the button that does role n's job ("press A to open" names the button that opens).
const roleName = (n) => buttonName(IA.physicalFor(n, padMap()));
// ---- keyboard & mouse
// Keys are looked up by KeyboardEvent.code (the key's position), so bindings survive a
// change of keyboard layout; labels come from the layout when Chromium can tell us.
const KBM = window.TesseraKeyboardMap;
let kbLayout = null;
try {
  if (navigator.keyboard && navigator.keyboard.getLayoutMap) navigator.keyboard.getLayoutMap().then((m) => { kbLayout = m; applyGlyphs(); }).catch(() => {});
} catch { /* no layout map: fall back to the built-in names */ }
const kbBindings = () => KBM.normalize(prefs.kb && prefs.kb.bindings, prefs.kb && prefs.kb.preset);
let kbIndex = KBM.lookup(kbBindings());
const keyLabel = (code) => KBM.label(code, kbLayout);
const actionKeys = (act) => (kbBindings()[act] || []).map(keyLabel);
function kbRefresh() { kbIndex = KBM.lookup(kbBindings()); applyGlyphs(); }

// What the person last touched: 'pad', 'keyboard' or 'mouse'. Button hints follow it
// (unless Settings > Keyboard & mouse pins them), so a keyboard shows PgUp / PgDn, not LB / RB.
let inputMode = 'pad';
function hintMode() {
  const h = (prefs.kb && prefs.kb.hints) || 'auto';
  if (h === 'controller') return 'pad';
  if (h === 'keyboard') return inputMode === 'mouse' ? 'mouse' : 'keyboard';
  return inputMode;
}
function setInputMode(m) {
  if (m === inputMode) return;
  const before = hintMode();
  inputMode = m;
  if (hintMode() === before) return;
  applyGlyphs();
  if (modal && (modal.kind === 'keys' || modal.kind === 'cal' || modal.kind === 'tour')) renderModal();
  else if (!modal && (hoverId === 'new' || hoverId === 'browser') && typeof update === 'function') update(); // "Press A to…" under those tabs
}
const ROLE_ACTION = IA.ACTION_OF_ROLE;
// The name to show in a hint for controller button n, in whatever the person is using.
function hintName(n) {
  const m = hintMode();
  if (m === 'pad') return roleName(n);
  if (m === 'mouse' && n === 0) return 'Click';
  if (m === 'mouse' && n === 1) return 'Right-click';
  const a = ROLE_ACTION[n];
  const k = a ? actionKeys(a)[0] : '';
  return k || roleName(n);
}
// "Press Enter" / "Press A", or just "Click" for the mouse.
const pressTo = (n) => (hintMode() === 'mouse' && n <= 1 ? hintName(n) : `Press ${hintName(n)}`);
function applyGlyphs() {
  const m = hintMode();
  document.body.classList.toggle('hint-keys', m !== 'pad');
  document.body.dataset.input = m;
  for (const el of document.querySelectorAll('[data-g]')) {
    const ids = el.dataset.g.split(',').map(Number);
    el.textContent = ids.length === 1 ? hintName(ids[0]) : ids[0] === 8 ? `Hold ${roleName(8)} + ${roleName(9)}` : ids.map(hintName).join(' / ');
  }
}

// ------------------------------------------------------- screen + theme
// --auto follows the resolution, so the same layout reads right on a 720p
// handheld and a 4K TV. The person's own scale choices sit on top of it.
function fitScreen() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  document.documentElement.style.setProperty('--auto', Math.min(2.5, Math.max(0.6, s)).toFixed(3));
}
window.addEventListener('resize', () => { fitScreen(); if (modal && modal.kind === 'tour') setTimeout(() => { if (modal && modal.kind === 'tour') renderModal(); }, 50); });
fitScreen();

let appliedVars = new Set();
let imageRev = null;
// Shells are named, built-in arrangements rather than theme-supplied markup. The
// pure helper is also used by node:test, keeping custom theme JSON values harmless.
function shellLayoutOf(theme) {
  const setting = theme && Array.isArray(theme.settings) && theme.settings.find((s) => s.id === 'shellLayout');
  const helper = window.TesseraShellLayout;
  return helper ? helper.normalize(setting && setting.value) : 'classic';
}
// The layout parts in effect: the arrangement's own, with any part picked on its own on top.
const PART_SETTING = { nav: 'partNav', tabs: 'partTabs', clock: 'partClock', frame: 'partFrame', title: 'partTitle', tile: 'partTile', size: 'partSize', row: 'partRow', card: 'partCard', spot: 'partSpot', emblem: 'partEmblem', hints: 'partHints' };
function layoutPartsOf(theme) {
  const helper = window.TesseraShellLayout;
  const picks = {};
  for (const [part, id] of Object.entries(PART_SETTING)) {
    const s = theme && Array.isArray(theme.settings) && theme.settings.find((x) => x.id === id);
    if (s) picks[part] = s.value;
  }
  return helper ? helper.resolveParts(shellLayoutOf(theme), picks) : { nav: 'top', tabs: 'pills', clock: 'off', frame: 'glow', title: 'below', tile: 'portrait', size: 'medium', row: 'center', card: 'standard', spot: 'off', emblem: 'none', hints: 'center' };
}
function applyLayoutParts(theme) {
  const parts = layoutPartsOf(theme);
  for (const [k, v] of Object.entries(parts)) document.body.dataset[k === 'nav' ? 'nav' : 'part' + k[0].toUpperCase() + k.slice(1)] = v;
  return parts;
}
function shellLayoutInfo() {
  const helper = window.TesseraShellLayout;
  const nav = layoutPartsOf(prefs.theme).nav;
  return helper ? { id: shellLayoutOf(prefs.theme), ...helper.handoffs(nav) } : { id: 'classic', navigation: 'horizontal', contentEntry: 'down', contentExit: 'up' };
}
// How bright a color is, 0 (black) to 1 (white).
function lumOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
// Dark or white text, whichever reads better on this color (WCAG contrast).
function onColor(hex) {
  const lum = lumOf(hex);
  return (lum + 0.05) / 0.057 >= 1.05 / (lum + 0.05) ? '#10151c' : '#ffffff';
}

// ---- selector glow. A theme can ask for a new random pastel glow every time the
// selector lands somewhere new (a tile, a tab, a menu row, a key). Only the glow
// around the selection takes the color: fills stay the theme's own. The color is
// set on the selected element only, so nothing else on screen changes.
let selOn = false;       // the theme asked for it
let selTone = 'light';   // 'dark' themes get a slightly deeper pastel
let selSig = '';         // what was selected last time
let selNow = null;       // { glow, ring }: the glow the selection has now (glow = the soft light, ring = the outline)
let selBack = null;      // the glow a tile had before a menu opened over it
let selHue = null;       // the hue of the last pick
// OKLCH to linear RGB (a channel outside 0..1 means the screen can't show that color).
function oklchRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);
// OKLCH to a hex color. If the color doesn't exist on screen, take some chroma off until it does.
function oklchHex(L, C, hDeg) {
  const enc = (v) => { const x = Math.min(1, Math.max(0, v)); return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)); };
  for (let k = 0; k < 14; k++) {
    const rgb = oklchRgb(L, C, hDeg);
    if (inGamut(rgb)) return '#' + rgb.map((v) => enc(v).toString(16).padStart(2, '0')).join('');
    C *= 0.92;
  }
  return '#' + enc(L).toString(16).padStart(2, '0').repeat(3);
}
// The most color a screen can show at this lightness and hue.
function maxChroma(L, hDeg) {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchRgb(L, mid, hDeg))) lo = mid; else hi = mid;
  }
  return lo;
}
// A fresh random pastel: any hue at random, no palette and no cycle. The one rule is that it is never
// nearly the same hue as the pick just before it, so a move always shows.
function nextPastel(tone) {
  let hue = Math.random() * 360;
  for (let i = 0; selHue !== null && i < 20; i++) {
    const d = Math.abs(hue - selHue) % 360;
    if (Math.min(d, 360 - d) >= 25) break;
    hue = Math.random() * 360;
  }
  selHue = hue;
  const dark = tone === 'dark';
  // Every hue comes out equally soft, so none turns neon: yellows are made lighter (they go mustard when dark),
  // cyan is softened, and the color never goes past what the screen can show.
  const yellow = Math.max(0, Math.cos(((hue - 100) * Math.PI) / 180));
  const cyan = Math.max(0, Math.cos(((hue - 195) * Math.PI) / 180)) ** 2;
  const L = (dark ? 0.81 : 0.82) + (dark ? 0.06 : 0.075) * yellow ** 2 + (Math.random() - 0.5) * 0.04;
  const C = Math.min((dark ? 0.10 : 0.125) * (1 - 0.3 * cyan) * (0.92 + Math.random() * 0.16), 0.92 * maxChroma(L, hue));
  const glow = oklchHex(L, C, hue);
  if (dark) return { glow, ring: glow };
  // On a light page the outline is a touch deeper than the glow so it stays visible (less so for yellows).
  return { glow, ring: oklchHex(L - 0.045 * (1 - 0.85 * yellow), C + 0.02, hue) };
}
const modalIds = new WeakMap();
let modalSeq = 0;
const modalId = () => { if (!modalIds.has(modal)) modalIds.set(modal, ++modalSeq); return modalIds.get(modal); };
function selectionTarget() {
  if (modal) {
    if (modal.kind === 'list') return { el: modalEl.querySelector('.mitem.active'), sig: `m|${modalId()}|${modal.index}` };
    if (modal.kind === 'keys') return { el: modalEl.querySelector('.key.active'), sig: `k|${modalId()}|${modal.r}|${modal.c}` };
    return null;
  }
  if (focus === 'tabs') return { el: tabsEl.querySelector('.tab.focused'), sig: `t|${hoverId}` };
  const c = cur();
  const row = selectedRow();
  return { el: (homeMode() ? canvasEl : rowsEl).querySelector('.card.active'), sig: `c|${curKey()}|${c.row}|${row ? c.cols[row.id] || 0 : 0}` };
}
// Called whenever the selection may have moved. A new place gets a new random glow; the same place keeps its own.
function paintSelection() {
  if (!selOn) return;
  const t = selectionTarget();
  if (!t || !t.el) return;
  if (t.sig !== selSig || !selNow) {
    const wasMenu = /^[mk]\|/.test(selSig);
    const isMenu = /^[mk]\|/.test(t.sig);
    if (!isMenu) selBack = null;
    if (isMenu && !wasMenu && selNow) selBack = { sig: selSig, color: selNow }; // a menu opened over a tile: remember its glow
    selNow = !isMenu && selBack && selBack.sig === t.sig ? selBack.color : nextPastel(selTone);
    selSig = t.sig;
  }
  if (t.el.dataset.glow !== selNow.glow) {
    t.el.style.setProperty('--glow', selNow.glow);
    t.el.style.setProperty('--glow-ring', selNow.ring);
    t.el.dataset.glow = selNow.glow;
  }
}
let layoutReady = false;
let layoutSig = '';
function applyTheme(t) {
  if (!t || !Array.isArray(t.settings)) return;
  prefs.theme = t;
  document.body.dataset.shellLayout = shellLayoutOf(t);
  applyLayoutParts(t);
  const fx = t.settings.find((s) => s.id === 'backdrop');
  document.body.dataset.fx = fx ? fx.value : 'none';
  const bgs = t.settings.find((s) => s.id === 'bg');
  document.body.dataset.tone = selTone = bgs && /^#[0-9a-f]{6}$/i.test(bgs.value) && lumOf(bgs.value) < 0.3 ? 'dark' : 'light';
  const sc = t.settings.find((s) => s.id === 'selColor');
  selOn = Boolean(sc && sc.value === 'pastel');
  document.body.dataset.sel = selOn ? 'pastel' : 'accent';
  if (!selOn) {
    selSig = ''; selNow = null; selBack = null; selHue = null;
    // leaving a pastel theme: give every element its normal glow back
    for (const el of document.querySelectorAll('[data-glow]')) {
      for (const v of ['--glow', '--glow-ring']) el.style.removeProperty(v);
      delete el.dataset.glow;
    }
    for (const w of document.querySelectorAll('.row.off')) w.classList.remove('off');
  }
  const wgs = t.settings.find((s) => s.id === 'widgetStyle');
  document.body.dataset.wg = wgs && ['glass', 'frosted', 'outline', 'solid'].includes(wgs.value) ? wgs.value : 'frosted';
  const root = document.documentElement;
  const now = new Set();
  let dim = 0;
  let hasPicture = false;
  for (const s of t.settings) {
    if (s.id === 'accent' && /^#[0-9a-f]{6}$/i.test(s.value)) {
      root.style.setProperty('--on-accent', onColor(s.value));
    }
    if (s.id === 'confirm' && /^#[0-9a-f]{6}$/i.test(s.value)) root.style.setProperty('--on-ok', onColor(s.value));
    if (s.id === 'cancel' && /^#[0-9a-f]{6}$/i.test(s.value)) root.style.setProperty('--on-danger', onColor(s.value));
    if (s.id === 'bgDim') dim = s.value * (s.scale || 1);
    if (!s.var) continue;
    let v;
    if (s.type === 'image') { hasPicture = Boolean(s.value); continue; }
    if (s.type === 'range') v = s.scale && s.scale !== 1 ? String(+(s.value * s.scale).toFixed(4)) : s.value + (s.unit || '');
    else if (s.type === 'toggle') v = s.value ? s.on : s.off;
    else v = String(s.value);
    root.style.setProperty(s.var, v);
    now.add(s.var);
  }
  for (const v of appliedVars) if (!now.has(v) && v !== '--bg-image') root.style.removeProperty(v);
  appliedVars = now;
  const sig = JSON.stringify(layoutCfg());
  if (sig !== layoutSig) {
    layoutSig = sig;
    if (layoutReady) { sizeGrid(); render(); }
  }
  root.style.setProperty('--bg-dim-on', hasPicture ? String(dim) : '0');
  const img = t.settings.find((s) => s.type === 'image' && s.var);
  if (!img || !hasPicture) {
    root.style.setProperty('--bg-image', 'none');
    imageRev = null;
  } else if (imageRev !== t.rev + ':' + t.active) {
    imageRev = t.rev + ':' + t.active;
    api.settings('themeImage', { id: img.id }).then((r) => {
      if (r && r.dataUrl) root.style.setProperty(img.var, `url("${r.dataUrl}")`);
      else {
        root.style.setProperty(img.var, 'none');
        if (r && r.error) setStatus(r.error, true);
      }
    });
  }
}
function applyPrefs(p) {
  if (!p) return;
  prefs.pad = { ...PAD_DEFAULTS, ...(p.pad || {}) };
  prefs.kb = { ...KB_DEFAULTS, ...(p.kb || {}) };
  prefs.live = Boolean(p.live);
  kbIndex = KBM.lookup(kbBindings());
  prefs.calib = p.calib || {};
  prefs.pageGrid = p.pageGrid || {};
  if (p.pin) prefs.pin = p.pin;
  if (p.vault) prefs.vault = p.vault;
  if (p.storage) prefs.storage = p.storage;
  if (p.calibration) { prefs.calibration = p.calibration; if (!(modal && modal.kind === 'cal')) applySavedCalibration(); }
  applyGlyphs();
  applyTheme(p.theme);
}
// Stick value after this controller's resting-offset fix and the deadzone.
const padKey = (pad) => pad.id.slice(0, 80);
function axisValue(pad, i) {
  const off = (prefs.calib[padKey(pad)] || [])[i] || 0;
  const v = (pad.axes[i] || 0) - off;
  const dz = prefs.pad.deadzone / 100;
  const a = Math.abs(v);
  return a < dz ? 0 : Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}
const triggerValue = (pad, n) => {
  const v = pad.buttons[n] ? pad.buttons[n].value : 0;
  return v * 100 < prefs.pad.trigger ? 0 : v;
};
const BUTTON_NAMES_BY_ROLE = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb' };
const RESERVED_BUTTONS = [0, 12, 13, 14, 15];
let keymap = { back: 2, space: 3, shift: 10, done: 9, cancel: 1 }; // delete X, space Y, shift L3, done Menu, cancel B

// Icons on the Settings tiles: simple line drawings in the theme's highlight color. Each has a small
// motion ("anim") that plays only on the selected tile, and only with Animations on and Icons set to
// Animated. Parts with a class a1..a4 are what moves. Drawn with the DOM: no markup strings, no files.
const ICONS = {
  wifi: { anim: 'seq', parts: [['path', { d: 'M8.5 15.5a5 5 0 0 1 7 0', class: 'a1' }], ['path', { d: 'M5.5 12.2a9.5 9.5 0 0 1 13 0', class: 'a2' }], ['path', { d: 'M2.5 8.9a14 14 0 0 1 19 0', class: 'a3' }], ['circle', { cx: 12, cy: 19, r: 1.3, class: 'dot' }]] },
  bluetooth: { anim: 'seq', parts: [['path', { d: 'M7 7.5l10 9-5 4.5V3l5 4.5-10 9' }], ['circle', { cx: 3.5, cy: 12, r: 1.1, class: 'dot a1' }], ['circle', { cx: 20.5, cy: 12, r: 1.1, class: 'dot a2' }]] },
  sound: { anim: 'seq', parts: [['path', { d: 'M3.5 9.5h3.5L11.5 6v12L7 14.5H3.5z' }], ['path', { d: 'M15 9.5a3.5 3.5 0 0 1 0 5', class: 'a1' }], ['path', { d: 'M17.5 7a7 7 0 0 1 0 10', class: 'a2' }], ['path', { d: 'M20 4.5a10.5 10.5 0 0 1 0 15', class: 'a3' }]] },
  pad: { anim: 'seq', parts: [['path', { d: 'M7 8h10a4 4 0 0 1 3.9 3.1l1 4.6a2.4 2.4 0 0 1-4.3 1.9L16 16H8l-1.6 1.6a2.4 2.4 0 0 1-4.3-1.9l1-4.6A4 4 0 0 1 7 8z' }], ['path', { d: 'M8 10.6v3.4M6.3 12.3h3.4' }], ['circle', { cx: 15.6, cy: 11.4, r: 0.9, class: 'dot a1' }], ['circle', { cx: 17.6, cy: 13.3, r: 0.9, class: 'dot a2' }]] },
  keyboard: { anim: 'press', parts: [['rect', { x: 2.5, y: 6, width: 19, height: 12, rx: 2 }], ['path', { d: 'M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01', class: 'a1' }], ['path', { d: 'M7.5 12.5h.01M10.5 12.5h.01M13.5 12.5h.01M16.5 12.5h.01', class: 'a2' }], ['path', { d: 'M8 15.3h8', class: 'a3' }]] },
  controls: { anim: 'press', parts: [['rect', { x: 3, y: 5, width: 5, height: 5, rx: 1.3, class: 'a1' }], ['rect', { x: 9.5, y: 5, width: 5, height: 5, rx: 1.3, class: 'a2' }], ['rect', { x: 16, y: 5, width: 5, height: 5, rx: 1.3, class: 'a3' }], ['rect', { x: 3, y: 13, width: 18, height: 5.5, rx: 1.3 }]] },
  theme: { anim: 'pop', parts: [['path', { d: 'M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z' }], ['circle', { cx: 7.5, cy: 11, r: 1.2, class: 'dot a1' }], ['circle', { cx: 9.5, cy: 7, r: 1.2, class: 'dot a2' }], ['circle', { cx: 14.5, cy: 7, r: 1.2, class: 'dot a3' }], ['circle', { cx: 17.2, cy: 10.6, r: 1.2, class: 'dot a4' }]] },
  profiles: { anim: 'pop', parts: [['circle', { cx: 16, cy: 7.5, r: 2.2, class: 'a2' }], ['path', { d: 'M12.3 19c.3-2.8 2.1-4.6 4.2-4.6s3.9 1.8 4.2 4.6', class: 'a2' }], ['circle', { cx: 8.5, cy: 8.5, r: 2.6, class: 'a1' }], ['path', { d: 'M3.5 19c0-3.3 2.2-5.5 5-5.5s5 2.2 5 5.5', class: 'a1' }]] },
  display: { anim: 'draw', parts: [['rect', { x: 3, y: 4, width: 18, height: 12.5, rx: 2 }], ['path', { d: 'M9 20.5h6M12 16.5v4' }], ['path', { d: 'M6 13l3.2-3.2 2.6 2.6 2.2-2.2L17.8 14', class: 'a1', pathLength: 1 }]] },
  storage: { anim: 'seq', parts: [['rect', { x: 3, y: 4.5, width: 18, height: 6.5, rx: 2 }], ['rect', { x: 3, y: 13, width: 18, height: 6.5, rx: 2 }], ['circle', { cx: 17, cy: 7.75, r: 1, class: 'dot a1' }], ['circle', { cx: 17, cy: 16.25, r: 1, class: 'dot a2' }], ['path', { d: 'M6.5 7.75h5M6.5 16.25h5' }]] },
  update: { anim: 'spin', parts: [['path', { d: 'M19.5 12a7.5 7.5 0 0 1-13.6 4.4M4.5 12a7.5 7.5 0 0 1 13.6-4.4' }], ['path', { d: 'M18.6 3.4v4.4h-4.4M5.4 20.6v-4.4h4.4' }]] },
  addons: { anim: 'wiggle', parts: [['path', { d: 'M10 4.5a2 2 0 0 1 4 0V6h3.5a1.5 1.5 0 0 1 1.5 1.5V11h-1.5a2 2 0 0 0 0 4H19v3.5a1.5 1.5 0 0 1-1.5 1.5H14v-1.5a2 2 0 0 0-4 0V20H6.5A1.5 1.5 0 0 1 5 18.5V15h1.5a2 2 0 0 0 0-4H5V7.5A1.5 1.5 0 0 1 6.5 6H10z' }]] },
  pin: { anim: 'lift', parts: [['rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2.2 }], ['path', { d: 'M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5', class: 'a1' }], ['path', { d: 'M12 14.3v2.6' }]] },
  power: { anim: 'pulse', parts: [['path', { d: 'M12 3.5v8', class: 'a1' }], ['path', { d: 'M7.2 6.2a7.6 7.6 0 1 0 9.6 0' }]] },
  desktop: { anim: 'slide', parts: [['rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }], ['path', { d: 'M9 20.5h6M12 17v3.5' }], ['rect', { x: 5.8, y: 6.8, width: 7, height: 5, rx: 1, class: 'a1' }], ['rect', { x: 11.2, y: 9.6, width: 7, height: 5, rx: 1, class: 'a2' }]] },
};
function iconEl(name) {
  const ic = ICONS[name];
  const box = document.createElement('div');
  box.className = 'ico';
  box.dataset.anim = ic.anim;
  const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, box);
  for (const [tag, attrs] of ic.parts) svgEl(tag, attrs, svg);
  return box;
}

// Settings is built in. These are actions, not launchable items. They sit in groups: each group is
// one titled row on a rail theme, and a run of rows (with its title above the first) in grid and flow.
const SETTINGS_ROWS = [
  {
    id: '_cat_connect',
    title: 'Connections',
    cat: true,
    tiles: [
      { id: '_wifi', title: 'Wi-Fi', kind: 'action', icon: 'wifi' },
      { id: '_bluetooth', title: 'Bluetooth', kind: 'action', icon: 'bluetooth' },
      { id: '_sound', title: 'Sound', kind: 'action', icon: 'sound' },
    ],
  },
  {
    id: '_cat_pads',
    title: 'Controllers',
    cat: true,
    tiles: [
      { id: '_pad', title: 'Controller', kind: 'action', icon: 'pad' },
      { id: '_keyboard', title: 'Keyboard & mouse', kind: 'action', icon: 'keyboard' },
    ],
  },
  {
    id: '_cat_look',
    title: 'Appearance',
    cat: true,
    tiles: [
      { id: '_theme', title: 'Theme Settings', kind: 'action', icon: 'theme' },
      { id: '_profiles', title: 'Profiles', kind: 'action', icon: 'profiles' },
      { id: '_display', title: 'Display calibration', kind: 'action', icon: 'display' },
    ],
  },
  {
    id: '_cat_system',
    title: 'System',
    cat: true,
    tiles: [
      { id: '_storage', title: 'Storage', kind: 'action', icon: 'storage' },
      { id: '_update', title: 'Update software', kind: 'action', icon: 'update' },
      { id: '_addons', title: 'Add-ons', kind: 'action', icon: 'addons' },
      { id: '_pin', title: 'PIN', kind: 'action', icon: 'pin' },
    ],
  },
  {
    id: '_cat_power',
    title: 'Power',
    cat: true,
    tiles: [
      { id: '_power', title: 'Power', kind: 'action', icon: 'power' },
      { id: '_desktop', title: 'Desktop Mode', kind: 'action', icon: 'desktop' },
    ],
  },
];

let updateWaiting = false; // a downloaded update is waiting for a restart (known once Update software has looked)
let tileNotes = { wifi: '', bluetooth: '', audio: '', home: null, addons: 0, version: '' }; // short live notes under Wi-Fi, Bluetooth and Sound (see screens.js)
// The short status under a tile that has nothing urgent to say (Theme Settings > Settings page >
// Status under every tile). Built from what the page already knows, plus the summaries call.
const DEFAULT_KEYMAP = { back: 2, space: 3, shift: 10, done: 9, cancel: 1 };
function calmNote(id) {
  const shortPad = (p) => {
    if (!p) return 'No controller';
    if (p.tessera) return `P${p.player} ${(GRIP_PART[p.info && p.info.kind] || p.id).replace(/ \(Nintendo\)$/, '')}`;
    return p.id.replace(/\s*\((STANDARD GAMEPAD|Vendor).*$/i, '').slice(0, 36) || 'Controller';
  };
  const themeName = () => { const t = prefs.theme && prefs.theme.themes && prefs.theme.themes.find((x) => x.id === prefs.theme.active); return t ? t.name : ''; };
  switch (id) {
    case '_pad': return shortPad(activePad());
    case '_keyboard': return (KBM.PRESET_NAMES[(prefs.kb && prefs.kb.preset) || 'standard'] || '').replace(/ \(.*$/, '') + (prefs.kb && prefs.kb.bindings ? ', changed' : '');
    case '_controls': return Object.keys(DEFAULT_KEYMAP).every((k) => keymap[k] === DEFAULT_KEYMAP[k]) && !Object.keys(prefs.pad.remap || {}).length ? 'Standard' : 'Changed';
    case '_theme': return themeName();
    case '_profiles': return prefs.profiles && prefs.profiles.length ? `${prefs.profiles.length} profile${prefs.profiles.length === 1 ? '' : 's'}` : 'None yet';
    case '_display': return prefs.calibration && prefs.calibration.cal ? (prefs.calibration.cal.enabled === false ? 'Calibrated, off' : 'Calibrated') : 'Not calibrated';
    case '_storage': return tileNotes.home && Number.isFinite(tileNotes.home.free) ? `${fmtBytes(tileNotes.home.free)} free` : '';
    case '_update': return tileNotes.version ? `Version ${tileNotes.version}` : '';
    case '_addons': return tileNotes.addons ? `${tileNotes.addons} installed` : 'None yet';
    case '_pin': return prefs.pin && prefs.pin.set ? 'On' : 'Off';
    case '_power': return 'Sleep · Restart · Off';
    case '_desktop': return 'Login screen';
    default: return '';
  }
}
function settingsRows() {
  const low = (prefs.storage && prefs.storage.low) || [];
  const all = layoutCfg().notes;
  const rows = isLive() ? [{ id: '_cat_usb', title: 'Tessera USB', cat: true, tiles: [{ id: '_install', title: 'Install Tessera', kind: 'action', icon: 'update', sub: 'on this computer' }] }, ...SETTINGS_ROWS] : SETTINGS_ROWS;
  return rows.map((r) => ({
    ...r,
    tiles: r.tiles.map((t) => {
      if (t.id === '_storage' && low.length) return { ...t, sub: `Low space: ${low[0].name}`, warn: true };
      if (t.id === '_update' && updateWaiting) return { ...t, sub: 'Restart to finish', warn: true };
      if (t.id === '_update' && graphicsNotice) return { ...t, sub: 'New graphics card', warn: true };
      if (t.id === '_wifi' && tileNotes.wifi) return { ...t, sub: tileNotes.wifi };
      if (t.id === '_bluetooth' && tileNotes.bluetooth) return { ...t, sub: tileNotes.bluetooth };
      if (t.id === '_sound' && tileNotes.audio) return { ...t, sub: tileNotes.audio };
      const calm = all ? calmNote(t.id) : '';
      return calm ? { ...t, sub: calm } : t;
    }),
  }));
}
