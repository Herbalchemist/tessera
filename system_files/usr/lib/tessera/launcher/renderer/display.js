// SPDX-License-Identifier: GPL-3.0-or-later
// Settings > Screens: which screen Ludus uses, its resolution and refresh rate, and a built-in
// screen's orientation. Every choice comes from what the screen itself reports (main/display.js).
// A change restarts Ludus on trial: "Keep these settings?" for 15 seconds, then it goes back.

const ORIENT_WORD = { normal: 'Normal', left: 'Turned left', right: 'Turned right', upsidedown: 'Upside down' };
const screenName = (s) => (s.label ? `${s.label} (${s.name})` : s.name) + (s.internal ? ' · built in' : '');
const modeWord = (m) => `${m.width} × ${m.height}`;
const hzWord = (m) => `${Math.round(m.hz || m.refresh)} Hz`;

async function displayList() {
  setStatus('Looking at the screens…');
  busy = true;
  try { return await api.display('list', {}); } finally { busy = false; setStatus(''); }
}

async function flowScreens() {
  if (busy) return;
  let d = await displayList();
  if (!d || !d.ok) return void (await pick('Screens', [{ label: 'OK', plain: true }], 0, { body: (d && d.error) || "Couldn't read the screens." }));
  if (d.nested) {
    return void (await pick('Screens', [{ label: 'OK', plain: true }], 0, { body: "Ludus is open on top of Opus, so it uses Opus's screen settings: the main screen, at the resolution set there. Change screens, resolution and orientation in Opus's display settings." }));
  }
  const screens = d.screens || [];
  if (!screens.length) return void (await pick('Screens', [{ label: 'OK', plain: true }], 0, { body: "No connected screen was found. (Ludus's own screen should always be listed: please make a problem report.)" }));
  const set = d.settings || {};
  // The draft starts from the settings in use, or from the screen showing Ludus now
  const shown = screens.find((s) => s.current) || screens[0];
  let draft = { output: set.output || shown.name, width: set.width, height: set.height, refresh: set.refresh, orientation: set.orientation || 'normal' };
  let index = 0;
  for (;;) {
    const s = screens.find((x) => x.name === draft.output) || screens[0];
    const best = s.modes.find((m) => m.preferred) || s.modes[0];
    const res = draft.width ? `${draft.width} × ${draft.height}` : `${modeWord(best)} (the screen's own)`;
    const rate = draft.refresh ? `${draft.refresh} Hz` : 'the highest it offers';
    const items = [
      { label: 'Screen', sub: screenName(s), op: 'screen', plain: true },
      { label: 'Resolution', sub: res, op: 'res', plain: true },
      { label: 'Refresh rate', sub: rate, op: 'rate', plain: true },
    ];
    if (s.internal) items.push({ label: 'Orientation', sub: ORIENT_WORD[draft.orientation || 'normal'], op: 'orient', plain: true });
    items.push({ label: 'Apply', sub: 'Ludus starts again with these, then asks to keep them', op: 'apply', ok: true });
    items.push({ label: "Use the screen's own choice", sub: 'clears these settings', op: 'auto', plain: true });
    const others = screens.length - 1;
    const body = [
      `Ludus shows on one screen at a time${others ? `; the other${others > 1 ? 's stay' : ' stays'} dark while it runs` : ''}. Opus can use them all, mirrored or side by side.`,
      s.internal ? '' : 'Turning a screen on its side is done in Opus for external screens (Ludus can only turn a built-in screen).',
    ].filter(Boolean).join('\n');
    const it = await pick('Screens', items, index, { body });
    if (!it) return;
    index = items.indexOf(it);
    if (it.op === 'screen') {
      const c = await pick('Show Ludus on', screens.map((x) => ({ label: screenName(x), sub: x.current ? 'showing Ludus now' : `${x.modes.length} modes`, s: x, ok: x.name === draft.output, plain: x.name !== draft.output })));
      if (c && c.s.name !== draft.output) draft = { output: c.s.name, orientation: 'normal' };
    } else if (it.op === 'res') {
      const sizes = [];
      for (const m of s.modes) if (!m.interlaced && !sizes.some((x) => x.width === m.width && x.height === m.height)) sizes.push(m);
      const c = await pick('Resolution', [
        { label: `The screen's own (${modeWord(best)})`, auto: true, ok: !draft.width, plain: Boolean(draft.width) },
        ...sizes.map((m) => ({ label: modeWord(m), sub: m.width === best.width && m.height === best.height ? 'recommended' : '', m, ok: draft.width === m.width && draft.height === m.height, plain: !(draft.width === m.width && draft.height === m.height) })),
      ]);
      if (c) { if (c.auto) { delete draft.width; delete draft.height; delete draft.refresh; } else { draft.width = c.m.width; draft.height = c.m.height; delete draft.refresh; } }
    } else if (it.op === 'rate') {
      const w = draft.width || best.width; const h = draft.height || best.height;
      const rates = s.modes.filter((m) => m.width === w && m.height === h && !m.interlaced);
      const c = await pick('Refresh rate', [
        { label: 'The highest it offers', auto: true, ok: !draft.refresh, plain: Boolean(draft.refresh) },
        ...rates.map((m) => ({ label: hzWord(m), sub: `${m.hz} Hz`, m, ok: draft.refresh === m.refresh, plain: draft.refresh !== m.refresh })),
      ], 0, { body: `At ${w} × ${h}.` });
      if (c) { if (c.auto) delete draft.refresh; else { draft.width = w; draft.height = h; draft.refresh = c.m.refresh; } }
    } else if (it.op === 'orient') {
      const c = await pick('Orientation', Object.entries(ORIENT_WORD).map(([k, v]) => ({ label: v, k, ok: draft.orientation === k, plain: draft.orientation !== k })));
      if (c) draft.orientation = c.k;
    } else if (it.op === 'apply' || it.op === 'auto') {
      const payload = it.op === 'auto' ? { auto: true } : { output: draft.output, ...(draft.width ? { width: draft.width, height: draft.height } : {}), ...(draft.refresh ? { refresh: draft.refresh } : {}), ...(s.internal ? { orientation: draft.orientation } : {}) };
      let r = await api.display('try', payload);
      if (r && r.needPin) { if (!(await requirePin('Enter the admin PIN to change screens'))) continue; r = await api.display('try', payload); }
      if (!r || !r.ok) { await pick("Can't use that", [{ label: 'OK', plain: true }], 0, { body: (r && r.error) || 'Something went wrong.' }); d = await displayList(); continue; }
      if (r.restarted) { setStatus('Starting Ludus again on the new settings…'); return 'restarted'; }
      return void (await pick('Saved', [{ label: 'OK', plain: true }], 0, { body: 'These are used the next time Ludus starts. You will be asked to keep them.' }));
    }
  }
}

// After a restart on new settings: keep them, or they go back by themselves in 15 seconds.
async function displayKeepCountdown() {
  const d = await api.display('list', {});
  if (!d || !d.ok || !d.trying || !d.tried || d.nested) return;
  let left = 15;
  let done = false;
  const body = () => `Can you see this clearly? If not, Ludus goes back to the settings before in ${left} second${left === 1 ? '' : 's'}.`;
  const items = [{ label: 'Keep these settings', op: 'keep', ok: true }, { label: 'Change back', op: 'back', plain: true }];
  const choice = new Promise((resolve) => {
    openList({ title: 'Keep these screen settings?', items, index: 1, body: body(), onChoose: (it) => resolve(it.op), onBack: () => resolve('back') });
    const m = modal;
    const tick = setInterval(() => {
      if (done) return clearInterval(tick);
      left -= 1;
      if (left <= 0) { clearInterval(tick); return resolve('back'); }
      if (modal === m) { m.body = body(); renderModal(); }
    }, 1000);
  });
  const op = await choice;
  done = true;
  if (modal) closeModal();
  if (op === 'keep') { await api.display('confirm', {}); setStatus('Screen settings kept.'); return; }
  const r = await api.display('revert', { restart: true });
  setStatus(r && r.restarted ? 'Going back to the settings before…' : 'Going back to the settings before at the next start.');
}

// A screen was plugged in while Ludus runs: show Ludus there?
let displayAsking = false;
async function displayNew(e) {
  if (displayAsking || GUIDE_ONLY || gameOn) return;
  const d = await api.display('list', {});
  if (!d || !d.ok || d.nested) return;
  const s = (d.screens || []).find((x) => (e.outputs || []).includes(x.name));
  if (!s) return;
  if (modal || busy) { setStatus(`New screen: ${screenName(s)}. Settings > Screens can show Ludus there.`); return; }
  displayAsking = true;
  try {
    const it = await pick('New screen', [
      { label: 'Show Ludus there', sub: 'Ludus starts again on it, at its own best mode', op: 'use', ok: true },
      { label: 'Not now', op: 'later', plain: true },
      { label: "Don't ask for this screen", op: 'ignore', plain: true },
    ], 0, { body: `${screenName(s)} was connected.` });
    if (!it) return;
    if (it.op === 'ignore') await api.display('ignore', { output: s.name });
    if (it.op !== 'use') return;
    let r = await api.display('try', { output: s.name });
    if (r && r.needPin) { if (!(await requirePin('Enter the admin PIN to change screens'))) return; r = await api.display('try', { output: s.name }); }
    if (!r || !r.ok) await pick("Can't use that", [{ label: 'OK', plain: true }], 0, { body: (r && r.error) || 'Something went wrong.' });
  } finally { displayAsking = false; }
}
if (api.onDisplayNew) api.onDisplayNew((e) => { displayNew(e); });
if (api.display) api.onInit(() => { setTimeout(() => { displayKeepCountdown(); }, 1200); });

// Settings > Appearance: the theme, the screens and the display calibration, under one tile.
async function flowAppearance() {
  let index = 0;
  for (;;) {
    const items = [
      { label: 'Theme Settings', sub: calmNote('_theme') || 'colors, layout, motion, boot screen', op: '_theme', plain: true },
      { label: 'Screens', sub: 'which screen, resolution, refresh rate', op: '_screens', plain: true },
      { label: 'Display calibration', sub: calmNote('_display'), op: '_display', plain: true },
    ];
    const it = await pick('Appearance', items, index);
    if (!it) return;
    index = items.indexOf(it);
    let r;
    if (it.op === '_theme') r = await flowTheme();
    else if (it.op === '_screens') r = await flowScreens();
    else r = await flowCalMenu();
    if (r === 'restarted' || modal) return; // Ludus is starting again (Screens > Apply), or something else is open
  }
}
