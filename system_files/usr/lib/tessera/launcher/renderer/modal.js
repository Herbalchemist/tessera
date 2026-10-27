// SPDX-License-Identifier: GPL-3.0-or-later
// Menus and dialogs, the on-screen keyboard and PIN button patterns.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

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
function openList({ title, items, index = 0, multi = false, onChoose, onBack, onY, body = '', welcome = false, cls = '', onRender = null }) {
  // Never start on a label or on something folded away.
  const flags = visibleFlags(items);
  for (let i = index; i < items.length; i++) if (pickable(items, flags, i)) { index = i; break; }
  modal = { kind: 'list', title, items, index, multi, onChoose, onBack, onY, body, welcome, cls, onRender };
  renderModal();
}
// Resolves with the chosen item, or null if the user backs out.
function pick(title, items, index = 0, extra = {}) {
  return new Promise((resolve) => {
    openList({
      ...extra,
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
// Waits for the next keyboard key and resolves with its code (null: cancelled with Esc or B).
function captureKey(label) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), 15000);
    const finish = (code) => {
      clearTimeout(timer);
      closeModal();
      resolve(code);
    };
    modal = { kind: 'capture', keyboard: true, label, finish, note: '' };
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
// For passwords: the same keyboard with a key that swaps the letters for symbols.
const KEY_ROWS_SYM = [...KEY_ROWS.slice(0, 4), ['shift', 'sym', 'space', 'back', 'cancel', 'done']];
// For secrets (a Wi-Fi password): hidden while typing, with a key that shows or hides it.
const KEY_ROWS_SECRET = [...KEY_ROWS.slice(0, 4), ['shift', 'sym', 'show', 'space', 'back', 'cancel', 'done']];
const SYM_MAP = [
  '!@#$%^&*()'.split(''),
  '`~-_=+[]{}'.split(''),
  '\\|;:\'",.<>'.split(''),
  ['/', '?', '', '', '', '', '', '', '', ''],
];
const SPECIAL = { shift: 'Shift', sym: '#+=', show: 'Show', space: 'Space', back: '⌫', cancel: 'Cancel', done: 'Done' };

// Resolves with the text, or null on cancel.
const rowsOf = () => modal.rows || KEY_ROWS;
function ask(title, initial = '', opts = {}) {
  return new Promise((resolve) => {
    modal = {
      kind: 'keys', title, text: initial.slice(0, opts.max || MAX_TEXT), shift: false, sym: false, r: opts.rows ? 0 : 1, c: 0, last: null, resolve, dom: null,
      rows: opts.rows || (opts.secret ? KEY_ROWS_SECRET : opts.symbols ? KEY_ROWS_SYM : null), mask: Boolean(opts.mask || opts.secret), secret: Boolean(opts.secret),
      max: opts.max || MAX_TEXT, digits: Boolean(opts.digits), patternWanted: Boolean(opts.pattern), peekUntil: 0,
    };
    renderModal();
  });
}
function finishKeys(accept) {
  const { resolve, text } = modal;
  closeModal();
  resolve(accept ? text : null);
}
function typeChar(ch) {
  if (modal.text.length >= modal.max) return;
  if (modal.digits && !/^\d$/.test(ch)) return;
  modal.text += modal.shift ? ch.toUpperCase() : ch;
  modal.shift = false;
  if (modal.secret && modal.mask) {
    // a hidden password shows its newest character for a moment, so a slip of the stick is noticed
    modal.peekUntil = performance.now() + 900;
    const m = modal;
    setTimeout(() => { if (modal === m && performance.now() >= m.peekUntil) renderModal(); }, 950);
  }
  renderModal();
}
function keyAction(k) {
  if (k === 'sym') modal.sym = !modal.sym;
  else if (k === 'show') { modal.mask = !modal.mask; modal.peekUntil = 0; }
  else if (k === '') return; // an empty spot on the symbol keys
  else if (k === 'shift') modal.shift = !modal.shift;
  else if (k === 'space') typeChar(' ');
  else if (k === 'back') modal.text = modal.text.slice(0, -1);
  else if (k === 'cancel') return finishKeys(false);
  else if (k === 'done') return finishKeys(true);
  else return typeChar(k);
  renderModal();
}

// ---- PIN button patterns
// Each controller family has its own fixed set: ten buttons stand for the
// digits 1 2 3 4 5 6 7 8 9 0, in that order. These are NOT the remappable
// controls and no setting changes them. They only apply to the PIN keypad, on
// pads that report the standard layout (anything else keeps the plain keypad).
const PAD_ARROWS = { 12: '↑', 13: '↓', 14: '←', 15: '→' };
const PIN_PATTERNS = {
  // standard-layout button numbers, in digit order 1..9, 0
  xbox:        { order: [0, 1, 2, 3, 4, 5, 12, 13, 14, 15] },        // A B X Y LB RB ↑ ↓ ← →
  playstation: { order: [0, 1, 2, 3, 4, 5, 12, 13, 14, 15] },        // ✕ ○ □ △ L1 R1 ↑ ↓ ← →
  nintendo:    { order: [1, 0, 3, 2, 4, 5, 12, 13, 14, 15] },        // A B X Y L R ↑ ↓ ← →
};
const PIN_CONTROLS = { 6: 'back', 8: 'cancel', 9: 'done' };           // LT/ZL, View/Create/−, Menu/Options/+
function patternActive() {
  if (!modal || modal.kind !== 'keys' || !modal.patternWanted) return false;
  const p = activePad();
  return Boolean(p && p.mapping === 'standard');
}
const patternFamily = () => { const p = activePad(); return detectFamily(p ? p.id : ''); };
const patternLabel = (fam, n) => PAD_ARROWS[n] || (GLYPH_SETS[fam] || BUTTON_NAMES)[n] || `#${n}`;
function patternDigitFor(n) {
  const order = (PIN_PATTERNS[patternFamily()] || PIN_PATTERNS.xbox).order;
  const i = order.indexOf(n);
  return i < 0 ? null : String((i + 1) % 10);
}
function patternButton(n) {
  const d = patternDigitFor(n);
  if (d !== null) { flashKey(d); return typeChar(d); }
  const act = PIN_CONTROLS[n];
  if (act) { flashKey(act); return keyAction(act); }
}
// What the key under the cursor types: on the symbol layer the letter keys stand for symbols.
function keyFor(r, c) {
  const k = rowsOf()[r][c];
  return modal.sym && !SPECIAL[k] && SYM_MAP[r] ? SYM_MAP[r][c] || '' : k;
}
function flashKey(k) {
  if (!modal || !modal.dom) return;
  rowsOf().forEach((row, r) => row.forEach((key, c) => {
    if (key !== k) return;
    const el = modal.dom.cells[r][c];
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), 160);
  }));
}
// A controller button pressed while the keyboard is open. A always types
// the highlighted key; the rest follow the bindings from Settings → Controls.
function keysButton(n) {
  modal.last = n;
  if (patternActive()) return patternButton(n);
  if (n === 0) return keyAction(keyFor(modal.r, modal.c));
  const action = Object.keys(keymap).find((k) => keymap[k] === n);
  if (action) return keyAction(action);
  renderModal();
}

// Built once and then updated in place, so the slide-up only plays on open.
function buildKeys() {
  modalEl.replaceChildren();
  modalEl.className = 'keys' + (modal.digits ? ' numeric' : '');
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
  const cells = rowsOf().map((row) => {
    const line = document.createElement('div');
    line.className = 'krow';
    const els = row.map((k, c) => {
      const el = document.createElement('div');
      el.dataset.r = rowsOf().indexOf(row);
      el.dataset.c = c;
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
  const peek = modal.mask && modal.secret && modal.text && performance.now() < modal.peekUntil;
  text.textContent = !modal.mask ? modal.text : peek ? '•'.repeat(modal.text.length - 1) + modal.text.slice(-1) : '•'.repeat(modal.text.length);
  rowsOf().forEach((row, r) =>
    row.forEach((k, c) => {
      const el = cells[r][c];
      const pat = patternActive();
      el.classList.toggle('on', (k === 'shift' && modal.shift) || (k === 'sym' && modal.sym));
      el.classList.toggle('active', !pat && r === modal.r && c === modal.c);
      el.classList.toggle('pat', pat);
      if (pat) {
        const fam = patternFamily();
        const order = (PIN_PATTERNS[fam] || PIN_PATTERNS.xbox).order;
        let n = null;
        if (/^\d$/.test(k)) n = order[(Number(k) + 9) % 10];
        else n = Number(Object.keys(PIN_CONTROLS).find((b) => PIN_CONTROLS[b] === k));
        el.textContent = SPECIAL[k] || k;
        if (n !== null && !Number.isNaN(n)) {
          const b = document.createElement('small');
          b.className = 'kg';
          b.textContent = patternLabel(fam, n);
          el.appendChild(b);
        }
        return;
      }
      if (k === 'sym') el.textContent = modal.sym ? 'abc' : SPECIAL.sym;
      else if (k === 'show') el.textContent = modal.mask ? 'Show' : 'Hide';
      else if (modal.sym && !SPECIAL[k] && SYM_MAP[r]) el.textContent = SYM_MAP[r][c] || '';
      else el.textContent = SPECIAL[k] || (modal.shift ? k.toUpperCase() : k);
    })
  );
  paintSelection();
  if (modal.digits && patternActive()) {
    hint.textContent = 'Press the button shown on each number to type it.';
    return;
  }
  if (hintMode() !== 'pad') {
    hint.textContent = modal.digits
      ? 'Type the numbers on your keyboard   Backspace delete   Enter done   Esc cancel'
      : 'Type on your keyboard   Backspace delete   Enter done   Esc cancel';
    return;
  }
  if (modal.digits) {
    hint.textContent = `A press   ${buttonName(keymap.back)} delete   ${buttonName(keymap.done)} done   ${buttonName(keymap.cancel)} cancel`;
    return;
  }
  hint.textContent =
    `A type   ${buttonName(keymap.back)} delete   ${buttonName(keymap.space)} space   ` +
    `${buttonName(keymap.shift)} shift   ${buttonName(keymap.done)} done` +
    (modal.last === null ? '' : `      (last button: ${modal.last})`);
}

function renderModal() {
  if (!modal) return;
  if (modal.kind === 'tour') return renderTour();
  modalEl.hidden = false;
  if (modal.kind === 'keys') return updateKeys();
  if (modal.kind === 'pad' || modal.kind === 'color' || modal.kind === 'cal') return;
  modalEl.className = modal.welcome ? 'welcome' : (modal.cls || '');
  modalEl.replaceChildren();
  const box = document.createElement('div');
  box.className = 'box';
  const h = document.createElement('h3');
  box.appendChild(h);
  if (modal.body) {
    const p = document.createElement('p');
    p.className = 'mbody';
    p.textContent = modal.body;
    box.appendChild(p);
  }

  if (modal.kind === 'capture') {
    h.textContent = modal.keyboard ? `Press a key for “${modal.label}”` : `Press a button for “${modal.label}”`;
    const p = document.createElement('p');
    p.className = 'khint';
    p.textContent = modal.note || (modal.keyboard ? `Esc or ${buttonName(1)} on a controller to cancel` : 'Press Esc on a keyboard to cancel');
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
    el.dataset.i = n; // which item a mouse click means
    el.className = 'mitem' + (n === modal.index ? ' active' : '') + (it.header ? ' header' : '') + (it.fold ? ' fold' : '') + (danger ? ' danger' : '') + (ok ? ' ok' : '') + (it.graphic ? ' rich' : '');
    const mark = modal.multi && 'checked' in it ? (it.checked ? '☑  ' : '☐  ') : '';
    const text = (it.fold ? (isOpen(it) ? '▾  ' : '▸  ') : '') + mark + it.label;
    const addSub = (parent) => {
      if (!it.sub) return;
      const s = document.createElement('small');
      s.textContent = it.sub;
      parent.appendChild(s);
    };
    if (it.graphic) {
      // a row with a picture under it: the name and size on top, the graphic below
      const top = document.createElement('div');
      top.className = 'rtop';
      const nm = document.createElement('span');
      nm.textContent = text;
      top.appendChild(nm);
      addSub(top);
      el.appendChild(top);
      it.graphic(el);
    } else {
      el.textContent = text;
      addSub(el);
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
  if (modal.onRender) modal.onRender(box);
  paintSelection();
}

function modalPress(act) {
  if (modal.kind === 'tour') return tourPress(act);
  if (modal.kind === 'capture' || modal.kind === 'pad') return;
  if (modal.kind === 'grip') { if (act === 'a' || act === 'b') closeModal(); return; }
  if (modal.kind === 'cal') return calPress(act);
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
    else if ((act === 'left' || act === 'right') && cur && cur.adjust) cur.adjust(act === 'right' ? 1 : -1); // a slider
    else if ((act === 'left' || act === 'right') && cur && cur.header && cur.fold) foldOpen.set(cur.fold, act === 'right');
    else if (act === 'left' && cur && !cur.header) {
      // left on a row inside a branch: fold the branch and land on its heading
      for (let i = modal.index - 1; i >= 0; i--) {
        if (modal.items[i].header) { if (modal.items[i].fold) { foldOpen.set(modal.items[i].fold, false); modal.index = i; } break; }
      }
    }
    else if (act === 'b') modal.onBack();
    else if (act === 'y' && modal.onY) return modal.onY(cur); // Y on a keyboard (the controller's Y goes straight to onY)
    renderModal();
    return;
  }
  // keyboard: directions only. Buttons go through keysButton().
  const kr = rowsOf();
  if (act === 'left') modal.c = Math.max(0, modal.c - 1);
  else if (act === 'right') modal.c = Math.min(kr[modal.r].length - 1, modal.c + 1);
  else if (act === 'up') modal.r = Math.max(0, modal.r - 1);
  else if (act === 'down') modal.r = Math.min(kr.length - 1, modal.r + 1);
  modal.c = Math.min(modal.c, kr[modal.r].length - 1);
  renderModal();
}
