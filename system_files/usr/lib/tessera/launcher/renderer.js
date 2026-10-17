// SPDX-License-Identifier: GPL-3.0-or-later
const tabsEl = document.getElementById('tabs');
const rowsEl = document.getElementById('rows');
const crumbEl = document.getElementById('crumb');
const titleEl = document.getElementById('title');
const statusEl = document.getElementById('status');

const NAV_REPEAT_MS = 200;
const QUIT_HOLD_MS = 1500;
const TAB_IDS = ['home', 'library', 'apps', 'settings'];
const TAB_NAMES = { home: 'Home', library: 'Library', apps: 'Apps', settings: 'Settings' };

// Settings is built in. Actions, not launchable items.
const SETTINGS_ROWS = [
  {
    id: '_settings',
    title: 'System',
    tiles: [
      { id: '_desktop', title: 'Desktop Mode', kind: 'action' },
      { id: '_quit', title: 'Exit to login screen', kind: 'action' },
    ],
  },
];

let data = { tabs: { home: [], library: [], apps: [] }, folders: {} };
let tab = 0;
// Where you were in each tab: row, plus the column remembered per row.
const cursor = {};          // key -> { row, cols: {rowId: col} }
let stack = [];             // open folders: [{ id, title }]
let suspended = false;      // true while a game is running
let lastNav = 0;
let quitSince = null;
const prev = {};            // edge detection for one-shot buttons

function setStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', Boolean(isError));
}

// The rows currently on screen: a folder if one is open, else the tab's rows.
function currentRows() {
  if (stack.length) {
    const top = stack[stack.length - 1];
    const f = data.folders[top.id];
    return [{ id: top.id, title: top.title, tiles: f ? f.tiles : [] }];
  }
  const id = TAB_IDS[tab];
  return id === 'settings' ? SETTINGS_ROWS : data.tabs[id] || [];
}

function curKey() {
  return stack.length ? 'f:' + stack[stack.length - 1].id : TAB_IDS[tab];
}
function cur() {
  const k = curKey();
  return (cursor[k] = cursor[k] || { row: 0, cols: {} });
}

function drawTabs() {
  tabsEl.replaceChildren();
  TAB_IDS.forEach((id, n) => {
    const el = document.createElement('span');
    el.className = 'tab' + (n === tab ? ' active' : '');
    el.textContent = TAB_NAMES[id];
    tabsEl.appendChild(el);
  });
}

function render() {
  drawTabs();
  crumbEl.textContent = stack.length ? [TAB_NAMES[TAB_IDS[tab]], ...stack.map((s) => s.title)].join('  ›  ') : '';
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
      card.className = 'card kind-' + t.kind;
      const kind = document.createElement('small');
      kind.textContent = t.kind === 'folder' ? 'Folder' : t.kind === 'app' ? 'App' : t.kind === 'game' ? 'Game' : '';
      const name = document.createElement('span');
      name.textContent = t.title;
      card.append(kind, name);
      rail.appendChild(card);
    });
    viewport.appendChild(rail);
    wrap.append(label, viewport);
    rowsEl.appendChild(wrap);
  });
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = stack.length ? 'This folder is empty.' : 'Nothing here yet.';
    rowsEl.appendChild(empty);
  }
  clamp();
  update();
}

function clamp() {
  const rows = currentRows();
  const c = cur();
  c.row = Math.max(0, Math.min(rows.length - 1, c.row));
  rows.forEach((r) => {
    const col = c.cols[r.id] || 0;
    c.cols[r.id] = Math.max(0, Math.min(r.tiles.length - 1, col));
  });
}

// Highlight the selection and slide rows/rails using real measurements.
function update() {
  const rows = currentRows();
  const c = cur();
  [...rowsEl.querySelectorAll('.row')].forEach((wrap, r) => {
    const active = r === c.row;
    wrap.classList.toggle('active', active);
    const rail = wrap.querySelector('.rail');
    const col = (rows[r] && c.cols[rows[r].id]) || 0;
    [...rail.children].forEach((card, n) => card.classList.toggle('active', active && n === col));
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
  titleEl.textContent = t ? t.title : '';
}

function selectedTile() {
  const rows = currentRows();
  const c = cur();
  const row = rows[c.row];
  return row ? row.tiles[c.cols[row.id] || 0] : null;
}

function moveCol(d) {
  const row = currentRows()[cur().row];
  if (!row) return;
  const c = cur();
  c.cols[row.id] = Math.max(0, Math.min(row.tiles.length - 1, (c.cols[row.id] || 0) + d));
  update();
}
function moveRow(d) {
  const c = cur();
  c.row = Math.max(0, Math.min(currentRows().length - 1, c.row + d));
  update();
}
function switchTab(d) {
  if (suspended) return;
  tab = (tab + d + TAB_IDS.length) % TAB_IDS.length;
  stack = [];
  setStatus('');
  render();
}
function back() {
  if (!stack.length) return;
  stack.pop();
  render();
}

function activate() {
  const t = selectedTile();
  if (!t || suspended) return;
  if (t.kind === 'folder') {
    stack.push({ id: t.id, title: t.title });
    render();
  } else if (t.kind === 'action') {
    if (t.id === '_quit') window.launcherAPI.quit();
    else setStatus('Desktop Mode is not available yet.');
  } else {
    suspended = true;
    setStatus('Starting…');
    window.launcherAPI.launch(t.id);
  }
}

window.launcherAPI.onInit((payload) => {
  data = { tabs: payload.tabs, folders: payload.folders };
  render();
  if (payload.error) setStatus(payload.error, true);
  else if (!TAB_IDS.slice(0, 3).some((id) => data.tabs[id].length))
    setStatus('Add games to library.json to see them here.');
});

function resume(message) {
  suspended = false;
  prev.a = true; // if A is still held, don't relaunch until it's released
  setStatus(message, Boolean(message));
}
window.launcherAPI.onGameExited(resume);
window.launcherAPI.onLaunchFailed(resume);

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
      if (left) moveCol(-1);
      else if (right) moveCol(1);
      else if (up) moveRow(-1);
      else moveRow(1);
      lastNav = now;
    }

    // One-shot buttons fire on a fresh press only.
    const edge = (name, n, fn) => {
      const down = b(n);
      if (down && !prev[name]) fn();
      prev[name] = down;
    };
    edge('a', 0, activate);
    edge('b', 1, back);
    edge('lb', 4, () => switchTab(-1));
    edge('rb', 5, () => switchTab(1));

    // Hold View (8) + Menu (9) to quit, no keyboard needed.
    if (b(8) && b(9)) {
      if (quitSince === null) quitSince = now;
      else if (now - quitSince > QUIT_HOLD_MS) window.launcherAPI.quit();
    } else {
      quitSince = null;
    }
  }
  requestAnimationFrame(loop);
}

// Keyboard fallback, handy for testing without a controller.
window.addEventListener('keydown', (e) => {
  if (suspended) return;
  const k = e.key;
  if (k === 'ArrowLeft') moveCol(-1);
  else if (k === 'ArrowRight') moveCol(1);
  else if (k === 'ArrowUp') moveRow(-1);
  else if (k === 'ArrowDown') moveRow(1);
  else if (k === 'Enter') activate();
  else if (k === 'Escape' || k === 'Backspace') back();
  else if (k === 'PageUp') switchTab(-1);
  else if (k === 'PageDown') switchTab(1);
});
window.addEventListener('resize', update);

render();
requestAnimationFrame(loop); // one loop, started once
