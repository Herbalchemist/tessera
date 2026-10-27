// SPDX-License-Identifier: GPL-3.0-or-later
// Display calibration: test patterns and the steps.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ------------------------------------------------------ display calibration
// Settings → Display calibration. Done by eye with test patterns, so it is a
// good correction rather than a lab one. The result is a few numbers (see
// "display calibration" in main.js) drawn over the whole launcher with an SVG
// filter; for games it can also be handed to Gamescope as a shader.
const CAL_RANGES = { black: [-0.1, 0.1], white: [0.8, 1], gamma: [0.6, 1.6], gain: [0.85, 1], sat: [0.5, 1.5] };
const CAL_TARGET_GAMMA = 2.2;
const calClamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const calDefault = () => ({ black: 0, white: 1, gamma: [1, 1, 1], gain: [1, 1, 1], sat: 1 });
const calIsId = (c) => !c || (c.black === 0 && c.white === 1 && c.sat === 1 && c.gamma.every((g) => g === 1) && c.gain.every((g) => g === 1));
function calCurve(c, ch, x) {
  const t = Math.min(1, Math.max(0, (x - c.black) / (1 - c.black)));
  return Math.min(1, Math.pow(t, c.gamma[ch]) * c.white * c.gain[ch]);
}
let calSvg = null;
// Draw (or clear) the correction over the whole page.
function setScreenFilter(c) {
  const root = document.documentElement;
  if (!c || calIsId(c)) { root.style.removeProperty('filter'); return; }
  if (!calSvg) {
    const ns = 'http://www.w3.org/2000/svg';
    calSvg = document.createElementNS(ns, 'svg');
    calSvg.setAttribute('class', 'calsvg');
    calSvg.setAttribute('aria-hidden', 'true');
    const f = document.createElementNS(ns, 'filter');
    f.setAttribute('id', 'tcal');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '100%'); f.setAttribute('height', '100%');
    const ct = document.createElementNS(ns, 'feComponentTransfer');
    for (const n of ['R', 'G', 'B']) {
      const fn = document.createElementNS(ns, 'feFunc' + n);
      fn.setAttribute('type', 'table');
      ct.appendChild(fn);
    }
    const cm = document.createElementNS(ns, 'feColorMatrix');
    cm.setAttribute('type', 'saturate');
    f.append(ct, cm);
    calSvg.appendChild(f);
    document.body.appendChild(calSvg);
  }
  const funcs = calSvg.querySelectorAll('feComponentTransfer > *');
  funcs.forEach((fn, ch) => {
    const vals = [];
    for (let i = 0; i < 256; i++) vals.push(calCurve(c, ch, i / 255).toFixed(4));
    fn.setAttribute('tableValues', vals.join(' '));
  });
  calSvg.querySelector('feColorMatrix').setAttribute('values', String(c.sat));
  root.style.filter = 'url(#tcal)';
}
// The saved calibration, unless Gamescope is already applying it to everything.
function applySavedCalibration() {
  const p = prefs.calibration;
  setScreenFilter(p && p.cal && p.cal.enabled && !p.systemActive ? p.cal : null);
}

// What the person is adjusting, in plain units.
const calWork = () => ({ brightness: 0, whiteLevel: 100, g25: 2.2, g50: 2.2, g75: 2.2, gr: 2.2, gg: 2.2, gb: 2.2, warm: 0, tint: 0, sat: 100 });
// Turn those into the saved numbers. mode 'quick' uses one gamma and no per-colour offsets.
function calFromWork(w, mode, layers) {
  const all = !layers;
  const on = (l) => all || layers.includes(l);
  const c = calDefault();
  if (on('black')) c.black = calClamp(-w.brightness / 100, CAL_RANGES.black);
  if (on('white')) c.white = calClamp(w.whiteLevel / 100, CAL_RANGES.white);
  if (on('gamma')) {
    const lum = mode === 'quick' ? w.g50 : (w.g25 + w.g50 + w.g75) / 3;
    const mean = (w.gr + w.gg + w.gb) / 3;
    const per = mode === 'quick' ? [0, 0, 0] : [w.gr - mean, w.gg - mean, w.gb - mean];
    c.gamma = per.map((d) => calClamp(CAL_TARGET_GAMMA / (lum + d), CAL_RANGES.gamma));
  }
  if (on('gain')) {
    const t = w.warm / 10;
    const u = w.tint / 10;
    const g = [1, 1, 1];
    if (t > 0) g[2] *= 1 - 0.12 * t; else g[0] *= 1 + 0.12 * t;
    if (u > 0) g[1] *= 1 - 0.1 * u; else { g[0] *= 1 + 0.06 * u; g[2] *= 1 + 0.06 * u; }
    c.gain = g.map((x) => calClamp(x, CAL_RANGES.gain));
  }
  if (on('sat')) c.sat = calClamp(w.sat / 100, CAL_RANGES.sat);
  return c;
}

// ---- the test patterns (drawn at the screen's own pixels so lines stay one pixel wide)
const grey = (v) => { const n = Math.round(Math.min(1, Math.max(0, v)) * 255); return `rgb(${n},${n},${n})`; };
const lumaOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const CHIPS = [[0.85, 0.25, 0.25], [0.9, 0.85, 0.25], [0.25, 0.75, 0.35], [0.25, 0.8, 0.85], [0.3, 0.4, 0.9], [0.85, 0.3, 0.8]];
const rgbOf = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
function patRegion(W, H, fw = 0.7, fh = 0.46) {
  const w = Math.round(W * fw); const h = Math.round(H * fh);
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) + Math.round(H * 0.02), w, h };
}
function drawBars(ctx, W, H, levels, bg, textColor) {
  const r = patRegion(W, H, 0.7, 0.4);
  const bw = Math.round(r.w / (levels.length * 1.6));
  const gap = Math.round(bw * 0.6);
  const total = levels.length * bw + (levels.length - 1) * gap;
  levels.forEach((v, i) => {
    const x = Math.round((W - total) / 2) + i * (bw + gap);
    ctx.fillStyle = grey(v);
    ctx.fillRect(x, r.y, bw, r.h);
    ctx.fillStyle = textColor;
    ctx.font = `${Math.round(H * 0.035)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), x + bw / 2, r.y + r.h + Math.round(H * 0.06));
  });
}
// light = how much light the lines give (0.25, 0.5 or 0.75). tint = which colours take part (white or one colour).
function drawGamma(ctx, W, H, gamma, light, tint) {
  const r = patRegion(W, H, 0.62, 0.5);
  const img = ctx.createImageData(r.w, r.h);
  const hi = [tint[0] * 255, tint[1] * 255, tint[2] * 255];
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      let lit;
      if (light === 0.5) lit = y % 2 === 0;
      else if (light === 0.25) lit = x % 2 === 0 && y % 2 === 0;
      else lit = !(x % 2 === 0 && y % 2 === 0);
      const i = (y * r.w + x) * 4;
      img.data[i] = lit ? hi[0] : 0; img.data[i + 1] = lit ? hi[1] : 0; img.data[i + 2] = lit ? hi[2] : 0; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, r.x, r.y);
  const v = Math.pow(light, 1 / gamma);
  const s = Math.round(Math.min(r.w, r.h) * 0.5);
  ctx.fillStyle = `rgb(${Math.round(v * tint[0] * 255)},${Math.round(v * tint[1] * 255)},${Math.round(v * tint[2] * 255)})`;
  ctx.fillRect(r.x + Math.round((r.w - s) / 2), r.y + Math.round((r.h - s) / 2), s, s);
}
function drawGreys(ctx, W, H, levels) {
  const r = patRegion(W, H, 0.78, 0.46);
  const bw = Math.round(r.w / levels.length);
  levels.forEach((v, i) => { ctx.fillStyle = grey(v); ctx.fillRect(r.x + i * bw, r.y, bw, r.h); });
}
function drawChips(ctx, W, H) {
  const r = patRegion(W, H, 0.78, 0.5);
  const bw = Math.round(r.w / CHIPS.length);
  CHIPS.forEach((c, i) => {
    ctx.fillStyle = rgbOf(c); ctx.fillRect(r.x + i * bw, r.y, bw, Math.round(r.h * 0.62));
    const l = lumaOf(...c); ctx.fillStyle = grey(l); ctx.fillRect(r.x + i * bw, r.y + Math.round(r.h * 0.62), bw, Math.round(r.h * 0.38));
  });
}
function drawReview(ctx, W, H) {
  const r = patRegion(W, H, 0.78, 0.5);
  const ramp = 48; const rw = Math.round(r.w / ramp);
  for (let i = 0; i < ramp; i++) { ctx.fillStyle = grey(i / (ramp - 1)); ctx.fillRect(r.x + i * rw, r.y, rw, Math.round(r.h * 0.2)); }
  const cy = r.y + Math.round(r.h * 0.24); const bw = Math.round(r.w / (CHIPS.length + 1)); const ch = Math.round(r.h * 0.34);
  CHIPS.forEach((c, i) => { ctx.fillStyle = rgbOf(c); ctx.fillRect(r.x + i * bw, cy, bw, ch); });
  ctx.fillStyle = 'rgb(224,172,140)'; ctx.fillRect(r.x + CHIPS.length * bw, cy, bw, ch); // a skin tone
  const levels = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1];
  const gw = Math.round(r.w / levels.length);
  levels.forEach((v, i) => { ctx.fillStyle = grey(v); ctx.fillRect(r.x + i * gw, cy + ch + Math.round(r.h * 0.04), gw, Math.round(r.h * 0.18)); });
}
const calRound = (v, n = 0) => Number(v.toFixed(n));
const calSigned = (v) => (v > 0 ? '+' : '') + v;

// ---- the steps. Each says what to show, what to adjust and which parts of the correction are visible while it does.
const gammaStep = (id, title, key, light, tint, extra) => ({
  id, title, bg: '#000', layers: [], kind: 'gamma',
  help: 'Sit back from the screen and squint a little. Adjust until the middle square looks the same brightness as the lines around it.' + (extra || ''),
  min: 1.6, max: 3.2, step: 0.02, coarse: 0.1, dflt: 2.2, get: (w) => w[key], set: (w, v) => { w[key] = calRound(v, 2); },
  label: (v) => `Gamma ${v.toFixed(2)}`, draw: (ctx, W, H, w) => drawGamma(ctx, W, H, w[key], light, tint),
});
const CAL_STEP_DEFS = {
  black: {
    id: 'black', title: 'Brightness', bg: '#000', layers: ['black'], min: -10, max: 10, step: 1, coarse: 3, dflt: 0,
    help: 'Adjust until bar 1 just disappears into the black, and bar 2 is faintly visible.',
    get: (w) => w.brightness, set: (w, v) => { w.brightness = Math.round(v); },
    label: (v) => `Brightness ${calSigned(v)}`, draw: (ctx, W, H) => drawBars(ctx, W, H, [0.02, 0.04, 0.06, 0.08, 0.12], '#000', grey(0.4)),
  },
  white: {
    id: 'white', title: 'White level', bg: '#fff', layers: ['black', 'white'], min: 85, max: 100, step: 1, coarse: 3, dflt: 100,
    help: 'Lower it until you can just tell bar 1 apart from the white background. Leave it at 100% if you already can.',
    get: (w) => w.whiteLevel, set: (w, v) => { w.whiteLevel = Math.round(v); },
    label: (v) => `White level ${v}%`, draw: (ctx, W, H) => drawBars(ctx, W, H, [0.98, 0.96, 0.94, 0.92, 0.88], '#fff', grey(0.3)),
  },
  gamma25: gammaStep('gamma25', 'Gamma · dark tones', 'g25', 0.25, [1, 1, 1], ' (This one is the dark tones.)'),
  gamma50: gammaStep('gamma50', 'Gamma · middle tones', 'g50', 0.5, [1, 1, 1]),
  gamma75: gammaStep('gamma75', 'Gamma · bright tones', 'g75', 0.75, [1, 1, 1], ' (This one is the bright tones.)'),
  gammaR: gammaStep('gammaR', 'Red balance', 'gr', 0.5, [1, 0, 0], ' Only red is lit here.'),
  gammaG: gammaStep('gammaG', 'Green balance', 'gg', 0.5, [0, 1, 0], ' Only green is lit here.'),
  gammaB: gammaStep('gammaB', 'Blue balance', 'gb', 0.5, [0, 0, 1], ' Only blue is lit here.'),
  warm: {
    id: 'warm', title: 'White balance', bg: '#808080', layers: ['black', 'white', 'gamma', 'gain'], min: -10, max: 10, step: 1, coarse: 3, dflt: 0,
    help: 'These greys should look neutral. If they look blue, move toward Warmer. If they look yellow or orange, move toward Cooler.',
    get: (w) => w.warm, set: (w, v) => { w.warm = Math.round(v); },
    label: (v) => (v === 0 ? 'Neutral' : v > 0 ? `Warmer ${v}` : `Cooler ${-v}`), draw: (ctx, W, H) => drawGreys(ctx, W, H, [0.15, 0.3, 0.5, 0.7, 0.85]),
  },
  tint: {
    id: 'tint', title: 'Tint', bg: '#808080', layers: ['black', 'white', 'gamma', 'gain'], min: -10, max: 10, step: 1, coarse: 3, dflt: 0,
    help: 'Still neutral grey? If they look green, move toward Pinker. If they look pink or purple, move toward Greener.',
    get: (w) => w.tint, set: (w, v) => { w.tint = Math.round(v); },
    label: (v) => (v === 0 ? 'Neutral' : v > 0 ? `Pinker ${v}` : `Greener ${-v}`), draw: (ctx, W, H) => drawGreys(ctx, W, H, [0.15, 0.3, 0.5, 0.7, 0.85]),
  },
  sat: {
    id: 'sat', title: 'Colour', bg: '#808080', layers: ['black', 'white', 'gamma', 'gain', 'sat'], min: 60, max: 140, step: 2, coarse: 10, dflt: 100,
    help: 'Pick the colour strength that looks natural: rich, but not glowing. The grey swatches show what no colour looks like.',
    get: (w) => w.sat, set: (w, v) => { w.sat = Math.round(v); },
    label: (v) => `Colour ${v}%`, draw: (ctx, W, H) => drawChips(ctx, W, H),
  },
  review: { id: 'review', title: 'Check the result', bg: '#808080', layers: null, review: true, draw: (ctx, W, H) => drawReview(ctx, W, H) },
};
const CAL_FLOWS = {
  quick: ['black', 'gamma50', 'warm', 'review'],
  thorough: ['black', 'white', 'gamma25', 'gamma50', 'gamma75', 'gammaR', 'gammaG', 'gammaB', 'warm', 'tint', 'sat', 'review'],
};
const CAL_INTRO = 'Set your screen to its normal picture mode first and turn off any dynamic contrast, energy saving or motion smoothing. Let it warm up for a few minutes, dim the room, and turn HDR off.';

function buildCal() {
  modalEl.hidden = false;
  modalEl.className = 'cal';
  modalEl.replaceChildren();
  const top = document.createElement('div');
  top.className = 'cal-top';
  const stepEl = document.createElement('div'); stepEl.className = 'cal-step';
  const helpEl = document.createElement('div'); helpEl.className = 'cal-help';
  top.append(stepEl, helpEl);
  const canvas = document.createElement('canvas');
  canvas.className = 'cal-canvas';
  const bottom = document.createElement('div');
  bottom.className = 'cal-bottom';
  const valEl = document.createElement('div'); valEl.className = 'cal-val';
  const barEl = document.createElement('div'); barEl.className = 'cal-bar';
  const fill = document.createElement('i'); barEl.appendChild(fill);
  const hintEl = document.createElement('div'); hintEl.className = 'cal-hint';
  bottom.append(valEl, barEl, hintEl);
  modalEl.append(canvas, top, bottom);
  modal.dom = { stepEl, helpEl, canvas, valEl, barEl, fill, hintEl, bottom };
}
function calSummary(w, mode) {
  const c = calFromWork(w, mode);
  const lum = mode === 'quick' ? w.g50 : (w.g25 + w.g50 + w.g75) / 3;
  const lines = [`Brightness ${calSigned(w.brightness)}`, `Gamma ${lum.toFixed(2)} (target ${CAL_TARGET_GAMMA})`];
  if (mode !== 'quick') lines.splice(1, 0, `White level ${w.whiteLevel}%`);
  lines.push(w.warm || w.tint ? `Balance ${w.warm ? (w.warm > 0 ? 'warmer' : 'cooler') : ''}${w.warm && w.tint ? ', ' : ''}${w.tint ? (w.tint > 0 ? 'pinker' : 'greener') : ''}` : 'Balance neutral');
  if (mode !== 'quick') lines.push(`Colour ${w.sat}%`);
  return { c, text: lines.join('   ·   ') };
}
function renderCal() {
  if (!modal || modal.kind !== 'cal') return;
  if (!modal.dom) buildCal();
  const { stepEl, helpEl, canvas, valEl, barEl, fill, hintEl } = modal.dom;
  const def = modal.defs[modal.i];
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(window.innerWidth * dpr); const H = Math.round(window.innerHeight * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  canvas.style.width = '100%'; canvas.style.height = '100%';
  modalEl.style.background = def.bg;
  modalEl.style.color = def.bg === '#000' ? '#9a9a9a' : '#111';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = def.bg; ctx.fillRect(0, 0, W, H);
  def.draw(ctx, W, H, modal.w);
  stepEl.textContent = `${modal.mode === 'quick' ? 'Quick' : 'Thorough'} calibration · step ${modal.i + 1} of ${modal.defs.length} · ${def.title}`;
  const nextLabel = def.review ? 'Save' : 'Next';
  const g = (n) => hintName(n);
  if (def.review) {
    const s = calSummary(modal.w, modal.mode);
    helpEl.textContent = (modal.compare ? 'Showing your screen as it was.' : 'Showing the corrected screen.') + ' Hold ' + g(3) + ' to compare with how it was.';
    valEl.textContent = s.text;
    barEl.hidden = true;
  } else {
    helpEl.textContent = def.help;
    const v = def.get(modal.w);
    valEl.textContent = def.label(v);
    barEl.hidden = false;
    fill.style.width = `${((v - def.min) / (def.max - def.min)) * 100}%`;
  }
  hintEl.textContent = `◀ ▶ adjust   ${g(4)} / ${g(5)} bigger steps   ${g(0)} ${nextLabel}   ${g(1)} ${modal.i === 0 ? 'Cancel' : 'Back'}   ${g(2)} reset` + (def.review ? '' : `   ${g(3)} hold to see it as it was`);
  // What shows through the screen filter right now
  if (modal.compare) setScreenFilter(null);
  else if (def.layers && def.layers.length === 0) setScreenFilter(null); // gamma steps measure the screen as it is
  else setScreenFilter(calFromWork(modal.w, modal.mode, def.layers));
}
function calAdjust(dir, big) {
  const def = modal.defs[modal.i];
  if (def.review) return;
  const d = (big ? def.coarse : def.step) * dir;
  def.set(modal.w, calClamp(def.get(modal.w) + d, [def.min, def.max]));
  renderCal();
}
async function calFinish(save) {
  const { mode, w, resolve } = modal;
  const cal = save ? { ...calFromWork(w, mode), mode } : null;
  closeModal();
  modalEl.style.removeProperty('background');
  modalEl.style.removeProperty('color');
  setScreenFilter(null);
  let msg = '';
  if (cal) {
    busy = true;
    let r;
    try { r = await api.settings('calSet', { cal }); } finally { busy = false; }
    if (r && r.prefs) { applyPrefs(r.prefs); msg = 'Calibration saved.'; } else msg = (r && r.error) || "Couldn't save the calibration.";
  }
  applySavedCalibration();
  if (msg) setStatus(msg, !cal ? false : msg !== 'Calibration saved.');
  resolve(Boolean(cal));
}
function calPress(act) {
  if (act === 'left') return calAdjust(-1, false);
  if (act === 'right') return calAdjust(1, false);
  if (act === 'down' || act === 'lb') return calAdjust(-1, true);
  if (act === 'up' || act === 'rb') return calAdjust(1, true);
  const def = modal.defs[modal.i];
  if (act === 'x') { if (!def.review) { def.set(modal.w, def.dflt); renderCal(); } return; }
  if (act === 'a') {
    if (def.review) return calFinish(true);
    modal.i++; modal.compare = false; return renderCal();
  }
  if (act === 'b') {
    if (modal.i === 0) return calFinish(false);
    modal.i--; modal.compare = false; return renderCal();
  }
}
function calCompare(on) {
  if (!modal || modal.kind !== 'cal') return;
  modal.compare = on;
  renderCal();
}
function runCalibration(mode) {
  return new Promise((resolve) => {
    modal = { kind: 'cal', mode, defs: CAL_FLOWS[mode].map((k) => CAL_STEP_DEFS[k]), i: 0, w: calWork(), compare: false, dom: null, resolve };
    setScreenFilter(null);
    renderCal();
  });
}
async function flowCalibrate(mode) {
  const quick = mode === 'quick';
  const it = await pick(quick ? 'Quick calibration' : 'Thorough calibration', [
    { label: 'Start', sub: quick ? '4 short steps · about a minute' : '12 steps · about 5 minutes', op: 'go', plain: true },
    { label: 'Cancel', op: 'no', plain: true },
  ], 0, { body: CAL_INTRO + (quick ? ' This one sets brightness, gamma and white balance.' : ' This one also sets white level, gamma at three levels, each colour on its own, tint and colour strength.') });
  if (!it || it.op !== 'go') return;
  await runCalibration(mode);
}
const calDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch { return ''; } };
async function flowCalMenu(index = 0) {
  if (modal || busy) return;
  const p = prefs.calibration || { cal: null };
  const c = p.cal;
  const items = [];
  items.push({
    label: c ? `Calibrated ${calDate(c.at)} · ${c.mode === 'thorough' ? 'Thorough' : 'Quick'}${c.enabled ? '' : ' · off'}` : 'Not calibrated yet',
    sub: c ? `Gamma ≈ ${(CAL_TARGET_GAMMA / ((c.gamma[0] + c.gamma[1] + c.gamma[2]) / 3)).toFixed(2)}` : '', header: true,
  });
  items.push({ label: 'Quick calibration', sub: 'About a minute', op: 'quick', plain: true });
  items.push({ label: 'Thorough calibration', sub: 'About 5 minutes', op: 'thorough', plain: true });
  if (c) {
    items.push({ label: 'Calibration', sub: c.enabled ? 'On · A to turn off' : 'Off · A to turn on', op: 'toggle', plain: true });
    items.push({ label: 'Apply to games too', sub: p.system ? 'On · experimental' : 'Off · experimental', op: 'system', plain: true });
    items.push({ label: 'Reset to default', op: 'reset', plain: true });
  }
  items.push({ label: 'Back', op: 'back', plain: true });
  const body = p.systemFailed ? 'Applying it to games failed, so it was switched off. Tessera itself is still calibrated.' : p.system && !p.systemActive ? 'Applying it to games takes effect the next time Tessera starts.' : '';
  const it = await pick('Display calibration', items, Math.max(1, index), body ? { body } : {});
  if (!it || it.op === 'back') return;
  const again = () => flowCalMenu(items.indexOf(it));
  if (it.op === 'quick' || it.op === 'thorough') { await flowCalibrate(it.op); return again(); }
  if (!(await requirePin())) return again();
  let r;
  if (it.op === 'toggle') r = await api.settings('calToggle', { enabled: !c.enabled });
  else if (it.op === 'system') {
    if (!p.system && !(await confirm('Also apply the calibration to games? Tessera gives it to Gamescope when it starts, so it takes effect after a restart. If anything goes wrong it switches itself off.', 'Turn it on'))) return again();
    r = await api.settings('calSystem', { on: !p.system });
  } else if (it.op === 'reset') {
    if (!(await confirm('Go back to the screen as it is, with no calibration?', 'Reset'))) return again();
    r = await api.settings('calReset', {});
  }
  if (r && r.prefs) { applyPrefs(r.prefs); setStatus(it.op === 'reset' ? 'Calibration reset.' : it.op === 'toggle' ? (c.enabled ? 'Calibration is off.' : 'Calibration is on.') : p.system ? 'Games will no longer be calibrated.' : 'Games will be calibrated from the next start.'); }
  else if (r) setStatus(r.error, true);
  return again();
}

// Desktop Mode is the login screen: Tessera closes, and the person signs in
// (password and all) to whichever session they pick. See tessera-session.
let leavingNow = false; // Desktop Mode was chosen and Tessera is closing: ignore further presses
async function flowDesktop() {
  if (modal || busy || leavingNow) return;
  const ok = await confirm(nestedView
    ? 'Switch to Desktop Mode?  Tessera will close and the desktop will be shown again.'
    : 'Switch to Desktop Mode?  Tessera will close and the login screen will appear.  To come back later, choose Return to Tessera in the application menu.');
  if (!ok) return;
  leavingNow = true;
  setStatus('Closing Tessera…');
  let r;
  try { r = await api.quit(); } catch { r = { ok: false, error: "Couldn't close Tessera. Try again." }; }
  if (r && r.needPin) {
    leavingNow = false;
    if (!(await requirePin())) return;
    leavingNow = true;
    try { r = await api.quit(); } catch { r = { ok: false, error: "Couldn't close Tessera. Try again." }; }
  }
  if (r && r.ok === false) {
    leavingNow = false;
    setStatus(r.error || "Couldn't close Tessera. Try again.", true);
    return;
  }
  // Tessera is on its way out. If it somehow is not gone after a while, allow another try.
  setTimeout(() => { leavingNow = false; }, 8000);
}
