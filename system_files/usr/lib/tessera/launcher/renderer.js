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
const QUIT_HOLD_MS = 1500;
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
const buttonName = (n) => BUTTON_NAMES[n] || `Button ${n}`;
const BUTTON_NAMES_BY_ROLE = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb' };
const RESERVED_BUTTONS = [0, 12, 13, 14, 15];
let keymap = { back: 1, space: 2, shift: 3, done: 9, cancel: 8 };

// Settings is built in. These are actions, not launchable items.
const SETTINGS_ROWS = [
  {
    id: '_settings',
    title: 'System',
    tiles: [
      { id: '_roots', title: 'Library folders', kind: 'action' },
      { id: '_scan', title: 'Scan for games', kind: 'action' },
      { id: '_controls', title: 'Controls', kind: 'action' },
      { id: '_addons', title: 'Add-ons', kind: 'action' },
      { id: '_desktop', title: 'Desktop Mode', kind: 'action' },
      { id: '_quit', title: 'Exit to login screen', kind: 'action' },
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
let modal = null;
let lastNav = 0;
let quitSince = null;
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

function currentRows() {
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
      }
      rail.appendChild(card);
    });
    viewport.appendChild(rail);
    wrap.append(label, viewport);
    rowsEl.appendChild(wrap);

    // The big empty tile "splits" into real tiles once something is added.
    const big = row.tiles.length === 1 && row.tiles[0].big;
    if (wasBig[row.id] && !big) {
      const mid = rail.scrollWidth / 2;
      [...rail.children].forEach((card, i) => {
        card.style.setProperty('--from', `${mid - (card.offsetLeft + card.offsetWidth / 2)}px`);
        card.style.setProperty('--i', i);
      });
      rail.classList.add('split');
    }
    wasBig[row.id] = big;
  });
  clamp();
  update();
  tickInlays();
}

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
    if (card) {
      const w = rail.parentElement.clientWidth;
      rail.style.transform = `translateX(${w / 2 - (card.offsetLeft + card.offsetWidth / 2)}px)`;
    }
  });
  const activeRow = rowsEl.querySelectorAll('.row')[c.row];
  if (activeRow) {
    const h = rowsEl.parentElement.clientHeight;
    rowsEl.style.transform = `translateY(${h / 2 - (activeRow.offsetTop + activeRow.offsetHeight / 2)}px)`;
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
  c.row = Math.max(0, Math.min(currentRows().length - 1, c.row + d));
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
  if (!tabList().includes(page)) {
    page = 'home';
    stack = [];
  }
  if (!tabList().includes(hoverId)) hoverId = page;
  while (stack.length && !data.folders[stack[stack.length - 1].id]) stack.pop();
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
    if (t.id === '_quit') api.quit();
    else if (t.id === '_roots') flowRoots();
    else if (t.id === '_scan') flowScan();
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
  modal = null;
  modalEl.hidden = true;
  modalEl.className = '';
  modalEl.replaceChildren();
}

// A list the controller can scroll. Used for menus, pickers and the browser.
function openList({ title, items, index = 0, multi = false, onChoose, onBack }) {
  modal = { kind: 'list', title, items, index, multi, onChoose, onBack };
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
      el.className = 'key' + (SPECIAL[k] ? ' wide' : '');
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
  modal.items.forEach((it, n) => {
    const el = document.createElement('div');
    el.className = 'mitem' + (n === modal.index ? ' active' : '');
    const mark = modal.multi && 'checked' in it ? (it.checked ? '☑  ' : '☐  ') : '';
    el.textContent = mark + it.label;
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
  const active = list.children[modal.index];
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

function modalPress(act) {
  if (modal.kind === 'capture') return;
  if (modal.kind === 'list') {
    const n = modal.items.length;
    if (act === 'up') modal.index = Math.max(0, modal.index - 1);
    else if (act === 'down') modal.index = Math.min(Math.max(0, n - 1), modal.index + 1);
    else if (act === 'a' && n) modal.onChoose(modal.items[modal.index]);
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

async function confirm(question, yesLabel) {
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

// Settings → Add-ons: what's installed, where downloads go, and why a widget
// was rejected (handy for people making their own).
async function flowAddons() {
  let op = 'list';
  for (;;) {
    busy = true;
    let info;
    try { info = await api.addons(op); } finally { busy = false; }
    const items = [{ label: `Widgets (${info.widgets.length})`, sub: info.dirs.widgets, info: true }];
    info.widgets.forEach((w) =>
      items.push({ label: '    ' + w.name, sub: [w.author, `${w.size.w} × ${w.size.h}${w.resizable ? ' · resizable' : ''}`].filter(Boolean).join(' · '), info: true })
    );
    info.rejected.forEach((r) => items.push({ label: '    ⚠ ' + r.id, sub: r.reason, info: true }));
    items.push({ label: `Themes (${info.themeCount} found, support coming)`, sub: info.dirs.themes, info: true });
    items.push({ label: 'Art', sub: info.dirs.art, info: true });
    items.push({ label: 'Fonts', sub: info.dirs.fonts, info: true });
    items.push({ label: 'Sounds', sub: info.dirs.sounds, info: true });
    items.push({ label: '↻  Reload add-ons', op: 'reload' });
    const it = await pick('Add-ons · downloads go in these folders', items, items.length - 1);
    if (!it) return;
    op = it.op === 'reload' ? 'rescan' : 'list';
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
async function flowBrowse(purpose, after, into) {
  busy = true;
  let r;
  try { r = await api.browse('start', { purpose, into }); } finally { busy = false; }
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
    items.push({ label: e.isDir ? e.name + '/' : e.name, op: e.isDir ? 'enter' : 'choose', i })
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
      applyView(res.view);
      setStatus(res.message);
      if (after) after();
    },
    onBack: async () => {
      if (r.canUp) return showBrowse(await go('up'), purpose, after);
      await go('close');
      closeModal();
      if (after) after();
    },
  });
}

async function flowRoots() {
  busy = true;
  let r;
  try { r = await api.settings('get'); } finally { busy = false; }
  const items = [{ label: '+  Add a folder…', op: 'add' }];
  r.roots.forEach((p, i) => items.push({ label: p, sub: 'A to remove', op: 'rm', i }));
  const it = await pick('Library folders (scanned for games)', items);
  if (!it) return;
  if (it.op === 'add') return flowBrowse('addRoot', flowRoots);
  if (await confirm(`Stop scanning ${it.label}?`, 'Remove from list (files are not touched)')) {
    busy = true;
    try { await api.settings('removeRoot', { index: it.i }); } finally { busy = false; }
  }
  flowRoots();
}

// Settings → Controls. For now: which buttons the on-screen keyboard uses.
async function flowControls() {
  let index = 0;
  for (;;) {
    busy = true;
    try { keymap = (await api.settings('getKeys')).keys; } finally { busy = false; }
    const items = KEY_ACTIONS.map((a) => ({ label: a.label, sub: buttonName(keymap[a.id]), id: a.id }));
    items.push({ label: 'Reset to defaults', op: 'reset' });
    const it = await pick('Controls · On-screen keyboard buttons', items, index);
    if (!it) return;
    index = items.indexOf(it);
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
  const ok = await confirm('Switch to Desktop Mode?', 'Yes: close Tessera and show the login screen');
  if (ok) api.quit();
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
  if (modal && modal.kind === 'keys') return keysButton(n);
  if (n === 3) return yDown();
  const name = BUTTON_NAMES_BY_ROLE[n];
  if (name) press(name);
}
function onRelease(n) {
  if (n === 3) yUp();
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
      setStatus(`Controller: ${pad.id} [${pad.mapping || 'non-standard'}]`);
    }
    const b = (n) => Boolean(pad.buttons[n] && pad.buttons[n].pressed);
    const left = b(14) || pad.axes[0] < -0.5;
    const right = b(15) || pad.axes[0] > 0.5;
    const up = b(12) || pad.axes[1] < -0.5;
    const down = b(13) || pad.axes[1] > 0.5;

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

    // Hold View (8) + Menu (9) to quit, no keyboard needed.
    if (b(8) && b(9) && !modal) {
      if (quitSince === null) quitSince = now;
      else if (now - quitSince > QUIT_HOLD_MS) api.quit();
    } else {
      quitSince = null;
    }
  }
  requestAnimationFrame(loop);
}

// Keyboard fallback, handy for testing without a controller.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (modal && modal.kind === 'capture') {
    if (e.key === 'Escape') modal.finish(null);
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
