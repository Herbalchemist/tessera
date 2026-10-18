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

// What Tessera calls a user-made group of tiles. One place to rename it.
const TERM = 'mosaic';
const Term = TERM[0].toUpperCase() + TERM.slice(1);

const TAB_IDS = ['home', 'library', 'apps', 'new', 'settings'];
const TAB_NAMES = { home: 'Home', library: 'Library', apps: 'Apps', new: '+ ' + Term, settings: 'Settings' };

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
let focus = 'content';      // 'tabs' (the tab bar) or 'content' (the tiles)
const cursor = {};          // per tab/folder: { row, cols: { rowId: col } }
let stack = [];             // open folders: [{ id, title }]
let suspended = false;      // true while a game is running
let busy = false;           // true while waiting on the main process
let modal = null;
let lastNav = 0;
let quitSince = null;
const prev = {};            // edge detection for one-shot buttons
const wasBig = {};          // rows that showed the big empty tile last render

function setStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', Boolean(isError));
}

// ------------------------------------------------------------ home screen

// An empty row is one big tile. A filled one ends in a small "+" tile.
function withAdd(row, ctx, emptyTitle, emptySub) {
  if (!row.tiles.length) {
    return { ...row, tiles: [{ id: '_add', kind: 'add', big: true, title: emptyTitle, sub: emptySub, ctx }] };
  }
  return { ...row, tiles: [...row.tiles, { id: '_add', kind: 'add', title: 'Add', ctx }] };
}

function emptyTab(id) {
  const text = {
    home: ['Make this yours', `Add a game, an app, or a ${TERM}`],
    library: ['Add your first game', 'Pick a file or scan your folders'],
    apps: ['Add your first app', 'Steam, a browser, anything you launch'],
  }[id];
  return { id: '_empty_' + id, title: TAB_NAMES[id], tiles: [], text, ctx: { tab: id } };
}

function newTabRows() {
  const mosaics = Object.entries(data.folders).map(([id, f]) => ({ id, title: f.title, kind: 'folder' }));
  const row = { id: '_mosaics', title: `Your ${TERM}s`, tiles: mosaics };
  return [
    withAdd(
      row,
      { create: true },
      `Create your first ${TERM}`,
      'A named collection of games, apps and more'
    ),
  ].map((r) => {
    // Keep "+ New" first so it's always under your thumb.
    const add = r.tiles.find((t) => t.kind === 'add');
    return add && !add.big ? { ...r, tiles: [{ ...add, title: `New ${TERM}` }, ...r.tiles.filter((t) => t !== add)] } : r;
  });
}

function currentRows() {
  if (stack.length) {
    const top = stack[stack.length - 1];
    const f = data.folders[top.id];
    return [
      withAdd({ id: top.id, title: f ? f.title : top.title, tiles: f ? f.tiles : [] }, { catId: top.id },
        `This ${TERM} is empty`, 'Add a game, an app, or something from your library'),
    ];
  }
  const id = TAB_IDS[tab];
  if (id === 'settings') return SETTINGS_ROWS;
  if (id === 'new') return newTabRows();
  const rows = (data.tabs[id] || []).map((r) => {
    if (data.folders[r.id]) {
      return withAdd(r, { catId: r.id }, `This ${TERM} is empty`, 'Add a game, an app, or something from your library');
    }
    if (r.id === '_all_games') return withAdd(r, { tab: 'library', kind: 'game' });
    if (r.id === '_all_apps') return withAdd(r, { tab: 'apps', kind: 'app' });
    return r;
  });
  if (!rows.length) {
    const e = emptyTab(id);
    return [{ id: e.id, title: e.title, tiles: [{ id: '_add', kind: 'add', big: true, title: e.text[0], sub: e.text[1], ctx: e.ctx }] }];
  }
  return rows;
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
  TAB_IDS.forEach((id) => {
    const el = document.createElement('span');
    el.className = 'tab';
    el.textContent = TAB_NAMES[id];
    tabsEl.appendChild(el);
  });
}

function render() {
  if (!tabsEl.children.length) drawTabs();
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
      } else {
        const kind = document.createElement('small');
        kind.textContent = { folder: Term, app: 'App', game: 'Game' }[t.kind] || '';
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
  [...tabsEl.children].forEach((el, n) => {
    el.classList.toggle('active', n === tab);                 // the tab you're on
    el.classList.toggle('focused', n === tab && !inTiles);    // the tab bar has focus
  });
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
  titleEl.textContent = !inTiles ? TAB_NAMES[TAB_IDS[tab]] : t && !t.big ? t.title : '';
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
  if (d < 0 && c.row === 0) {
    focus = 'tabs'; // up from the top row lands on the tab bar
    return update();
  }
  c.row = Math.max(0, Math.min(currentRows().length - 1, c.row + d));
  update();
}
// Switching tabs puts focus on the tab bar and deselects the tiles.
function switchTab(d) {
  tab = (tab + d + TAB_IDS.length) % TAB_IDS.length;
  stack = [];
  focus = 'tabs';
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
  } else if (t.kind === 'add') {
    flowAdd(t.ctx || {});
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

// What "+" offers depends on where it is.
async function flowAdd(ctx) {
  const into = ctx.catId;
  const tabId = ctx.tab;
  const onlyGame = ctx.kind === 'game';
  const onlyApp = ctx.kind === 'app';
  const items = [];
  if (into && libraryChoices(into).length) items.push({ label: 'Add something from your library…', op: 'existing' });
  if (ctx.create) items.push({ label: `New ${TERM}…`, op: 'mosaic' });
  if (!ctx.create) {
    if (!onlyApp && tabId !== 'apps') items.push({ label: 'Add a game from a file…', op: 'game' });
    if (!onlyGame && tabId !== 'library') items.push({ label: 'Add an app from a file…', op: 'app' });
    if (!onlyApp && tabId !== 'apps') items.push({ label: 'Scan for games', op: 'scan' });
    if (!onlyGame && !onlyApp) items.push({ label: into ? `New ${TERM} inside this one…` : `New ${TERM}…`, op: 'mosaic' });
  }
  const it = items.length === 1 ? items[0] : await pick('Add', items);
  if (!it) return;
  switch (it.op) {
    case 'existing': return flowAddExisting(into);
    case 'game': return flowBrowse('addGame', undefined, into);
    case 'app': return flowBrowse('addApp', undefined, into);
    case 'scan': return flowScan(into);
    case 'mosaic': return flowNewMosaic({ parent: into, preferTab: tabId });
  }
}

// Things in your library that aren't in this mosaic yet.
function libraryChoices(into) {
  const have = new Set(((data.folders[into] || {}).tiles || []).map((t) => t.id));
  const rowTiles = (tabId, rowId) => ((data.tabs[tabId] || []).find((r) => r.id === rowId) || {}).tiles || [];
  const things = [...rowTiles('library', '_all_games'), ...rowTiles('apps', '_all_apps')];
  const mosaics = Object.entries(data.folders).map(([id, f]) => ({ id, title: f.title, kind: 'folder' }));
  return [...things, ...mosaics].filter((t) => t.id !== into && !have.has(t.id));
}

async function flowAddExisting(into) {
  const choices = libraryChoices(into);
  const items = [{ label: 'Add selected', op: 'confirm' }];
  choices.forEach((t) =>
    items.push({ label: t.title, sub: { folder: Term, app: 'App', game: 'Game' }[t.kind], checked: false, id: t.id })
  );
  openList({
    title: 'Add to this ' + TERM,
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

async function flowNewMosaic({ parent, preferTab, row } = {}) {
  const title = await ask(`Name your ${TERM}`);
  if (title === null) return;
  let target = parent ? { parent } : null;
  if (!target) {
    const where = [
      { label: 'A row on Home', tab: 'home' },
      { label: 'A row on Library', tab: 'library' },
      { label: 'A row on Apps', tab: 'apps' },
      { label: `Only in the + ${Term} tab`, tab: 'none' },
    ];
    if (row && data.folders[row.id]) where.push({ label: `Inside the current ${TERM}`, parent: row.id });
    const want = preferTab || TAB_IDS[tab];
    where.sort((a, b) => Number(b.tab === want) - Number(a.tab === want));
    target = await pick('Where should it appear?', where);
    if (!target) return;
  }
  const r = await lib('newCategory', target.parent ? { title, parentId: target.parent } : { title, tab: target.tab });
  // Open a brand-new mosaic so you land on its big "add" tile.
  if (r.ok && r.id && !target.parent) {
    stack = [{ id: r.id, title }];
    focus = 'content';
    render();
  }
}

function openMenu() {
  if (suspended || busy || modal || focus !== 'content') return;
  const t = selectedTile();
  const row = selectedRow();
  const editableRow = Boolean(row) && !row.id.startsWith('_') && Boolean(data.folders[row.id]);
  const inFolder = stack.length > 0;
  const items = [];
  const isThing = t && (t.kind === 'game' || t.kind === 'app' || t.kind === 'folder');
  if (isThing) {
    items.push({ label: `Add to a ${TERM}…`, op: 'addTo' });
    if (editableRow) items.push({ label: 'Remove from this row', op: 'removeFromRow' });
    if (t.kind === 'folder') {
      items.push({ label: `Rename this ${TERM}…`, op: 'renameTile' });
      items.push({ label: `Delete this ${TERM}…`, op: 'deleteTile' });
    } else {
      items.push({ label: 'Rename…', op: 'renameItem' });
      items.push({ label: 'Remove from library…', op: 'deleteItem' });
    }
  }
  if (editableRow) {
    items.push({ label: inFolder ? `Rename the open ${TERM}…` : 'Rename this row…', op: 'renameRow' });
    items.push({ label: inFolder ? `Delete the open ${TERM}…` : 'Delete this row…', op: 'deleteRow' });
  }
  items.push({ label: `New ${TERM}…`, op: 'newCat' });
  items.push({ label: 'Add a game from a file…', op: 'addGame' });
  items.push({ label: 'Add an app from a file…', op: 'addApp' });
  items.push({ label: 'Scan for games', op: 'scan' });
  pick('Options', items).then((it) => it && runMenu(it.op, t, row));
}

async function runMenu(op, t, row) {
  switch (op) {
    case 'addTo': return flowAddTo(t, row);
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
      if (await confirm(`Delete “${row.title}”?`, 'Delete (things inside are kept)'))
        return lib('deleteCategory', { id: row.id });
      return;
    case 'newCat': return flowNewMosaic({ row });
    case 'addGame': return flowBrowse('addGame');
    case 'addApp': return flowBrowse('addApp');
    case 'scan': return flowScan();
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

async function flowScan(into) {
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
      try { res = await api.scan('add', { cids, into }); } finally { busy = false; }
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
  if (act === 'lb') return switchTab(-1);
  if (act === 'rb') return switchTab(1);
  if (focus === 'tabs') {
    // On the tab bar: left/right change tab, down or A goes back to the tiles.
    if (act === 'left') return switchTab(-1);
    if (act === 'right') return switchTab(1);
    if (act === 'down' || act === 'a') {
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

api.onInit((payload) => {
  applyView(payload);
  if (payload.error) setStatus(payload.error, true);
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
