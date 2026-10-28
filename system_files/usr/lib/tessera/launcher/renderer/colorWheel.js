// SPDX-License-Identifier: GPL-3.0-or-later
// The color wheel used by Theme Settings.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ------------------------------------------------------------ color wheel
// Hue is the angle, saturation the distance from the centre, and brightness
// is its own slider. Left stick moves on the wheel, right stick or LB / RB
// change brightness, Y types a hex code, A applies, B cancels.
function hsvToHex(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: mx ? d / mx : 0, v: mx };
}
const WHEEL_PX = 280;
function drawWheel(canvas, v) {
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(WHEEL_PX, WHEEL_PX);
  const rad = WHEEL_PX / 2;
  for (let y = 0; y < WHEEL_PX; y++) {
    for (let x = 0; x < WHEEL_PX; x++) {
      const dx = (x + 0.5 - rad) / rad;
      const dy = (y + 0.5 - rad) / rad;
      const d = Math.hypot(dx, dy);
      if (d > 1) continue;
      const hex = hsvToHex(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, d, v);
      const i = (y * WHEEL_PX + x) * 4;
      const n = parseInt(hex.slice(1), 16);
      img.data[i] = n >> 16; img.data[i + 1] = (n >> 8) & 255; img.data[i + 2] = n & 255; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
// Resolves { color } when applied, { hex: true, color } when the person wants to type a code, or null.
function pickColor(title, start) {
  return new Promise((resolve) => {
    const hsv = hexToHsv(/^#[0-9a-f]{6}$/i.test(start) ? start : '#ffffff');
    modal = { kind: 'color', title, orig: start, ...hsv, resolve, t: 0, dom: null, drawnV: -1 };
    buildColor();
    updateColor(null, performance.now());
  });
}
function buildColor() {
  modalEl.hidden = false;
  modalEl.className = 'color';
  modalEl.replaceChildren();
  const box = document.createElement('div');
  box.className = 'box colorbox';
  const h = document.createElement('h3');
  h.textContent = modal.title;
  const body = document.createElement('div');
  body.className = 'colorbody';
  const wrap = document.createElement('div');
  wrap.className = 'wheelwrap';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = WHEEL_PX;
  canvas.className = 'wheel';
  const mark = document.createElement('div');
  mark.className = 'wheelmark';
  wrap.append(canvas, mark);
  const side = document.createElement('div');
  side.className = 'colorside';
  const sw = document.createElement('div');
  sw.className = 'swatches';
  const was = document.createElement('div');
  was.className = 'sw';
  const now = document.createElement('div');
  now.className = 'sw';
  sw.append(was, now);
  const hexEl = document.createElement('div');
  hexEl.className = 'hexval';
  const bright = document.createElement('div');
  bright.className = 'brightbar';
  const fill = document.createElement('div');
  bright.appendChild(fill);
  const hint = document.createElement('div');
  hint.className = 'khint colorhint';
  hint.textContent = `Left stick: move on the wheel\nRight stick or ${roleName(4)} / ${roleName(5)}: brightness\n${roleName(3)}: type a hex code   ${roleName(2)}: undo\n${roleName(0)}: apply   ${roleName(1)}: cancel`;
  side.append(sw, hexEl, bright, hint);
  body.append(wrap, side);
  box.append(h, body);
  modalEl.appendChild(box);
  was.style.background = /^#[0-9a-f]{6}$/i.test(modal.orig) ? modal.orig : '#ffffff';
  modal.dom = { canvas, mark, now, hexEl, fill };
}
function updateColor(pad, now) {
  const d = modal.dom;
  if (!d) return;
  const dt = modal.t ? Math.min(0.05, (now - modal.t) / 1000) : 0;
  modal.t = now;
  if (pad && dt) {
    // left stick: move the cursor on the disc. right stick up/down: brightness.
    const dx = axisValue(pad, 0);
    const dy = axisValue(pad, 1);
    if (dx || dy) {
      let x = modal.s * Math.cos((modal.h * Math.PI) / 180) + dx * dt * 1.1;
      let y = modal.s * Math.sin((modal.h * Math.PI) / 180) + dy * dt * 1.1;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      modal.s = Math.min(1, len);
      if (len > 0.0001) modal.h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }
    const by = axisValue(pad, 3);
    if (by) modal.v = Math.max(0, Math.min(1, modal.v - by * dt * 0.7));
  }
  if (Math.abs(modal.drawnV - modal.v) > 0.01) { drawWheel(d.canvas, modal.v); modal.drawnV = modal.v; }
  const hex = hsvToHex(modal.h, modal.s, modal.v);
  modal.hex = hex;
  const a = (modal.h * Math.PI) / 180;
  d.mark.style.left = (50 + 50 * modal.s * Math.cos(a)) + '%';
  d.mark.style.top = (50 + 50 * modal.s * Math.sin(a)) + '%';
  d.now.style.background = hex;
  d.hexEl.textContent = hex.toUpperCase();
  d.fill.style.width = Math.round(modal.v * 100) + '%';
}
function colorPress(act) {
  const step = 0.04;
  const a = (modal.h * Math.PI) / 180;
  let x = modal.s * Math.cos(a);
  let y = modal.s * Math.sin(a);
  if (act === 'left') x -= step;
  else if (act === 'right') x += step;
  else if (act === 'up') y -= step;
  else if (act === 'down') y += step;
  else return;
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  modal.s = Math.min(1, len);
  if (len > 0.0001) modal.h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  updateColor(null, performance.now());
}
function colorButton(n) {
  const m = modal;
  if (n === 0) { const color = m.hex; closeModal(); m.resolve({ color }); }
  else if (n === 1) { closeModal(); m.resolve(null); }
  else if (n === 3) { const color = m.hex; closeModal(); m.resolve({ hex: true, color }); }
  else if (n === 2) { Object.assign(m, hexToHsv(/^#[0-9a-f]{6}$/i.test(m.orig) ? m.orig : '#ffffff')); updateColor(null, performance.now()); }
  else if (n === 4 || n === 5) { m.v = Math.max(0, Math.min(1, m.v + (n === 5 ? 0.05 : -0.05))); updateColor(null, performance.now()); }
}

// Settings → Theme Settings. What's here comes from the active theme, so a
// theme can add settings of its own (see themes/<id>/theme.json).
const COLOR_PRESETS = [
  ['Blue', '#7fb2ff'], ['Sky', '#5ad1ff'], ['Teal', '#3ddc97'], ['Green', '#7ed957'], ['Yellow', '#ffd166'],
  ['Orange', '#ff9f45'], ['Red', '#ff6b6b'], ['Pink', '#ff7ac8'], ['Purple', '#b794f6'], ['White', '#ffffff'],
  ['Light gray', '#c9ced6'], ['Gray', '#3b475a'], ['Charcoal', '#1a222c'], ['Midnight', '#10151c'], ['Black', '#000000'],
];
function themeValueText(s) {
  if (s.type === 'range') return s.value + (s.unit || '');
  if (s.type === 'choice') return (s.options.find((o) => o.value === s.value) || {}).label || String(s.value);
  if (s.type === 'toggle') return s.value ? 'On' : 'Off';
  if (s.type === 'image') return s.value || 'None';
  const hit = COLOR_PRESETS.find(([, hex]) => hex === s.value);
  return hit ? `${hit[0]}  ${s.value}` : s.value;
}
async function themeSet(id, value) {
  busy = true;
  try {
    const r = await api.settings('themeSet', { id, value });
    if (r.theme) applyTheme(r.theme);
    if (!r.ok) setStatus(r.error, true);
  } finally { busy = false; }
}
async function flowTheme() {
  if (modal || busy) return;
  let index = 1;
  for (;;) {
    busy = true;
    let t;
    try { t = await api.settings('themeGet'); } finally { busy = false; }
    applyTheme(t);
    const active = t.themes.find((x) => x.id === t.active);
    const items = [{ label: 'Theme', header: true }, { label: active ? active.name : 'Tessera Bright', sub: t.themes.length > 1 ? `${hintName(0)} to switch` : 'more themes: Add-ons', op: 'switch', plain: true }];
    let group = null;
    const sizes = {};
    t.settings.forEach((s) => { sizes[s.group] = (sizes[s.group] || 0) + 1; });
    for (const s of t.settings) {
      // a group with a single setting needs no dropdown, just its label
      if (s.group !== group) { group = s.group; items.push(sizes[group] > 1 ? { label: group, header: true, fold: 'theme.' + group } : { label: group, header: true }); }
      items.push({ label: s.label, sub: themeValueText(s), op: 'set', s, plain: true });
    }
    items.push({ label: 'Your themes', header: true });
    items.push({ label: 'Save current as a new theme…', op: 'saveNew', plain: true });
    if (active && !active.builtin) {
      items.push({ label: 'Rename this theme…', op: 'rename', plain: true });
      items.push({ label: 'Overwrite this theme with current', op: 'overwrite', plain: true });
      items.push({ label: 'Delete this theme…', op: 'delete', plain: true });
    }
    items.push({ label: 'Reset', header: true });
    items.push({ label: 'Reset this theme to defaults', op: 'reset', plain: true });
    const it = await pick('Theme Settings', items, index);
    if (!it) return;
    index = items.indexOf(it);
    if (it.op === 'reset') {
      if (await confirm('Reset every Theme Setting to its default?')) {
        busy = true;
        try { const r = await api.settings('themeReset'); if (r.theme) applyTheme(r.theme); } finally { busy = false; }
      }
    } else if (it.op === 'switch') {
      // A short #id tag only shows up when two themes share a name — it's how they stay
      // told apart on screen without baking a number into the name itself.
      const pickT = await pick('Choose a theme', t.themes.map((x) => ({
        label: x.name, sub: [x.id === t.active ? 'current' : x.author, x.dup ? `#${x.id}` : ''].filter(Boolean).join('  ·  '), id: x.id,
      })));
      if (pickT) {
        busy = true;
        try { const r = await api.settings('themeUse', { id: pickT.id }); if (r.theme) applyTheme(r.theme); } finally { busy = false; }
      }
    } else if (it.op === 'saveNew') {
      const name = await ask('Name this theme', '');
      if (name === null) continue;
      if (!name.trim()) { setStatus('Give it a name.', true); continue; }
      busy = true;
      try {
        const r = await api.addons('saveTheme', { name });
        if (r.ok) { applyTheme(r.theme); setStatus(`Saved as “${name.trim()}”.`); } else setStatus(r.error, true);
      } finally { busy = false; }
    } else if (it.op === 'rename') {
      const name = await ask('Rename this theme', active.name);
      if (name === null) continue;
      if (!name.trim()) { setStatus('Give it a name.', true); continue; }
      busy = true;
      try {
        const r = await api.addons('renameTheme', { id: active.id, name });
        if (r.ok) { applyTheme(r.theme); setStatus('Renamed.'); } else setStatus(r.error, true);
      } finally { busy = false; }
    } else if (it.op === 'overwrite') {
      if (await confirm(`Overwrite “${active.name}” with the Theme Settings you have now?`, 'Overwrite')) {
        busy = true;
        try {
          const r = await api.addons('overwriteTheme', { id: active.id });
          if (r.ok) { applyTheme(r.theme); setStatus('Saved.'); } else setStatus(r.error, true);
        } finally { busy = false; }
      }
    } else if (it.op === 'delete') {
      const name = active.name;
      if (await confirm(`Delete “${name}”? This removes its folder from your Tessera folder.`, 'Delete')) {
        busy = true;
        let r;
        try { r = await api.addons('remove', { dir: 'themes', id: active.id }); } finally { busy = false; }
        if (r && r.needPin) {
          // Only in-use themes land here — an unused one deletes with no PIN prompt at all.
          if (!(await requirePin('This theme is being used by another profile. Enter your PIN to continue deleting.'))) continue;
          busy = true;
          try { r = await api.addons('remove', { dir: 'themes', id: active.id }); } finally { busy = false; }
        }
        if (r && r.ok) {
          applyTheme(r.theme);
          setStatus(r.fellBack && r.fellBack.length ? `Deleted “${name}”. ${r.fellBack.join(' and ')} fell back to Tessera Bright.` : `Deleted “${name}”.`);
        } else setStatus((r && r.error) || "Couldn't delete that.", true);
      }
    } else if (it.op === 'set') await editThemeSetting(it.s);
  }
}
async function editThemeSetting(s) {
  if (s.type === 'toggle') return themeSet(s.id, !s.value);
  if (s.type === 'range') {
    const vals = [];
    for (let v = s.min; v <= s.max + 1e-9; v += s.step) vals.push(Math.round(v * 1000) / 1000);
    const it = await pick(s.label + (s.hint ? '  ·  ' + s.hint : ''), vals.slice(0, 60).map((v) => ({ label: v + (s.unit || ''), sub: v === s.value ? 'current' : '', v })), Math.max(0, vals.indexOf(s.value)));
    if (it) await themeSet(s.id, it.v);
  } else if (s.type === 'choice') {
    const it = await pick(s.label, s.options.map((o) => ({ label: o.label, sub: o.value === s.value ? 'current' : '', v: o.value })), Math.max(0, s.options.findIndex((o) => o.value === s.value)));
    if (it) await themeSet(s.id, it.v);
  } else if (s.type === 'color') {
    const items = [
      { label: 'Color wheel…', sub: 'pick by eye', op: 'wheel', plain: true },
      { label: 'Hex code…', sub: s.value.toUpperCase(), op: 'hex', plain: true },
      { label: 'Presets', header: true, fold: 'color.presets' },
      ...COLOR_PRESETS.map(([name, hex]) => ({ label: name, sub: hex + (hex === s.value ? '  ·  current' : ''), v: hex, plain: true })),
      { label: 'Default', sub: s.default, v: s.default, plain: true },
    ];
    const it = await pick(s.label, items);
    if (!it) return;
    if (it.op === 'wheel' || it.op === 'hex') {
      let hex = s.value;
      let typing = it.op === 'hex';
      for (;;) {
        if (typing) {
          const txt = await ask('Hex code, like #ff8800', hex);
          if (txt === null) return;
          const m = /^#?([0-9a-f]{6})$/i.exec(txt.trim());
          if (!m) { setStatus('That is not a 6-digit hex code.', true); continue; }
          hex = '#' + m[1].toLowerCase();
          typing = false;
        }
        const res = await pickColor(s.label, hex);
        if (!res) return;
        hex = res.color;
        if (res.hex) { typing = true; continue; }
        await themeSet(s.id, hex);
        return;
      }
    } else await themeSet(s.id, it.v);
  } else if (s.type === 'image') {
    const it = await pick(s.label, [
      { label: 'Choose a picture…', sub: 'PNG, JPEG or WebP, up to 12 MB', op: 'pick' },
      ...(s.value ? [{ label: 'Remove picture', op: 'none' }] : []),
      { label: 'Cancel' },
    ]);
    if (!it || !it.op) return;
    if (it.op === 'none') await themeSet(s.id, '');
    else await new Promise((res) => flowBrowse('pickImage', res));
  }
}

// Minimal, on purpose: who's using this Tessera, and which theme (if any) is theirs. No
// switching session or startup wizard yet — see the plan doc for where this is headed.
async function flowProfiles() {
  if (modal || busy) return;
  let index = 1;
  for (;;) {
    busy = true;
    let pr, t;
    try { [pr, t] = await Promise.all([api.profiles('list'), api.settings('themeGet')]); } finally { busy = false; }
    const list = pr.profiles || [];
    const themeName = (id) => { const x = t.themes.find((th) => th.id === id); return x ? x.name : id; };
    const items = [
      { label: 'Profiles', header: true },
      { label: 'Add a profile…', op: 'add', plain: true },
    ];
    if (list.length) {
      items.push({ label: `Press ${hintName(3)} on a profile for its options`, header: true });
      list.forEach((p) => items.push({ label: p.name, sub: p.themeId ? `Theme: ${themeName(p.themeId)}` : "Uses Tessera's active theme", id: p.id, plain: true }));
    }
    const it = await pick('Profiles', items, index, {
      onY: list.length
        ? async (hit) => { if (hit && hit.id) await flowProfileOptions(hit.id, hit.label); }
        : undefined,
    });
    if (!it) return;
    index = items.indexOf(it);
    if (it.op === 'add') {
      const name = await ask('Name this profile', '');
      if (name === null) continue;
      if (!name.trim()) { setStatus('Give them a name.', true); continue; }
      busy = true;
      let r;
      try { r = await api.profiles('add', { name }); } finally { busy = false; }
      if (r && r.needPin) { if (!(await requirePin())) continue; busy = true; try { r = await api.profiles('add', { name }); } finally { busy = false; } }
      setStatus(r && r.ok ? `Added ${name.trim()}.` : (r && r.error) || "Couldn't add that.", !(r && r.ok));
    }
  }
}
async function flowProfileOptions(id, name) {
  const it = await pick(name, [
    { label: 'Rename…', op: 'rename', plain: true },
    { label: 'Give it a theme…', op: 'theme', plain: true },
    { label: "Use Tessera's active theme", op: 'clear', plain: true },
    { label: 'Remove this profile…', op: 'remove', plain: true },
  ]);
  if (!it) return;
  if (it.op === 'rename') {
    const newName = await ask('Rename this profile', name);
    if (newName === null || !newName.trim()) return;
    busy = true;
    let r;
    try { r = await api.profiles('rename', { id, name: newName }); } finally { busy = false; }
    if (r && r.needPin) { if (!(await requirePin())) return; busy = true; try { r = await api.profiles('rename', { id, name: newName }); } finally { busy = false; } }
    setStatus(r && r.ok ? 'Renamed.' : (r && r.error) || "Couldn't rename that.", !(r && r.ok));
  } else if (it.op === 'theme') {
    busy = true;
    let t;
    try { t = await api.settings('themeGet'); } finally { busy = false; }
    const choice = await pick(`Theme for ${name}`, t.themes.map((x) => ({ label: x.name, sub: x.dup ? `#${x.id}` : x.author, id: x.id })));
    if (!choice) return;
    busy = true;
    let r;
    try { r = await api.profiles('setTheme', { id, themeId: choice.id }); } finally { busy = false; }
    setStatus(r && r.ok ? `${name} now uses ${choice.label}.` : (r && r.error) || "Couldn't set that.", !(r && r.ok));
  } else if (it.op === 'clear') {
    busy = true;
    let r;
    try { r = await api.profiles('setTheme', { id, themeId: null }); } finally { busy = false; }
    setStatus(r && r.ok ? `${name} now follows the active theme.` : (r && r.error) || "Couldn't set that.", !(r && r.ok));
  } else if (it.op === 'remove') {
    if (!(await confirm(`Remove the profile “${name}”?`, 'Remove'))) return;
    busy = true;
    let r;
    try { r = await api.profiles('remove', { id }); } finally { busy = false; }
    if (r && r.needPin) { if (!(await requirePin())) return; busy = true; try { r = await api.profiles('remove', { id }); } finally { busy = false; } }
    setStatus(r && r.ok ? `Removed ${name}.` : (r && r.error) || "Couldn't remove that.", !(r && r.ok));
  }
}

async function flowScan(into) {
  if (modal || busy) return;
  setStatus('Scanning your library folders…');
  busy = true;
  let r;
  try {
    r = await api.scan('run');
  } finally {
    busy = false;
  }
  if (!r.found.length)
    return setStatus(r.notes || 'No new games found. Heroic, Lutris and installed games are checked automatically; add library folders for Steam and PS5 games.', Boolean(r.notes));
  setStatus(r.notes || '', Boolean(r.notes));
  const items = [{ label: 'Add selected games', op: 'confirm' }];
  r.found.forEach((f) => items.push({ label: f.title, sub: f.source, checked: !f.optional, cid: f.cid }));
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
