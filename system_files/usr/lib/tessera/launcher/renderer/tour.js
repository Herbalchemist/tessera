// SPDX-License-Identifier: GPL-3.0-or-later
// The guided tour.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ------------------------------------------------------------------- the tour
// An optional walk around the launcher: a ring lights up one part of the screen at a time,
// with a card that explains it. Offered at the end of setup and from the guide. A or a click:
// next, B: back, Y: leave the tour. The texts name the keys of whatever the person is using.
let wantTour = false;
const tabEl = (id) => tabsEl.children[tabList().indexOf(id)] || null;
function tourSteps() {
  const g = hintName;
  const kb = hintMode() !== 'pad';
  return [
    { title: 'A quick tour', text: `Here's where everything is. ${g(0)}: next   ${g(1)}: back   ${g(3)}: leave the tour.` },
    // Try it: the bumpers really switch tabs here, and the step says when it worked.
    { tab: 'home', target: () => tabsEl, title: 'Tabs', tryTabs: true,
      text: `Everything lives in tabs. ${g(4)} and ${g(5)} switch between them from anywhere${kb ? ', and so do Esc + ← / →' : ''}.`,
      tryText: `Try it now: press ${g(4)} or ${g(5)}.`, triedText: `That's it. ${g(4)} and ${g(5)} work from anywhere, even inside a menu's page.` },
    { tab: 'home', target: () => tourPageTarget(), title: 'Home', text: 'Your page of widgets: the clock, what you played last, system status, and community widgets from Add-ons.',
      doLabel: 'add a widget now', do: () => flowAddInlay('_home') },
    { tab: 'library', target: () => tourPageTarget(), title: 'Library', text: `Your games. ${g(0)} plays one. ${g(3)} shows options: scan for games from Steam, Lutris and Heroic, add one from a file, change box art, rename or move.`,
      doLabel: 'link a library drive or folder', do: () => tourLibrary() },
    { tab: 'new', target: () => tabEl('new'), title: 'Make your own tabs', text: '+ Mosaic builds a tab of your own, with games, apps, widgets and folders arranged the way you like.',
      doLabel: 'make one now', do: () => flowNewMosaic({}) },
    { tab: 'browser', target: () => tabEl('browser'), title: 'The browser', text: kb ? 'A full web page, full screen. The mouse and keyboard work as usual; Esc + ← / → leaves it.' : `A full web page, full screen. One stick moves a cursor and the other scrolls; ${g(7)} clicks, ${g(3)} types an address, ${g(1)} leaves.` },
    { tab: 'settings', target: () => tabEl('settings'), title: 'Settings', text: 'Wi-Fi, Bluetooth, sound, controllers, keyboard & mouse, the look (Theme Settings), profiles, storage and updates.' },
    { target: () => document.querySelector('footer'), title: 'Button hints', text: 'These follow what you hold: controller buttons, keyboard keys or mouse clicks. Change keys in Settings > Keyboard & mouse.' },
    { title: 'The guide', text: `Press ${g(16)} any time, even in the middle of a game, for quick settings, profiles, notifications and power. You can take this tour again from there.` },
  ];
}
// What a page step lights up: the page's own area (its tiles), whatever the layout. Measured from
// what's actually drawn: the union of the visible tiles, else the page area itself.
function tourPageTarget() {
  // Home draws its tiles on its own canvas; every other page in the rows.
  const area = page === 'home' && !canvasEl.hidden ? canvasEl : rowsEl;
  const tiles = [...area.querySelectorAll('.card:not(.ghost)')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && getComputedStyle(e).visibility !== 'hidden'; });
  if (!tiles.length) return area;
  const rs = tiles.map((e) => e.getBoundingClientRect());
  const box = { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
  return { getBoundingClientRect: () => ({ ...box, width: box.right - box.left, height: box.bottom - box.top }) };
}
// Library: link a folder or drive with games on it, then (if wanted) look for games right away.
async function tourLibrary() {
  const it = await pick('Your games', [
    { label: 'Link a library drive or folder…', sub: 'Tessera looks there for games', op: 'roots', plain: true },
    { label: 'Scan for games now', sub: 'Steam, Heroic, Lutris and your library folders', op: 'scan', plain: true },
  ]);
  if (!it) return;
  if (it.op === 'roots') return flowRoots();
  return flowScan();
}
// Waits until the person has finished whatever they opened (a flow can open several menus in turn).
async function tourWaitIdle() {
  let quiet = 0;
  while (quiet < 3) {
    await new Promise((r) => setTimeout(r, 150));
    quiet = !modal && !busy ? quiet + 1 : 0;
  }
}
// Steps aside for the person to do the step's thing, then comes back to the same step.
async function tourDo(st) {
  const at = modal.i;
  const back = modal.back;
  modal.onClose = null;
  closeModal();
  document.body.classList.remove('touring');
  try { await st.do(); } catch { /* back to the tour anyway */ }
  await tourWaitIdle();
  runTour(at, back);
}
function goTabFor(id) {
  if (!id || hoverId === id) return;
  const list = tabList();
  if (!list.includes(id)) return;
  moveTabs(list.indexOf(id) - Math.max(0, list.indexOf(hoverId)));
}
function runTour(start = 0, keep = null) {
  if (modal || browserOpen) return;
  const back = keep || { page, hoverId, focus };
  modal = {
    kind: 'tour', i: start, steps: tourSteps(), back, shown: -1, tried: false,
    onClose: () => {
      document.body.classList.remove('touring');
      if (back.page !== page || back.hoverId !== hoverId) { page = back.page; hoverId = back.hoverId; stack = []; render(); }
      focus = back.focus;
      update();
    },
  };
  document.body.classList.add('touring');
  renderModal();
}
function renderTour() {
  modal.steps = tourSteps(); // texts follow the input in use
  const st = modal.steps[modal.i];
  // Go to the step's tab when arriving at it (not on every redraw: on the Tabs step the person
  // switches tabs themselves).
  if (modal.shown !== modal.i) { modal.shown = modal.i; modal.tried = false; goTabFor(st.tab); }
  modalEl.hidden = false;
  modalEl.className = 'tour';
  let ring = modalEl.querySelector('.tour-ring');
  let card = modalEl.querySelector('.tour-card');
  if (!ring) {
    modalEl.replaceChildren();
    ring = document.createElement('div');
    ring.className = 'tour-ring';
    card = document.createElement('div');
    card.className = 'tour-card box';
    modalEl.append(ring, card);
  }
  card.replaceChildren();
  const step = document.createElement('p');
  step.className = 'tour-step';
  step.textContent = `${modal.i + 1} of ${modal.steps.length}`;
  const h = document.createElement('h3');
  h.textContent = st.title;
  const p = document.createElement('p');
  p.className = 'mbody';
  p.textContent = st.text;
  card.append(step, h, p);
  if (st.tryTabs) {
    const t = document.createElement('p');
    t.className = 'tour-try' + (modal.tried ? ' done' : '');
    t.textContent = modal.tried ? `✓ ${st.triedText}` : st.tryText;
    card.append(t);
  }
  if (st.do) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tour-do';
    const k = document.createElement('b');
    k.textContent = hintName(2);
    b.append(k, ` ${st.doLabel.charAt(0).toUpperCase()}${st.doLabel.slice(1)}`);
    card.append(b);
  }
  const hint = document.createElement('p');
  hint.className = 'khint';
  const last = modal.i === modal.steps.length - 1;
  hint.textContent = `${hintName(0)} ${last ? 'done' : 'next'}${modal.i ? `   ${hintName(1)} back` : ''}${last ? '' : `   ${hintName(3)} leave the tour`}`;
  card.append(hint);
  placeTour();
  // A tab switch slides the page in: measure again once it has settled, so the ring lands on
  // where things end up, not where they were mid-way.
  const m = modal, i = modal.i;
  for (const t of [260, 650, 1100]) setTimeout(() => { if (modal === m && m.i === i) placeTour(); }, t);
}
// The ring around the step's part of the screen, and the card beside it.
function placeTour() {
  const st = modal.steps[modal.i];
  const ring = modalEl.querySelector('.tour-ring');
  const card = modalEl.querySelector('.tour-card');
  if (!ring || !card) return;
  const el = st.target ? st.target() : null;
  const r = el ? el.getBoundingClientRect() : null;
  const pad = 10;
  const shown = r && r.width > 4 && r.height > 4;
  if (shown) {
    const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
    const w = Math.min(innerWidth - 8, r.right + pad) - x, h = Math.min(innerHeight - 8, r.bottom + pad) - y;
    Object.assign(ring.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, opacity: '1' });
  } else {
    Object.assign(ring.style, { left: `${innerWidth / 2}px`, top: `${innerHeight / 2}px`, width: '0px', height: '0px', opacity: '1' });
  }
  // The card sits below the lit-up part when there's room, above it otherwise, beside it (narrower
  // if that's what fits), or at the edge with the most room.
  card.style.width = '';
  if (shown) {
    const below = innerHeight - (r.bottom + pad + 16) - 8, above = r.top - pad - 16 - 8;
    const right = innerWidth - (r.right + pad + 16) - 16, left = r.left - pad - 16 - 16;
    const side = Math.max(right, left);
    if (card.offsetHeight > Math.max(below, above) && card.offsetWidth > side && side >= 240) card.style.width = `${Math.floor(side)}px`;
  }
  const ch = card.offsetHeight, cw = card.offsetWidth;
  let top = (innerHeight - ch) / 2, left = (innerWidth - cw) / 2;
  if (shown) {
    if (r.bottom + pad + 16 + ch < innerHeight) top = r.bottom + pad + 16;
    else if (r.top - pad - 16 - ch > 0) top = r.top - pad - 16 - ch;
    else if (r.right + pad + 16 + cw < innerWidth) { left = r.right + pad + 16; top = Math.min(innerHeight - ch - 16, Math.max(16, r.top)); }
    else if (r.left - pad - 16 - cw > 0) { left = r.left - pad - 16 - cw; top = Math.min(innerHeight - ch - 16, Math.max(16, r.top)); }
    else top = r.top > innerHeight - r.bottom ? 16 : innerHeight - ch - 16; // no room anywhere: the edge with more space, covering as little as it can
    if (left === (innerWidth - cw) / 2) left = Math.min(innerWidth - cw - 16, Math.max(16, r.left + r.width / 2 - cw / 2));
  }
  Object.assign(card.style, { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` });
}
function tourPress(act) {
  const n = modal.steps.length;
  const st = modal.steps[modal.i];
  // Tabs step: the bumpers really switch tabs.
  if ((act === 'lb' || act === 'rb') && st.tryTabs) {
    moveTabs(act === 'lb' ? -1 : 1);
    modal.tried = true;
    return renderTour();
  }
  if (act === 'x' && st.do) return tourDo(st);
  if (act === 'a' || act === 'right' || act === 'down') {
    if (modal.i >= n - 1) return closeModal();
    modal.i++;
  } else if (act === 'b' || act === 'left' || act === 'up') {
    if (modal.i === 0) return closeModal();
    modal.i--;
  } else if (act === 'y') return closeModal();
  else return;
  renderTour();
}
