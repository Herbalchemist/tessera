// SPDX-License-Identifier: GPL-3.0-or-later
// State, tabs, and the pages: Home's grid, the status clock and widgets.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ------------------------------------------------------------------ state

let data = { tabs: { library: [], apps: [] }, folders: {}, mosaics: [], tabOrder: ['home', 'library', 'apps'] };
let page = 'home';          // the page on screen: home, library, apps, m:<id>, settings
let hoverId = 'home';       // the tab the tab bar is pointing at (can be "new")
let focus = 'content';      // 'tabs' (the tab bar) or 'content' (the tiles)
const cursor = {};          // per page/folder: { row, cols: { rowId: col } }
let stack = [];             // open folders: [{ id, title }]
let suspended = false;      // true while a game is running
let busy = false;           // true while waiting on the main process
let nestedView = false;     // Tessera was started from the desktop (Return to Tessera), not as the session itself
let artRev = 0;             // bumps when a game picture changes, so tiles reload it
let modal = null;
let holdTimer = null;
let reorderId = null;       // mosaic being moved with the tab bar
let place = null;           // an inlay being placed or resized on Home's grid
let yTap = false;           // Y went down on the tiles: a tap opens Options, a long hold lifts the mosaic
let escHeld = false;        // Escape is down on the keyboard: Esc+Left/Right swaps tabs instead of going back
let escChordUsed = false;   // true once that chord fired, so releasing Esc doesn't also trigger "back"
const prevBtn = new Array(32).fill(false);
const wasBig = {};          // rows that showed the big empty tile last render

const statusLog = []; // the last few messages, for the guide
// opts.log: false for passing remarks that aren't worth a notification (a controller taking over).
let busyTimer = 0;
function setStatus(msg, isError, opts = {}) {
  if (msg && opts.log !== false && msg !== 'Starting…' && (!statusLog.length || statusLog[0].msg !== msg)) {
    statusLog.unshift({ msg, isError: Boolean(isError), at: Date.now() });
    statusLog.length = Math.min(statusLog.length, 6);
  }
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', Boolean(isError));
  // While a game starts, the pointer becomes the busy one: Tessera's symbol building itself (the
  // system's "progress" pointer, from icons/Tessera). Back to normal on the next message, or after a
  // minute in case the game never says anything.
  document.body.classList.toggle('busy', msg === 'Starting…');
  clearTimeout(busyTimer);
  if (msg === 'Starting…') busyTimer = setTimeout(() => document.body.classList.remove('busy'), 60000);
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
  if (page === 'settings') return settingsRows();
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
  const own = (prefs.pageGrid || {})[curKey()]; // this page's own size, if it has one
  if (own) { cols = own.cols; rows = own.rows; }
  const gapPct = Math.max(20, Math.min(240, Number(get('tileGap')) || 100));
  const icons = ['animated', 'still', 'off'].includes(get('setIcons')) ? get('setIcons') : 'animated';
  return { mode, cols: Math.max(2, Math.min(12, cols)), rows: Math.max(1, Math.min(8, rows)), gapPct, pack: get('setPack') === true, notes: get('setNotes') !== false, icons, shell: shellLayoutOf(prefs.theme), parts: layoutPartsOf(prefs.theme) };
}
function currentRows() {
  const base = baseRows();
  const { mode, cols } = layoutCfg();
  if (mode === 'rails' || homeMode()) return base;
  if (base.length === 1 && base[0].tiles.length === 1 && base[0].tiles[0].big) return base; // the big empty tile stays big
  // Grid: all the tiles on the page, cut into rows of `cols`. Everything that moves between rows
  // and tiles (D-pad, selection, menus) works on these rows like on any other.
  const out = [];
  // Flow grids are wider than the screen: two extra columns wait off to the sides.
  const per = mode === 'flow' ? cols + 2 : cols;
  if (base.some((r) => r.cat) && mode === 'grid' && layoutCfg().pack) {
    // Settings, groups side by side: whole groups share a row while they fit, in their own order.
    // Each keeps its title, above its own tiles. A group wider than the grid still gets rows of its own.
    let row = null;
    const flush = () => { if (row) out.push(row); row = null; };
    for (const r of base) {
      if (r.tiles.length > per) {
        flush();
        for (let i = 0; i < r.tiles.length; i += per) out.push({ id: r.id + ':' + i / per, title: i === 0 ? r.title : '', cat: true, tiles: r.tiles.slice(i, i + per) });
        continue;
      }
      if (row && row.tiles.length + r.tiles.length > per) flush();
      if (!row) row = { id: r.id, title: r.title, cat: true, tiles: [], segs: [] };
      else row.id += '+' + r.id;
      row.segs.push({ title: r.title, n: r.tiles.length });
      row.tiles = row.tiles.concat(r.tiles);
    }
    flush();
    return out.length ? out : base;
  }
  if (base.some((r) => r.cat)) {
    // A page in groups (Settings): each group is cut into rows of its own, and its title sits above the first.
    for (const r of base) {
      for (let i = 0; i < r.tiles.length; i += per) out.push({ id: r.id + ':' + i / per, title: i === 0 ? r.title : '', cat: true, tiles: r.tiles.slice(i, i + per) });
    }
    return out.length ? out : base;
  }
  const tiles = base.flatMap((r) => r.tiles);
  for (let i = 0; i < tiles.length; i += per) out.push({ id: 'grid:' + i / per, title: '', tiles: tiles.slice(i, i + per) });
  return out.length ? out : base;
}

function cur() {
  const k = curKey();
  return (cursor[k] = cursor[k] || { row: 0, cols: {} });
}

// Line icons for the tabs. Most shells show only the names; shells built around round
// buttons (Home row, Channels) show these instead, with the name under the focused one.
const TAB_ICONS = {
  browser: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.6 5.2 3.6 8.5s-1 6.1-3.6 8.5M12 3.5c-2.6 2.4-3.6 5.2-3.6 8.5s1 6.1 3.6 8.5"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6.5 9.5V19h11V9.5"/><path d="M10.5 19v-5h3v5"/>',
  library: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  apps: '<circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="7" r="2.3"/><circle cx="7" cy="17" r="2.3"/><circle cx="17" cy="17" r="2.3"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18"/>',
  new: '<path d="M12 5v14M5 12h14"/>',
  mosaic: '<rect x="4" y="4" width="9" height="9" rx="1.5"/><rect x="15" y="4" width="5" height="5" rx="1"/><rect x="15" y="11" width="5" height="9" rx="1"/><rect x="4" y="15" width="9" height="5" rx="1"/>',
};
function tabKind(id) { return id.startsWith('m:') ? 'mosaic' : id; }
function drawTabs() {
  tabsEl.replaceChildren();
  tabList().forEach((id) => {
    const el = document.createElement('span');
    el.className = 'tab';
    el.dataset.tab = tabKind(id);
    const ico = document.createElement('i');
    ico.className = 'tab-ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = `<svg viewBox="0 0 24 24">${TAB_ICONS[tabKind(id)] || TAB_ICONS.mosaic}</svg>`;
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tabName(id);
    el.append(ico, name);
    tabsEl.appendChild(el);
  });
}

// ---- a status clock, shown by the shells that have one (top corner, or the curved bar).
function clockBar() {
  let bar = document.getElementById('clockbar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'clockbar';
  bar.innerHTML = '<span class="cb-who" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4"/><path d="M4.5 20c1.4-3.6 4.2-5.2 7.5-5.2s6.1 1.6 7.5 5.2"/></svg></span><span class="cb-time"></span><span class="cb-date"></span>';
  document.body.insertBefore(bar, document.body.firstChild);
  return bar;
}
function tickClock() {
  const bar = clockBar();
  const now = new Date();
  bar.querySelector('.cb-time').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  bar.querySelector('.cb-date').textContent = now.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });
}
tickClock();
setInterval(tickClock, 10000);
// Decorations a shell can show: a picture layer for Spotlight, a turning cube for Cube.
(function decorations() {
  const spot = document.createElement('div');
  spot.id = 'spotlight';
  spot.setAttribute('aria-hidden', 'true');
  const cube = document.createElement('div');
  cube.id = 'cube-emblem';
  cube.setAttribute('aria-hidden', 'true');
  const spin = document.createElement('div');
  spin.className = 'spin';
  for (const face of ['f', 'b', 'l', 'r', 't', 'u']) {
    const el = document.createElement('i');
    el.className = face;
    spin.appendChild(el);
  }
  cube.appendChild(spin);
  document.body.append(spot, cube);
})();
// The Spotlight shell paints the selected tile's art across the whole screen.
function syncSpotlight() {
  if (document.body.dataset.partSpot !== 'on') return;
  const card = rowsEl.querySelector('.card.active');
  if (!card) return; // on the tab bar: keep the last picture
  const art = card.style.backgroundImage || (card._art ? `url("${card._art}")` : '');
  const next = art && art !== 'none' ? art : 'none';
  if (document.body.style.getPropertyValue('--hero') !== next) document.body.style.setProperty('--hero', next);
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
  if (dir === shellLayoutInfo().contentExit) {
    focus = 'tabs'; // leave Home toward the shell's visible navigation edge
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
  document.body.dataset.shellLayout = lc.shell;
  applyLayoutParts(prefs.theme);
  rowsEl.className = 'rows shell-' + lc.shell + (lc.mode === 'rails' ? '' : ' ' + lc.mode) + (page === 'settings' && !stack.length ? ' cats' : '') + (lc.icons === 'animated' ? ' icons-anim' : '');
  rowsEl.parentElement.classList.toggle('flowmask', lc.mode === 'flow');
  const pageKey = page + '/' + stack.map((s) => s.id).join('/');
  if (pageKey !== rowsEl._key) { rowsEl._key = pageKey; rowsEl._ty = 0; }
  const rows = currentRows();
  rows.forEach((row) => {
    const wrap = document.createElement('section');
    wrap.className = 'row';
    const label = document.createElement('h2');
    label.textContent = row.title;
    if (row.cat && row.title) label.className = 'cat'; // the group titles on Settings stay visible; other row titles are hidden by the style sheet
    if (row.segs && row.segs.length > 1) {
      // groups side by side: one title over each group's own tiles
      label.textContent = '';
      label.classList.add('segs');
      for (const sg of row.segs) { const sp = document.createElement('span'); sp.textContent = sg.title; sp.style.setProperty('--n', sg.n); label.appendChild(sp); }
    }
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
        kind.textContent = t.offline ? (t.offline === 'drive' ? 'Drive not connected' : 'Files missing') : (t.kind === 'action' && t.sub) || { folder: 'Folder', app: 'App', game: 'Game' }[t.kind] || '';
        if (t.offline) card.classList.add('offline');
        if (t.warn) card.classList.add('warn');
        const name = document.createElement('span');
        name.textContent = t.title;
        card.append(kind, name);
        if (t.icon && lc.icons !== 'off' && ICONS[t.icon]) { card.prepend(iconEl(t.icon)); card.classList.add('has-ico'); }
        if (t.art) {
          card.classList.add('has-art');
          card._art = `tessera-art://item/${encodeURIComponent(t.id)}?v=${artRev}`; // loaded by artWindow() once the tile is near the selection
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
  if (page === 'settings' && !stack.length && typeof refreshTileNotes === 'function') refreshTileNotes();
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
  const { gapPct } = layoutCfg();
  const gap = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.2 * gapPct / 100; // the same space between columns and between rows
  const w = Math.max(200, vp.clientWidth - gap * 2 - 24);
  const h = Math.max(160, vp.clientHeight);
  let cw = (w - (cols - 1) * gap) / cols;
  const padv = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.1; // a little room above the first row for the selected tile's grow and outline
  const titleH = rowsEl.classList.contains('cats') ? parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.7 : 0; // a group title takes a little room too
  const fitH = (h - padv - titleH - rows * gap) / rows;
  // A shell can ask for a fixed tile shape (height / width), e.g. wide channels or square tiles.
  // Then the tiles keep that shape and get narrower instead of squashed when height runs out.
  const aspect = parseFloat(getComputedStyle(document.body).getPropertyValue('--tile-aspect'));
  let ch;
  if (aspect > 0) {
    ch = Math.max(90, Math.min(cw * aspect, fitH));
    cw = Math.min(cw, ch / aspect);
  } else {
    ch = Math.max(90, Math.min(cw * 1.5, fitH));
  }
  rowsEl.style.setProperty('--cols', String(cols));
  rowsEl.style.setProperty('--padv', padv.toFixed(1) + 'px');
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
    artWindowFor(rail, r, c.row, col);
    const card = rail.children[col];
    const lmode = layoutCfg().mode;
    if (lmode === 'grid') rail.style.transform = 'none';
    else if (lmode === 'flow') {
      // The grid slides under the selector: whatever column is selected sits in the middle.
      const sel = rows[c.row] ? c.cols[rows[c.row].id] || 0 : 0;
      const ref = rowsEl.querySelectorAll('.row')[c.row].querySelector('.rail').children[sel];
      const w = rail.parentElement.clientWidth;
      rail.style.transform = ref ? `translateX(${w / 2 - (ref.offsetLeft + ref.offsetWidth / 2)}px)` : 'none';
      const gt = wrap.querySelector('h2.cat'); // a group title slides with its row, so it stays above the first tile
      if (gt) gt.style.transform = rail.style.transform;
    } else if (card) {
      const w = rail.parentElement.clientWidth;
      // Spotlight keeps the selection at the start of its row, like the console it honors;
      // every other shell keeps it in the middle.
      if (lmode === 'rails' && layoutCfg().parts.row === 'start') rail.style.transform = `translateX(${-card.offsetLeft}px)`;
      else rail.style.transform = `translateX(${w / 2 - (card.offsetLeft + card.offsetWidth / 2)}px)`;
    }
  });
  syncSpotlight();
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
      const head = parseFloat(rowsEl.style.getPropertyValue('--padv')) || 0; // the room the first row has above it
      let ty = rowsEl._ty || 0;
      if (mode === 'flow') ty = h / 2 - (top + activeRow.offsetHeight / 2);
      else if (top + ty < head - 0.5) ty = head - top; // scrolling back up keeps that room, as scrolling down already does: the selected tile's grow and glow aren't cut, and the next row doesn't peek in below
      else if (bot + ty > h) ty = h - bot;
      ty = Math.max(minTy, Math.min(0, ty));
      rowsEl._ty = ty;
      rowsEl.style.transform = `translateY(${ty}px)`;
      // With the pastel glow the tile grid lets light spill past its edge, so rows whose tiles have scrolled wholly out of view are hidden instead of peeking in.
      for (const w of rowsEl.querySelectorAll('.row')) {
        const tiles = w.querySelector('.rail') || w; // the tiles, without the gap that follows them
        const t0 = tiles.offsetTop + ty;
        w.classList.toggle('off', selOn && mode === 'grid' && (t0 >= h - 2 || t0 + tiles.offsetHeight <= 2));
      }
    }
  }
  paintSelection();
  const t = selectedTile();
  titleEl.textContent = !inTiles
    ? hoverId === 'new' ? `${pressTo(0)} to create a ${TERM}` : hoverId === 'browser' ? `${pressTo(0)} to open your browser` : tabName(hoverId)
    : t && !t.big ? t.title : '';
}

// Game pictures are only loaded for tiles near the selection, and let go again when
// the selection moves away. A library of hundreds of tiles then keeps a couple of
// dozen pictures in memory instead of all of them.
const ART_COLS = 10; // tiles either side of the selected one (a rail shows about 7 at a time)
function loadArt(card) {
  if (card && card._art && !card.style.backgroundImage) card.style.backgroundImage = `url("${card._art}")`;
}
function dropArt(card) {
  if (card && card.style.backgroundImage) card.style.removeProperty('background-image');
}
function artWindow(rail, lo, hi) {
  const cards = rail.children;
  const from = Math.max(0, lo);
  const to = Math.min(cards.length - 1, hi);
  const was = rail._artWin || { lo: 0, hi: -1 };
  for (let i = was.lo; i <= was.hi; i++) if (i < from || i > to) dropArt(cards[i]);
  for (let i = from; i <= to; i++) if (i < was.lo || i > was.hi) loadArt(cards[i]);
  rail._artWin = to >= from ? { lo: from, hi: to } : { lo: 0, hi: -1 };
}
function dropAllArt() {
  for (const rail of rowsEl.querySelectorAll('.rail')) artWindow(rail, 0, -1);
}
function artWindowFor(rail, rowIdx, selRow, col) {
  const lc = layoutCfg();
  const rowsNear = lc.mode === 'rails' ? 2 : lc.rows + 1;
  if (Math.abs(rowIdx - selRow) > rowsNear) return artWindow(rail, 0, -1);
  if (lc.mode === 'rails') return artWindow(rail, col - ART_COLS, col + ART_COLS);
  artWindow(rail, 0, rail.children.length - 1); // a grid row is only a few tiles wide
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
  // Dashboard navigation lives on the left. Once the selection reaches the
  // left edge, another Left moves into the sidebar instead of doing nothing.
  if (shellLayoutInfo().contentExit === 'left' && d < 0 && (c.cols[row.id] || 0) === 0) {
    focus = 'tabs';
    hoverId = page;
    return update();
  }
  c.cols[row.id] = Math.max(0, Math.min(row.tiles.length - 1, (c.cols[row.id] || 0) + d));
  update();
}
function moveRow(d) {
  if (homeMode()) return homeMove(d < 0 ? 'up' : 'down');
  const c = cur();
  const rows = currentRows();
  // In the bottom-dock shell, Down from the last content row lands on the
  // dock. Classic and Crossbar retain their familiar Up-to-navigation rule.
  if (shellLayoutInfo().contentExit === 'down' && d > 0 && c.row === rows.length - 1) {
    focus = 'tabs';
    hoverId = page;
    return update();
  }
  if (d < 0 && c.row === 0) {
    focus = 'tabs'; // up from the top row lands on the tab bar
    hoverId = page;
    return update();
  }
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

// The Browser tab is a real embedded page (a <webview>), not a separate launched
// application: full screen, no Tessera chrome over it, Y pops up a Go-to-address
// prompt using the same on-screen keyboard as everything else. LB / RB close it,
// same as closing any other tab, landing on the neighbour.
let browserOpen = false;
let browserUrl = 'https://duckduckgo.com/';
let urlBarOpening = false;
function normalizeUrl(v) {
  const s = (v || '').trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s; // already has a scheme
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return 'https://' + s; // looks like a bare address
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s); // treat it as a search
}
