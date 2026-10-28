// SPDX-License-Identifier: GPL-3.0-or-later
// Getting into and out of the web browser.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ---- getting into and out of the browser. The page is a native view drawn over this
// window, which CSS can't move or fade, so the animation plays on a picture of it (the
// "curtain"): on the way out the picture replaces the live page before it is removed, on
// the way in the picture from last time comes in and the live page takes over under it.
let browserMoving = false;  // an entrance or exit is playing; input waits for it
let browserShot = '';       // how the page looked when you last left it
const BROWSER_ANIMS = ['slide', 'zoom', 'fade', 'rise', 'flip', 'doors', 'none'];
const BROWSER_ANIM_MS = 340;
function browserAnimStyle() {
  const get = (id) => { const s = prefs.theme && prefs.theme.settings.find((x) => x.id === id); return s ? s.value : undefined; };
  if (get('motion') === false) return 'none';
  const v = get('browserAnim');
  return BROWSER_ANIMS.includes(v) ? v : 'slide';
}
function browserCurtain() {
  let c = document.getElementById('browser-curtain');
  if (c) return c;
  c = document.createElement('div');
  c.id = 'browser-curtain';
  c.hidden = true;
  for (const side of ['l', 'r']) {
    const half = document.createElement('div');
    half.className = 'half ' + side;
    c.appendChild(half);
  }
  const ph = document.createElement('div');
  ph.className = 'ph';
  ph.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19"/><path d="M5 24h38M24 5c6 6 8 12 8 19s-2 13-8 19M24 5c-6 6-8 12-8 19s2 13 8 19"/></svg><b>Browser</b>';
  c.appendChild(ph);
  document.body.appendChild(c);
  return c;
}
function paintCurtain(c, shot) {
  for (const a of c.getAnimations({ subtree: true })) a.cancel();
  c.style.transformOrigin = '';
  c.classList.toggle('empty', !shot);
  c.classList.remove('dim');
  for (const half of c.querySelectorAll('.half')) half.style.backgroundImage = shot ? `url("${shot}")` : '';
}
async function decodeShot(shot) {
  if (!shot) return;
  const img = new Image();
  img.src = shot;
  try { await img.decode(); } catch { /* shown as soon as it can be */ }
}
// dir: +1 when you travelled right to get here (RB), -1 when left (LB).
function playCurtain(c, style, phase, dir) {
  if (style === 'none') return Promise.resolve();
  const enter = phase === 'in';
  const timing = { duration: BROWSER_ANIM_MS, easing: enter ? 'cubic-bezier(.2,.8,.25,1)' : 'cubic-bezier(.55,0,.8,.3)', fill: 'forwards' };
  const both = (from, to) => (enter ? [from, to] : [to, from]);
  const rest = { transform: 'none', opacity: 1 };
  const runs = [];
  if (style === 'doors') {
    const [l, r] = c.querySelectorAll('.half');
    runs.push(l.animate(both({ transform: 'translateX(-101%)' }, { transform: 'none' }), timing));
    runs.push(r.animate(both({ transform: 'translateX(101%)' }, { transform: 'none' }), timing));
    if (c.classList.contains('empty')) runs.push(c.animate(both({ opacity: 0 }, { opacity: 1 }), timing));
  } else if (style === 'slide') {
    // In: arrives from the side you were heading toward. Out: leaves the way you came.
    const off = enter ? dir * 100 : -dir * 100;
    runs.push(c.animate([enter ? { transform: `translateX(${off}%)` } : rest, enter ? rest : { transform: `translateX(${off}%)` }], timing));
  } else if (style === 'zoom') {
    const tab = tabsEl.children[tabList().indexOf('browser')];
    const r = tab ? tab.getBoundingClientRect() : null;
    c.style.transformOrigin = r ? `${Math.round(r.left + r.width / 2)}px ${Math.round(r.top + r.height / 2)}px` : '50% 0';
    runs.push(c.animate(both({ transform: 'scale(.06)', opacity: 0, borderRadius: '48px' }, { transform: 'none', opacity: 1, borderRadius: '0px' }), timing));
  } else if (style === 'fade') {
    runs.push(c.animate(both({ opacity: 0 }, { opacity: 1 }), { ...timing, easing: 'ease-in-out' }));
  } else if (style === 'rise') {
    runs.push(c.animate(both({ transform: 'translateY(100%) scale(.94)', opacity: 0.4 }, rest), timing));
  } else if (style === 'flip') {
    const turned = { transform: `perspective(1800px) rotateY(${enter ? -84 : 84}deg) scale(.92)`, opacity: 0 };
    runs.push(c.animate(enter ? [turned, rest] : [rest, turned], timing));
  }
  return Promise.all(runs.map((a) => a.finished.catch(() => {})));
}
// Bumping through the tabs: landing on Browser opens it only once you stay there a moment, so
// passing over it (or turning back) never waits for the page to open and close. And bumper presses
// made while the browser is coming or going are kept and played after it, not dropped.
const BROWSER_SETTLE_MS = 250;
let browserOpenTimer = null;
const queuedTabs = [];
function arriveOnBrowser(dir) {
  clearTimeout(browserOpenTimer);
  browserOpenTimer = setTimeout(() => {
    browserOpenTimer = null;
    if (hoverId === 'browser' && !browserOpen && !modal && !suspended && !busy) launchBrowser(dir);
  }, BROWSER_SETTLE_MS);
}
function queueTabPress(act) {
  if (queuedTabs.length < 6) queuedTabs.push(act);
}
function drainTabQueue() {
  while (queuedTabs.length && !browserMoving) press(queuedTabs.shift());
}
async function launchBrowser(dir = 1) {
  if (browserOpen || browserMoving) return;
  if (prefs.pin.set && prefs.pin.browser && !(await requirePin())) return;
  browserMoving = true;
  const c = browserCurtain();
  try {
    const style = browserAnimStyle();
    paintCurtain(c, browserShot);
    if (style !== 'none') {
      await decodeShot(browserShot);
      c.hidden = false;
      await playCurtain(c, style, 'in', dir);
    }
    const result = await api.browser('open', { url: browserUrl });
    if (!result || !result.ok) {
      c.hidden = true;
      setStatus((result && result.error) || "Couldn't open the browser.", true);
      return;
    }
    browserOpen = true;
    document.body.classList.add('browser-open');
    setStatus('');
    // The live page is now on top of the curtain; take the curtain away once it has painted.
    setTimeout(() => { if (browserOpen && !urlBarOpening) c.hidden = true; }, 300);
  } finally {
    browserMoving = false;
    setTimeout(drainTabQueue, 0);
  }
}
async function closeBrowser(dir = -1) {
  if (!browserOpen || browserMoving) return;
  browserMoving = true;
  const c = browserCurtain();
  try {
    const style = browserAnimStyle();
    const snap = await api.browser('snapshot');
    if (snap && snap.ok) browserShot = snap.image;
    if (style !== 'none') {
      paintCurtain(c, browserShot);
      await decodeShot(browserShot);
      c.hidden = false; // under the live page for now, identical to it
    }
    browserOpen = false;
    await api.browser('close');
    document.body.classList.remove('browser-open');
    await playCurtain(c, style, 'out', dir);
    c.hidden = true;
  } finally {
    browserMoving = false;
    setTimeout(drainTabQueue, 0);
  }
}
async function openUrlBar() {
  if (!browserOpen || modal || urlBarOpening || browserMoving) return;
  urlBarOpening = true;
  // The page draws on top of this whole window, so the on-screen keyboard underneath would
  // be invisible unless the page steps aside for it first. A dimmed picture of the page
  // stays behind the keyboard so you can see what you are leaving.
  const c = browserCurtain();
  try {
    const snap = await api.browser('snapshot');
    if (snap && snap.ok) browserShot = snap.image;
    paintCurtain(c, browserShot);
    await decodeShot(browserShot);
    c.hidden = false;
    c.classList.add('dim');
    await api.browser('hide');
    const v = await ask('Go to', browserUrl, { max: 300 });
    const u = v === null ? null : normalizeUrl(v);
    const result = u ? await api.browser('go', { url: u }) : await api.browser('show');
    if (!result || !result.ok) {
      urlBarOpening = false;
      await closeBrowser();
      setStatus((result && result.error) || "Couldn't open that address.", true);
    } else if (u) browserUrl = u;
  } finally {
    urlBarOpening = false;
    c.classList.remove('dim');
    setTimeout(() => { if (browserOpen) c.hidden = true; }, 300);
  }
}
// Bumpers and left/right on the tab bar. The bar is a loop. The page follows the
// pointer, except on the button tabs.
function moveTabs(d) {
  clearTimeout(browserOpenTimer); // moving on: don't open the browser we were passing
  browserOpenTimer = null;
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
  nestedView = Boolean(view.nested);
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
    requirePin().then((ok) => { if (ok) runAction(t.id); });
  } else if (t.offline) {
    setStatus(t.offline === 'drive' ? `${t.title} is on a drive that isn't plugged in.` : `${t.title}'s files can't be found. Settings > Storage > Clean up can remove broken entries.`, true);
  } else {
    suspended = true;
    dropAllArt(); // the launcher sits hidden while a game runs: don't hold the pictures in memory meanwhile
    setStatus('Starting…');
    api.launch(t.id);
  }
}

function runAction(id) {
  if (id === '_storage') flowStorage();
  else if (id === '_update') flowUpdate();
  else if (id === '_pad') flowPadMenu();
  else if (id === '_keyboard') flowKeyboardMenu();
  else if (id === '_install') flowInstaller();
  else if (id === '_theme') flowTheme();
  else if (id === '_profiles') flowProfiles();
  else if (id === '_display') flowCalMenu();
  else if (id === '_controls') flowControls();
  else if (id === '_desktop') flowDesktop();
  else if (id === '_addons') flowAddons();
  else if (id === '_pin') flowPin();
  else if (id === '_wifi') flowWifi();
  else if (id === '_bluetooth') flowBluetooth();
  else if (id === '_sound') flowSound();
  else if (id === '_power') flowPower();
  else setStatus('Not available yet.');
}
