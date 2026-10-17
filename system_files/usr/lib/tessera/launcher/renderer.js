// SPDX-License-Identifier: GPL-3.0-or-later
const rail = document.getElementById('rail');
const titleEl = document.getElementById('title');
const statusEl = document.getElementById('status');

const NAV_REPEAT_MS = 200;
const QUIT_HOLD_MS = 1500;

let games = [];
let index = 0;
let suspended = false;   // true while a game is running
let prevA = false;       // edge detection: launch only on a fresh press
let lastNav = 0;
let quitSince = null;

function setStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', Boolean(isError));
}

function render() {
  rail.replaceChildren();
  games.forEach((g) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.textContent = g.title;
    rail.appendChild(card);
  });
  select(0);
}

function select(i) {
  index = Math.max(0, Math.min(games.length - 1, i));
  [...rail.children].forEach((c, n) => c.classList.toggle('active', n === index));
  titleEl.textContent = games[index] ? games[index].title : 'No games yet';
  center();
}

// Center the active card using real measurements, so it works for any count.
function center() {
  const card = rail.children[index];
  if (!card) return;
  const viewport = rail.parentElement.clientWidth;
  const x = viewport / 2 - (card.offsetLeft + card.offsetWidth / 2);
  rail.style.transform = `translateX(${x}px)`;
}

function launch() {
  if (!games[index] || suspended) return;
  suspended = true;
  setStatus('Starting…');
  window.launcherAPI.launch(games[index].id);
}

window.launcherAPI.onInit(({ games: list, error }) => {
  games = list;
  render();
  if (error) setStatus(error, true);
  else if (!games.length) setStatus('Add games to games.json to see them here.');
});

function resume(message) {
  suspended = false;
  prevA = true; // if A is still held, don't relaunch until it's released
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
    const a = b(0);

    if ((left || right) && now - lastNav > NAV_REPEAT_MS) {
      select(index + (right ? 1 : -1));
      lastNav = now;
    }
    if (a && !prevA) launch();
    prevA = a;

    // Hold Select (8) + Start (9) to quit, no keyboard needed.
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
  if (e.key === 'ArrowLeft') select(index - 1);
  else if (e.key === 'ArrowRight') select(index + 1);
  else if (e.key === 'Enter') launch();
});
window.addEventListener('resize', center);

requestAnimationFrame(loop); // one loop, started once
