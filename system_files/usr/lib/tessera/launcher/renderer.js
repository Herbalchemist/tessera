// SPDX-License-Identifier: GPL-3.0-or-later
const api = window.launcherAPI;
const tabsEl = document.getElementById('tabs');
const rowsEl = document.getElementById('rows');
const crumbEl = document.getElementById('crumb');
const titleEl = document.getElementById('title');
const statusEl = document.getElementById('status');
const modalEl = document.getElementById('modal');

const NAV_REPEAT_MS = 200;
const QUIT_HOLD_MS = 1500;
const MAX_TEXT = 40;
const TAB_IDS = ['home', 'library', 'apps', 'settings'];
const TAB_NAMES = { home: 'Home', library: 'Library', apps: 'Apps', settings: 'Settings' };

// Settings is built in. These are actions, not launchable items.
const SETTINGS_ROWS = [
  {
    id: '_settings',
    title: 'System',
    tiles: [
      { id: '_roots', title: 'Library folders', kind: 'action' },
      { id: '_scan', title: 'Scan for games', kind: 'action' },
      { id: '_desktop', title: 'Desktop Mode', kind: 'action' },
      { id: '_quit', title: 'Exit to login screen', kind: 'action' },
    ],
  },
];

let data = { tabs: { home: [], library: [], apps: [] }, folders: {} };
let tab = 0;
const cursor = {};          // per tab/folder: { row, cols: { rowId: col } }
let stack = [];             // open folders: [{ id, title }]
let suspended = false;      // true while a game is running
let busy = false;           // true while waiting on the main process
let modal = null;
let lastNav = 0;
let quitSince = null;
const prev = {};            // edge detection for one-shot buttons

function setStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', Boolean(isError));
}

// ------------------------------------------------------------ home screen

function currentRows() {
  if (stack.length) {
    const top = stack[stack.length - 1];
    const f = data.folders[top.id];
    return [{ id: top.id, title: f ? f.title : top.title, tiles: f ? f.tiles : [] }];
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
  crumbEl.textContent = stack.length
    ? [TAB_NAMES[TAB_IDS[tab]], ...stack.map((s) => s.title)].join('  ›  ')
    : '';
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
      kind.textContent =
        { folder: 'Folder', app: 'App', game: 'Game' }[t.kind] || '';
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
    empty.textContent = stack.length
      ? 'This folder is empty. Press Y to add things.'
      : 'Nothing here yet. Press Y to add a game or a category.';
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
    c.cols[r.id] = Math.max(0, Math.min(r.tiles.length - 1, c.cols[r.id] || 0));
  });
}

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

function selectedRow() {
  return currentRows()[cur().row] || null;
}
function selectedTile() {
  const row = selectedRow();
  return row ? row.tiles[cur().cols[row.id] || 0] || null : null;
}

function moveCol(d) {
  const row = selectedRow();
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

// Replace what's on screen with a fresh view from the main process.
function applyView(view) {
  if (!view) return;
  data = { tabs: view.tabs, folders: view.folders };
  while (stack.length && !data.folders[stack[stack.length - 1].id]) stack.pop();
  render();
}

function activate() {
  const t = selectedTile();
  if (!t) return;
  if (t.kind === 'folder') {
    stack.push({ id: t.id, title: t.title });
    render();
  } else if (t.kind === 'action') {
    if (t.id === '_quit') api.quit();
    else if (t.id === '_roots') flowRoots();
    else if (t.id === '_scan') flowScan();
    else setStatus('Desktop Mode is not available yet.');
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
  modalEl.replaceChildren();
}

// A list the controller can scroll. Used for menus, pickers and the browser.
function openList({ title, items, index = 0, multi = false, onChoose, onBack }) {
  modal = { kind: 'list', title, items, index, multi, onChoose, onBack };
  renderModal();
}
// Resolves with the chosen item, or null if the user backs out.
function pick(title, items) {
  return new Promise((resolve) => {
    openList({
      title,
      items,
      onChoose: (it) => { closeModal(); resolve(it); },
      onBack: () => { closeModal(); resolve(null); },
    });
  });
}

// On-screen keyboard. Resolves with the text, or null on cancel.
const KEY_ROWS = [
  '1234567890'.split(''),
  'qwertyuiop'.split(''),
  "asdfghjkl'".split(''),
  'zxcvbnm-.&'.split(''),
  ['shift', 'space', 'back', 'cancel', 'done'],
];
const SPECIAL = { shift: 'Shift', space: 'Space', back: '⌫', cancel: 'Cancel', done: 'Done' };

function ask(title, initial = '') {
  return new Promise((resolve) => {
    modal = { kind: 'keys', title, text: initial.slice(0, MAX_TEXT), shift: false, r: 1, c: 0, resolve };
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

function renderModal() {
  if (!modal) return;
  modalEl.hidden = false;
  modalEl.replaceChildren();
  const box = document.createElement('div');
  box.className = 'box';
  const h = document.createElement('h3');
  h.textContent = modal.title;
  box.appendChild(h);

  if (modal.kind === 'list') {
    const list = document.createElement('div');
    list.className = 'mlist';
    modal.items.forEach((it, n) => {
      const el = document.createElement('div');
      el.className = 'mitem' + (n === modal.index ? ' active' : '');
      const box_ = modal.multi && 'checked' in it ? (it.checked ? '☑  ' : '☐  ') : '';
      el.textContent = box_ + it.label;
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
  } else {
    const field = document.createElement('div');
    field.className = 'field';
    field.textContent = modal.text;
    const caret = document.createElement('span');
    caret.className = 'caret';
    field.appendChild(caret);
    box.appendChild(field);
    const grid = document.createElement('div');
    grid.className = 'keys';
    KEY_ROWS.forEach((row, r) => {
      const line = document.createElement('div');
      line.className = 'krow';
      row.forEach((k, c) => {
        const el = document.createElement('div');
        const special = SPECIAL[k];
        el.className =
          'key' +
          (special ? ' wide' : '') +
          (k === 'shift' && modal.shift ? ' on' : '') +
          (r === modal.r && c === modal.c ? ' active' : '');
        el.textContent = special || (modal.shift ? k.toUpperCase() : k);
        line.appendChild(el);
      });
      grid.appendChild(line);
    });
    box.appendChild(grid);
    const hint = document.createElement('p');
    hint.className = 'khint';
    hint.textContent = 'A type   B delete   X space   Y shift';
    box.appendChild(hint);
    modalEl.appendChild(box);
  }
}

function modalPress(act) {
  if (modal.kind === 'list') {
    const n = modal.items.length;
    if (act === 'up') modal.index = Math.max(0, modal.index - 1);
    else if (act === 'down') modal.index = Math.min(Math.max(0, n - 1), modal.index + 1);
    else if (act === 'a' && n) modal.onChoose(modal.items[modal.index]);
    else if (act === 'b') modal.onBack();
    renderModal();
    return;
  }
  // keyboard
  if (act === 'left') modal.c = Math.max(0, modal.c - 1);
  else if (act === 'right') modal.c = Math.min(KEY_ROWS[modal.r].length - 1, modal.c + 1);
  else if (act === 'up') modal.r = Math.max(0, modal.r - 1);
  else if (act === 'down') modal.r = Math.min(KEY_ROWS.length - 1, modal.r + 1);
  else if (act === 'a') return keyAction(KEY_ROWS[modal.r][modal.c]);
  else if (act === 'b') return keyAction('back');
  else if (act === 'x') return keyAction('space');
  else if (act === 'y') return keyAction('shift');
  modal.c = Math.min(modal.c, KEY_ROWS[modal.r].length - 1);
  renderModal();
}

// -------------------------------------------------------------- the flows
// Each flow only sends ids, names and menu choices to the main process.

async function lib(op, payload) {
  busy = true;
  let r;
  try {
    r = await api.library(op, payload);
  } finally {
    busy = false;
  }
  applyView(r.view);
  setStatus(r.ok ? r.message : r.error, !r.ok);
  return r;
}

async function confirm(question, yesLabel) {
  const r = await pick(question, [{ label: yesLabel, yes: true }, { label: 'Cancel' }]);
  return Boolean(r && r.yes);
}

function openMenu() {
  if (suspended || busy || modal) return;
  const t = selectedTile();
  const row = selectedRow();
  const editableRow = Boolean(row) && !row.id.startsWith('_') && Boolean(data.folders[row.id]);
  const inFolder = stack.length > 0;
  const items = [];
  const isThing = t && (t.kind === 'game' || t.kind === 'app' || t.kind === 'folder');
  if (isThing) {
    items.push({ label: 'Add to a category…', op: 'addTo' });
    if (editableRow) items.push({ label: 'Remove from this row', op: 'removeFromRow' });
    if (t.kind === 'folder') {
      items.push({ label: 'Rename this folder…', op: 'renameTile' });
      items.push({ label: 'Delete this folder…', op: 'deleteTile' });
    } else {
      items.push({ label: 'Remove from library…', op: 'deleteItem' });
    }
  }
  if (editableRow) {
    items.push({ label: inFolder ? 'Rename the open folder…' : 'Rename this row…', op: 'renameRow' });
    items.push({ label: inFolder ? 'Delete the open folder…' : 'Delete this row…', op: 'deleteRow' });
  }
  items.push({ label: 'New category…', op: 'newCat' });
  items.push({ label: 'Add a game from a file…', op: 'addGame' });
  items.push({ label: 'Scan for games', op: 'scan' });
  pick('Options', items).then((it) => it && runMenu(it.op, t, row));
}

async function runMenu(op, t, row) {
  switch (op) {
    case 'addTo': return flowAddTo(t, row);
    case 'removeFromRow': return lib('removeEntry', { catId: row.id, ref: t.id });
    case 'renameTile': return flowRename(t.id, t.title);
    case 'deleteTile':
      if (await confirm(`Delete folder “${t.title}”?`, 'Delete (games inside are kept)'))
        return lib('deleteCategory', { id: t.id });
      return;
    case 'deleteItem':
      if (await confirm(`Remove “${t.title}” from your library?`, 'Remove (files are not touched)'))
        return lib('deleteItem', { id: t.id });
      return;
    case 'renameRow': return flowRename(row.id, row.title);
    case 'deleteRow':
      if (await confirm(`Delete “${row.title}”?`, 'Delete (games inside are kept)'))
        return lib('deleteCategory', { id: row.id });
      return;
    case 'newCat': return flowNewCategory(row);
    case 'addGame': return flowBrowse('addGame');
    case 'scan': return flowScan();
  }
}

async function flowRename(id, current) {
  const text = await ask('Rename', current);
  if (text !== null) await lib('renameCategory', { id, title: text });
}

async function flowNewCategory(row) {
  const title = await ask('Name your category');
  if (title === null) return;
  const where = [
    { label: 'A row on Home', tab: 'home' },
    { label: 'A row on Library', tab: 'library' },
    { label: 'A row on Apps', tab: 'apps' },
  ];
  if (row && !row.id.startsWith('_') && data.folders[row.id])
    where.push({ label: 'A folder inside the current row', parent: row.id });
  // Put the choice that matches the tab you're on first.
  const here = TAB_IDS[tab];
  where.sort((a, b) => Number(b.tab === here) - Number(a.tab === here));
  const w = await pick('Where should it appear?', where);
  if (!w) return;
  await lib('newCategory', w.parent ? { title, parentId: w.parent } : { title, tab: w.tab });
}

async function flowAddTo(t, row) {
  const targets = Object.entries(data.folders)
    .filter(([id]) => id !== t.id && !(row && id === row.id))
    .map(([id, f]) => ({ label: f.title, id }));
  if (!targets.length) return setStatus('Make a category first (Y → New category).', true);
  const choice = await pick(`Add “${t.title}” to…`, targets);
  if (choice) await lib('addEntry', { catId: choice.id, ref: t.id });
}

// Browse the file system through main. We only ever say "enter entry N".
async function flowBrowse(purpose, after) {
  busy = true;
  let r;
  try { r = await api.browse('start', { purpose }); } finally { busy = false; }
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

async function flowScan() {
  if (modal || busy) return;
  setStatus('Scanning your library folders…');
  busy = true;
  let r;
  try {
    const roots = await api.settings('get');
    if (!roots.roots.length) {
      busy = false;
      setStatus('Add a library folder first: Settings → Library folders.', true);
      return;
    }
    r = await api.scan('run');
  } finally {
    busy = false;
  }
  if (!r.found.length) return setStatus(r.notes || 'No new games found.', Boolean(r.notes));
  setStatus(r.notes || '', Boolean(r.notes));
  const items = [{ label: 'Add selected games', op: 'confirm' }];
  r.found.forEach((f) => items.push({ label: f.title, sub: f.source, checked: true, cid: f.cid }));
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
      try { res = await api.scan('add', { cids }); } finally { busy = false; }
      applyView(res.view);
      setStatus(res.ok ? res.message : res.error, !res.ok);
    },
    onBack: () => { closeModal(); setStatus('Nothing added.'); },
  });
}

// ------------------------------------------------------------------ input

function press(act) {
  if (suspended || busy) return;
  if (modal) return modalPress(act);
  switch (act) {
    case 'left': return moveCol(-1);
    case 'right': return moveCol(1);
    case 'up': return moveRow(-1);
    case 'down': return moveRow(1);
    case 'a': return activate();
    case 'b': return back();
    case 'y': return openMenu();
    case 'lb': return switchTab(-1);
    case 'rb': return switchTab(1);
  }
}

api.onInit((payload) => {
  applyView(payload);
  if (payload.error) setStatus(payload.error, true);
  else if (!TAB_IDS.slice(0, 3).some((id) => data.tabs[id].length))
    setStatus('Welcome. Press Y to add a game, or scan your library folders.');
});

function resume(message) {
  suspended = false;
  prev.a = true; // if A is still held, don't relaunch until it's released
  setStatus(message, Boolean(message));
}
api.onGameExited(resume);
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
      press(left ? 'left' : right ? 'right' : up ? 'up' : 'down');
      lastNav = now;
    }
    // One-shot buttons fire on a fresh press only.
    [['a', 0], ['b', 1], ['x', 2], ['y', 3], ['lb', 4], ['rb', 5]].forEach(([name, n]) => {
      const down_ = b(n);
      if (down_ && !prev[name]) press(name);
      prev[name] = down_;
    });

    // Hold View (8) + Menu (9) to quit, no keyboard needed.
    if (b(8) && b(9)) {
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
  if (suspended || busy || e.ctrlKey || e.metaKey || e.altKey) return;
  if (modal && modal.kind === 'keys') {
    if (e.key.length === 1) { typeChar(e.key); return e.preventDefault(); }
    if (e.key === 'Enter') return finishKeys(true);
    if (e.key === 'Escape') return finishKeys(false);
  }
  const map = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    Enter: 'a', Escape: 'b', Backspace: 'b', PageUp: 'lb', PageDown: 'rb',
  };
  const act = map[e.key] || (e.key === 'y' ? 'y' : null);
  if (act) press(act);
});
window.addEventListener('resize', update);

render();
requestAnimationFrame(loop); // one loop, started once
