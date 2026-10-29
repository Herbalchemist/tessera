// SPDX-License-Identifier: GPL-3.0-or-later
// Input: controllers, keyboard and mouse, turned into moves and actions; and startup.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ------------------------------------------------------------------ input

// Hold Y for 3 seconds on a tab (any but Settings and + Mosaic) to pick it up, then move it with
// left/right. Any other press puts it down. (Deliberately not shown on screen.)
function liftTarget() {
  const id = focus === 'tabs' ? hoverId : page;
  return data.tabOrder.includes(id) && !stack.length ? id : null;
}
function startHold() {
  cancelHold();
  if (modal || reorderId || place || !liftTarget()) return;
  holdTimer = setTimeout(() => {
    holdTimer = null;
    yTap = false;
    const id = liftTarget();
    if (!id || modal) return;
    focus = 'tabs'; // the tab bar takes over; D-pad / stick slide the tab
    hoverId = id;
    reorderId = id;
    update();
  }, REORDER_HOLD_MS);
}
function cancelHold() {
  clearTimeout(holdTimer);
  holdTimer = null;
}
// Y on a mosaic: tap = Options, hold 3 s = pick it up. Elsewhere Y is just Options.
function yDown() {
  if (modal || reorderId || place || !liftTarget()) return press('y');
  yTap = focus === 'content';
  startHold();
}
function yUp() {
  const pending = holdTimer !== null;
  cancelHold();
  if (yTap && pending) { yTap = false; press('y'); }
  yTap = false;
}
async function reorderPress(act) {
  if (act === 'left' || act === 'right') {
    await lib('moveTab', { id: reorderId, dir: act === 'left' ? -1 : 1 }, { quiet: true });
    update();
    return;
  }
  reorderId = null;
  update();
}

function press(act) {
  if (browserMoving && !suspended && (act === 'lb' || act === 'rb')) return queueTabPress(act);
  if (suspended || busy || browserMoving) return;
  if (browserOpen && !modal) {
    if (act === 'lb' || act === 'rb') { const d = act === 'lb' ? -1 : 1; closeBrowser(d); moveTabs(d); }
    else if (act === 'b') closeBrowser(-1); // same as backing out of anything else
    return; // everything else in the page itself goes through the mouse pointer, not Tessera nav
  }
  if (modal) return modalPress(act);
  if (reorderId) return reorderPress(act);
  if (place) return placePress(act);
  if (act === 'lb' || act === 'rb') {
    moveTabs(act === 'lb' ? -1 : 1);
    if (hoverId === 'browser') arriveOnBrowser(act === 'lb' ? -1 : 1); // staying on it after a bumper opens it
    return;
  }
  if (focus === 'tabs') {
    // Horizontal shells use left/right across categories. Dashboard turns the
    // same list into a sidebar, so up/down stays visually and spatially true.
    const shell = shellLayoutInfo();
    if (shell.navigation === 'vertical') {
      if (act === 'up') return moveTabs(-1);
      if (act === 'down') return moveTabs(1);
    } else {
      if (act === 'left') return moveTabs(-1);
      if (act === 'right') return moveTabs(1);
    }
    if (act === shell.contentEntry || act === 'a') {
      if (hoverId === 'new') return flowNewMosaic({});
      if (hoverId === 'browser') return launchBrowser();
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

// One controller button went down.
function onButton(n) {
  if (modal && modal.kind === 'capture' && modal.keyboard) {
    if (n === 1) modal.finish(null); // B cancels; other buttons are ignored while waiting for a key
    return;
  }
  if (modal && modal.kind === 'capture' && modal.only) {
    if (!modal.only.includes(n)) {
      modal.note = 'Use a face button (A, B, X, Y) or a bumper.';
      return renderModal();
    }
    return modal.finish(n);
  }
  if (modal && modal.kind === 'capture') {
    if (RESERVED_BUTTONS.includes(n)) {
      modal.note = `${roleName(n)} can't be used here. Try another button.`;
      return renderModal();
    }
    return modal.finish(n);
  }
  if (n === 16 && !(modal && modal.kind === 'pad')) { if (!guideWatching) guidePressFromPage(); return; }
  if (suspended || busy) return;
  if (modal && modal.kind === 'pad') { modal.last = n; return; } // the tester just watches
  if (modal && modal.kind === 'grip') { const nm = BUTTON_NAMES_BY_ROLE[n]; if (nm === 'a' || nm === 'b') press(nm); return; }
  if (modal && modal.kind === 'cal') {
    if (n === 3) return calCompare(true);
    const nm = BUTTON_NAMES_BY_ROLE[n];
    if (nm) calPress(nm);
    return;
  }
  if (modal && modal.kind === 'color') return colorButton(n);
  if (modal && modal.kind === 'keys') return keysButton(n);
  if (modal && modal.kind === 'list') {
    if (n === 3 && modal.onY) modal.onY(modal.items[modal.index]);
    else if (n === 3) return;
    else { const nm = BUTTON_NAMES_BY_ROLE[n]; if (nm) press(nm); }
    return;
  }
  if (browserOpen) {
    // Y pops up Go to…; LB/RB/B need to actually reach press() so they can close the browser —
    // everything else is left to the page itself (mouse, or typing once Go to… is open).
    if (n === 3) return openUrlBar();
    const nm = BUTTON_NAMES_BY_ROLE[n];
    if (nm === 'lb' || nm === 'rb' || nm === 'b') press(nm);
    return;
  }
  if (n === 3) return yDown();
  const name = BUTTON_NAMES_BY_ROLE[n];
  if (name) press(name);
}
function onRelease(n) {
  if (n === 3 && modal && modal.kind === 'cal') return calCompare(false);
  if (browserOpen) return; // Y is a tap here (open the address prompt), not a hold
  if (n === 3 && !modal) yUp();
}

// The launcher stays hidden (body.hold) until its first data arrives, and on a
// brand-new install until the welcome popup has been answered.
const reveal = () => document.body.classList.remove('hold');
setTimeout(() => { if (!modal) reveal(); }, 8000); // never leave the screen blank
let lowWarned = false;
api.onDriveAdded((d) => offerDrive(d));
api.onInit((payload) => {
  applyView(payload);
  if (payload.error) setStatus(payload.error, true);
  else if (!lowWarned && payload.prefs && payload.prefs.storage && payload.prefs.storage.low.length) {
    lowWarned = true;
    const l = payload.prefs.storage.low[0];
    setStatus(`Low storage: ${l.name} has ${fmtBytes(l.free)} left. Settings > Storage can help free some up.`, true);
  }
  if (!GUIDE_ONLY && payload.prefs && payload.prefs.live) {
    if (!installerShown && !modal && !busy) flowInstaller().then(reveal);
    else reveal();
  } else if (!GUIDE_ONLY && payload.prefs && payload.prefs.pin && payload.prefs.pin.firstRun && !welcomed) {
    if (!modal && !busy) flowWelcome().then(reveal);
  } else {
    reveal();
    // "Who's playing?" once at start, when that's turned on (Settings › Profiles).
    if (!GUIDE_ONLY && !askedWho) { askedWho = true; api.profiles('list').then((pr) => { if (pr && (pr.ask || pr.lockedOut) && pr.profiles && pr.profiles.length && !modal && !busy) whoIsPlaying(); }).catch(() => {}); }
  }
});
let askedWho = false;

function resume(message) {
  suspended = false;
  // The game ended (maybe while the guide was up in front of it).
  gameOn = null;
  if (guideOpen) closeGuide({ stay: true });
  update(); // loads the pictures near the selection again
  prevBtn[0] = true; // if A is still held, don't relaunch until it's released
  setStatus(message, Boolean(message));
}
api.onGameExited(resume);
// Closing the browser with LB / RB lands on the neighbouring tab.
api.onShiftTab((dir) => { hoverId = 'browser'; moveTabs(dir); });
if (api.onBrowserAction) {
  api.onBrowserAction((action) => {
    if (!browserOpen || modal || urlBarOpening) return;
    if (action === 'y') return openUrlBar();
    if (action === 'b' || action === 'lb' || action === 'rb') press(action);
  });
}
api.onLaunchFailed(resume);

// ------------------------------------------------------------------ controllers
// Chromium's own gamepad list, plus the Nintendo Switch controllers that Tessera reads itself
// (pads.js in the main process), because Chromium leaves those out on Linux.
const vpads = new Map(); // pads.js id -> a gamepad-shaped object
const vmotion = new Map(); // pads.js id -> { L: {gyro, accel}, R: ..., pro: ... }
let vpadInfo = { ok: false, pads: [], grip: false, mode: 'together' };
const VBUTTONS = 18;
function vpadObject(id, bits, axes) {
  const info = vpadInfo.pads.find((p) => p.id === id);
  const buttons = [];
  for (let n = 0; n < VBUTTONS; n++) { const on = Boolean(bits & (1 << n)); buttons.push({ pressed: on, touched: on, value: on ? 1 : 0 }); }
  return { id: info ? info.name : 'Nintendo controller', key: id, index: 100 + (info ? info.player : 0), connected: true, mapping: 'standard', timestamp: performance.now(), buttons, axes: axes.slice(0, 4), player: info ? info.player : 0, tessera: true, info };
}
function applyPadList(list) {
  if (!list || !list.ok) return;
  vpadInfo = list;
  const ids = new Set(list.pads.map((p) => p.id));
  for (const id of [...vpads.keys()]) if (!ids.has(id)) { vpads.delete(id); vmotion.delete(id); }
  for (const p of list.pads) {
    const old = vpads.get(p.id);
    if (!old) vpads.set(p.id, vpadObject(p.id, 0, [0, 0, 0, 0]));
    else { old.id = p.name; old.player = p.player; old.info = p; }
  }
  if (modal && modal.kind === 'grip') renderGrip();
}
if (api.onPads) {
  api.onPads((m) => {
    if (!m) return;
    if (m.type === 'list') applyPadList(m);
    else if (m.type === 'frame' && typeof m.id === 'string' && Array.isArray(m.a)) {
      if (!vpadInfo.pads.some((p) => p.id === m.id)) return;
      vpads.set(m.id, vpadObject(m.id, m.b | 0, m.a));
    } else if (m.type === 'motion' && typeof m.id === 'string') {
      const all = vmotion.get(m.id) || {};
      all[m.part] = { gyro: m.gyro, accel: m.accel };
      vmotion.set(m.id, all);
    }
  });
  api.pads('list').then(applyPadList).catch(() => {});
}
function gamepads() {
  const out = [];
  let native = [];
  try { native = [...navigator.getGamepads()]; } catch { /* none */ }
  for (const p of native) {
    if (!p || !p.connected) continue;
    if (vpadInfo.ok && /vendor:\s*057e/i.test(p.id)) continue; // Tessera reads these itself
    out.push(p);
  }
  for (const p of vpads.values()) out.push(p);
  return out;
}
// The controller in charge is the one somebody used last: picking up a second controller and
// pressing a button just works. Until then, the first standard one.
let lastPadId = null;
let currentPad = null; // its identity
const padBusyBefore = new Map();
const padIdent = (p) => p.key || `${p.id}#${p.index}`;
let padWasBusy = true; // a controller already held at start doesn't count as a fresh press
const padBusy = (p) => p.buttons.some((b) => b && b.pressed) || p.axes.slice(0, 4).some((a) => Math.abs(a) > 0.6);
function choosePad() {
  const pads = gamepads();
  let chosen = pads.find((p) => padIdent(p) === currentPad) || null;
  for (const p of pads) {
    const k = padIdent(p);
    const busy = padBusy(p);
    const was = padBusyBefore.get(k);
    padBusyBefore.set(k, busy);
    if (was === undefined) continue; // just appeared: a trigger resting at -1 is not somebody pressing
    if (busy && !was && k !== currentPad) chosen = p;
  }
  if (!chosen) chosen = pads.find((p) => p.mapping === 'standard') || pads[0] || null;
  if (chosen && padIdent(chosen) !== currentPad) {
    currentPad = padIdent(chosen);
    prevBtn.fill(false); // start fresh, so the press that woke this controller counts
  }
  return chosen;
}
function activePad() {
  const pads = gamepads();
  return pads.find((p) => padIdent(p) === currentPad) || pads.find((p) => p.mapping === 'standard') || pads[0] || null;
}

// Holding a direction: one repeater for the launcher and the browser (input-actions.js), at the
// speed chosen in Settings > Controller > Repeat speed. A new direction moves at once.
let padNav = null;
let padNavSpeed = null;
let navQuietUntil = 0; // just back from the browser: a stick still held there doesn't move the launcher at once
function navRepeater() {
  const speed = prefs.pad.repeat || 'standard';
  if (padNav && padNavSpeed === speed) return padNav;
  if (padNav) padNav.dispose();
  padNavSpeed = speed;
  padNav = IA.createDirectionRepeater({
    ...IA.repeatTiming(speed, 'launcher'),
    onAction: (dir) => {
      // (with the browser open, a menu or the address keyboard over it still moves)
      if (suspended || busy || (browserOpen && !modal) || performance.now() < navQuietUntil) return;
      if (!(modal && modal.kind === 'capture')) press(dir);
    },
  });
  return padNav;
}

function loop(now) {
  const pad = suspended ? null : choosePad();
  const nav = navRepeater();
  if (!pad || suspended) nav.set('pad', '');
  if (pad && mouseShown && padBusy(pad)) hideMouse();
  if (pad) {
    // A fresh press or push on the controller makes the hints show its buttons again. Only a
    // change counts, so a trigger that rests half-pressed can't hold the hints on the controller.
    const busyNow = padBusy(pad);
    if (busyNow && !padWasBusy) setInputMode('pad');
    padWasBusy = busyNow;
  }
  if (pad && browserOpen && !modal) {
    // The main-process adapters own browser input. Track held buttons without
    // dispatch so native Gamepad API polling cannot double-fire B/Y/bumper actions
    // or replay a held button when the address keyboard opens.
    const swap = padMap(pad);
    for (let n = 0; n < prevBtn.length; n++) { const k = IA.physicalFor(n, swap); prevBtn[n] = Boolean(pad.buttons[k] && pad.buttons[k].pressed); }
    nav.set('pad', '');
    navQuietUntil = now + IA.repeatTiming(prefs.pad.repeat, 'launcher').initialDelay;
  } else if (pad) {
    if (pad.id !== lastPadId) {
      lastPadId = pad.id;
      applyGlyphs(); // "automatic" labels follow whichever controller is in use
      if (modal && modal.kind === 'keys') renderModal();
      setStatus(`Controller: ${pad.id.replace(/\s*\((STANDARD GAMEPAD|Vendor)[^)]*\)/gi, '').replace(/ \(Nintendo\)$/, '').trim() || 'connected'}`, false, { log: false });
    }
    // n is a role (0 confirms, 1 goes back...): read the physical button doing that job.
    const swap = padMap(pad);
    const b = (n) => { const k = IA.physicalFor(n, swap); return Boolean(pad.buttons[k] && pad.buttons[k].pressed); };
    const wheel = modal && modal.kind === 'color'; // on the color wheel the stick moves the cursor smoothly instead
    const sx = wheel ? 0 : axisValue(pad, 0);
    const sy = wheel ? 0 : axisValue(pad, 1);
    const left = b(14) || sx < -0.5;
    const right = b(15) || sx > 0.5;
    const up = b(12) || sy < -0.5;
    const down = b(13) || sy > 0.5;

    if (patternActive()) {
      // PIN pattern: the D-pad types digits like any other button, and nothing navigates.
      nav.set('pad', '');
      for (let n = 12; n <= 15; n++) {
        const d = b(n);
        if (d && !prevBtn[n]) onButton(n);
        prevBtn[n] = d;
      }
    } else {
      nav.set('pad', left ? 'left' : right ? 'right' : up ? 'up' : down ? 'down' : '');
    }
    // Every button fires once per press (and once on release).
    const count = Math.min(pad.buttons.length, prevBtn.length);
    for (let n = 0; n < count; n++) {
      if (n >= 12 && n <= 15) continue; // the D-pad is handled above
      const isDown = b(n);
      if (isDown && !prevBtn[n]) onButton(n);
      if (!isDown && prevBtn[n]) onRelease(n);
      prevBtn[n] = isDown;
    }

  }
  if (modal && modal.kind === 'pad') updatePad(pad, now);
  if (modal && modal.kind === 'color') updateColor(pad, now);
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ mouse
// A mouse works too: the pointer shows up when the mouse moves, in the theme's highlight color, and
// hides again after a few seconds or as soon as the controller or keyboard is used. Click opens what
// is under it (like A), right-click goes back (like B), the wheel moves up and down.
let mouseShown = false;
let mouseTimer = 0;
let cursorFor = '';
function cursorImage() {
  const cs = getComputedStyle(document.documentElement);
  const fill = cs.getPropertyValue('--accent').trim() || '#7fb2ff';
  const edge = cs.getPropertyValue('--on-accent').trim() || '#10151c';
  const key = fill + edge;
  if (key === cursorFor) return;
  cursorFor = key;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M5 3 L5 25 L11 19.5 L15 28.5 L19 26.8 L15.2 18 L23 18 Z" fill="${fill}" stroke="${edge}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  document.documentElement.style.setProperty('--tcursor', `url("data:image/svg+xml,${encodeURIComponent(svg)}") 5 3`);
}
function showMouse() {
  cursorImage();
  if (!mouseShown) { mouseShown = true; document.body.classList.add('mouse'); }
  clearTimeout(mouseTimer);
  const secs = prefs.kb && Number.isFinite(prefs.kb.mouseHide) ? prefs.kb.mouseHide : 3;
  if (secs > 0) mouseTimer = setTimeout(hideMouse, secs * 1000);
}
function hideMouse() {
  if (!mouseShown) return;
  mouseShown = false;
  clearTimeout(mouseTimer);
  document.body.classList.remove('mouse');
}
// Only real movement counts: Chromium also sends mousemove when the page moves under a still pointer.
let mouseAt = null;
window.addEventListener('mousemove', (e) => {
  const at = `${e.screenX},${e.screenY}`;
  if (at === mouseAt) return;
  mouseAt = at;
  setInputMode('mouse');
  showMouse();
}, { passive: true });
window.addEventListener('contextmenu', (e) => { e.preventDefault(); setInputMode('mouse'); showMouse(); if (!suspended && !busy) press('b'); });
let wheelAt = 0;
window.addEventListener('wheel', (e) => {
  setInputMode('mouse');
  showMouse();
  const how = (prefs.kb && prefs.kb.wheel) || 'move';
  if (how === 'off') return;
  const now = performance.now();
  if (now - wheelAt < 140 || suspended || busy) return;
  wheelAt = now;
  const ax = Math.abs(e.deltaX) > Math.abs(e.deltaY);
  const d = ax ? e.deltaX : e.deltaY;
  if (!d) return;
  // 'tabs': up/down on the wheel flips between tabs (lists in a menu still scroll).
  if (how === 'tabs' && !modal && !ax) return press(d > 0 ? 'rb' : 'lb');
  press(ax ? (d > 0 ? 'right' : 'left') : (d > 0 ? 'down' : 'up'));
}, { passive: true });
window.addEventListener('mousedown', (e) => {
  setInputMode('mouse');
  // The back and forward thumb buttons on many mice: back, and next tab.
  if (e.button === 3) { e.preventDefault(); if (!suspended && !busy) press('b'); return; }
  if (e.button === 4) { e.preventDefault(); if (!suspended && !busy && !modal) press('rb'); return; }
  if (e.button === 1) { e.preventDefault(); if (!suspended && !busy) press('y'); return; } // middle click: options
  if (e.button !== 0) return;
  showMouse();
  if (suspended || busy) return;
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  if (modal) {
    // A click outside the menu (on the dimmed screen around it) goes back, like Esc or right-click.
    const outside = !t.closest('.box, .kbpanel, .gnotes, #url-bubble');
    if (outside && modal.kind === 'list' && !modal.welcome) return press('b'); // (not the first-run welcome: a stray click mustn't skip setup)
    if (outside && modal.kind === 'keys' && !modal.patternWanted) return finishKeys(false);
    if (modal.kind === 'list') {
      const it = t.closest('.mitem');
      if (!it || it.dataset.i === undefined) return;
      const i = Number(it.dataset.i);
      if (!modal.items[i]) return;
      if (modal.items[i].header && !modal.items[i].fold) return; // a plain label
      modal.index = i;
      renderModal();
      return press('a');
    }
    if (modal.kind === 'keys') {
      const k = t.closest('.key');
      if (!k || k.dataset.r === undefined) return;
      modal.r = Number(k.dataset.r); modal.c = Number(k.dataset.c);
      return keyAction(keyFor(modal.r, modal.c));
    }
    if (modal.kind === 'grip') return closeModal();
    if (modal.kind === 'tour') return press('a');
    return; // the controller tester, color wheel and calibration are made for the controller
  }
  const tab = t.closest('.tab');
  if (tab && tabsEl.contains(tab)) {
    const list = tabList();
    const i = [...tabsEl.children].indexOf(tab);
    if (i < 0 || !list[i]) return;
    moveTabs(i - Math.max(0, list.indexOf(hoverId)));
    if (isButtonTab(hoverId)) press('a'); // Browser and "+ Mosaic" are buttons
    return;
  }
  const card = t.closest('.card');
  if (!card || !rowsEl.contains(card)) return;
  const rowEl = card.closest('.row');
  const r = [...rowsEl.querySelectorAll('.row')].indexOf(rowEl);
  const n = [...card.parentElement.children].indexOf(card);
  const rows = currentRows();
  if (r < 0 || n < 0 || !rows[r]) return;
  if (reorderId || place) return; // moving something: finish that with the controller
  const c = cur();
  c.row = r;
  c.cols[rows[r].id] = n;
  focus = 'content';
  update();
  press('a');
});

// The keyboard. Every action can be rebound in Settings > Keyboard & mouse; keys are matched by
// position (e.code). Volume keys always work.
function volumeKey(e) {
  const d = { AudioVolumeUp: 1, AudioVolumeDown: -1, AudioVolumeMute: 0 }[e.code];
  if (d === undefined) return false;
  if (!api.audio) return true;
  api.audio('info').then(async (a) => {
    const out = a && a.ok ? a.outputs.find((o) => o.isDefault) : null;
    if (!out) return;
    if (d === 0) {
      await api.audio('mute', { kind: 'output', id: out.id, on: !out.mute });
      return setStatus(out.mute ? `Sound on · ${out.volume}%` : 'Muted');
    }
    const v = Math.max(0, Math.min(100, (out.volume || 0) + d * 5));
    if (out.mute && d > 0) await api.audio('mute', { kind: 'output', id: out.id, on: false });
    await api.audio('volume', { kind: 'output', id: out.id, pct: v });
    setStatus(`Volume ${v}%`);
  }).catch(() => {});
  return true;
}
window.addEventListener('keydown', (e) => {
  setInputMode('keyboard');
  hideMouse();
  if (modal && modal.kind === 'capture' && modal.keyboard) {
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape') return modal.finish(null);
    if (!KBM.validCode(e.code)) { modal.note = "That key can't be used. Try another."; return renderModal(); }
    return modal.finish(e.code);
  }
  if (volumeKey(e)) return e.preventDefault();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const act = kbIndex.get(e.code) || null;
  if (modal && modal.kind === 'capture') {
    if (e.key === 'Escape') modal.finish(null);
    return;
  }
  if (modal && modal.kind === 'pad') {
    if (e.key === 'Escape') closeModal();
    return;
  }
  if (modal && modal.kind === 'color') {
    if (act === 'left' || act === 'right' || act === 'up' || act === 'down') colorPress(act);
    else if (act === 'a') colorButton(0);
    else if (act === 'b') colorButton(1);
    else if (act === 'x') colorButton(2);
    else if (act === 'y' || e.key === 'h') colorButton(3);
    else if (act === 'lb') colorButton(4);
    else if (act === 'rb') colorButton(5);
    if (act) e.preventDefault();
    return;
  }
  if (suspended || busy) return;
  if (modal && modal.kind === 'keys') {
    if (e.key.length === 1) { typeChar(e.key); return e.preventDefault(); }
    if (e.key === 'Enter') return finishKeys(true);
    if (e.key === 'Escape') return finishKeys(false);
    if (e.key === 'Backspace') return keyAction('back');
  }
  // Esc+Left / Esc+Right is the keyboard equivalent of LB/RB: switch tabs (mosaics).
  // Esc alone still means "back", but only fires on release, so it can be judged as
  // a chord first — the same tap-vs-hold pattern used for Y below.
  if (e.code === 'Escape' && act === 'b') {
    escHeld = true;
    escChordUsed = false;
    return e.preventDefault();
  }
  if (escHeld && (act === 'left' || act === 'right')) {
    escChordUsed = true;
    press(act === 'right' ? 'rb' : 'lb');
    return e.preventDefault();
  }
  if (!act) return;
  e.preventDefault();
  if (act === 'y') return e.repeat ? undefined : yDown();
  if (act === 'guide') return e.repeat ? undefined : guidePressFromPage();
  press(act);
});
window.addEventListener('keyup', (e) => {
  if (kbIndex.get(e.code) === 'y') yUp();
  // Only fire "back" here if OUR keydown branch actually claimed this Escape (escHeld).
  // When a modal (capture/pad/color/keys) already handled it on keydown, escHeld was
  // never set, so this stays a no-op instead of firing a second, spurious "back".
  if (e.code === 'Escape' && escHeld) {
    if (!escChordUsed) press('b');
    escHeld = false;
    escChordUsed = false;
  }
});
window.addEventListener('resize', update);

render();
requestAnimationFrame(loop); // one loop, started once
