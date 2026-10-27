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
    { tab: 'home', target: () => tabsEl, title: 'Tabs', text: `Everything lives in tabs. ${g(4)} and ${g(5)} switch between them from anywhere${kb ? ', and so do Esc + ← / →' : ''}.` },
    { tab: 'home', target: () => rowsEl, title: 'Home', text: 'Your page of widgets: the clock, what you played last, system status, and community widgets from Add-ons.' },
    { tab: 'library', target: () => rowsEl.querySelector('.row') || rowsEl, title: 'Library', text: `Your games. ${g(0)} plays one. ${g(3)} shows options: scan for games from Steam, Lutris and Heroic, add one from a file, change box art, rename or move.` },
    { tab: 'new', target: () => tabEl('new'), title: 'Make your own tabs', text: '+ Mosaic builds a tab of your own, with games, apps, widgets and folders arranged the way you like.' },
    { tab: 'browser', target: () => tabEl('browser'), title: 'The browser', text: kb ? 'A full web page, full screen. The mouse and keyboard work as usual; Esc + ← / → leaves it.' : `A full web page, full screen. One stick moves a cursor and the other scrolls; ${g(7)} clicks, ${g(3)} types an address, ${g(1)} leaves.` },
    { tab: 'settings', target: () => tabEl('settings'), title: 'Settings', text: 'Wi-Fi, Bluetooth, sound, controllers, keyboard & mouse, the look (Theme Settings), profiles, storage and updates.' },
    { target: () => document.querySelector('footer'), title: 'Button hints', text: 'These follow what you hold: controller buttons, keyboard keys or mouse clicks. Change keys in Settings > Keyboard & mouse.' },
    { title: 'The guide', text: `Press ${g(16)} any time, even in the middle of a game, for quick settings, profiles, notifications and power. You can take this tour again from there.` },
  ];
}
function goTabFor(id) {
  if (!id || hoverId === id) return;
  const list = tabList();
  if (!list.includes(id)) return;
  moveTabs(list.indexOf(id) - Math.max(0, list.indexOf(hoverId)));
}
function runTour() {
  if (modal || browserOpen) return;
  const back = { page, hoverId, focus };
  modal = {
    kind: 'tour', i: 0, steps: tourSteps(),
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
  goTabFor(st.tab);
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
  card.replaceChildren();
  const step = document.createElement('p');
  step.className = 'tour-step';
  step.textContent = `${modal.i + 1} of ${modal.steps.length}`;
  const h = document.createElement('h3');
  h.textContent = st.title;
  const p = document.createElement('p');
  p.className = 'mbody';
  p.textContent = st.text;
  const hint = document.createElement('p');
  hint.className = 'khint';
  const last = modal.i === modal.steps.length - 1;
  hint.textContent = `${hintName(0)} ${last ? 'done' : 'next'}${modal.i ? `   ${hintName(1)} back` : ''}${last ? '' : `   ${hintName(3)} leave the tour`}`;
  card.append(step, h, p, hint);
  // The card sits below the lit-up part when there's room, above it otherwise, or in the middle.
  const ch = card.offsetHeight, cw = card.offsetWidth;
  let top = (innerHeight - ch) / 2, left = (innerWidth - cw) / 2;
  if (shown) {
    if (r.bottom + pad + 16 + ch < innerHeight) top = r.bottom + pad + 16;
    else if (r.top - pad - 16 - ch > 0) top = r.top - pad - 16 - ch;
    left = Math.min(innerWidth - cw - 16, Math.max(16, r.left + r.width / 2 - cw / 2));
  }
  Object.assign(card.style, { top: `${Math.round(top)}px`, left: `${Math.round(left)}px` });
}
function tourPress(act) {
  const n = modal.steps.length;
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
