// SPDX-License-Identifier: GPL-3.0-or-later
const api = window.launcherAPI;
const tabsEl = document.getElementById('tabs');
const rowsEl = document.getElementById('rows');
const crumbEl = document.getElementById('crumb');
const titleEl = document.getElementById('title');
const statusEl = document.getElementById('status');
const modalEl = document.getElementById('modal');
const canvasEl = document.getElementById('canvas');

const NAV_REPEAT_MS = 200;
const REORDER_HOLD_MS = 3000;
const MAX_TEXT = 40;
const GRID_COLS = 12; // Home is a grid spread over the whole screen (keep in step with main.js)
const GRID_ROWS = 6;

// What Tessera calls a user-made page of tiles. One place to rename it.
const TERM = 'mosaic';
const Term = TERM[0].toUpperCase() + TERM.slice(1);

// ----------------------------------------------------------------- inlays
// Inlays are small live pieces (widgets) set into a page. Built-in presets are
// drawn here; add one by adding an entry below and to BUILTIN_INLAYS in
// main.js. Widgets people download are drawn by main's add-ons loader instead,
// in a sandboxed frame (see widgetFrame). Any page can hold either kind.
const INLAYS = {
  recent: {
    render(card) {
      const head = document.createElement('div');
      head.className = 'recent-head';
      head.textContent = 'Recently played';
      const list = document.createElement('div');
      list.className = 'recent-list';
      const items = data.recent || [];
      if (!items.length) {
        const none = document.createElement('div');
        none.className = 'recent-none';
        none.textContent = 'Nothing played yet';
        list.appendChild(none);
      }
      items.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'recent-row';
        const name = document.createElement('span');
        name.textContent = it.title;
        const kind = document.createElement('small');
        kind.textContent = it.kind === 'app' ? 'App' : 'Game';
        row.append(name, kind);
        list.appendChild(row); // rows past the bottom are clipped by the widget's size
      });
      card.append(head, list);
    },
  },
  clock: {
    render(card) {
      const time = document.createElement('div');
      time.className = 'clock-time';
      const date = document.createElement('div');
      date.className = 'clock-date';
      card.append(time, date);
    },
  },
};
// A downloaded widget runs in a sandboxed frame: scripts allowed, but it has
// no network, no access to this page, and can only load its own folder
// (enforced by the tessera-widget protocol in main.js).
function widgetFrame(id) {
  const f = document.createElement('iframe');
  f.className = 'widget-frame';
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('scrolling', 'no');
  f.tabIndex = -1;
  f.src = `tessera-widget://${id}/`;
  return f;
}
function tickInlays() {
  const now = new Date();
  document.querySelectorAll('.clock-time').forEach((el) => {
    el.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  });
  document.querySelectorAll('.clock-date').forEach((el) => {
    el.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  });
}
setInterval(tickInlays, 1000);

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
};
const PAD_DEFAULTS = { deadzone: 15, trigger: 8, rumble: 'normal', style: 'split', glyphs: 'auto' };
let prefs = { pad: { ...PAD_DEFAULTS }, calib: {}, theme: null };
// "Automatic" looks at who made the connected controller (USB vendor id, then the name).
function detectFamily(id) {
  const v = /vendor:\s*([0-9a-f]{4})/i.exec(id || '');
  const ven = v ? v[1].toLowerCase() : '';
  if (ven === '054c' || /dualsense|dualshock|playstation|sony/i.test(id)) return 'playstation';
  if (ven === '057e' || /nintendo|joy-?con|switch|pro controller/i.test(id)) return 'nintendo';
  return 'xbox';
}
const glyphSet = () => {
  let g = prefs.pad.glyphs;
  if (g === 'auto') { const p = activePad(); g = detectFamily(p ? p.id : ''); }
  return GLYPH_SETS[g] || BUTTON_NAMES;
};
const glyph = (n) => glyphSet()[n];
const buttonName = (n) => glyph(n) || `Button ${n}`;
function applyGlyphs() {
  for (const el of document.querySelectorAll('[data-g]')) {
    const ids = el.dataset.g.split(',').map(Number);
    el.textContent = ids.length === 1 ? buttonName(ids[0]) : ids[0] === 8 ? `Hold ${buttonName(8)} + ${buttonName(9)}` : ids.map(buttonName).join(' / ');
  }
}

// ------------------------------------------------------- screen + theme
// --auto follows the resolution, so the same layout reads right on a 720p
// handheld and a 4K TV. The person's own scale choices sit on top of it.
function fitScreen() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  document.documentElement.style.setProperty('--auto', Math.min(2.5, Math.max(0.6, s)).toFixed(3));
}
window.addEventListener('resize', fitScreen);
fitScreen();

let appliedVars = new Set();
let imageRev = null;
// Dark or white text, whichever reads better on this color (WCAG contrast).
function onColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (lum + 0.05) / 0.057 >= 1.05 / (lum + 0.05) ? '#10151c' : '#ffffff';
}
let layoutReady = false;
let layoutSig = '';
function applyTheme(t) {
  if (!t || !Array.isArray(t.settings)) return;
  prefs.theme = t;
  const fx = t.settings.find((s) => s.id === 'backdrop');
  document.body.dataset.fx = fx ? fx.value : 'none';
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
  prefs.calib = p.calib || {};
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

// Settings is built in. These are actions, not launchable items.
const SETTINGS_ROWS = [
  {
    id: '_settings',
    title: 'System',
    tiles: [
      { id: '_roots', title: 'Library folders', kind: 'action' },
      { id: '_scan', title: 'Scan for games', kind: 'action' },
      { id: '_pad', title: 'Controller', kind: 'action' },
      { id: '_controls', title: 'Button mapping', kind: 'action' },
      { id: '_theme', title: 'Theme Settings', kind: 'action' },
      { id: '_addons', title: 'Add-ons', kind: 'action' },
      { id: '_desktop', title: 'Desktop Mode', kind: 'action' },
    ],
  },
];

// ------------------------------------------------------------------ state

let data = { tabs: { library: [], apps: [] }, folders: {}, mosaics: [], tabOrder: ['home', 'library', 'apps'] };
let page = 'home';          // the page on screen: home, library, apps, m:<id>, settings
let hoverId = 'home';       // the tab the tab bar is pointing at (can be "new")
let focus = 'content';      // 'tabs' (the tab bar) or 'content' (the tiles)
const cursor = {};          // per page/folder: { row, cols: { rowId: col } }
let stack = [];             // open folders: [{ id, title }]
let suspended = false;      // true while a game is running
let busy = false;           // true while waiting on the main process
let artRev = 0;             // bumps when a game picture changes, so tiles reload it
let modal = null;
let lastNav = 0;
let holdTimer = null;
let reorderId = null;       // mosaic being moved with the tab bar
let place = null;           // an inlay being placed or resized on Home's grid
let yTap = false;           // Y went down on the tiles: a tap opens Options, a long hold lifts the mosaic
const prevBtn = new Array(32).fill(false);
const wasBig = {};          // rows that showed the big empty tile last render

function setStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', Boolean(isError));
}

// ------------------------------------------------------------------- tabs

function tabList() {
  return ['browser', ...data.tabOrder, 'new', 'settings'];
}
function tabName(id) {
  if (id === 'new') return '+ ' + Term;
  if (id.startsWith('m:')) return (data.folders[id.slice(2)] || {}).title || '?';
  return { browser: 'Browser', home: 'Home', library: 'Library', apps: 'Apps', settings: 'Settings' }[id];
}

// ------------------------------------------------------------ home screen

// An empty row is one big tile. A filled one ends in a small "+" tile.
function withAdd(row, ctx, emptyTitle, emptySub) {
  if (!row.tiles.length) {
    return { ...row, tiles: [{ id: '_add', kind: 'add', big: true, title: emptyTitle, sub: emptySub, ctx }] };
  }
  return { ...row, tiles: [...row.tiles, { id: '_add', kind: 'add', title: 'Add', ctx }] };
}

function baseRows() {
  if (stack.length) {
    const top = stack[stack.length - 1];
    const f = data.folders[top.id];
    return [
      withAdd({ id: top.id, title: f ? f.title : top.title, tiles: f ? f.tiles : [] }, { catId: top.id },
        'This folder is empty', 'Add a game, an app, or something from your library'),
    ];
  }
  if (page === 'settings') return SETTINGS_ROWS;
  if (page === 'home') {
    const f = data.folders._home;
    const tiles = (f ? f.tiles : []).filter((t) => t.kind === 'inlay');
    if (!tiles.length)
      return [{ id: '_home', title: 'Home', tiles: [{ id: '_add', kind: 'add', big: true, title: 'Make this yours', sub: 'Pick a widget, then choose where it goes', ctx: { catId: '_home' } }] }];
    return [{ id: '_home', title: 'Home', tiles }];
  }
  if (page.startsWith('m:')) {
    const id = page.slice(2);
    const f = data.folders[id] || { title: '?', tiles: [] };
    return [
      withAdd({ id, title: f.title, tiles: f.tiles }, { catId: id },
        `This ${TERM} is empty`, 'Add a game, an app, an inlay, or something from your library'),
    ];
  }
  // Library and Apps are automatic lists of everything you've added.
  const rows = (data.tabs[page] || []).map((r) =>
    withAdd(r, r.id === '_all_games' ? { tab: 'library', kind: 'game' } : { tab: 'apps', kind: 'app' })
  );
  if (rows.length) return rows;
  const text = {
    library: ['Add your first game', 'Pick a file or scan your folders'],
    apps: ['Add your first app', 'Steam, a browser, anything you launch'],
  }[page];
  return [
    {
      id: '_empty_' + page,
      title: tabName(page),
      tiles: [{ id: '_add', kind: 'add', big: true, title: text[0], sub: text[1], ctx: { tab: page, kind: page === 'apps' ? 'app' : 'game' } }],
    },
  ];
}

function curKey() {
  return stack.length ? 'f:' + stack[stack.length - 1].id : page;
}
// Tile layout from Theme Settings: rails (sideways, one row per list), grid
// (several rows, scrolls when you reach the edge) or flow (the selected row
// stays in focus and the rest slide under the tab bar).
function layoutCfg() {
  const get = (id) => { const s = prefs.theme && prefs.theme.settings.find((x) => x.id === id); return s ? s.value : undefined; };
  let cols = Number(get('gridCols')) || 5;
  let rows = Number(get('gridRows')) || 3;
  const pre = /^c(\d+)r(\d+)$/.exec(get('gridPreset') || '');
  if (pre) { cols = Number(pre[1]); rows = Number(pre[2]); }
  const mode = ['grid', 'flow'].includes(get('layout')) ? get('layout') : 'rails';
  return { mode, cols: Math.max(2, Math.min(12, cols)), rows: Math.max(1, Math.min(8, rows)) };
}
function currentRows() {
  const base = baseRows();
  const { mode, cols } = layoutCfg();
  if (mode === 'rails' || homeMode()) return base;
  if (base.length === 1 && base[0].tiles.length === 1 && base[0].tiles[0].big) return base; // the big empty tile stays big
  // Grid: all the tiles on the page, cut into rows of `cols`. Everything that moves between rows
  // and tiles (D-pad, selection, menus) works on these rows like on any other.
  const tiles = base.flatMap((r) => r.tiles);
  const out = [];
  for (let i = 0; i < tiles.length; i += cols) out.push({ id: 'grid:' + i / cols, title: '', tiles: tiles.slice(i, i + cols) });
  return out.length ? out : base;
}

function cur() {
  const k = curKey();
  return (cursor[k] = cursor[k] || { row: 0, cols: {} });
}

function drawTabs() {
  tabsEl.replaceChildren();
  tabList().forEach((id) => {
    const el = document.createElement('span');
    el.className = 'tab';
    el.textContent = tabName(id);
    tabsEl.appendChild(el);
  });
}

function fillInlay(card, t) {
  if (t.widget) {
    card.classList.add('has-widget');
    card.appendChild(widgetFrame(t.widget));
  } else if (t.missing) {
    const kind = document.createElement('small');
    kind.textContent = 'Not installed';
    const name = document.createElement('span');
    name.textContent = t.title;
    card.append(kind, name);
  } else if (INLAYS[t.type]) {
    INLAYS[t.type].render(card, t);
  }
}

// ---- Home: a grid over the whole screen. Widgets sit on it where you put them.
const homeMode = () => page === 'home' && !stack.length;
const gridAt = (el, r) => {
  el.style.gridColumn = `${r.x + 1} / span ${r.w}`;
  el.style.gridRow = `${r.y + 1} / span ${r.h}`;
};
function renderCanvas() {
  canvasEl.replaceChildren();
  if (place) {
    // Faint cells show where things can go while you place one.
    for (let y = 0; y < GRID_ROWS; y++)
      for (let x = 0; x < GRID_COLS; x++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        gridAt(cell, { x, y, w: 1, h: 1 });
        canvasEl.appendChild(cell);
      }
  }
  const tiles = currentRows()[0].tiles;
  tiles.forEach((t) => {
    if (t.kind === 'add' && place) return; // the grid is what you're looking at now
    const card = document.createElement('div');
    card.className = 'card kind-' + t.kind + (t.big ? ' big' : '');
    if (t.kind === 'add') {
      const plus = document.createElement('div');
      plus.className = 'plus';
      plus.textContent = '+';
      const name = document.createElement('span');
      name.textContent = t.title;
      const sub = document.createElement('small');
      sub.textContent = t.sub;
      card.append(plus, name, sub);
      gridAt(card, { x: 3, y: 1, w: 6, h: 4 });
    } else {
      fillInlay(card, t);
      gridAt(card, t);
      if (place && place.id === t.id) card.classList.add('moving');
    }
    canvasEl.appendChild(card);
  });
  drawGhost();
}
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function homeTiles() {
  const f = data.folders._home;
  return (f ? f.tiles : []).filter((t) => t.kind === 'inlay');
}
function drawGhost() {
  canvasEl.querySelectorAll('.ghost').forEach((g) => g.remove());
  if (!place) return;
  const g = document.createElement('div');
  g.className = 'ghost' + (homeTiles().some((o) => o.id !== place.id && rectsOverlap(place, o)) ? ' bad' : '');
  const label = document.createElement('span');
  label.textContent = `${place.name} · ${place.w} × ${place.h}`;
  g.appendChild(label);
  gridAt(g, place);
  canvasEl.appendChild(g);
  setStatus(
    `D-pad ${place.mode === 'move' ? 'moves' : 'resizes'}` +
      (place.def.resizable ? `  ·  X: ${place.mode === 'move' ? 'resize' : 'move'}` : '  ·  fixed size') +
      '  ·  A place  ·  B cancel'
  );
}
// Where a new widget starts: the first free spot, top-left first.
function firstFree(w, h, ignoreId) {
  const others = homeTiles().filter((o) => o.id !== ignoreId);
  for (let y = 0; y + h <= GRID_ROWS; y++)
    for (let x = 0; x + w <= GRID_COLS; x++)
      if (!others.some((o) => rectsOverlap({ x, y, w, h }, o))) return { x, y };
  return { x: 0, y: 0 };
}
function startPlace(p) {
  place = { mode: 'move', ...p };
  focus = 'content';
  render();
}
function placePress(act) {
  const p = place;
  const d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[act];
  if (d) {
    if (p.mode === 'move') {
      p.x = Math.max(0, Math.min(GRID_COLS - p.w, p.x + d[0]));
      p.y = Math.max(0, Math.min(GRID_ROWS - p.h, p.y + d[1]));
    } else {
      p.w = Math.max(p.def.min.w, Math.min(Math.min(p.def.max.w, GRID_COLS - p.x), p.w + d[0]));
      p.h = Math.max(p.def.min.h, Math.min(Math.min(p.def.max.h, GRID_ROWS - p.y), p.h + d[1]));
    }
    return drawGhost();
  }
  if (act === 'x') {
    if (p.def.resizable) p.mode = p.mode === 'move' ? 'size' : 'move';
    return drawGhost();
  }
  if (act === 'b') {
    place = null;
    setStatus('');
    return render();
  }
  if (act === 'a') {
    const rect = { x: p.x, y: p.y, w: p.w, h: p.h };
    const op = p.id
      ? lib('placeInlay', { id: p.id, ...rect }, { quiet: true })
      : lib('addInlay', { catId: '_home', type: p.type, ...rect }, { quiet: true });
    op.then((r) => {
      if (r.ok) { place = null; setStatus(''); render(); }
      else { drawGhost(); setStatus(r.error, true); } // stay in placement so it can be moved
    });
  }
}
// Spatial movement between widgets (D-pad / stick), by where they sit on screen.
function homeMove(dir) {
  const tiles = selectedRow().tiles;
  const c = cur();
  const i = c.cols._home || 0;
  const from = tiles[i];
  let best = -1;
  let bestScore = Infinity;
  if (from && from.kind === 'inlay') {
    const fx = from.x + from.w / 2;
    const fy = from.y + from.h / 2;
    tiles.forEach((o, n) => {
      if (n === i || o.kind !== 'inlay') return;
      const dx = o.x + o.w / 2 - fx;
      const dy = o.y + o.h / 2 - fy;
      const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
      const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 0) return;
      const score = along + across * 2;
      if (score < bestScore) { best = n; bestScore = score; }
    });
  }
  if (best >= 0) {
    c.cols._home = best;
    return update();
  }
  if (dir === 'up') {
    focus = 'tabs'; // nothing above: the tab bar
    hoverId = page;
    update();
  }
}

function render() {
  drawTabs();
  crumbEl.textContent = stack.length
    ? [tabName(page), ...stack.map((s) => s.title)].join('  ›  ')
    : '';
  const home = homeMode();
  canvasEl.hidden = !home;
  rowsEl.hidden = home;
  if (home) {
    renderCanvas();
    clamp();
    update();
    tickInlays();
    return;
  }
  rowsEl.replaceChildren();
  const lc = layoutCfg();
  rowsEl.className = 'rows' + (lc.mode === 'rails' ? '' : ' ' + lc.mode);
  rowsEl.parentElement.classList.toggle('flowmask', lc.mode === 'flow');
  const pageKey = page + '/' + stack.map((s) => s.id).join('/');
  if (pageKey !== rowsEl._key) { rowsEl._key = pageKey; rowsEl._ty = 0; }
  const rows = currentRows();
  rows.forEach((row) => {
    const wrap = document.createElement('section');
    wrap.className = 'row';
    const label = document.createElement('h2');
    label.textContent = row.title;
    const viewport = document.createElement('div');
    viewport.className = 'rowport';
    const rail = document.createElement('div');
    rail.className = 'rail';
    row.tiles.forEach((t) => {
      const card = document.createElement('div');
      card.className = 'card kind-' + t.kind + (t.big ? ' big' : '');
      if (t.kind === 'add') {
        const plus = document.createElement('div');
        plus.className = 'plus';
        plus.textContent = '+';
        card.appendChild(plus);
        const name = document.createElement('span');
        name.textContent = t.title;
        card.appendChild(name);
        if (t.sub) {
          const sub = document.createElement('small');
          sub.textContent = t.sub;
          card.appendChild(sub);
        }
      } else if (t.kind === 'inlay') {
        fillInlay(card, t);
      } else {
        const kind = document.createElement('small');
        kind.textContent = { folder: 'Folder', app: 'App', game: 'Game' }[t.kind] || '';
        const name = document.createElement('span');
        name.textContent = t.title;
        card.append(kind, name);
        if (t.art) {
          card.classList.add('has-art');
          card.style.backgroundImage = `url("tessera-art://item/${encodeURIComponent(t.id)}?v=${artRev}")`;
        }
      }
      rail.appendChild(card);
    });
    viewport.appendChild(rail);
    wrap.append(label, viewport);
    rowsEl.appendChild(wrap);

    // The big empty tile "splits" into real tiles once something is added.
    const big = row.tiles.length === 1 && row.tiles[0].big;
    if (wasBig[row.id] && !big && lc.mode === 'rails') {
      const mid = rail.scrollWidth / 2;
      [...rail.children].forEach((card, i) => {
        card.style.setProperty('--from', `${mid - (card.offsetLeft + card.offsetWidth / 2)}px`);
        card.style.setProperty('--i', i);
      });
      rail.classList.add('split');
    }
    wasBig[row.id] = big;
  });
  sizeGrid();
  clamp();
  update();
  tickInlays();
}

// Grid tiles are sized so `cols` fit across and `rows` fit down.
function sizeGrid() {
  const { mode, cols, rows } = layoutCfg();
  if (mode === 'rails' || homeMode()) {
    rowsEl.style.removeProperty('--card-w');
    rowsEl.style.removeProperty('--card-h');
    return;
  }
  const vp = rowsEl.parentElement;
  const gap = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.2;
  const w = Math.max(200, vp.clientWidth - gap * 4);
  const h = Math.max(160, vp.clientHeight);
  const cw = (w - (cols - 1) * gap) / cols;
  const ch = Math.max(90, Math.min(cw * 1.5, (h - rows * gap) / rows));
  rowsEl.style.setProperty('--card-w', cw.toFixed(1) + 'px');
  rowsEl.style.setProperty('--card-h', ch.toFixed(1) + 'px');
  rowsEl.style.setProperty('--gap', gap.toFixed(1) + 'px');
}
window.addEventListener('resize', () => { sizeGrid(); update(); });

function clamp() {
  const rows = currentRows();
  const c = cur();
  c.row = Math.max(0, Math.min(rows.length - 1, c.row));
  rows.forEach((r) => {
    c.cols[r.id] = Math.max(0, Math.min(r.tiles.length - 1, c.cols[r.id] || 0));
  });
}

function update() {
  const rows = currentRows();
  const c = cur();
  const inTiles = focus === 'content';
  const list = tabList();
  [...tabsEl.children].forEach((el, n) => {
    const id = list[n];
    el.classList.toggle('active', id === page);                              // the page you're on
    el.classList.toggle('focused', !inTiles && id === hoverId);              // the tab bar points here
    el.classList.toggle('lifted', Boolean(reorderId) && id === reorderId);
  });
  // Keep the tab bar pointing at the focused tab (or the current page).
  const target = tabsEl.children[list.indexOf(inTiles ? page : hoverId)];
  if (target) {
    // Centre the whole bar if it fits; otherwise follow the focused tab.
    const port = tabsEl.parentElement.clientWidth;
    const bar = tabsEl.offsetWidth;
    let x = (port - bar) / 2;
    if (bar > port) {
      x = port / 2 - (target.offsetLeft + target.offsetWidth / 2);
      x = Math.min(0, Math.max(port - bar, x));
    }
    tabsEl.style.transform = `translateX(${x}px)`;
  }
  if (homeMode()) {
    const col = c.cols._home || 0;
    [...canvasEl.querySelectorAll('.card')].forEach((card, n) =>
      card.classList.toggle('active', inTiles && !place && n === col)
    );
  }
  [...rowsEl.querySelectorAll('.row')].forEach((wrap, r) => {
    const active = r === c.row;
    wrap.classList.toggle('active', active && inTiles);
    const rail = wrap.querySelector('.rail');
    const col = (rows[r] && c.cols[rows[r].id]) || 0;
    [...rail.children].forEach((card, n) => card.classList.toggle('active', inTiles && active && n === col));
    const card = rail.children[col];
    if (layoutCfg().mode !== 'rails') rail.style.transform = 'none';
    else if (card) {
      const w = rail.parentElement.clientWidth;
      rail.style.transform = `translateX(${w / 2 - (card.offsetLeft + card.offsetWidth / 2)}px)`;
    }
  });
  const activeRow = rowsEl.querySelectorAll('.row')[c.row];
  if (activeRow) {
    const h = rowsEl.parentElement.clientHeight;
    const mode = layoutCfg().mode;
    if (mode === 'rails') {
      rowsEl.style.transform = `translateY(${h / 2 - (activeRow.offsetTop + activeRow.offsetHeight / 2)}px)`;
    } else {
      // Nothing moves until the tiles outgrow the screen. Then: grid scrolls just enough to keep the
      // selection in view; flow keeps the selected row in the middle.
      const minTy = Math.min(0, h - rowsEl.scrollHeight);
      const top = activeRow.offsetTop;
      const bot = top + activeRow.offsetHeight;
      let ty = rowsEl._ty || 0;
      if (mode === 'flow') ty = h / 2 - (top + activeRow.offsetHeight / 2);
      else if (top + ty < 0) ty = -top;
      else if (bot + ty > h) ty = h - bot;
      ty = Math.max(minTy, Math.min(0, ty));
      rowsEl._ty = ty;
      rowsEl.style.transform = `translateY(${ty}px)`;
    }
  }
  const t = selectedTile();
  titleEl.textContent = !inTiles
    ? hoverId === 'new' ? `Press A to create a ${TERM}` : hoverId === 'browser' ? 'Press A to open your browser' : tabName(hoverId)
    : t && !t.big ? t.title : '';
}

function selectedRow() {
  return currentRows()[cur().row] || null;
}
function selectedTile() {
  const row = selectedRow();
  return row ? row.tiles[cur().cols[row.id] || 0] || null : null;
}

function moveCol(d) {
  if (homeMode()) return homeMove(d < 0 ? 'left' : 'right');
  const row = selectedRow();
  if (!row) return;
  const c = cur();
  c.cols[row.id] = Math.max(0, Math.min(row.tiles.length - 1, (c.cols[row.id] || 0) + d));
  update();
}
function moveRow(d) {
  if (homeMode()) return homeMove(d < 0 ? 'up' : 'down');
  const c = cur();
  if (d < 0 && c.row === 0) {
    focus = 'tabs'; // up from the top row lands on the tab bar
    hoverId = page;
    return update();
  }
  const rows = currentRows();
  const was = rows[c.row];
  c.row = Math.max(0, Math.min(rows.length - 1, c.row + d));
  if (layoutCfg().mode !== 'rails' && was && rows[c.row] && rows[c.row] !== was) {
    // stay in the same column, like any grid
    c.cols[rows[c.row].id] = Math.min(c.cols[was.id] || 0, rows[c.row].tiles.length - 1);
  }
  update();
}
// "Browser" and "+ Mosaic" are buttons that live on the bar, not pages: the
// pointer lights them up but the screen keeps showing the page you were on.
const isButtonTab = (id) => id === 'new' || id === 'browser';
function launchBrowser() {
  suspended = true;
  setStatus('Opening your browser…');
  api.launch('_browser');
}
// Bumpers and left/right on the tab bar. The bar is a loop. The page follows the
// pointer, except on the button tabs.
function moveTabs(d) {
  const list = tabList();
  const i = Math.max(0, list.indexOf(hoverId));
  hoverId = list[(i + d + list.length) % list.length];
  focus = 'tabs';
  if (!isButtonTab(hoverId) && hoverId !== page) {
    page = hoverId;
    stack = [];
    setStatus('');
    render();
  } else {
    update();
  }
}
function back() {
  if (!stack.length) return;
  stack.pop();
  render();
}

// Replace what's on screen with a fresh view from the main process.
function applyView(view) {
  if (!view) return;
  data = { tabs: view.tabs, folders: view.folders, mosaics: view.mosaics || [], tabOrder: view.tabOrder || data.tabOrder, recent: view.recent || [] };
  if (view.keys) keymap = view.keys;
  if (view.prefs) applyPrefs(view.prefs);
  artRev = view.artRev || 0;
  if (!tabList().includes(page)) {
    page = 'home';
    stack = [];
  }
  if (!tabList().includes(hoverId)) hoverId = page;
  while (stack.length && !data.folders[stack[stack.length - 1].id]) stack.pop();
  layoutReady = true;
  sizeGrid();
  render();
}

function activate() {
  const t = selectedTile();
  if (!t) return;
  if (t.kind === 'folder') {
    stack.push({ id: t.id, title: t.title });
    render();
  } else if (t.kind === 'add') {
    flowAdd(t.ctx || {});
  } else if (t.kind === 'inlay') {
    openMenu(); // widgets are display-only; A offers move / resize / remove
  } else if (t.kind === 'action') {
    if (t.id === '_roots') flowRoots();
    else if (t.id === '_scan') flowScan();
    else if (t.id === '_pad') flowPadMenu();
    else if (t.id === '_theme') flowTheme();
    else if (t.id === '_controls') flowControls();
    else if (t.id === '_desktop') flowDesktop();
    else if (t.id === '_addons') flowAddons();
    else setStatus('Not available yet.');
  } else {
    suspended = true;
    setStatus('Starting…');
    api.launch(t.id);
  }
}

// ------------------------------------------------------------------ modal

function closeModal() {
  const done = modal && modal.onClose;
  modal = null;
  modalEl.hidden = true;
  modalEl.className = '';
  modalEl.replaceChildren();
  if (done) done();
}

// A list the controller can scroll. Used for menus, pickers and the browser.
// Collapsible trees: an item with header + fold is a heading that A (or
// left / right) opens and closes; the items under it, up to the next
// heading, hide with it. A heading without fold is just a label.
const foldOpen = new Map(); // fold key -> expanded?
const isOpen = (it) => (foldOpen.has(it.fold) ? foldOpen.get(it.fold) : Boolean(it.open));
function visibleFlags(items) {
  let hidden = false;
  return items.map((it) => {
    if (it.header) { hidden = Boolean(it.fold) && !isOpen(it); return true; }
    return !hidden;
  });
}
const pickable = (items, flags, i) => Boolean(items[i]) && flags[i] && !(items[i].header && !items[i].fold);
function openList({ title, items, index = 0, multi = false, onChoose, onBack, onY }) {
  // Never start on a label or on something folded away.
  const flags = visibleFlags(items);
  for (let i = index; i < items.length; i++) if (pickable(items, flags, i)) { index = i; break; }
  modal = { kind: 'list', title, items, index, multi, onChoose, onBack, onY };
  renderModal();
}
// Resolves with the chosen item, or null if the user backs out.
function pick(title, items, index = 0) {
  return new Promise((resolve) => {
    openList({
      title,
      items,
      index,
      onChoose: (it) => { closeModal(); resolve(it); },
      onBack: () => { closeModal(); resolve(null); },
    });
  });
}

// Waits for the next controller button and resolves with its number.
function capture(label) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), 10000);
    const finish = (n) => {
      clearTimeout(timer);
      closeModal();
      resolve(n);
    };
    modal = { kind: 'capture', label, finish, note: '' };
    renderModal();
  });
}

// ---- on-screen keyboard
const KEY_ROWS = [
  '1234567890'.split(''),
  'qwertyuiop'.split(''),
  "asdfghjkl'".split(''),
  'zxcvbnm-.&'.split(''),
  ['shift', 'space', 'back', 'cancel', 'done'],
];
const SPECIAL = { shift: 'Shift', space: 'Space', back: '⌫', cancel: 'Cancel', done: 'Done' };

// Resolves with the text, or null on cancel.
function ask(title, initial = '') {
  return new Promise((resolve) => {
    modal = { kind: 'keys', title, text: initial.slice(0, MAX_TEXT), shift: false, r: 1, c: 0, last: null, resolve, dom: null };
    renderModal();
  });
}
function finishKeys(accept) {
  const { resolve, text } = modal;
  closeModal();
  resolve(accept ? text : null);
}
function typeChar(ch) {
  if (modal.text.length >= MAX_TEXT) return;
  modal.text += modal.shift ? ch.toUpperCase() : ch;
  modal.shift = false;
  renderModal();
}
function keyAction(k) {
  if (k === 'shift') modal.shift = !modal.shift;
  else if (k === 'space') typeChar(' ');
  else if (k === 'back') modal.text = modal.text.slice(0, -1);
  else if (k === 'cancel') return finishKeys(false);
  else if (k === 'done') return finishKeys(true);
  else return typeChar(k);
  renderModal();
}
// A controller button pressed while the keyboard is open. A always types
// the highlighted key; the rest follow the bindings from Settings → Controls.
function keysButton(n) {
  modal.last = n;
  if (n === 0) return keyAction(KEY_ROWS[modal.r][modal.c]);
  const action = Object.keys(keymap).find((k) => keymap[k] === n);
  if (action) return keyAction(action);
  renderModal();
}

// Built once and then updated in place, so the slide-up only plays on open.
function buildKeys() {
  modalEl.replaceChildren();
  modalEl.className = 'keys';
  const centre = document.createElement('div');
  centre.className = 'kbcenter';
  const h = document.createElement('h3');
  const field = document.createElement('div');
  field.className = 'field';
  const text = document.createElement('span');
  const caret = document.createElement('span');
  caret.className = 'caret';
  field.append(text, caret);
  centre.append(h, field);

  const panel = document.createElement('div');
  panel.className = 'kbpanel';
  const grid = document.createElement('div');
  grid.className = 'keys-grid';
  const cells = KEY_ROWS.map((row) => {
    const line = document.createElement('div');
    line.className = 'krow';
    const els = row.map((k) => {
      const el = document.createElement('div');
      el.className = 'key' + (SPECIAL[k] ? ' wide' : '') + (k === 'cancel' ? ' cancel' : '') + (k === 'done' ? ' done' : '');
      line.appendChild(el);
      return el;
    });
    grid.appendChild(line);
    return els;
  });
  const hint = document.createElement('p');
  hint.className = 'khint';
  panel.append(grid, hint);
  modalEl.append(centre, panel);
  modal.dom = { h, text, cells, hint };
}
function updateKeys() {
  if (!modal.dom) buildKeys();
  const { h, text, cells, hint } = modal.dom;
  h.textContent = modal.title;
  text.textContent = modal.text;
  KEY_ROWS.forEach((row, r) =>
    row.forEach((k, c) => {
      const el = cells[r][c];
      el.textContent = SPECIAL[k] || (modal.shift ? k.toUpperCase() : k);
      el.classList.toggle('on', k === 'shift' && modal.shift);
      el.classList.toggle('active', r === modal.r && c === modal.c);
    })
  );
  hint.textContent =
    `A type   ${buttonName(keymap.back)} delete   ${buttonName(keymap.space)} space   ` +
    `${buttonName(keymap.shift)} shift   ${buttonName(keymap.done)} done` +
    (modal.last === null ? '' : `      (last button: ${modal.last})`);
}

function renderModal() {
  if (!modal) return;
  modalEl.hidden = false;
  if (modal.kind === 'keys') return updateKeys();
  if (modal.kind === 'pad' || modal.kind === 'color') return;
  modalEl.className = '';
  modalEl.replaceChildren();
  const box = document.createElement('div');
  box.className = 'box';
  const h = document.createElement('h3');
  box.appendChild(h);

  if (modal.kind === 'capture') {
    h.textContent = `Press a button for “${modal.label}”`;
    const p = document.createElement('p');
    p.className = 'khint';
    p.textContent = modal.note || 'Press Esc on a keyboard to cancel';
    box.appendChild(p);
    modalEl.appendChild(box);
    return;
  }

  h.textContent = modal.title;
  const list = document.createElement('div');
  list.className = 'mlist';
  const flags = visibleFlags(modal.items);
  modal.items.forEach((it, n) => {
    if (!flags[n]) return;
    const el = document.createElement('div');
    // Cancel / Close glow red, Done / Yes glow green, except in menus that are just lists of settings.
    const danger = !it.plain && (it.danger || /^(cancel|close)\b/i.test(it.label));
    const ok = !it.plain && (it.ok || /^(done|yes|ok|confirm)$/i.test(it.label));
    el.className = 'mitem' + (n === modal.index ? ' active' : '') + (it.header ? ' header' : '') + (it.fold ? ' fold' : '') + (danger ? ' danger' : '') + (ok ? ' ok' : '');
    const mark = modal.multi && 'checked' in it ? (it.checked ? '☑  ' : '☐  ') : '';
    el.textContent = (it.fold ? (isOpen(it) ? '▾  ' : '▸  ') : '') + mark + it.label;
    if (it.sub) {
      const s = document.createElement('small');
      s.textContent = it.sub;
      el.appendChild(s);
    }
    list.appendChild(el);
  });
  if (!modal.items.length) {
    const e = document.createElement('div');
    e.className = 'mitem dim';
    e.textContent = 'Nothing here.';
    list.appendChild(e);
  }
  box.appendChild(list);
  modalEl.appendChild(box);
  const active = list.querySelector('.mitem.active');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

function modalPress(act) {
  if (modal.kind === 'capture' || modal.kind === 'pad') return;
  if (modal.kind === 'color') return colorPress(act);
  if (modal.kind === 'list') {
    const n = modal.items.length;
    const flags = visibleFlags(modal.items);
    const step = (d) => {
      let i = modal.index + d;
      while (modal.items[i] && !pickable(modal.items, flags, i)) i += d; // skip labels and folded items
      if (modal.items[i]) modal.index = i;
    };
    const cur = modal.items[modal.index];
    if (act === 'up') step(-1);
    else if (act === 'down') step(1);
    else if (act === 'a' && n && cur && cur.header) { if (cur.fold) foldOpen.set(cur.fold, !isOpen(cur)); }
    else if (act === 'a' && n) modal.onChoose(cur);
    else if ((act === 'left' || act === 'right') && cur && cur.header && cur.fold) foldOpen.set(cur.fold, act === 'right');
    else if (act === 'left' && cur && !cur.header) {
      // left on a row inside a branch: fold the branch and land on its heading
      for (let i = modal.index - 1; i >= 0; i--) {
        if (modal.items[i].header) { if (modal.items[i].fold) { foldOpen.set(modal.items[i].fold, false); modal.index = i; } break; }
      }
    }
    else if (act === 'b') modal.onBack();
    renderModal();
    return;
  }
  // keyboard: directions only. Buttons go through keysButton().
  if (act === 'left') modal.c = Math.max(0, modal.c - 1);
  else if (act === 'right') modal.c = Math.min(KEY_ROWS[modal.r].length - 1, modal.c + 1);
  else if (act === 'up') modal.r = Math.max(0, modal.r - 1);
  else if (act === 'down') modal.r = Math.min(KEY_ROWS.length - 1, modal.r + 1);
  modal.c = Math.min(modal.c, KEY_ROWS[modal.r].length - 1);
  renderModal();
}

// -------------------------------------------------------------- the flows
// Each flow only sends ids, names and menu choices to the main process.

async function lib(op, payload, { quiet = false } = {}) {
  busy = true;
  let r;
  try {
    r = await api.library(op, payload);
  } finally {
    busy = false;
  }
  applyView(r.view);
  if (!quiet) setStatus(r.ok ? r.message : r.error, !r.ok);
  return r;
}

async function confirm(question, yesLabel = 'Yes') {
  const r = await pick(question, [{ label: yesLabel, yes: true }, { label: 'Cancel' }]);
  return Boolean(r && r.yes);
}

// What "+" offers depends on where it is.
async function flowAdd(ctx) {
  const into = ctx.catId;
  const onlyGame = ctx.kind === 'game';
  const onlyApp = ctx.kind === 'app';
  const items = [];
  if (into && libraryChoices(into).length) items.push({ label: 'Add something from your library…', op: 'existing' });
  if (into === '_home') items.push({ label: 'Add a widget…', op: 'inlay' });
  if (!onlyApp && ctx.tab !== 'apps') items.push({ label: 'Add a game from a file…', op: 'game' });
  if (!onlyGame && ctx.tab !== 'library') items.push({ label: 'Add an app from a file…', op: 'app' });
  if (!onlyApp && ctx.tab !== 'apps') items.push({ label: 'Scan for games', op: 'scan' });
  if (into === '_home') items.push({ label: `New ${TERM}…`, op: 'mosaic' });
  else if (into) items.push({ label: 'New folder here…', op: 'folder' });
  const it = items.length === 1 ? items[0] : await pick('Add', items);
  if (!it) return;
  switch (it.op) {
    case 'existing': return flowAddExisting(into);
    case 'inlay': return flowAddInlay(into);
    case 'game': return flowBrowse('addGame', undefined, into);
    case 'app': return flowBrowse('addApp', undefined, into);
    case 'scan': return flowScan(into);
    case 'mosaic': return flowNewMosaic({});
    case 'folder': return flowNewMosaic({ parent: into });
  }
}

// Nothing is added for you: pick a preset or an installed widget.
async function flowAddInlay(into) {
  for (;;) {
    busy = true;
    let info;
    try { info = await api.addons('list'); } finally { busy = false; }
    const sub = (d, kind) =>
      [d.description || kind, `${d.size.w} × ${d.size.h}`, d.resizable ? 'resizable' : ''].filter(Boolean).join(' · ');
    const items = [
      ...info.presets.map((p) => ({ label: p.name, sub: sub(p, 'preset'), type: p.type })),
      ...info.widgets.map((w) => ({ label: w.name, sub: sub(w, 'widget'), type: w.type })),
      { label: '↻  Reload add-ons', op: 'reload' },
    ];
    const it = await pick('Add an inlay', items);
    if (!it) return;
    if (it.op === 'reload') {
      busy = true;
      try { await api.addons('rescan'); } finally { busy = false; }
      continue;
    }
    const d = [...info.presets, ...info.widgets].find((x) => x.type === it.type);
    // Nothing is placed yet: choose where it goes first.
    const at = firstFree(d.size.w, d.size.h);
    return startPlace({ type: it.type, name: d.name, def: d, ...at, w: d.size.w, h: d.size.h });
  }
}

function flowPlaceExisting(t) {
  const def = { size: { w: t.w, h: t.h }, min: t.min, max: t.max, resizable: t.resizable };
  startPlace({ id: t.id, name: t.title, def, x: t.x, y: t.y, w: t.w, h: t.h });
}

// Settings → Add-ons: what's installed and where downloads go, sorted into
// sections. Rejected widgets say why (handy for people making their own).
async function flowAddons() {
  let op = 'list';
  let view = 'top';
  let index = 0;
  for (;;) {
    busy = true;
    let info;
    try { info = await api.addons(op); } finally { busy = false; }
    op = 'list';
    const inert = (label, sub) => ({ label, sub, info: true });
    let items;
    let title;
    if (view === 'top') {
      title = 'Add-ons';
      items = [
        { label: 'Installed', header: true },
        { label: 'Widgets', sub: `${info.widgets.length} installed${info.rejected.length ? ` · ${info.rejected.length} problem${info.rejected.length === 1 ? '' : 's'}` : ''}`, view: 'widgets' },
        { label: 'Themes', sub: info.themes.length ? `${info.themes.length} installed` : 'none installed', view: 'themes' },
        { label: 'Built in', sub: info.presets.map((p) => p.name).join(', '), view: 'builtin' },
        { label: 'Get more', header: true },
        { label: 'Where to put downloads', sub: 'widgets, themes, art, fonts, sounds', view: 'folders' },
        { label: '↻  Reload add-ons', op: 'reload' },
      ];
    } else if (view === 'widgets') {
      title = 'Add-ons · Widgets';
      items = info.widgets.map((w) => inert(w.name, [w.author, `${w.size.w} × ${w.size.h}${w.resizable ? ' · resizable' : ''}`].filter(Boolean).join(' · ')));
      info.rejected.forEach((x) => items.push(inert('⚠  ' + x.id, x.reason)));
      if (!items.length) items.push(inert('No widgets installed yet', info.dirs.widgets));
    } else if (view === 'themes') {
      title = 'Add-ons · Themes (A to switch)';
      items = [{ label: 'Tessera (stock)', sub: 'built in', theme: 'stock' }];
      info.themes.forEach((t) => items.push({ label: t.name, sub: [t.author, t.settings ? `${t.settings} extra setting${t.settings === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '), theme: t.id }));
      items.push(inert('Theme packs go in', info.dirs.themes));
    } else if (view === 'builtin') {
      title = 'Add-ons · Built in';
      items = info.presets.map((p) => inert(p.name, p.description || ''));
    } else {
      title = 'Add-ons · Where downloads go';
      items = [
        inert('Widgets', info.dirs.widgets),
        inert('Themes', info.dirs.themes),
        inert('Art', info.dirs.art),
        inert('Fonts', info.dirs.fonts),
        inert('Sounds', info.dirs.sounds),
      ];
    }
    const it = await pick(title, items, view === 'top' ? Math.max(index, 1) : 0);
    if (!it) {
      if (view === 'top') return;
      view = 'top';
      continue;
    }
    if (view === 'top') index = items.indexOf(it);
    if (it.view) view = it.view;
    else if (it.op === 'reload') op = 'rescan';
    else if (it.theme) {
      busy = true;
      try {
        const r = await api.settings('themeUse', { id: it.theme });
        if (r.theme) applyTheme(r.theme);
        setStatus(`Theme: ${it.label}`);
      } finally { busy = false; }
    }
  }
}

// Things in your library that aren't in this page yet.
function libraryChoices(into) {
  const have = new Set(((data.folders[into] || {}).tiles || []).map((t) => t.id));
  const rowTiles = (tabId, rowId) => ((data.tabs[tabId] || []).find((r) => r.id === rowId) || {}).tiles || [];
  const things = [...rowTiles('library', '_all_games'), ...rowTiles('apps', '_all_apps')];
  const folders = Object.entries(data.folders)
    .filter(([id]) => id !== '_home')
    .map(([id, f]) => ({ id, title: f.title, kind: 'folder' }));
  return [...things, ...folders].filter((t) => t.id !== into && !have.has(t.id));
}

async function flowAddExisting(into) {
  const choices = libraryChoices(into);
  const items = [{ label: 'Add selected', op: 'confirm' }];
  choices.forEach((t) =>
    items.push({ label: t.title, sub: { folder: 'Folder', app: 'App', game: 'Game' }[t.kind], checked: false, id: t.id })
  );
  openList({
    title: 'Add to this page',
    items,
    multi: true,
    onChoose: async (it) => {
      if (it.op !== 'confirm') {
        it.checked = !it.checked;
        return;
      }
      const ids = items.filter((x) => x.checked).map((x) => x.id);
      closeModal();
      let n = 0;
      let last = null;
      for (const id of ids) {
        last = await lib('addEntry', { catId: into, ref: id });
        if (last.ok) n++;
      }
      if (ids.length) setStatus(n ? `Added ${n}.` : last.error, !n);
    },
    onBack: () => closeModal(),
  });
}

// A new mosaic gets its own tab and opens straight away. A new folder
// (parent given) lives inside that page.
async function flowNewMosaic({ parent } = {}) {
  const title = await ask(parent ? 'Name your folder' : `Name your ${TERM}`);
  if (title === null) return;
  const r = await lib('newCategory', parent ? { title, parentId: parent } : { title });
  if (r.ok && r.id && !parent) {
    page = hoverId = 'm:' + r.id;
    stack = [];
    focus = 'content';
    render();
  }
}

function openMenu() {
  if (suspended || busy || modal || focus !== 'content') return;
  const t = selectedTile();
  const row = selectedRow();
  const catRow = Boolean(row) && Boolean(data.folders[row.id]);
  const renamable = catRow && row.id !== '_home';
  const inFolder = stack.length > 0;
  const items = [];
  const isThing = t && (t.kind === 'game' || t.kind === 'app' || t.kind === 'folder');
  if (isThing) {
    items.push({ label: `Add to a ${TERM} or folder…`, op: 'addTo' });
    if (catRow) items.push({ label: 'Remove from this page', op: 'removeFromRow' });
    if (t.kind === 'folder') {
      items.push({ label: 'Rename this folder…', op: 'renameTile' });
      items.push({ label: 'Delete this folder…', op: 'deleteTile' });
    } else {
      items.push({ label: 'Rename…', op: 'renameItem' });
      items.push({ label: 'Change picture…', op: 'pickArt' });
      if (t.custom) items.push({ label: 'Use the automatic picture', op: 'clearArt' });
      items.push({ label: 'Remove from library…', op: 'deleteItem' });
    }
  } else if (t && t.kind === 'inlay') {
    if (!t.missing) items.push({ label: t.resizable ? 'Move / resize…' : 'Move…', op: 'resize' });
    if (catRow) items.push({ label: 'Remove this widget', op: 'removeFromRow' });
  }
  if (homeMode()) items.push({ label: 'Add a widget…', op: 'addWidget' });
  if (renamable) {
    items.push({ label: inFolder ? 'Rename the open folder…' : `Rename this ${TERM}…`, op: 'renameRow' });
    items.push({ label: inFolder ? 'Delete the open folder…' : `Delete this ${TERM}…`, op: 'deleteRow' });
  }
  if (catRow) items.push({ label: 'New folder here…', op: 'newFolder' });
  items.push({ label: `New ${TERM}…`, op: 'newCat' });
  items.push({ label: 'Add a game from a file…', op: 'addGame' });
  items.push({ label: 'Add an app from a file…', op: 'addApp' });
  items.push({ label: 'Scan for games', op: 'scan' });
  pick('Options', items).then((it) => it && runMenu(it.op, t, row));
}

async function runMenu(op, t, row) {
  const into = row && data.folders[row.id] ? row.id : undefined;
  switch (op) {
    case 'addWidget': return flowAddInlay('_home');
    case 'addTo': return flowAddTo(t, row);
    case 'resize': return flowPlaceExisting(t);
    case 'removeFromRow': return lib('removeEntry', { catId: row.id, ref: t.id });
    case 'renameTile': return flowRename('renameCategory', t.id, t.title);
    case 'renameItem': return flowRename('renameItem', t.id, t.title);
    case 'pickArt': return flowBrowse('pickArt', undefined, undefined, t.id);
    case 'clearArt': return lib('clearArt', { id: t.id });
    case 'deleteTile':
      if (await confirm(`Delete “${t.title}”?`, 'Delete (things inside are kept)'))
        return lib('deleteCategory', { id: t.id });
      return;
    case 'deleteItem':
      if (await confirm(`Remove “${t.title}” from your library?`, 'Remove (files are not touched)'))
        return lib('deleteItem', { id: t.id });
      return;
    case 'renameRow': return flowRename('renameCategory', row.id, row.title);
    case 'deleteRow':
      if (await confirm(`Delete “${row.title}”?`, 'Delete (your games and apps are kept)'))
        return lib('deleteCategory', { id: row.id });
      return;
    case 'newFolder': return flowNewMosaic({ parent: into });
    case 'newCat': return flowNewMosaic({});
    case 'addGame': return flowBrowse('addGame', undefined, into);
    case 'addApp': return flowBrowse('addApp', undefined, into);
    case 'scan': return flowScan(into);
  }
}

async function flowRename(op, id, current) {
  const text = await ask('Rename', current);
  if (text !== null) await lib(op, { id, title: text });
}

async function flowAddTo(t, row) {
  const targets = Object.entries(data.folders)
    .filter(([id]) => id !== t.id && !(row && id === row.id))
    .map(([id, f]) => ({ label: f.title, id }));
  if (!targets.length) return setStatus(`Make a ${TERM} first (the + ${Term} tab).`, true);
  const choice = await pick(`Add “${t.title}” to…`, targets);
  if (choice) await lib('addEntry', { catId: choice.id, ref: t.id });
}

// Browse the file system through main. We only ever say "enter entry N".
async function flowBrowse(purpose, after, into, item) {
  busy = true;
  let r;
  try { r = await api.browse('start', { purpose, into, item }); } finally { busy = false; }
  showBrowse(r, purpose, after);
}
function showBrowse(r, purpose, after) {
  if (!r || r.error) {
    closeModal();
    setStatus((r && r.error) || 'Could not open that.', true);
    return after && after();
  }
  const items = [];
  if (r.canUp) items.push({ label: '⬆  Up one level', op: 'up' });
  if (r.canChooseHere) items.push({ label: '✔  Use this folder', op: 'here' });
  r.entries.forEach((e, i) =>
    items.push({ label: e.isDir && !r.renamable ? e.name + '/' : e.name, sub: e.sub, key: e.key, op: e.isDir ? 'enter' : 'choose', i })
  );
  const go = async (op, payload) => {
    busy = true;
    let res;
    try { res = await api.browse(op, payload); } finally { busy = false; }
    return res;
  };
  openList({
    title: r.crumb + (r.truncated ? '  (first 500 shown)' : ''),
    items,
    index: r.canUp ? (r.entries.length ? 1 + Number(Boolean(r.canChooseHere)) : 0) : 0,
    onChoose: async (it) => {
      if (it.op === 'up') return showBrowse(await go('up'), purpose, after);
      if (it.op === 'enter') return showBrowse(await go('enter', { index: it.i }), purpose, after);
      const res = await go('choose', { index: it.op === 'here' ? -1 : it.i });
      if (res.error) return setStatus(res.error, true);
      closeModal();
      if (res.view) applyView(res.view);
      if (res.theme) applyTheme(res.theme);
      setStatus(res.message);
      if (after) after();
    },
    // Y on a drive: give it a name you'd actually say.
    onY: r.renamable
      ? async (it) => {
          if (!it || !it.key) return;
          await renameDrive(it.key, '');
          showBrowse(await go('refresh'), purpose, after);
        }
      : undefined,
    onBack: async () => {
      if (r.canUp) return showBrowse(await go('up'), purpose, after);
      await go('close');
      closeModal();
      if (after) after();
    },
  });
}

async function renameDrive(key, current) {
  const name = await ask('Name this drive (empty = automatic name)', current || '');
  if (name === null) return false;
  busy = true;
  try { await api.settings('driveName', { key, name }); } finally { busy = false; }
  return true;
}

// Settings → Library folders → Name your drives.
async function flowDrives() {
  let index = 0;
  for (;;) {
    busy = true;
    let r;
    try { r = await api.settings('drives'); } finally { busy = false; }
    const items = r.drives.map((d) => ({ label: d.name, sub: d.tech, key: d.key, custom: d.custom }));
    if (!items.length) items.push({ label: 'No extra drives found', sub: 'Plug one in and open this again', header: true });
    const it = await pick('Your drives · A to rename', items, index);
    if (!it) return;
    if (!it.key) continue;
    index = items.indexOf(it);
    await renameDrive(it.key, it.custom ? it.label : '');
  }
}

async function flowRoots() {
  busy = true;
  let r;
  try { r = await api.settings('get'); } finally { busy = false; }
  const items = [{ label: '+  Add a folder…', op: 'add' }, { label: '✎  Name your drives…', op: 'drives' }];
  r.roots.forEach((p, i) => items.push({ label: p.name, sub: p.tech || 'A to remove', op: 'rm', i }));
  const it = await pick('Library folders (scanned for games)', items);
  if (!it) return;
  if (it.op === 'add') return flowBrowse('addRoot', flowRoots);
  if (it.op === 'drives') { await flowDrives(); return flowRoots(); }
  if (await confirm(`Stop scanning ${it.label}?`, 'Remove from list (files are not touched)')) {
    busy = true;
    try { await api.settings('removeRoot', { index: it.i }); } finally { busy = false; }
  }
  flowRoots();
}

// Settings → Button mapping. For now: which buttons the on-screen keyboard
// uses. Any button the system reports works here, including paddles and
// other extra buttons (numbered 17 and up in the Controller test).
async function flowControls() {
  let index = 1;
  for (;;) {
    busy = true;
    try { keymap = (await api.settings('getKeys')).keys; } finally { busy = false; }
    // These are settings rows, so Done and Cancel stay plain here (plain: true).
    const items = [{ label: 'Keyboard', header: true, fold: 'map.keyboard', open: true }];
    KEY_ACTIONS.forEach((a) => items.push({ label: a.label, sub: buttonName(keymap[a.id]), id: a.id, plain: true }));
    items.push({ label: 'Reset keyboard buttons', op: 'reset', plain: true });
    items.push({ label: 'Fixed buttons', header: true, fold: 'map.fixed' });
    [
      [buttonName(0), 'select'], [buttonName(1), 'back'], [buttonName(3), 'options'], [`${buttonName(4)} / ${buttonName(5)}`, 'switch tab'], ['D-pad', 'move'],
    ].forEach(([k, v]) => items.push({ label: k, sub: v, plain: true, info: true }));
    const it = await pick('Button mapping', items, index);
    if (!it) return;
    index = items.indexOf(it);
    if (it.info) continue;
    busy = true;
    try {
      if (it.op === 'reset') {
        keymap = (await api.settings('resetKeys')).keys;
        continue;
      }
    } finally {
      busy = false;
    }
    const n = await capture(it.label);
    if (n === null) continue;
    busy = true;
    try {
      const r = await api.settings('setKey', { action: it.id, button: n });
      keymap = r.keys;
      if (!r.ok) setStatus(r.error, true);
    } finally {
      busy = false;
    }
  }
}

// Desktop Mode is the login screen: Tessera closes, and the person signs in
// (password and all) to whichever session they pick. See tessera-session.
async function flowDesktop() {
  if (modal || busy) return;
  const ok = await confirm('Switch to Desktop Mode?  Tessera will close and the login screen will appear.');
  if (ok) api.quit();
}


// ------------------------------------------------------------ controller test
// Like the Game Controller page in desktop settings: what the system sees,
// live. Every button and stick is drawn, and raw numbers sit underneath, which
// also answers "which number is my A button?" for odd controllers.
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

function buildPad() {
  modalEl.className = 'pad';
  modalEl.replaceChildren();
  const box = document.createElement('div');
  box.className = 'box padbox';
  const title = document.createElement('h3');
  const sub = document.createElement('div');
  sub.className = 'padsub';
  const svg = svgEl('svg', { viewBox: '0 0 600 340', class: 'padsvg' });
  const parts = {};
  const btn = (index, tag, attrs, label, lx, ly) => {
    const g = svgEl('g', { class: 'pb' }, svg);
    svgEl(tag, attrs, g);
    if (label) {
      const t = svgEl('text', { x: lx, y: ly, class: 'pl', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      t.textContent = label;
    }
    parts[index] = g;
    return g;
  };
  // body
  svgEl('path', { class: 'pbody', d: 'M120 70 H480 Q560 70 575 170 L590 290 Q595 330 560 322 Q520 316 495 262 H105 Q80 316 40 322 Q5 330 10 290 L25 170 Q40 70 120 70 Z' }, svg);
  // shoulders and triggers
  btn(4, 'rect', { x: 95, y: 36, width: 120, height: 26, rx: 10 }, buttonName(4), 155, 49);
  btn(5, 'rect', { x: 385, y: 36, width: 120, height: 26, rx: 10 }, buttonName(5), 445, 49);
  parts.lt = svgEl('rect', { x: 105, y: 4, width: 100, height: 22, rx: 6, class: 'ptrig' }, svg);
  parts.ltf = svgEl('rect', { x: 105, y: 4, width: 0, height: 22, rx: 6, class: 'ptrigfill' }, svg);
  parts.rt = svgEl('rect', { x: 395, y: 4, width: 100, height: 22, rx: 6, class: 'ptrig' }, svg);
  parts.rtf = svgEl('rect', { x: 395, y: 4, width: 0, height: 22, rx: 6, class: 'ptrigfill' }, svg);
  for (const [x, t] of [[155, buttonName(6)], [445, buttonName(7)]]) { const l = svgEl('text', { x, y: 15, class: 'pl', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, svg); l.textContent = t; }
  // sticks: ring lights up on press (L3 / R3), the dot follows the stick
  const stick = (cx, cy, press, key) => {
    const g = svgEl('g', { class: 'pb' }, svg);
    svgEl('circle', { cx, cy, r: 46 }, g);
    parts[press] = g;
    parts[key] = svgEl('circle', { cx, cy, r: 20, class: 'pdot' }, svg);
  };
  stick(170, 150, 10, 'ls');
  stick(385, 245, 11, 'rs');
  // d-pad
  const dp = (i, x, y, w, h) => btn(i, 'rect', { x, y, width: w, height: h, rx: 6 });
  dp(12, 218, 200, 28, 34); dp(13, 218, 250, 28, 34); dp(14, 186, 232, 34, 28); dp(15, 246, 232, 34, 28);
  // face buttons
  btn(0, 'circle', { cx: 480, cy: 185, r: 22 }, buttonName(0), 480, 185);
  btn(1, 'circle', { cx: 520, cy: 148, r: 22 }, buttonName(1), 520, 148);
  btn(2, 'circle', { cx: 440, cy: 148, r: 22 }, buttonName(2), 440, 148);
  btn(3, 'circle', { cx: 480, cy: 111, r: 22 }, buttonName(3), 480, 111);
  // centre
  btn(8, 'circle', { cx: 262, cy: 130, r: 13 });
  btn(9, 'circle', { cx: 338, cy: 130, r: 13 });
  btn(16, 'circle', { cx: 300, cy: 100, r: 16 });
  const note = document.createElement('div');
  note.className = 'padnote';
  const raw = document.createElement('div');
  raw.className = 'padraw';
  const hint = document.createElement('div');
  hint.className = 'khint padhint';
  hint.textContent = `Press anything to see it light up. Triggers also rumble.   Hold ${buttonName(1)} to close.`;
  const bar = document.createElement('div');
  bar.className = 'padbar';
  const barFill = document.createElement('div');
  bar.appendChild(barFill);
  box.append(title, sub, svg, note, raw, hint, bar);
  modalEl.appendChild(box);
  modal.dom = { title, sub, parts, note, raw, barFill, rawBtns: [], rawAxes: [], rawCount: -1 };
}

function updatePad(pad, now) {
  const d = modal.dom;
  if (!d) return;
  if (!pad) {
    d.title.textContent = 'No controller detected';
    d.sub.textContent = 'Plug one in or turn it on, then press a button.';
    d.note.textContent = '';
    for (const k of Object.keys(d.parts)) if (d.parts[k].classList) d.parts[k].classList.remove('on');
    return;
  }
  const pads = [...navigator.getGamepads()].filter((p) => p && p.connected);
  const standard = pad.mapping === 'standard';
  d.title.textContent = pad.id.slice(0, 70);
  d.sub.textContent =
    `${standard ? 'Standard layout' : 'Non-standard layout (raw numbers only)'}  ·  ${pad.buttons.length} buttons  ·  ${pad.axes.length} axes` +
    (pads.length > 1 ? `  ·  ${pads.length} controllers connected` : '') +
    (modal.last === null ? '' : `  ·  last button: ${modal.last}`);
  const val = (n) => (n === 6 || n === 7 ? triggerValue(pad, n) : pad.buttons[n] ? pad.buttons[n].value : 0);
  const on = (n) => Boolean(pad.buttons[n] && pad.buttons[n].pressed);
  for (const n of [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    if (d.parts[n]) d.parts[n].classList.toggle('on', standard && on(n));
  }
  d.parts.ltf.setAttribute('width', String(Math.round(100 * val(6))));
  d.parts.rtf.setAttribute('width', String(Math.round(100 * val(7))));
  const ax = (i) => axisValue(pad, i); // after the person's calibration and deadzone
  d.parts.ls.setAttribute('transform', `translate(${(ax(0) * 26).toFixed(1)} ${(ax(1) * 26).toFixed(1)})`);
  d.parts.rs.setAttribute('transform', `translate(${(ax(2) * 26).toFixed(1)} ${(ax(3) * 26).toFixed(1)})`);
  const extra = pad.buttons.length - 17;
  d.note.textContent = standard
    ? `Left stick ${ax(0).toFixed(2)}, ${ax(1).toFixed(2)}   ·   Right stick ${ax(2).toFixed(2)}, ${ax(3).toFixed(2)}   ·   ${buttonName(6)} ${val(6).toFixed(2)}   ${buttonName(7)} ${val(7).toFixed(2)}` +
      (extra > 0 ? `   ·   ${extra} extra button${extra === 1 ? '' : 's'} (dashed): paddles, share or touchpad` : '')
    : 'This controller does not report the standard layout, so the picture above may not match. The numbers below are always right.';
  // raw numbers: built once per controller, then only toggled
  if (d.rawCount !== pad.buttons.length + ':' + pad.axes.length) {
    d.rawCount = pad.buttons.length + ':' + pad.axes.length;
    d.raw.replaceChildren();
    d.rawBtns = [];
    d.rawAxes = [];
    const bw = document.createElement('div');
    bw.className = 'rawbtns';
    for (let n = 0; n < pad.buttons.length; n++) {
      const c = document.createElement('span');
      c.className = 'rawb' + (n >= 17 ? ' extra' : '');
      c.textContent = n;
      bw.appendChild(c);
      d.rawBtns.push(c);
    }
    const aw = document.createElement('div');
    aw.className = 'rawaxes';
    for (let n = 0; n < pad.axes.length; n++) {
      const row = document.createElement('div');
      row.className = 'rawax';
      const lab = document.createElement('span');
      lab.textContent = 'axis ' + n;
      const track = document.createElement('div');
      track.className = 'axtrack';
      const dot = document.createElement('div');
      dot.className = 'axdot';
      track.appendChild(dot);
      const num = document.createElement('span');
      num.className = 'axnum';
      row.append(lab, track, num);
      aw.appendChild(row);
      d.rawAxes.push({ dot, num });
    }
    d.raw.append(bw, aw);
  }
  d.rawBtns.forEach((c, n) => c.classList.toggle('on', on(n)));
  d.rawAxes.forEach((a, n) => {
    a.dot.style.left = ((ax(n) + 1) * 50).toFixed(1) + '%';
    a.num.textContent = ax(n).toFixed(2);
  });
  // Rumble follows the triggers, in the strength and style the person picked.
  rumble(pad, val(6), val(7), now);
  // Hold B for a second to close (a quick B press is just a test of B).
  if (on(1)) {
    modal.bSince = modal.bSince || now;
    const f = Math.min(1, (now - modal.bSince) / 1000);
    d.barFill.style.width = f * 100 + '%';
    if (f >= 1) { closeModal(); return; }
  } else {
    modal.bSince = 0;
    d.barFill.style.width = '0%';
  }
}

const RUMBLE_LEVEL = { off: 0, low: 0.4, normal: 0.7, high: 1 };
function rumble(pad, lt, rt, now) {
  const level = RUMBLE_LEVEL[prefs.pad.rumble] ?? 0.7;
  if (!level || (lt <= 0 && rt <= 0) || !pad.vibrationActuator || now - (modal.rumbleAt || 0) < 180) return;
  modal.rumbleAt = now;
  const style = prefs.pad.style;
  let strong = lt;
  let weak = rt;
  if (style === 'both') strong = weak = Math.max(lt, rt);
  else if (style === 'pulse' && Math.floor(now / 180) % 2) strong = weak = 0;
  try {
    pad.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: 220, strongMagnitude: strong * level, weakMagnitude: weak * level });
  } catch { /* not every controller can rumble */ }
}

// Resolves when the tester is closed.
function flowPad() {
  return new Promise((resolve) => {
    modal = { kind: 'pad', dom: null, last: null, bSince: 0, onClose: resolve };
    modalEl.hidden = false;
    buildPad();
    updatePad(activePad(), performance.now());
  });
}

// Settings → Controller: the live test, plus what the system should do with
// what the controller reports.
const PAD_LABELS = {
  rumble: { off: 'Off', low: 'Low', normal: 'Normal', high: 'High' },
  style: { split: 'Left trigger = left motor, right = right', both: 'Both motors together', pulse: 'Pulsing' },
  glyphs: { auto: 'Automatic (match my controller)', xbox: 'Xbox  (A B X Y)', playstation: 'PlayStation  (✕ ○ □ △)', nintendo: 'Nintendo  (B A Y X)' },
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function padSet(key, value) {
  busy = true;
  try {
    const r = await api.settings('padSet', { key, value });
    if (r.ok) { prefs.pad = { ...PAD_DEFAULTS, ...r.pad }; prefs.calib = r.calib; applyGlyphs(); }
  } finally { busy = false; }
}
async function calibratePad() {
  const first = activePad();
  if (!first) return setStatus('No controller detected. Press a button on it first.', true);
  const id = padKey(first);
  const it = await pick('Let go of both sticks and triggers, then choose Calibrate', [
    { label: 'Calibrate now', op: 'go' },
    { label: 'Clear calibration', op: 'clear' },
    { label: 'Cancel' },
  ]);
  if (!it || !it.op) return;
  busy = true;
  try {
    let offsets = null;
    if (it.op === 'go') {
      const sums = new Array(Math.min(first.axes.length, 8)).fill(0);
      let n = 0;
      for (let i = 0; i < 24; i++) {
        await sleep(25);
        const p = activePad();
        if (!p || padKey(p) !== id) break;
        sums.forEach((_s, k) => { sums[k] += p.axes[k] || 0; });
        n++;
      }
      if (!n) return setStatus('Lost the controller. Try again.', true);
      // Only small drifts are "resting offset". A trigger that rests at -1 isn't one.
      offsets = sums.map((s) => (Math.abs(s / n) <= 0.4 ? s / n : 0));
    }
    const r = await api.settings('padCalib', { id, offsets });
    if (r.ok) { prefs.calib = r.calib; setStatus(it.op === 'go' ? 'Sticks calibrated.' : 'Calibration cleared.'); }
    else setStatus(r.error || "Couldn't save that.", true);
  } finally { busy = false; }
}
async function flowPadMenu() {
  if (modal || busy) return;
  let index = 1;
  const steps = (lo, hi, st) => { const o = []; for (let v = lo; v <= hi; v += st) o.push(v); return o; };
  const pickNumber = async (title, key, lo, hi, st) => {
    const vals = steps(lo, hi, st);
    const items = vals.map((v) => ({ label: v + '%', sub: v === prefs.pad[key] ? 'current' : '', v }));
    const it = await pick(title, items, Math.max(0, vals.indexOf(prefs.pad[key])));
    if (it) await padSet(key, it.v);
  };
  const pickChoice = async (title, key) => {
    const opts = Object.entries(PAD_LABELS[key]);
    const items = opts.map(([v, label]) => ({ label, sub: v === prefs.pad[key] ? 'current' : '', v }));
    const it = await pick(title, items, Math.max(0, opts.findIndex(([v]) => v === prefs.pad[key])));
    if (it) await padSet(key, it.v);
  };
  for (;;) {
    const calibrated = prefs.calib[(activePad() || { id: '' }).id.slice(0, 80)];
    const items = [
      { label: 'Test', header: true, fold: 'pad.test', open: true },
      { label: 'Test your controller', sub: 'live buttons, sticks and triggers', op: 'test' },
      { label: 'Sticks and triggers', header: true, fold: 'pad.sticks', open: true },
      { label: 'Stick deadzone', sub: prefs.pad.deadzone + '%', op: 'deadzone' },
      { label: 'Calibrate sticks', sub: calibrated ? 'calibrated' : 'not calibrated', op: 'calib' },
      { label: 'Trigger sensitivity', sub: prefs.pad.trigger + '% to register', op: 'trigger' },
      { label: 'Vibration', header: true, fold: 'pad.rumble', open: true },
      { label: 'Vibration strength', sub: PAD_LABELS.rumble[prefs.pad.rumble], op: 'rumble' },
      { label: 'Vibration style', sub: PAD_LABELS.style[prefs.pad.style], op: 'style' },
      { label: 'Labels', header: true, fold: 'pad.labels', open: true },
      { label: 'Button labels', sub: PAD_LABELS.glyphs[prefs.pad.glyphs].split('  (')[0], op: 'glyphs' },
    ];
    const it = await pick('Controller', items, index);
    if (!it) return;
    index = items.indexOf(it);
    if (it.op === 'test') await flowPad();
    else if (it.op === 'deadzone') await pickNumber('Stick deadzone · ignore small movements', 'deadzone', 0, 40, 5);
    else if (it.op === 'trigger') await pickNumber('Trigger sensitivity · how far to pull before it counts', 'trigger', 0, 50, 5);
    else if (it.op === 'calib') await calibratePad();
    else if (it.op === 'rumble') await pickChoice('Vibration strength', 'rumble');
    else if (it.op === 'style') await pickChoice('Vibration style (the test uses this)', 'style');
    else if (it.op === 'glyphs') await pickChoice('Button labels', 'glyphs');
  }
}


// ------------------------------------------------------------ color wheel
// Hue is the angle, saturation the distance from the centre, and brightness
// is its own slider. Left stick moves on the wheel, right stick or LB / RB
// change brightness, Y types a hex code, A applies, B cancels.
function hsvToHex(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: mx ? d / mx : 0, v: mx };
}
const WHEEL_PX = 280;
function drawWheel(canvas, v) {
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(WHEEL_PX, WHEEL_PX);
  const rad = WHEEL_PX / 2;
  for (let y = 0; y < WHEEL_PX; y++) {
    for (let x = 0; x < WHEEL_PX; x++) {
      const dx = (x + 0.5 - rad) / rad;
      const dy = (y + 0.5 - rad) / rad;
      const d = Math.hypot(dx, dy);
      if (d > 1) continue;
      const hex = hsvToHex(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, d, v);
      const i = (y * WHEEL_PX + x) * 4;
      const n = parseInt(hex.slice(1), 16);
      img.data[i] = n >> 16; img.data[i + 1] = (n >> 8) & 255; img.data[i + 2] = n & 255; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
// Resolves { color } when applied, { hex: true, color } when the person wants to type a code, or null.
function pickColor(title, start) {
  return new Promise((resolve) => {
    const hsv = hexToHsv(/^#[0-9a-f]{6}$/i.test(start) ? start : '#ffffff');
    modal = { kind: 'color', title, orig: start, ...hsv, resolve, t: 0, dom: null, drawnV: -1 };
    buildColor();
    updateColor(null, performance.now());
  });
}
function buildColor() {
  modalEl.hidden = false;
  modalEl.className = 'color';
  modalEl.replaceChildren();
  const box = document.createElement('div');
  box.className = 'box colorbox';
  const h = document.createElement('h3');
  h.textContent = modal.title;
  const body = document.createElement('div');
  body.className = 'colorbody';
  const wrap = document.createElement('div');
  wrap.className = 'wheelwrap';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = WHEEL_PX;
  canvas.className = 'wheel';
  const mark = document.createElement('div');
  mark.className = 'wheelmark';
  wrap.append(canvas, mark);
  const side = document.createElement('div');
  side.className = 'colorside';
  const sw = document.createElement('div');
  sw.className = 'swatches';
  const was = document.createElement('div');
  was.className = 'sw';
  const now = document.createElement('div');
  now.className = 'sw';
  sw.append(was, now);
  const hexEl = document.createElement('div');
  hexEl.className = 'hexval';
  const bright = document.createElement('div');
  bright.className = 'brightbar';
  const fill = document.createElement('div');
  bright.appendChild(fill);
  const hint = document.createElement('div');
  hint.className = 'khint colorhint';
  hint.textContent = `Left stick: move on the wheel\nRight stick or ${buttonName(4)} / ${buttonName(5)}: brightness\n${buttonName(3)}: type a hex code   ${buttonName(2)}: undo\n${buttonName(0)}: apply   ${buttonName(1)}: cancel`;
  side.append(sw, hexEl, bright, hint);
  body.append(wrap, side);
  box.append(h, body);
  modalEl.appendChild(box);
  was.style.background = /^#[0-9a-f]{6}$/i.test(modal.orig) ? modal.orig : '#ffffff';
  modal.dom = { canvas, mark, now, hexEl, fill };
}
function updateColor(pad, now) {
  const d = modal.dom;
  if (!d) return;
  const dt = modal.t ? Math.min(0.05, (now - modal.t) / 1000) : 0;
  modal.t = now;
  if (pad && dt) {
    // left stick: move the cursor on the disc. right stick up/down: brightness.
    const dx = axisValue(pad, 0);
    const dy = axisValue(pad, 1);
    if (dx || dy) {
      let x = modal.s * Math.cos((modal.h * Math.PI) / 180) + dx * dt * 1.1;
      let y = modal.s * Math.sin((modal.h * Math.PI) / 180) + dy * dt * 1.1;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      modal.s = Math.min(1, len);
      if (len > 0.0001) modal.h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }
    const by = axisValue(pad, 3);
    if (by) modal.v = Math.max(0, Math.min(1, modal.v - by * dt * 0.7));
  }
  if (Math.abs(modal.drawnV - modal.v) > 0.01) { drawWheel(d.canvas, modal.v); modal.drawnV = modal.v; }
  const hex = hsvToHex(modal.h, modal.s, modal.v);
  modal.hex = hex;
  const a = (modal.h * Math.PI) / 180;
  d.mark.style.left = (50 + 50 * modal.s * Math.cos(a)) + '%';
  d.mark.style.top = (50 + 50 * modal.s * Math.sin(a)) + '%';
  d.now.style.background = hex;
  d.hexEl.textContent = hex.toUpperCase();
  d.fill.style.width = Math.round(modal.v * 100) + '%';
}
function colorPress(act) {
  const step = 0.04;
  const a = (modal.h * Math.PI) / 180;
  let x = modal.s * Math.cos(a);
  let y = modal.s * Math.sin(a);
  if (act === 'left') x -= step;
  else if (act === 'right') x += step;
  else if (act === 'up') y -= step;
  else if (act === 'down') y += step;
  else return;
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  modal.s = Math.min(1, len);
  if (len > 0.0001) modal.h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  updateColor(null, performance.now());
}
function colorButton(n) {
  const m = modal;
  if (n === 0) { const color = m.hex; closeModal(); m.resolve({ color }); }
  else if (n === 1) { closeModal(); m.resolve(null); }
  else if (n === 3) { const color = m.hex; closeModal(); m.resolve({ hex: true, color }); }
  else if (n === 2) { Object.assign(m, hexToHsv(/^#[0-9a-f]{6}$/i.test(m.orig) ? m.orig : '#ffffff')); updateColor(null, performance.now()); }
  else if (n === 4 || n === 5) { m.v = Math.max(0, Math.min(1, m.v + (n === 5 ? 0.05 : -0.05))); updateColor(null, performance.now()); }
}

// Settings → Theme Settings. What's here comes from the active theme, so a
// theme can add settings of its own (see themes/<id>/theme.json).
const COLOR_PRESETS = [
  ['Blue', '#7fb2ff'], ['Sky', '#5ad1ff'], ['Teal', '#3ddc97'], ['Green', '#7ed957'], ['Yellow', '#ffd166'],
  ['Orange', '#ff9f45'], ['Red', '#ff6b6b'], ['Pink', '#ff7ac8'], ['Purple', '#b794f6'], ['White', '#ffffff'],
  ['Light gray', '#c9ced6'], ['Gray', '#3b475a'], ['Charcoal', '#1a222c'], ['Midnight', '#10151c'], ['Black', '#000000'],
];
function themeValueText(s) {
  if (s.type === 'range') return s.value + (s.unit || '');
  if (s.type === 'choice') return (s.options.find((o) => o.value === s.value) || {}).label || String(s.value);
  if (s.type === 'toggle') return s.value ? 'On' : 'Off';
  if (s.type === 'image') return s.value || 'None';
  const hit = COLOR_PRESETS.find(([, hex]) => hex === s.value);
  return hit ? `${hit[0]}  ${s.value}` : s.value;
}
async function themeSet(id, value) {
  busy = true;
  try {
    const r = await api.settings('themeSet', { id, value });
    if (r.theme) applyTheme(r.theme);
    if (!r.ok) setStatus(r.error, true);
  } finally { busy = false; }
}
async function flowTheme() {
  if (modal || busy) return;
  let index = 1;
  for (;;) {
    busy = true;
    let t;
    try { t = await api.settings('themeGet'); } finally { busy = false; }
    applyTheme(t);
    const active = t.themes.find((x) => x.id === t.active);
    const items = [{ label: 'Theme', header: true }, { label: active ? active.name : 'Tessera Bright', sub: t.themes.length > 1 ? 'A to switch' : 'more themes: Add-ons', op: 'switch', plain: true }];
    let group = null;
    for (const s of t.settings) {
      if (s.group !== group) { group = s.group; items.push({ label: group, header: true, fold: 'theme.' + group }); }
      items.push({ label: s.label, sub: themeValueText(s), op: 'set', s, plain: true });
    }
    items.push({ label: 'Reset', header: true });
    items.push({ label: 'Reset this theme to defaults', op: 'reset', plain: true });
    const it = await pick('Theme Settings', items, index);
    if (!it) return;
    index = items.indexOf(it);
    if (it.op === 'reset') {
      if (await confirm('Reset every Theme Setting to its default?')) {
        busy = true;
        try { const r = await api.settings('themeReset'); if (r.theme) applyTheme(r.theme); } finally { busy = false; }
      }
    } else if (it.op === 'switch') {
      const pickT = await pick('Choose a theme', t.themes.map((x) => ({ label: x.name, sub: x.id === t.active ? 'current' : x.author, id: x.id })));
      if (pickT) {
        busy = true;
        try { const r = await api.settings('themeUse', { id: pickT.id }); if (r.theme) applyTheme(r.theme); } finally { busy = false; }
      }
    } else if (it.op === 'set') await editThemeSetting(it.s);
  }
}
async function editThemeSetting(s) {
  if (s.type === 'toggle') return themeSet(s.id, !s.value);
  if (s.type === 'range') {
    const vals = [];
    for (let v = s.min; v <= s.max + 1e-9; v += s.step) vals.push(Math.round(v * 1000) / 1000);
    const it = await pick(s.label + (s.hint ? '  ·  ' + s.hint : ''), vals.slice(0, 60).map((v) => ({ label: v + (s.unit || ''), sub: v === s.value ? 'current' : '', v })), Math.max(0, vals.indexOf(s.value)));
    if (it) await themeSet(s.id, it.v);
  } else if (s.type === 'choice') {
    const it = await pick(s.label, s.options.map((o) => ({ label: o.label, sub: o.value === s.value ? 'current' : '', v: o.value })), Math.max(0, s.options.findIndex((o) => o.value === s.value)));
    if (it) await themeSet(s.id, it.v);
  } else if (s.type === 'color') {
    const items = [
      { label: 'Color wheel…', sub: 'pick by eye', op: 'wheel', plain: true },
      { label: 'Hex code…', sub: s.value.toUpperCase(), op: 'hex', plain: true },
      { label: 'Presets', header: true, fold: 'color.presets' },
      ...COLOR_PRESETS.map(([name, hex]) => ({ label: name, sub: hex + (hex === s.value ? '  ·  current' : ''), v: hex, plain: true })),
      { label: 'Default', sub: s.default, v: s.default, plain: true },
    ];
    const it = await pick(s.label, items);
    if (!it) return;
    if (it.op === 'wheel' || it.op === 'hex') {
      let hex = s.value;
      let typing = it.op === 'hex';
      for (;;) {
        if (typing) {
          const txt = await ask('Hex code, like #ff8800', hex);
          if (txt === null) return;
          const m = /^#?([0-9a-f]{6})$/i.exec(txt.trim());
          if (!m) { setStatus('That is not a 6-digit hex code.', true); continue; }
          hex = '#' + m[1].toLowerCase();
          typing = false;
        }
        const res = await pickColor(s.label, hex);
        if (!res) return;
        hex = res.color;
        if (res.hex) { typing = true; continue; }
        await themeSet(s.id, hex);
        return;
      }
    } else await themeSet(s.id, it.v);
  } else if (s.type === 'image') {
    const it = await pick(s.label, [
      { label: 'Choose a picture…', sub: 'PNG, JPEG or WebP, up to 12 MB', op: 'pick' },
      ...(s.value ? [{ label: 'Remove picture', op: 'none' }] : []),
      { label: 'Cancel' },
    ]);
    if (!it || !it.op) return;
    if (it.op === 'none') await themeSet(s.id, '');
    else await new Promise((res) => flowBrowse('pickImage', res));
  }
}

async function flowScan(into) {
  if (modal || busy) return;
  setStatus('Scanning your library folders…');
  busy = true;
  let r;
  try {
    r = await api.scan('run');
  } finally {
    busy = false;
  }
  if (!r.found.length)
    return setStatus(r.notes || 'No new games found. Heroic, Lutris and installed games are checked automatically; add library folders for Steam and PS5 games.', Boolean(r.notes));
  setStatus(r.notes || '', Boolean(r.notes));
  const items = [{ label: 'Add selected games', op: 'confirm' }];
  r.found.forEach((f) => items.push({ label: f.title, sub: f.source, checked: !f.optional, cid: f.cid }));
  openList({
    title: `Found ${r.found.length} new game${r.found.length === 1 ? '' : 's'}`,
    items,
    multi: true,
    onChoose: async (it) => {
      if (it.op !== 'confirm') {
        it.checked = !it.checked;
        return;
      }
      const cids = items.filter((x) => x.checked).map((x) => x.cid);
      closeModal();
      busy = true;
      let res;
      try { res = await api.scan('add', { cids, into }); } finally { busy = false; }
      applyView(res.view);
      setStatus(res.ok ? res.message : res.error, !res.ok);
    },
    onBack: () => { closeModal(); setStatus('Nothing added.'); },
  });
}

// ------------------------------------------------------------------ input

// Hold Y for 3 seconds on a tab (any but Settings and + Mosaic) to pick it up, then move it with
// left/right. Any other press puts it down. (Deliberately not shown on screen.)
function liftTarget() {
  const id = focus === 'tabs' ? hoverId : page;
  return data.tabOrder.includes(id) && !stack.length ? id : null;
}
function startHold() {
  cancelHold();
  if (modal || reorderId || place || !liftTarget()) return;
  holdTimer = setTimeout(() => {
    holdTimer = null;
    yTap = false;
    const id = liftTarget();
    if (!id || modal) return;
    focus = 'tabs'; // the tab bar takes over; D-pad / stick slide the tab
    hoverId = id;
    reorderId = id;
    update();
  }, REORDER_HOLD_MS);
}
function cancelHold() {
  clearTimeout(holdTimer);
  holdTimer = null;
}
// Y on a mosaic: tap = Options, hold 3 s = pick it up. Elsewhere Y is just Options.
function yDown() {
  if (modal || reorderId || place || !liftTarget()) return press('y');
  yTap = focus === 'content';
  startHold();
}
function yUp() {
  const pending = holdTimer !== null;
  cancelHold();
  if (yTap && pending) { yTap = false; press('y'); }
  yTap = false;
}
async function reorderPress(act) {
  if (act === 'left' || act === 'right') {
    await lib('moveTab', { id: reorderId, dir: act === 'left' ? -1 : 1 }, { quiet: true });
    update();
    return;
  }
  reorderId = null;
  update();
}

function press(act) {
  if (suspended || busy) return;
  if (modal) return modalPress(act);
  if (reorderId) return reorderPress(act);
  if (place) return placePress(act);
  if (act === 'lb' || act === 'rb') {
    moveTabs(act === 'lb' ? -1 : 1);
    if (hoverId === 'browser') launchBrowser(); // arriving on it with a bumper opens it
    return;
  }
  if (focus === 'tabs') {
    // On the tab bar: left/right move the pointer; down or A go to the tiles,
    // except on "+ Mosaic", which is a button.
    if (act === 'left') return moveTabs(-1);
    if (act === 'right') return moveTabs(1);
    if (act === 'down' || act === 'a') {
      if (hoverId === 'new') return flowNewMosaic({});
      if (hoverId === 'browser') return launchBrowser();
      focus = 'content';
      return update();
    }
    return;
  }
  switch (act) {
    case 'left': return moveCol(-1);
    case 'right': return moveCol(1);
    case 'up': return moveRow(-1);
    case 'down': return moveRow(1);
    case 'a': return activate();
    case 'b': return stack.length ? back() : undefined;
    case 'y': return openMenu();
  }
}

// One controller button went down.
function onButton(n) {
  if (modal && modal.kind === 'capture') {
    if (RESERVED_BUTTONS.includes(n)) {
      modal.note = `${buttonName(n)} can't be used here. Try another button.`;
      return renderModal();
    }
    return modal.finish(n);
  }
  if (suspended || busy) return;
  if (modal && modal.kind === 'pad') { modal.last = n; return; } // the tester just watches
  if (modal && modal.kind === 'color') return colorButton(n);
  if (modal && modal.kind === 'keys') return keysButton(n);
  if (modal && modal.kind === 'list') {
    if (n === 3 && modal.onY) modal.onY(modal.items[modal.index]);
    else if (n === 3) return;
    else { const nm = BUTTON_NAMES_BY_ROLE[n]; if (nm) press(nm); }
    return;
  }
  if (n === 3) return yDown();
  const name = BUTTON_NAMES_BY_ROLE[n];
  if (name) press(name);
}
function onRelease(n) {
  if (n === 3 && !modal) yUp();
}

api.onInit((payload) => {
  applyView(payload);
  if (payload.error) setStatus(payload.error, true);
});

function resume(message) {
  suspended = false;
  prevBtn[0] = true; // if A is still held, don't relaunch until it's released
  setStatus(message, Boolean(message));
}
api.onGameExited(resume);
// Closing the browser with LB / RB lands on the neighbouring tab.
api.onShiftTab((dir) => { hoverId = 'browser'; moveTabs(dir); });
api.onLaunchFailed(resume);

// Prefer a standard-mapped pad, but fall back to any connected one.
let lastPadId = null;
function activePad() {
  let fallback = null;
  for (const p of navigator.getGamepads()) {
    if (!p || !p.connected) continue;
    if (p.mapping === 'standard') return p;
    fallback = fallback || p;
  }
  return fallback;
}

function loop(now) {
  const pad = suspended ? null : activePad();
  if (pad) {
    if (pad.id !== lastPadId) {
      lastPadId = pad.id;
      applyGlyphs(); // "automatic" labels follow whichever controller is in use
      setStatus(`Controller: ${pad.id} [${pad.mapping || 'non-standard'}]`);
    }
    const b = (n) => Boolean(pad.buttons[n] && pad.buttons[n].pressed);
    const wheel = modal && modal.kind === 'color'; // on the color wheel the stick moves the cursor smoothly instead
    const sx = wheel ? 0 : axisValue(pad, 0);
    const sy = wheel ? 0 : axisValue(pad, 1);
    const left = b(14) || sx < -0.5;
    const right = b(15) || sx > 0.5;
    const up = b(12) || sy < -0.5;
    const down = b(13) || sy > 0.5;

    if ((left || right || up || down) && now - lastNav > NAV_REPEAT_MS) {
      if (!(modal && modal.kind === 'capture')) press(left ? 'left' : right ? 'right' : up ? 'up' : 'down');
      lastNav = now;
    }
    // Every button fires once per press (and once on release).
    const count = Math.min(pad.buttons.length, prevBtn.length);
    for (let n = 0; n < count; n++) {
      if (n >= 12 && n <= 15) continue; // the D-pad is handled above
      const isDown = b(n);
      if (isDown && !prevBtn[n]) onButton(n);
      if (!isDown && prevBtn[n]) onRelease(n);
      prevBtn[n] = isDown;
    }

  }
  if (modal && modal.kind === 'pad') updatePad(pad, now);
  if (modal && modal.kind === 'color') updateColor(pad, now);
  requestAnimationFrame(loop);
}

// Keyboard fallback, handy for testing without a controller.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (modal && modal.kind === 'capture') {
    if (e.key === 'Escape') modal.finish(null);
    return;
  }
  if (modal && modal.kind === 'pad') {
    if (e.key === 'Escape') closeModal();
    return;
  }
  if (modal && modal.kind === 'color') {
    const k = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
    if (k) colorPress(k);
    else if (e.key === 'Enter') colorButton(0);
    else if (e.key === 'Escape') colorButton(1);
    else if (e.key === 'h') colorButton(3);
    else if (e.key === 'PageUp' || e.key === ']') colorButton(5);
    else if (e.key === 'PageDown' || e.key === '[') colorButton(4);
    return;
  }
  if (suspended || busy) return;
  if (modal && modal.kind === 'keys') {
    if (e.key.length === 1) { typeChar(e.key); return e.preventDefault(); }
    if (e.key === 'Enter') return finishKeys(true);
    if (e.key === 'Escape') return finishKeys(false);
    if (e.key === 'Backspace') return keyAction('back');
  }
  const map = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    Enter: 'a', Escape: 'b', Backspace: 'b', PageUp: 'lb', PageDown: 'rb',
  };
  if (e.key === 'y') return e.repeat ? undefined : yDown();
  const act = map[e.key] || (e.key === 'x' ? 'x' : null);
  if (act) press(act);
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'y') yUp();
});
window.addEventListener('resize', update);

render();
requestAnimationFrame(loop); // one loop, started once
