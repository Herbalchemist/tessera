// SPDX-License-Identifier: GPL-3.0-or-later
// The controller test.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ------------------------------------------------------------ controller test
// Like the Game Controller page in desktop settings: what the system sees,
// live. Every button and stick is drawn, and raw numbers sit underneath, which
// also answers "which number is my A button?" for odd controllers.
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

function buildPad() {
  modalEl.className = 'pad';
  modalEl.replaceChildren();
  const box = document.createElement('div');
  box.className = 'box padbox';
  const title = document.createElement('h3');
  const sub = document.createElement('div');
  sub.className = 'padsub';
  const svg = svgEl('svg', { viewBox: '0 0 600 340', class: 'padsvg' });
  const parts = {};
  const btn = (index, tag, attrs, label, lx, ly) => {
    const g = svgEl('g', { class: 'pb' }, svg);
    svgEl(tag, attrs, g);
    if (label) {
      const t = svgEl('text', { x: lx, y: ly, class: 'pl', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      t.textContent = label;
    }
    parts[index] = g;
    return g;
  };
  // body
  svgEl('path', { class: 'pbody', d: 'M120 70 H480 Q560 70 575 170 L590 290 Q595 330 560 322 Q520 316 495 262 H105 Q80 316 40 322 Q5 330 10 290 L25 170 Q40 70 120 70 Z' }, svg);
  // shoulders and triggers
  btn(4, 'rect', { x: 95, y: 36, width: 120, height: 26, rx: 10 }, buttonName(4), 155, 49);
  btn(5, 'rect', { x: 385, y: 36, width: 120, height: 26, rx: 10 }, buttonName(5), 445, 49);
  parts.lt = svgEl('rect', { x: 105, y: 4, width: 100, height: 22, rx: 6, class: 'ptrig' }, svg);
  parts.ltf = svgEl('rect', { x: 105, y: 4, width: 0, height: 22, rx: 6, class: 'ptrigfill' }, svg);
  parts.rt = svgEl('rect', { x: 395, y: 4, width: 100, height: 22, rx: 6, class: 'ptrig' }, svg);
  parts.rtf = svgEl('rect', { x: 395, y: 4, width: 0, height: 22, rx: 6, class: 'ptrigfill' }, svg);
  for (const [x, t] of [[155, buttonName(6)], [445, buttonName(7)]]) { const l = svgEl('text', { x, y: 15, class: 'pl', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, svg); l.textContent = t; }
  // sticks: ring lights up on press (L3 / R3), the dot follows the stick
  const stick = (cx, cy, press, key) => {
    const g = svgEl('g', { class: 'pb' }, svg);
    svgEl('circle', { cx, cy, r: 46 }, g);
    parts[press] = g;
    parts[key] = svgEl('circle', { cx, cy, r: 20, class: 'pdot' }, svg);
  };
  stick(170, 150, 10, 'ls');
  stick(385, 245, 11, 'rs');
  // d-pad
  const dp = (i, x, y, w, h) => btn(i, 'rect', { x, y, width: w, height: h, rx: 6 });
  dp(12, 218, 200, 28, 34); dp(13, 218, 250, 28, 34); dp(14, 186, 232, 34, 28); dp(15, 246, 232, 34, 28);
  // face buttons
  btn(0, 'circle', { cx: 480, cy: 185, r: 22 }, buttonName(0), 480, 185);
  btn(1, 'circle', { cx: 520, cy: 148, r: 22 }, buttonName(1), 520, 148);
  btn(2, 'circle', { cx: 440, cy: 148, r: 22 }, buttonName(2), 440, 148);
  btn(3, 'circle', { cx: 480, cy: 111, r: 22 }, buttonName(3), 480, 111);
  // centre
  btn(8, 'circle', { cx: 262, cy: 130, r: 13 });
  btn(9, 'circle', { cx: 338, cy: 130, r: 13 });
  btn(16, 'circle', { cx: 300, cy: 100, r: 16 });
  const note = document.createElement('div');
  note.className = 'padnote';
  const raw = document.createElement('div');
  raw.className = 'padraw';
  const hint = document.createElement('div');
  hint.className = 'khint padhint';
  hint.textContent = `Press anything to see it light up. Triggers also rumble.   Hold ${buttonName(1)} to close.`;
  const bar = document.createElement('div');
  bar.className = 'padbar';
  const barFill = document.createElement('div');
  bar.appendChild(barFill);
  box.append(title, sub, svg, note, raw, hint, bar);
  modalEl.appendChild(box);
  modal.dom = { title, sub, parts, note, raw, barFill, rawBtns: [], rawAxes: [], rawCount: -1 };
}

function updatePad(pad, now) {
  const d = modal.dom;
  if (!d) return;
  if (!pad) {
    d.title.textContent = 'No controller detected';
    d.sub.textContent = 'Plug one in or turn it on, then press a button.';
    d.note.textContent = '';
    for (const k of Object.keys(d.parts)) if (d.parts[k].classList) d.parts[k].classList.remove('on');
    return;
  }
  const pads = gamepads();
  const standard = pad.mapping === 'standard';
  d.title.textContent = pad.id.slice(0, 70);
  d.sub.textContent =
    `${standard ? 'Standard layout' : 'Non-standard layout (raw numbers only)'}  ·  ${pad.buttons.length} buttons  ·  ${pad.axes.length} axes` +
    (pads.length > 1 ? `  ·  ${pads.length} controllers connected` : '') +
    (pad.tessera && pad.player ? `  ·  Player ${pad.player}` : '') +
    (pad.tessera && pad.info && pad.info.battery ? `  ·  ${batteryText(pad.info.battery)}` : '') +
    (modal.last === null ? '' : `  ·  last button: ${modal.last}`);
  const val = (n) => (n === 6 || n === 7 ? triggerValue(pad, n) : pad.buttons[n] ? pad.buttons[n].value : 0);
  const on = (n) => Boolean(pad.buttons[n] && pad.buttons[n].pressed);
  for (const n of [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    if (d.parts[n]) d.parts[n].classList.toggle('on', standard && on(n));
  }
  d.parts.ltf.setAttribute('width', String(Math.round(100 * val(6))));
  d.parts.rtf.setAttribute('width', String(Math.round(100 * val(7))));
  const ax = (i) => axisValue(pad, i); // after the person's calibration and deadzone
  d.parts.ls.setAttribute('transform', `translate(${(ax(0) * 26).toFixed(1)} ${(ax(1) * 26).toFixed(1)})`);
  d.parts.rs.setAttribute('transform', `translate(${(ax(2) * 26).toFixed(1)} ${(ax(3) * 26).toFixed(1)})`);
  const extra = pad.buttons.length - 17;
  d.note.textContent = standard
    ? `Left stick ${ax(0).toFixed(2)}, ${ax(1).toFixed(2)}   ·   Right stick ${ax(2).toFixed(2)}, ${ax(3).toFixed(2)}   ·   ${buttonName(6)} ${val(6).toFixed(2)}   ${buttonName(7)} ${val(7).toFixed(2)}` +
      (extra > 0 ? `   ·   ${extra} extra button${extra === 1 ? '' : 's'} (dashed): paddles, share or touchpad` : '')
    : 'This controller does not report the standard layout, so the picture above may not match. The numbers below are always right.';
  const mo = pad.tessera ? vmotion.get(pad.key) : null;
  if (mo) {
    const fmt = (m) => `tilt ${m.accel.map((v) => v.toFixed(1)).join(' / ')} g, turn ${m.gyro.join(' / ')} °/s`;
    d.note.textContent += '   ·   Motion: ' + Object.entries(mo).map(([part, m]) => (part === 'jl' ? 'L ' : part === 'jr' ? 'R ' : '') + fmt(m)).join('   ');
  } else if (pad.tessera && pad.info && pad.info.motion) d.note.textContent += '   ·   Motion: move the controller';
  // raw numbers: built once per controller, then only toggled
  if (d.rawCount !== pad.buttons.length + ':' + pad.axes.length) {
    d.rawCount = pad.buttons.length + ':' + pad.axes.length;
    d.raw.replaceChildren();
    d.rawBtns = [];
    d.rawAxes = [];
    const bw = document.createElement('div');
    bw.className = 'rawbtns';
    for (let n = 0; n < pad.buttons.length; n++) {
      const c = document.createElement('span');
      c.className = 'rawb' + (n >= 17 ? ' extra' : '');
      c.textContent = n;
      bw.appendChild(c);
      d.rawBtns.push(c);
    }
    const aw = document.createElement('div');
    aw.className = 'rawaxes';
    for (let n = 0; n < pad.axes.length; n++) {
      const row = document.createElement('div');
      row.className = 'rawax';
      const lab = document.createElement('span');
      lab.textContent = 'axis ' + n;
      const track = document.createElement('div');
      track.className = 'axtrack';
      const dot = document.createElement('div');
      dot.className = 'axdot';
      track.appendChild(dot);
      const num = document.createElement('span');
      num.className = 'axnum';
      row.append(lab, track, num);
      aw.appendChild(row);
      d.rawAxes.push({ dot, num });
    }
    d.raw.append(bw, aw);
  }
  d.rawBtns.forEach((c, n) => c.classList.toggle('on', on(n)));
  d.rawAxes.forEach((a, n) => {
    a.dot.style.left = ((ax(n) + 1) * 50).toFixed(1) + '%';
    a.num.textContent = ax(n).toFixed(2);
  });
  // Rumble follows the triggers, in the strength and style the person picked.
  rumble(pad, val(6), val(7), now);
  // Hold B for a second to close (a quick B press is just a test of B).
  if (on(1)) {
    modal.bSince = modal.bSince || now;
    const f = Math.min(1, (now - modal.bSince) / 1000);
    d.barFill.style.width = f * 100 + '%';
    if (f >= 1) { closeModal(); return; }
  } else {
    modal.bSince = 0;
    d.barFill.style.width = '0%';
  }
}

const RUMBLE_LEVEL = { off: 0, low: 0.4, normal: 0.7, high: 1 };
function rumble(pad, lt, rt, now) {
  const level = RUMBLE_LEVEL[prefs.pad.rumble] ?? 0.7;
  if (!level || (lt <= 0 && rt <= 0) || !pad.vibrationActuator || now - (modal.rumbleAt || 0) < 180) return;
  modal.rumbleAt = now;
  const style = prefs.pad.style;
  let strong = lt;
  let weak = rt;
  if (style === 'both') strong = weak = Math.max(lt, rt);
  else if (style === 'pulse' && Math.floor(now / 180) % 2) strong = weak = 0;
  try {
    pad.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: 220, strongMagnitude: strong * level, weakMagnitude: weak * level });
  } catch { /* not every controller can rumble */ }
}

// Resolves when the tester is closed. Motion sensors are only read while it is open.
function flowPad() {
  if (api.pads) api.pads('motion', { on: true }).catch(() => {});
  return new Promise((resolve) => {
    modal = { kind: 'pad', dom: null, last: null, bSince: 0, onClose: () => { if (api.pads) api.pads('motion', { on: false }).catch(() => {}); resolve(); } };
    modalEl.hidden = false;
    buildPad();
    updatePad(activePad(), performance.now());
  });
}

// "Change grip/order", as on the Switch: L + R on two Joy-Cons joins them into one controller,
// SL + SR on one Joy-Con makes it a player of its own (held sideways). Only while this is open.
const GRIP_PART = { joined: 'Joy-Con L + R', jl: 'Left Joy-Con, sideways', jr: 'Right Joy-Con, sideways', pro: 'Controller' };
function batteryText(b) {
  if (!b) return '';
  const lvl = b.percent !== null && b.percent !== undefined ? b.percent + '%' : b.level;
  return (lvl ? 'Battery ' + lvl : '') + (b.charging ? ' (charging)' : '');
}
function renderGrip() {
  modalEl.className = 'grip';
  modalEl.replaceChildren();
  const box = document.createElement('div');
  box.className = 'box gripbox';
  const h = document.createElement('h3');
  h.textContent = 'Change grip/order';
  const how = document.createElement('p');
  how.className = 'griphow';
  how.textContent = 'Use two Joy-Cons together: press L and R, one on each. Use one Joy-Con on its own, held sideways: press SL and SR on it.';
  const cards = document.createElement('div');
  cards.className = 'gripcards';
  const pads = vpadInfo.pads;
  if (!pads.length) {
    const none = document.createElement('p');
    none.className = 'gripnone';
    none.textContent = 'No Joy-Con or Pro Controller is connected. Pair one in Settings > Bluetooth, or plug it in.';
    cards.appendChild(none);
  }
  for (const p of pads) {
    const c = document.createElement('div');
    c.className = 'gripcard k-' + p.kind;
    const pl = document.createElement('div');
    pl.className = 'gripplayer';
    pl.textContent = 'Player ' + p.player;
    const pic = document.createElement('div');
    pic.className = 'grippic';
    for (const part of p.parts) { const j = document.createElement('i'); j.className = 'jc ' + part; pic.appendChild(j); }
    const nm = document.createElement('div');
    nm.className = 'gripname';
    nm.textContent = GRIP_PART[p.kind] || p.name.replace(/ \(Nintendo\)$/, '');
    const sub = document.createElement('div');
    sub.className = 'gripsub';
    sub.textContent = p.error === 'permission' ? "Tessera isn't allowed to read this one" : [batteryText(p.battery), p.motion ? 'motion sensors' : ''].filter(Boolean).join(' · ');
    c.append(pl, pic, nm, sub);
    cards.appendChild(c);
  }
  const foot = document.createElement('p');
  foot.className = 'gripfoot';
  foot.textContent = `${hintName(0)} or ${hintName(1)}: done`;
  box.append(h, how, cards, foot);
  modalEl.appendChild(box);
}
function flowGrip() {
  if (!api.pads) return Promise.resolve();
  api.pads('grip', { on: true }).then(applyPadList).catch(() => {});
  return new Promise((resolve) => {
    modal = { kind: 'grip', onClose: () => { api.pads('grip', { on: false }).catch(() => {}); resolve(); } };
    modalEl.hidden = false;
    renderGrip();
  });
}

// Settings → Controller: the live test, plus what the system should do with
// what the controller reports.
const PAD_LABELS = {
  rumble: { off: 'Off', low: 'Low', normal: 'Normal', high: 'High' },
  style: { split: 'Left trigger = left motor, right = right', both: 'Both motors together', pulse: 'Pulsing' },
  glyphs: { auto: 'Automatic (match my controller)', xbox: 'Xbox  (A B X Y)', playstation: 'PlayStation  (✕ ○ □ △)', nintendo: 'Nintendo  (B A Y X)' },
  joycons: { together: 'One controller (held together)', separate: 'Two players (each held sideways)' },
  repeat: { slow: 'Slower', standard: 'Standard', fast: 'Faster' },
  confirm: { position: 'The bottom button, on every controller', label: 'Nintendo controllers: A (right) confirms, B goes back' },
  browserCursor: { right: 'Right stick moves the cursor, left stick scrolls', left: 'Left stick moves the cursor, right stick scrolls' },
  guideButton: { 'menu-home': 'Press opens the guide, hold goes Home', 'home-menu': 'Press goes Home, hold opens the guide', menu: 'Press or hold opens the guide' },
  guideDesktop: { auto: 'On, except while Steam is running', on: 'Always on', off: 'Off' },
  guideStyle: { side: 'A panel from the side', float: 'A floating card in the middle', compact: 'Compact: a narrow panel, smaller text' },
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function padSet(key, value) {
  busy = true;
  try {
    const r = await api.settings('padSet', { key, value });
    if (r.ok) { prefs.pad = { ...PAD_DEFAULTS, ...r.pad }; prefs.calib = r.calib; applyGlyphs(); }
  } finally { busy = false; }
}
async function calibratePad() {
  const first = activePad();
  if (!first) return setStatus('No controller detected. Press a button on it first.', true);
  const id = padKey(first);
  const it = await pick('Let go of both sticks and triggers, then choose Calibrate', [
    { label: 'Calibrate now', op: 'go' },
    { label: 'Clear calibration', op: 'clear' },
    { label: 'Cancel' },
  ]);
  if (!it || !it.op) return;
  busy = true;
  try {
    let offsets = null;
    if (it.op === 'go') {
      const sums = new Array(Math.min(first.axes.length, 8)).fill(0);
      let n = 0;
      for (let i = 0; i < 24; i++) {
        await sleep(25);
        const p = activePad();
        if (!p || padKey(p) !== id) break;
        sums.forEach((_s, k) => { sums[k] += p.axes[k] || 0; });
        n++;
      }
      if (!n) return setStatus('Lost the controller. Try again.', true);
      // Only small drifts are "resting offset". A trigger that rests at -1 isn't one.
      offsets = sums.map((s) => (Math.abs(s / n) <= 0.4 ? s / n : 0));
    }
    const r = await api.settings('padCalib', { id, offsets });
    if (r.ok) { prefs.calib = r.calib; setStatus(it.op === 'go' ? 'Sticks calibrated.' : 'Calibration cleared.'); }
    else setStatus(r.error || "Couldn't save that.", true);
  } finally { busy = false; }
}
async function flowPadMenu() {
  if (modal || busy) return;
  let index = 0;
  const steps = (lo, hi, st) => { const o = []; for (let v = lo; v <= hi; v += st) o.push(v); return o; };
  const pickNumber = async (title, key, lo, hi, st) => {
    const vals = steps(lo, hi, st);
    const items = vals.map((v) => ({ label: v + '%', sub: v === prefs.pad[key] ? 'current' : '', v }));
    const it = await pick(title, items, Math.max(0, vals.indexOf(prefs.pad[key])));
    if (it) await padSet(key, it.v);
  };
  const pickChoice = async (title, key) => {
    const opts = Object.entries(PAD_LABELS[key]);
    const items = opts.map(([v, label]) => ({ label, sub: v === prefs.pad[key] ? 'current' : '', v }));
    const it = await pick(title, items, Math.max(0, opts.findIndex(([v]) => v === prefs.pad[key])));
    if (it) await padSet(key, it.v);
  };
  for (;;) {
    const calibrated = prefs.calib[(activePad() || { id: '' }).id.slice(0, 80)];
    const items = [
      { label: 'Test your controller', sub: 'live buttons, sticks and triggers', op: 'test' },
      { label: 'Guide button', sub: PAD_LABELS.guideButton[prefs.pad.guideButton] || PAD_LABELS.guideButton['menu-home'], op: 'guideButton' },
      { label: 'Guide style', sub: PAD_LABELS.guideStyle[prefs.pad.guideStyle] || PAD_LABELS.guideStyle.side, op: 'guideStyle' },
      { label: 'Guide on the desktop', sub: PAD_LABELS.guideDesktop[prefs.pad.guideDesktop] || PAD_LABELS.guideDesktop.auto, op: 'guideDesktop' },
      { label: 'Button mapping', sub: calmNote('_controls'), op: 'mapping' },
      { label: 'Sticks and triggers', header: true, fold: 'pad.sticks', open: true },
      { label: 'Repeat speed', sub: `${PAD_LABELS.repeat[prefs.pad.repeat] || 'Standard'} · holding a direction, in menus and the browser`, op: 'repeat' },
      { label: 'Stick deadzone', sub: prefs.pad.deadzone + '%', op: 'deadzone' },
      { label: 'Calibrate sticks', sub: calibrated ? 'calibrated' : 'not calibrated', op: 'calib' },
      { label: 'Trigger sensitivity', sub: prefs.pad.trigger + '% to register', op: 'trigger' },
      { label: 'Vibration', header: true, fold: 'pad.rumble', open: true },
      { label: 'Vibration strength', sub: PAD_LABELS.rumble[prefs.pad.rumble], op: 'rumble' },
      { label: 'Vibration style', sub: PAD_LABELS.style[prefs.pad.style], op: 'style' },
      { label: 'Labels', header: true },
      { label: 'Button labels', sub: PAD_LABELS.glyphs[prefs.pad.glyphs].split('  (')[0], op: 'glyphs' },
      { label: 'Confirm button', sub: prefs.pad.remap && prefs.pad.remap.nintendo ? 'Nintendo: your own (Button mapping)' : prefs.pad.confirm === 'label' ? 'Nintendo: A confirms' : 'Bottom button', op: 'confirm' },
      { label: 'Joy-Con', header: true },
      { label: 'Change grip/order', sub: vpadInfo.pads.length ? vpadInfo.pads.map((p) => 'P' + p.player + ' ' + (GRIP_PART[p.kind] || 'Controller')).join(' · ') : 'join or split Joy-Cons, see who is which player', op: 'grip' },
      { label: 'A left and a right Joy-Con', sub: PAD_LABELS.joycons[prefs.pad.joycons] || PAD_LABELS.joycons.together, op: 'joycons' },
      { label: 'Browser', header: true, fold: 'pad.browser', open: true },
      { label: 'Cursor stick', sub: prefs.pad.browserCursor === 'left' ? 'Left stick (right stick scrolls)' : 'Right stick (left stick scrolls)', op: 'browserCursor' },
      { label: 'Cursor speed', sub: prefs.pad.cursorSpeed + '%', op: 'cursorSpeed' },
      { label: 'Scroll speed', sub: prefs.pad.scrollSpeed + '%', op: 'scrollSpeed' },
      { label: 'Clicks', sub: `${buttonName(7)} clicks, ${buttonName(6)} right-clicks`, plain: true, info: true },
    ];
    const it = await pick('Controller', items, index);
    if (!it) return;
    index = items.indexOf(it);
    if (it.info) continue;
    if (it.op === 'test') await flowPad();
    else if (it.op === 'mapping') await flowControls();
    else if (it.op === 'guideButton') await pickChoice('The Guide button (Xbox, PS or Home button)', 'guideButton');
    else if (it.op === 'guideStyle') await pickChoice('How the guide looks (notifications sit beside it on the right)', 'guideStyle');
    else if (it.op === 'guideDesktop') await pickChoice('The guide in Desktop Mode (Steam takes the button for itself while it runs)', 'guideDesktop');
    else if (it.op === 'browserCursor') await pickChoice('In the browser, which stick moves the cursor?', 'browserCursor');
    else if (it.op === 'cursorSpeed') await pickNumber('Cursor speed · how fast the browser cursor moves', 'cursorSpeed', 10, 100, 10);
    else if (it.op === 'scrollSpeed') await pickNumber('Scroll speed · how fast pages scroll at full tilt', 'scrollSpeed', 10, 100, 10);
    else if (it.op === 'deadzone') await pickNumber('Stick deadzone · ignore small movements', 'deadzone', 0, 40, 5);
    else if (it.op === 'trigger') await pickNumber('Trigger sensitivity · how far to pull before it counts', 'trigger', 0, 50, 5);
    else if (it.op === 'calib') await calibratePad();
    else if (it.op === 'rumble') await pickChoice('Vibration strength', 'rumble');
    else if (it.op === 'style') await pickChoice('Vibration style (the test uses this)', 'style');
    else if (it.op === 'glyphs') await pickChoice('Button labels', 'glyphs');
    else if (it.op === 'repeat') await pickChoice('How fast a held stick or D-pad keeps moving (in menus, on tiles and in the browser)', 'repeat');
    else if (it.op === 'confirm') await pickChoice('Which button confirms? (B, X and Y follow it; the launcher, browser and dialogs all use this)', 'confirm');
    else if (it.op === 'grip') await flowGrip();
    else if (it.op === 'joycons') await pickChoice('When a left and a right Joy-Con are both connected', 'joycons');
  }
}


// Settings → Keyboard & mouse: a key layout to start from, every action rebindable, and how
// the hints and the pointer behave.
const KB_LABELS = {
  hints: { auto: 'Automatic (whatever I used last)', controller: 'Always controller buttons', keyboard: 'Always keyboard keys' },
  wheel: { move: 'Moves the selection', tabs: 'Switches tabs (menus still scroll)', off: 'Does nothing' },
};
async function kbSet(op, payload) {
  busy = true;
  try {
    const r = await api.settings(op, payload);
    if (r && r.ok) { prefs.kb = { ...KB_DEFAULTS, ...r.kb }; kbRefresh(); }
    else if (r && r.error) setStatus(r.error, true);
    return r;
  } finally { busy = false; }
}
async function flowKeyboardMenu() {
  if (modal || busy) return;
  let index = 0;
  for (;;) {
    const b = kbBindings();
    const k = prefs.kb || KB_DEFAULTS;
    const items = [
      { label: 'Key layout', sub: KBM.PRESET_NAMES[k.preset] || KBM.PRESET_NAMES.standard, op: 'preset' },
      { label: 'Button hints', sub: KB_LABELS.hints[k.hints] || KB_LABELS.hints.auto, op: 'hints' },
      { label: 'Keys', header: true, fold: 'kb.keys', open: true },
    ];
    for (const a of KBM.ACTIONS) items.push({ label: KBM.ACTION_LABELS[a], sub: b[a].map(keyLabel).join('  ·  '), act: a });
    items.push({ label: 'Reset keys to the layout', sub: k.bindings ? 'you changed some keys' : 'nothing changed', op: 'reset', plain: true });
    items.push({ label: 'Always', sub: 'Volume keys change the volume. Esc + ← / → switches tabs, even inside a web page.', plain: true, info: true });
    items.push({ label: 'Mouse', header: true, fold: 'kb.mouse', open: true });
    items.push({ label: 'Hide the pointer after', sub: k.mouseHide ? `${k.mouseHide} s without moving` : 'Never (while using the mouse)', op: 'mouseHide' });
    items.push({ label: 'Scroll wheel', sub: KB_LABELS.wheel[k.wheel] || KB_LABELS.wheel.move, op: 'wheel' });
    items.push({ label: 'Buttons', sub: 'Click opens · right-click or the back thumb button goes back · middle click shows options · forward thumb button: next tab', plain: true, info: true });
    const it = await pick('Keyboard & mouse', items, index);
    if (!it) return;
    index = items.indexOf(it);
    if (it.info) continue;
    if (it.act) await flowKeyAction(it.act);
    else if (it.op === 'reset') await kbSet('kbReset', {});
    else if (it.op === 'preset' || it.op === 'hints' || it.op === 'wheel') {
      const opts = it.op === 'preset' ? Object.entries(KBM.PRESET_NAMES) : Object.entries(KB_LABELS[it.op]);
      const titles = { preset: 'Key layout (the arrow keys always work)', hints: 'Button hints at the bottom of the screen', wheel: 'The scroll wheel' };
      const choice = await pick(titles[it.op], opts.map(([v, label]) => ({ label, sub: v === k[it.op] ? 'current' : '', v })), Math.max(0, opts.findIndex(([v]) => v === k[it.op])));
      if (!choice) continue;
      if (it.op === 'preset' && k.bindings && choice.v !== k.preset) {
        const ok = await pick('Switching layout replaces the keys you changed', [{ label: 'Switch', v: true }, { label: 'Keep my keys' }]);
        if (!ok || !ok.v) continue;
      }
      await kbSet('kbSet', { key: it.op, value: choice.v });
    } else if (it.op === 'mouseHide') {
      const vals = [1, 2, 3, 5, 10, 30, 0];
      const choice = await pick('Hide the pointer after', vals.map((v) => ({ label: v ? `${v} second${v === 1 ? '' : 's'}` : 'Never', sub: v === k.mouseHide ? 'current' : '', v })), Math.max(0, vals.indexOf(k.mouseHide)));
      if (choice) await kbSet('kbSet', { key: 'mouseHide', value: choice.v });
    }
  }
}
async function flowKeyAction(act) {
  let index = 0;
  for (;;) {
    const keys = kbBindings()[act];
    const items = [{ label: 'Add a key', sub: `up to ${KBM.MAX_PER_ACTION} keys, the first one shows in hints`, op: 'add' }];
    keys.forEach((code, i) => items.push({ label: keyLabel(code), sub: i === 0 ? `shown in hints · ${hintName(0)}: make another one first, ${hintName(3)}: remove` : `${hintName(0)}: show this one in hints · ${hintName(3)}: remove`, code }));
    let removing = null;
    const it = await new Promise((resolve) => {
      openList({
        title: `${KBM.ACTION_LABELS[act]} · keys`, items, index,
        onChoose: (x) => { closeModal(); resolve(x); },
        onBack: () => { closeModal(); resolve(null); },
        onY: (x) => { if (x && x.code) { removing = x; closeModal(); resolve(x); } },
        yLabel: 'Remove',
      });
    });
    if (!it) return;
    index = items.indexOf(it);
    if (removing) {
      await kbSet('kbUnbind', { action: act, code: removing.code });
    } else if (it.op === 'add') {
      const code = await captureKey(KBM.ACTION_LABELS[act]);
      if (!code) continue;
      const other = kbIndex.get(code);
      if (other && other !== act) {
        const ok = await pick(`${keyLabel(code)} is used for ${KBM.ACTION_LABELS[other]}`, [{ label: `Use it for ${KBM.ACTION_LABELS[act]} instead`, v: true }, { label: 'Cancel' }]);
        if (!ok || !ok.v) continue;
      }
      await kbSet('kbBind', { action: act, code });
    } else if (it.code && index > 1) {
      await kbSet('kbBind', { action: act, code: it.code }); // binding again moves it to the front
    }
  }
}
