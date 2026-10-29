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
// ---- the frame: Tessera stays around the page (Theme Settings › Browser frame). The page is a
// native view, so it sits in the frame's opening: the launcher measures the opening and tells the
// main process where to put it. Full screen sends no opening.
let browserState = { url: '', title: '', loading: false };
function browserFramed() {
  const s = prefs.theme && prefs.theme.settings.find((x) => x.id === 'browserFrame');
  return !s || s.value !== 'full';
}
function browserFrame() {
  let f = document.getElementById('browser-frame');
  if (f) return f;
  f = document.createElement('div');
  f.id = 'browser-frame';
  f.hidden = true;
  f.innerHTML =
    '<div class="bf-top">' +
      '<div class="bf-side l"><b data-g="4"></b><span class="bf-prev"></span></div>' +
      '<div class="bf-addr"><svg class="bf-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/></svg>' +
        '<span class="bf-host"></span><span class="bf-title"></span><i class="bf-load"></i></div>' +
      '<div class="bf-side r"><span class="bf-hint"><b data-g="3"></b>Address</span><span class="bf-next"></span><b data-g="5"></b></div>' +
    '</div>' +
    '<div class="bf-bezel"><div class="bf-view"></div><i class="bf-corner tl"></i><i class="bf-corner tr"></i><i class="bf-corner bl"></i><i class="bf-corner br"></i></div>';
  document.body.appendChild(f);
  return f;
}
function paintBrowserFrame() {
  const f = document.getElementById('browser-frame');
  if (!f) return;
  const list = tabList();
  const i = list.indexOf('browser');
  f.querySelector('.bf-prev').textContent = tabName(list[(i - 1 + list.length) % list.length]);
  f.querySelector('.bf-next').textContent = tabName(list[(i + 1) % list.length]);
  let host = '';
  let secure = false;
  try { const u = new URL(browserState.url || browserUrl); host = u.host.replace(/^www\./, ''); secure = u.protocol === 'https:'; } catch { host = ''; }
  f.querySelector('.bf-host').textContent = host || 'New page';
  const title = (browserState.title || '').trim();
  f.querySelector('.bf-title').textContent = title && title !== host ? title : '';
  f.querySelector('.bf-addr').classList.toggle('secure', secure);
  f.classList.toggle('loading', Boolean(browserState.loading));
  applyGlyphs();
}
// Show the frame and put the page in its opening (or the whole window, full screen).
async function placeBrowser() {
  const framed = browserFramed();
  document.body.classList.toggle('browser-framed', framed);
  if (!framed) { const f = document.getElementById('browser-frame'); if (f) f.hidden = true; await api.browser('frame', { rect: null }); return null; }
  const f = browserFrame();
  f.hidden = false;
  paintBrowserFrame();
  const r = f.querySelector('.bf-view').getBoundingClientRect();
  const rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  await api.browser('frame', { rect });
  return rect;
}
function hideBrowserFrame() {
  const f = document.getElementById('browser-frame');
  if (f) f.hidden = true;
  document.body.classList.remove('browser-framed');
}
// The curtain (the picture of the page) covers exactly where the page is.
function fitCurtain(c, rect) {
  for (const k of ['left', 'top', 'width', 'height']) c.style[k] = '';
  c.style.inset = '';
  if (!rect) return;
  c.style.inset = 'auto';
  c.style.left = rect.x + 'px'; c.style.top = rect.y + 'px';
  c.style.width = rect.width + 'px'; c.style.height = rect.height + 'px';
}
if (api.onBrowserState) api.onBrowserState((st) => { if (st && typeof st === 'object') { browserState = st; paintBrowserFrame(); } });
let frameResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(frameResizeTimer);
  frameResizeTimer = setTimeout(() => { if (browserOpen && !browserMoving) placeBrowser().then((r) => fitCurtain(browserCurtain(), r)).catch(() => {}); }, 120);
});
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
  if (!(await unlockOwnBrowser())) return; // their own browser, behind their own PIN
  if (!(await guestAllowed({ perm: 'browser' }))) return;
  browserMoving = true;
  const c = browserCurtain();
  try {
    const style = browserAnimStyle();
    browserState = { url: browserUrl, title: browserState.url === browserUrl ? browserState.title : '', loading: false };
    fitCurtain(c, await placeBrowser());
    paintCurtain(c, browserShot);
    if (style !== 'none') {
      await decodeShot(browserShot);
      c.hidden = false;
      await playCurtain(c, style, 'in', dir);
    }
    const result = await api.browser('open', { url: browserUrl });
    if (!result || !result.ok) {
      c.hidden = true;
      hideBrowserFrame();
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
    document.getElementById('browser-frame')?.classList.add('leaving');
    await playCurtain(c, style, 'out', dir);
    c.hidden = true;
    hideBrowserFrame();
    document.getElementById('browser-frame')?.classList.remove('leaving');
  } finally {
    browserMoving = false;
    setTimeout(drainTabQueue, 0);
  }
}
// ---- the address bubble. While you browse, the address is the small pill in the frame's top bar.
// Y pulls that pill down out of the bar (a stretchy neck stays joined to the slot it came from),
// then it swells into a big bubble for editing, with the keyboard docked below. Done, it shrinks
// back and docks in its slot. Full screen, a small pill comes down from the top edge instead.
function urlBubble() {
  let b = document.getElementById('url-bubble');
  if (!b) {
    b = document.createElement('div');
    b.id = 'url-bubble';
    b.hidden = true;
    b.innerHTML =
      '<svg class="ub-neck" viewBox="0 0 160 30" preserveAspectRatio="none" aria-hidden="true"><path class="skin" d="M52 0 H108 C108 16 128 30 160 30 V33 H0 V30 C32 30 52 16 52 0 Z"/>' +
        '<path class="edge" d="M52 0 C52 16 32 30 0 30 M108 0 C108 16 128 30 160 30"/></svg>' +
      '<div class="ub-body">' +
        '<div class="ub-mini"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/></svg><span></span></div>' +
        '<div class="ub-row">' +
          '<svg class="ub-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>' +
          '<div class="ub-field"><span class="ub-text"></span><span class="caret"></span><span class="ub-ph">Search, or type a web address</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="ub-sub"></div>';
    document.body.appendChild(b);
  }
  return b;
}
const motionOn = () => { const s = prefs.theme && prefs.theme.settings.find((x) => x.id === 'motion'); return !(s && s.value === false); };
// Where the pill is, the bar edge it's pulled across, the moment just after it clears that edge, and
// where the big bubble ends up.
function bubbleGeometry() {
  const pillEl = browserFramed() ? document.querySelector('#browser-frame:not([hidden]) .bf-addr') : null;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const r = pillEl ? pillEl.getBoundingClientRect() : { left: W / 2 - 160, top: -46, width: 320, height: 40, bottom: -6 };
  const edge = pillEl ? document.querySelector('#browser-frame .bf-top').getBoundingClientRect().bottom : 0;
  const pill = { left: r.left, top: r.top, width: r.width, height: r.height };
  const cx = r.left + r.width / 2;
  const midW = r.width * 0.9;
  const midH = r.height * 1.12;
  const mid = { left: cx - midW / 2, top: edge + 6, width: midW, height: midH };
  const fw = Math.min(820, W * 0.72);
  const fh = Math.round(Math.max(64, Math.min(86, H * 0.105)));
  const big = { left: (W - fw) / 2, top: edge + Math.max(26, H * 0.045), width: fw, height: fh };
  return { pillEl, pill, mid, big, anchor: Math.max(0, r.bottom), cx };
}
// The neck's shape (Theme Settings › Address bubble): its outline, as a fraction of its own width.
const NECKS = {
  narrow: { skin: 'M52 0 H108 C108 16 128 30 160 30 V33 H0 V30 C32 30 52 16 52 0 Z', edge: 'M52 0 C52 16 32 30 0 30 M108 0 C108 16 128 30 160 30' },
  wide: { skin: 'M22 0 H138 C138 18 147 30 160 30 V33 H0 V30 C13 30 22 18 22 0 Z', edge: 'M22 0 C22 18 13 30 0 30 M138 0 C138 18 147 30 160 30' },
};
function bubbleStyle() {
  const s = prefs.theme && prefs.theme.settings.find((x) => x.id === 'addressBubble');
  return s && ['wide', 'narrow', 'detached'].includes(s.value) ? s.value : 'wide';
}
const px = (g, extra = {}) => ({ left: g.left + 'px', top: g.top + 'px', width: g.width + 'px', height: g.height + 'px', ...extra });
function paintUrlBubble(text, fresh) {
  const b = document.getElementById('url-bubble');
  if (!b) return;
  const t = b.querySelector('.ub-text');
  t.textContent = text;
  t.classList.toggle('sel', Boolean(fresh && text));
  b.querySelector('.ub-field').classList.toggle('empty', !text);
  const s = String(text || '').trim();
  const where = !s ? '' : /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) ? 'Opens this address' : 'Searches DuckDuckGo';
  b.querySelector('.ub-sub').textContent = fresh ? 'Type to replace it' : where;
}
function pullUrlBubble(b) {
  const g = bubbleGeometry();
  b._geo = g;
  const body = b.querySelector('.ub-body');
  const neck = b.querySelector('.ub-neck');
  const sub = b.querySelector('.ub-sub');
  const mini = b.querySelector('.ub-mini');
  const row = b.querySelector('.ub-row');
  // The bubble starts as the pill: same words, same lock.
  if (g.pillEl) {
    mini.querySelector('span').textContent = g.pillEl.querySelector('.bf-host').textContent;
    mini.classList.toggle('secure', g.pillEl.classList.contains('secure'));
    g.pillEl.classList.add('pulled'); // an empty slot stays in the bar
  } else mini.querySelector('span').textContent = '';
  for (const a of b.getAnimations({ subtree: true })) a.cancel();
  b.classList.remove('back');
  b.hidden = false;
  // Wide: the neck spans most of the slot. Narrow (and Detached, which pinches a thin one): a tail.
  const style = bubbleStyle();
  const shape = NECKS[style === 'wide' ? 'wide' : 'narrow'];
  neck.querySelector('.skin').setAttribute('d', shape.skin);
  neck.querySelector('.edge').setAttribute('d', shape.edge);
  const nw = style === 'wide' ? Math.round(g.pill.width * 0.96) : 200;
  b._style = style;
  b._detached = false;
  Object.assign(body.style, px(g.big, { borderRadius: '30px' }));
  Object.assign(neck.style, { width: nw + 'px', left: g.cx - nw / 2 + 'px', top: g.anchor - 1 + 'px', height: g.big.top - g.anchor + 3 + 'px', opacity: '' });
  Object.assign(sub.style, { left: g.big.left + 30 + 'px', top: g.big.top + g.big.height + 10 + 'px' });
  if (!motionOn()) {
    mini.style.opacity = 0; row.style.opacity = 1;
    if (style === 'detached') { neck.style.opacity = '0'; b._detached = true; }
    return Promise.resolve();
  }
  const T = 620;
  const pullEase = 'cubic-bezier(.55,0,.8,.45)'; // tugged out of the slot
  const growEase = 'cubic-bezier(.2,1.25,.4,1)'; // then it swells, overshooting a touch
  const runs = [
    body.animate([
      { ...px(g.pill), borderRadius: g.pill.height / 2 + 'px', offset: 0, easing: pullEase },
      { ...px(g.mid), borderRadius: g.mid.height / 2 + 'px', offset: 0.34, easing: growEase },
      { ...px(g.big), borderRadius: '30px', offset: 1 },
    ], { duration: T }),
    neck.animate([
      { height: '0px', opacity: 0, offset: 0, easing: pullEase },
      { height: Math.max(0, g.mid.top - g.anchor) * 0.5 + 'px', opacity: 0, offset: 0.2 },
      { height: Math.max(0, g.mid.top - g.anchor) + 3 + 'px', opacity: 1, offset: 0.34, easing: growEase },
      { height: g.big.top - g.anchor + 3 + 'px', opacity: 1, offset: 1 },
    ], { duration: T }),
    // the small address goes before the full one appears: never both at once
    mini.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0, offset: 0.42 }, { opacity: 0 }], { duration: T, fill: 'forwards' }),
    row.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.8 }, { opacity: 1 }], { duration: T, fill: 'forwards' }),
    sub.animate([{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], { duration: T, fill: 'forwards' }),
  ];
  const done = Promise.all(runs.map((a) => a.finished.catch(() => {})));
  if (style !== 'detached') return done;
  // Detached: once it's open, the tail pinches in the middle and snaps back up into the slot, and
  // the bubble, let go, drops a little and settles.
  return done.then(() => {
    if (b.hidden || b._style !== 'detached' || !runs.every((a) => a.playState === 'finished')) return;
    const h = g.big.top - g.anchor + 3;
    b._detached = true;
    const snap = [
      neck.animate([
        { height: h + 'px', transform: 'none', opacity: 1 },
        { height: h * 0.6 + 'px', transform: 'scaleX(.32)', opacity: 1, offset: 0.45 },
        { height: '0px', transform: 'scaleX(.18)', opacity: 0 },
      ], { duration: 300, easing: 'cubic-bezier(.5,0,.7,.4)', fill: 'forwards' }),
      body.animate([{ transform: 'none' }, { transform: 'translateY(7px)', offset: 0.45 }, { transform: 'translateY(-2px)', offset: 0.75 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' }),
    ];
    return Promise.all(snap.map((a) => a.finished.catch(() => {})));
  });
}
async function retractUrlBubble(b) {
  if (!b || b.hidden) return;
  const g = b._geo || bubbleGeometry();
  const body = b.querySelector('.ub-body');
  const neck = b.querySelector('.ub-neck');
  if (motionOn()) {
    for (const a of b.getAnimations({ subtree: true })) a.cancel();
    // Detached: the tail first reaches back down from the slot and catches the bubble (the first
    // 30%), then it is drawn home the same way as the others.
    const reach = b._detached ? 0.3 : 0;
    const at = (o) => reach + o * (1 - reach);
    const T = 380 + (reach ? 200 : 0);
    const H = g.big.top - g.anchor + 3;
    const neckFrames = [
      ...(reach ? [{ height: '0px', opacity: 0, transform: 'scaleX(.4)' }, { height: H + 'px', opacity: 1, transform: 'none', offset: reach, easing: 'cubic-bezier(.3,1.4,.5,1)' }] : [{ height: H + 'px', opacity: 1, transform: 'none' }]),
      { height: Math.max(0, g.mid.top - g.anchor) + 3 + 'px', opacity: 1, transform: 'none', offset: at(0.62) },
      { height: '0px', opacity: 0, transform: 'none', offset: at(0.85) },
      { height: '0px', opacity: 0, transform: 'none' },
    ];
    const runs = [
      body.animate([
        { ...px(g.big), borderRadius: '30px' },
        ...(reach ? [{ ...px(g.big), borderRadius: '30px', offset: reach }] : []),
        { ...px(g.mid), borderRadius: g.mid.height / 2 + 'px', offset: at(0.62), easing: 'cubic-bezier(.3,.7,.4,1)' },
        { ...px(g.pill), borderRadius: g.pill.height / 2 + 'px' },
      ], { duration: T, fill: 'forwards', easing: 'linear' }),
      neck.animate(neckFrames, { duration: T, fill: 'forwards' }),
      b.querySelector('.ub-row').animate([{ opacity: 1 }, { opacity: 1, offset: reach }, { opacity: 0, offset: at(0.3) }, { opacity: 0 }], { duration: T, fill: 'forwards' }),
      b.querySelector('.ub-mini').animate([{ opacity: 0 }, { opacity: 0, offset: at(0.45) }, { opacity: 1, offset: at(0.75) }, { opacity: 1 }], { duration: T, fill: 'forwards' }),
      b.querySelector('.ub-sub').animate([{ opacity: 1 }, { opacity: 0, offset: at(0.2) }, { opacity: 0 }], { duration: T, fill: 'forwards' }),
    ];
    await Promise.all(runs.map((a) => a.finished.catch(() => {})));
  }
  b.hidden = true;
  for (const a of b.getAnimations({ subtree: true })) a.cancel();
  if (g.pillEl) g.pillEl.classList.remove('pulled'); // docked back in its slot
}
async function openUrlBar() {
  if (!browserOpen || modal || urlBarOpening || browserMoving) return;
  urlBarOpening = true;
  // The page draws on top of the window, so it steps aside (a dimmed picture of it stays) while
  // the bubble and the keyboard are out.
  const c = browserCurtain();
  let bubble = null;
  try {
    const snap = await api.browser('snapshot');
    if (snap && snap.ok) browserShot = snap.image;
    paintCurtain(c, browserShot);
    await decodeShot(browserShot);
    c.hidden = false;
    c.classList.add('dim');
    await api.browser('hide');
    window.focus(); // keyboard and controllers back to the launcher page
    bubble = urlBubble();
    paintUrlBubble(browserUrl, true);
    pullUrlBubble(bubble); // the keyboard rises while it comes out
    const v = await ask('Go to', browserUrl, { max: 300, url: true, selectAll: true, cls: 'url', doneLabel: 'Go', onText: paintUrlBubble });
    await retractUrlBubble(bubble);
    const u = v === null ? null : normalizeUrl(v);
    const result = u ? await api.browser('go', { url: u }) : await api.browser('show');
    if (!result || !result.ok) {
      urlBarOpening = false;
      await closeBrowser();
      setStatus((result && result.error) || "Couldn't open that address.", true);
    } else if (u) browserUrl = u;
  } finally {
    if (bubble && !bubble.hidden) retractUrlBubble(bubble);
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
    // Making a problem report changes nothing, so it never asks for the PIN.
    (t.id === '_report' ? Promise.resolve(true) : requirePin()).then((ok) => { if (ok) runAction(t.id); });
  } else if (t.offline) {
    setStatus(t.offline === 'drive' ? `${t.title} is on a drive that isn't plugged in.` : `${t.title}'s files can't be found. Settings > Storage > Clean up can remove broken entries.`, true);
  } else {
    guestAllowed({ id: t.id }).then((ok) => {
      if (!ok) return;
      suspended = true;
      dropAllArt(); // the launcher sits hidden while a game runs: don't hold the pictures in memory meanwhile
      setStatus('Starting…');
      api.launch(t.id);
    });
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
  else if (id === '_report') flowReport();
  else setStatus('Not available yet.');
}
