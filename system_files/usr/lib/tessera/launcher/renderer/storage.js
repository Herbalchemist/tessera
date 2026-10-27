// SPDX-License-Identifier: GPL-3.0-or-later
// Settings > Storage.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ------------------------------------------------------------ Storage
// Settings → Storage: how full each drive is and what's using it, plus the
// housekeeping that goes with it. The graphics are plain bars built from
// theme colours, so they follow whichever theme is on.
function fmtBytes(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i >= 3 ? v.toFixed(v >= 100 ? 0 : 1) : Math.round(v)) + ' ' + u[i];
}
function usageBar(segs, total, shimmer) {
  const bar = document.createElement('div');
  bar.className = 'ubar' + (shimmer ? ' measuring' : '');
  for (const s of segs) {
    if (!(s.bytes > 0) || !(total > 0)) continue;
    const el = document.createElement('span');
    el.className = 'useg ' + s.cls;
    el.style.flexBasis = Math.max(0.6, (s.bytes / total) * 100) + '%';
    el.title = `${s.label}: ${fmtBytes(s.bytes)}`;
    bar.appendChild(el);
  }
  return bar;
}
function legend(items) {
  const row = document.createElement('div');
  row.className = 'ulegend';
  for (const it of items) {
    const chip = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = 'useg ' + it.cls;
    chip.append(dot, `${it.label} ${it.text}`);
    row.appendChild(chip);
  }
  return row;
}
function driveGraphic(el, d, measured) {
  const other = Math.max(0, d.used - d.games - d.tessera);
  const low = !d.muted && (d.free < 10 * 1024 ** 3 || d.free / d.total < 0.1);
  const segs = measured
    ? [{ cls: 'g', bytes: d.games, label: 'Games & apps' }, { cls: 't', bytes: d.tessera, label: 'Tessera' }, { cls: 'o', bytes: other, label: 'Other' }]
    : [{ cls: 'o', bytes: d.used, label: 'Used' }];
  const wrap = document.createElement('div');
  wrap.className = 'ugfx' + (low ? ' low' : '');
  wrap.appendChild(usageBar([...segs, { cls: 'f', bytes: d.free, label: 'Free' }], d.total, !measured));
  const lg = (measured
    ? [{ cls: 'g', label: 'Games & apps', n: d.games }, { cls: 't', label: 'Tessera', n: d.tessera }, { cls: 'o', label: 'Other', n: other }, { cls: 'f', label: 'Free', n: d.free }]
    : [{ cls: 'o', label: 'Used', n: d.used }, { cls: 'f', label: 'Free', n: d.free }]
  ).filter((x) => x.n > 0 || x.cls === 'f').map((x) => ({ cls: x.cls, label: x.label, text: fmtBytes(x.n) }));
  wrap.appendChild(legend(lg));
  const tags = [d.system ? 'Main storage' : d.external ? 'Plugged in' : '', d.library ? 'Game library' : '', low && !d.muted ? 'Low space' : '', d.muted ? 'Warnings off' : '', measured ? '' : 'Measuring…'].filter(Boolean);
  if (tags.length) {
    const t = document.createElement('div');
    t.className = 'utags';
    tags.forEach((x) => { const s = document.createElement('span'); s.textContent = x; if (x === 'Low space') s.className = 'warn'; t.appendChild(s); });
    wrap.appendChild(t);
  }
  el.appendChild(wrap);
}
function vaultGraphic(el, v, measured) {
  const parts = v.parts.filter((p) => p.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const wrap = document.createElement('div');
  wrap.className = 'ugfx';
  if (!parts.length) {
    const e = document.createElement('div');
    e.className = 'utags';
    e.textContent = measured ? 'Empty so far' : 'Measuring…';
    wrap.appendChild(e);
  } else {
    wrap.appendChild(usageBar(parts.map((p, i) => ({ cls: 'v' + (i % 8), bytes: p.bytes, label: p.name })), v.bytes, !measured));
    wrap.appendChild(legend(parts.map((p, i) => ({ cls: 'v' + (i % 8), label: p.name, text: fmtBytes(p.bytes) }))));
  }
  el.appendChild(wrap);
}
function storageItems(ov, measured, cleanHint) {
  const P = { plain: true };
  const items = [{ label: 'Drives', header: true }];
  ov.drives.forEach((d) => items.push({ ...P, label: d.name, sub: `${fmtBytes(d.free)} free of ${fmtBytes(d.total)}`, op: 'drive', drive: d, graphic: (el) => driveGraphic(el, d, measured) }));
  items.push({ label: 'Games & apps', header: true });
  items.push({ ...P, label: 'Manage games by size', sub: 'Biggest first', op: 'manage' });
  items.push({ ...P, label: 'Scan for games', sub: 'Look for new games now', op: 'scan' });
  items.push({ ...P, label: 'Add a game library', sub: 'Point Tessera at a folder of games', op: 'add' });
  items.push({ ...P, label: 'Library folders', sub: 'See or stop scanning', op: 'roots' });
  items.push({ ...P, label: 'New games install to', sub: ov.install || 'Tessera folder', op: 'install' });
  items.push({ label: 'Tessera folder', header: true });
  items.push({ ...P, label: ov.vault.path, sub: measured ? fmtBytes(ov.vault.bytes) : '', op: 'vault', graphic: (el) => vaultGraphic(el, ov.vault, measured) });
  items.push({ ...P, label: 'Downloads', sub: 'See or clear what you downloaded', op: 'downloads' });
  items.push({ label: 'Housekeeping', header: true });
  items.push({ ...P, label: 'Clean up', sub: cleanHint || 'Broken and duplicate entries, old logs', op: 'clean' });
  items.push({ ...P, label: 'Back up my setup', sub: 'Layout, library and settings', op: 'backup' });
  items.push({ ...P, label: 'Restore a backup', sub: 'Put a saved setup back', op: 'restore' });
  items.push({ ...P, label: 'Name your drives', sub: 'Friendly names for disks', op: 'drives' });
  items.push({ ...P, label: 'Hidden drives', sub: ov.hiddenCount ? `${ov.hiddenCount} hidden` : 'None', op: 'hidden' });
  return items;
}
async function flowStorage(index = 1) {
  if (modal || busy) return;
  busy = true;
  let ov;
  try { ov = await api.storage('overview', {}); } finally { busy = false; }
  if (!ov || !ov.ok) return setStatus((ov && ov.error) || "Couldn't read your drives.", true);
  let at = index;
  const it = await new Promise((resolve) => {
    openList({
      title: 'Storage',
      items: storageItems(ov, ov.measured),
      index,
      onChoose: (x) => { at = modal.index; closeModal(); resolve(x); },
      onBack: () => { closeModal(); resolve(null); },
    });
    const m = modal;
    // Measuring folders takes a moment on a big library: show the drives now, fill in the rest after.
    api.storage('overview', { measure: true }).then(async (r) => {
      if (modal !== m || !r || !r.ok) return;
      const sc = await api.storage('cleanScan', {});
      const n = sc && sc.ok ? sc.broken + sc.dupes + sc.orphans : 0;
      if (modal !== m) return;
      m.items = storageItems(r, true, n ? `${n} thing${n === 1 ? '' : 's'} to tidy` : 'Nothing to tidy right now');
      renderModal();
    });
  });
  if (!it) return;
  const back = () => flowStorage(Math.max(1, at));
  switch (it.op) {
    case 'drive': return flowDriveMenu(it.drive, back);
    case 'manage': return flowManage(back);
    case 'scan': return flowScan();
    case 'add': return flowBrowse('addRoot', back);
    case 'roots': return flowRoots(back);
    case 'install': return flowInstall(back);
    case 'vault': setStatus(`Your games, apps, themes and downloads live in ${prefs.vault || '~/Tessera'}.`); return back();
    case 'downloads': return flowDownloads(back);
    case 'clean': return flowClean(back);
    case 'backup': if (!(await requirePin())) return back(); return flowBrowse('backupTo', back);
    case 'restore': return flowRestore(back);
    case 'drives': await flowDrives(); return back();
    case 'hidden': return flowHidden(back);
    default: return back();
  }
}
async function flowDriveMenu(d, back) {
  const items = [];
  if (!d.library && !d.system) items.push({ label: 'Use for games', sub: 'Make a Games folder and scan it', op: 'use', plain: true });
  if (d.ejectable) items.push({ label: 'Eject safely', sub: 'Then it can be unplugged', op: 'eject', plain: true });
  items.push({ label: 'Name this drive…', op: 'name', plain: true });
  items.push({ label: 'Low space warning', sub: d.muted ? 'Off · A to turn on' : 'On · A to turn off', op: 'mute', plain: true });
  items.push({ label: 'Hide this drive', sub: 'Brings back from Hidden drives', op: 'hide', plain: true });
  items.push({ label: 'Back', op: 'back', plain: true });
  const it = await pick(`${d.name} · ${fmtBytes(d.free)} free of ${fmtBytes(d.total)}`, items);
  if (!it || it.op === 'back') return back();
  if (!(await requirePin())) return back();
  busy = true;
  let r;
  try {
    if (it.op === 'name') { busy = false; if (await renameDrive(d.key, '')) setStatus('Renamed.'); return back(); }
    if (it.op === 'mute') r = await api.storage('muteDrive', { key: d.key, muted: !d.muted });
    else if (it.op === 'hide') r = await api.storage('hideDrive', { key: d.key, hidden: true });
    else r = await api.storage(it.op === 'use' ? 'useDrive' : 'eject', { key: d.key });
  } finally { busy = false; }
  if (r.prefs) { applyPrefs(r.prefs); render(); r.message = it.op === 'hide' ? `${d.name} is hidden.` : d.muted ? `Low space warning is on for ${d.name}.` : `Low space warning is off for ${d.name}.`; }
  setStatus(r.message || r.error, !r.ok);
  if (r.ok && it.op === 'use') return flowScan();
  return back();
}
async function flowHidden(back) {
  busy = true;
  let r;
  try { r = await api.storage('hiddenDrives', {}); } finally { busy = false; }
  const items = r.drives.length
    ? r.drives.map((d) => ({ label: d.name, sub: `${fmtBytes(d.total)} · A to show again`, key: d.key, plain: true }))
    : [{ label: 'No hidden drives', sub: 'Hide one from its menu in Storage', header: true }];
  items.push({ label: 'Back', op: 'back', plain: true });
  const it = await pick('Hidden drives', items, 0);
  if (!it || it.op === 'back') return back();
  if (it.key && (await requirePin())) {
    const u = await api.storage('hideDrive', { key: it.key, hidden: false });
    if (u.prefs) { applyPrefs(u.prefs); render(); }
    setStatus(`${it.label} is showing again.`);
  }
  return flowHidden(back);
}
async function flowManage(back) {
  busy = true;
  let r;
  try { r = await api.storage('games', {}); } finally { busy = false; }
  if (!r || !r.ok) return back();
  const build = (res, measured) => {
    const total = res.games.reduce((s, g) => s + (g.bytes || 0), 0);
    const max = Math.max(1, ...res.games.map((g) => g.bytes || 0));
    const items = [{ label: measured ? `Biggest first · ${fmtBytes(total)} in all` : 'Biggest first · measuring…', header: true }];
    if (!res.games.length) items.push({ label: 'No games or apps yet', header: true });
    res.games.forEach((g) => items.push({
      plain: true, id: g.id, game: g,
      label: g.title,
      sub: g.offline ? (g.offline === 'drive' ? 'Drive not connected' : 'Files missing') : g.bytes === null ? 'Measuring…' : fmtBytes(g.bytes),
      graphic: g.offline || g.bytes === null ? null : (el) => {
        const w = document.createElement('div');
        w.className = 'ugfx thin';
        w.appendChild(usageBar([{ cls: g.deletable ? 'g' : 'o', bytes: g.bytes, label: g.title }], max));
        if (g.drive) { const t = document.createElement('div'); t.className = 'utags'; t.textContent = g.drive; w.appendChild(t); }
        el.appendChild(w);
      },
    }));
    if (res.games.some((g) => g.bytes)) items.push({ label: 'Coloured bars: files you can delete here  ·  Grey: outside your Tessera folder', header: true });
    return items;
  };
  const it = await new Promise((resolve) => {
    openList({ title: 'Manage games by size', items: build(r, false), index: 1, onChoose: (x) => { closeModal(); resolve(x); }, onBack: () => { closeModal(); resolve(null); } });
    const m = modal;
    api.storage('games', { measure: true }).then((res) => {
      if (modal !== m || !res || !res.ok) return;
      const cur = m.items[m.index];
      m.items = build(res, true);
      const same = cur && cur.id ? m.items.findIndex((x) => x.id === cur.id) : -1;
      m.index = same >= 0 ? same : Math.min(m.index, m.items.length - 1);
      renderModal();
    });
  });
  if (!it) return back();
  if (!it.game) return flowManage(back);
  const g = it.game;
  const menu = [];
  if (g.deletable) menu.push({ label: 'Delete the files…', sub: g.bytes ? `Frees ${fmtBytes(g.bytes)}` : '', op: 'files', plain: true });
  menu.push({ label: 'Remove from library…', sub: 'Keeps the files', op: 'remove', plain: true });
  menu.push({ label: 'Back', op: 'back', plain: true });
  const pk = await pick(g.title, menu);
  if (pk && pk.op !== 'back' && (await requirePin())) {
    if (pk.op === 'files' && (await confirm(`Delete “${g.title}” and its files from your Tessera folder? This can't be undone.`, 'Delete files'))) await lib('deleteFiles', { id: g.id });
    if (pk.op === 'remove' && (await confirm(`Remove “${g.title}” from your library?`, 'Remove (files are kept)'))) await lib('deleteItem', { id: g.id });
  }
  return flowManage(back);
}
async function flowInstall(back) {
  busy = true;
  let r;
  try { r = await api.storage('installRoots', {}); } finally { busy = false; }
  const items = r.roots.map((x, i) => ({ label: x.name, sub: [x.current ? '✓ in use' : '', x.free !== null ? `${fmtBytes(x.free)} free` : ''].filter(Boolean).join('  ·  '), i, plain: true }));
  const it = await pick('New games install to', items, Math.max(0, r.roots.findIndex((x) => x.current)));
  if (!it) return back();
  if (!(await requirePin())) return back();
  const res = await api.storage('setInstallRoot', { index: it.i });
  setStatus(res.message || res.error, !res.ok);
  return back();
}
async function flowDownloads(back) {
  busy = true;
  let d;
  try { d = await api.storage('downloads', {}); } finally { busy = false; }
  const items = [
    { label: d.count ? `${d.count} item${d.count === 1 ? '' : 's'} · ${fmtBytes(d.bytes)}` : 'Nothing downloaded', sub: d.path, header: true },
    ...(d.count ? [{ label: 'Clear Downloads…', sub: 'Deletes what is inside, keeps the folder', op: 'clear', plain: true }] : []),
    { label: 'Back', op: 'back', plain: true },
  ];
  const it = await pick('Downloads', items, d.count ? 1 : 1);
  if (it && it.op === 'clear' && (await requirePin()) && (await confirm(`Delete everything in Downloads (${fmtBytes(d.bytes)})? This can't be undone.`, 'Clear Downloads'))) {
    const r = await api.storage('clearDownloads', {});
    setStatus(r.message || r.error, !r.ok);
  }
  return back();
}
async function flowClean(back) {
  busy = true;
  let s;
  try { s = await api.storage('cleanScan', {}); } finally { busy = false; }
  const rows = [
    { what: 'broken', label: 'Broken entries', sub: s.broken ? `${s.broken} whose files are gone` : 'None' , n: s.broken },
    { what: 'dupes', label: 'Duplicate entries', sub: s.dupes ? `${s.dupes} pointing at the same game` : 'None', n: s.dupes },
    { what: 'orphans', label: 'Stray tiles', sub: s.orphans ? `${s.orphans} left over in mosaics` : 'None', n: s.orphans },
    { what: 'logs', label: 'Old logs', sub: s.logFiles > 1 ? `${s.logFiles} files · ${fmtBytes(s.logBytes)}` : 'None', n: s.logFiles > 1 ? s.logFiles : 0 },
  ];
  const items = [
    { label: 'Games on an unplugged drive are not touched', header: true },
    ...rows.map((r) => ({ label: r.label, sub: r.sub, checked: r.n > 0, what: r.what, n: r.n, plain: true })),
    { label: 'Clean up selected', op: 'go', plain: true },
    { label: 'Back', op: 'back', plain: true },
  ];
  await new Promise((resolve) => {
    openList({
      title: 'Clean up', items, multi: true, index: 1,
      onChoose: async (it) => {
        if (it.op === 'back') { closeModal(); return resolve(); }
        if (it.op !== 'go') { if (it.n) it.checked = !it.checked; return renderModal(); }
        const what = items.filter((x) => x.what && x.checked).map((x) => x.what);
        if (!what.length) { setStatus('Nothing selected.'); return; }
        if (!(await requirePin())) return;
        closeModal();
        const r = await api.storage('cleanRun', { what });
        if (r.ok) { const v = await api.library('refresh', {}); if (v && v.view) applyView(v.view); }
        setStatus(r.message || r.error, !r.ok);
        resolve();
      },
      onBack: () => { closeModal(); resolve(); },
    });
  });
  return back();
}
async function flowRestore(back) {
  if (!(await requirePin())) return back();
  if (!(await confirm('Restore a backup? It replaces your layout, library and settings. A copy of what you have now is kept.', 'Choose a backup folder'))) return back();
  return flowBrowse('restoreFrom', back);
}
// A drive was plugged in while Tessera was open: offer to use it for games.
let driveOffers = [];
async function offerDrive(d, tries = 0) {
  if (modal || busy || suspended) {
    if (tries < 40) setTimeout(() => offerDrive(d, tries + 1), 3000);
    return;
  }
  const it = await pick(`“${d.name}” was plugged in · ${fmtBytes(d.free)} free of ${fmtBytes(d.total)}`, [
    { label: 'Use it for games', sub: 'Makes a Games folder and scans it', op: 'use', plain: true },
    { label: 'Not now', op: 'no', plain: true },
    { label: 'Don’t ask about this drive again', op: 'never', plain: true },
  ], 0, { body: 'Want to keep games on it?' });
  if (!it || it.op === 'no') return;
  if (!(await requirePin())) return;
  if (it.op === 'never') { await api.storage('ignoreDrive', { key: d.key }); return setStatus('OK. You can still use it from Settings > Storage.'); }
  const r = await api.storage('useDrive', { key: d.key });
  setStatus(r.message || r.error, !r.ok);
  if (r.ok) flowScan();
}

// Settings → Button mapping. For now: which buttons the on-screen keyboard
// uses. Any button the system reports works here, including paddles and
// other extra buttons (numbered 17 and up in the Controller test).
async function flowControls() {
  let index = 1;
  for (;;) {
    busy = true;
    try { keymap = (await api.settings('getKeys')).keys; } finally { busy = false; }
    // These are settings rows, so Done and Cancel stay plain here (plain: true).
    const items = [{ label: 'Keyboard', header: true, fold: 'map.keyboard', open: true }];
    KEY_ACTIONS.forEach((a) => items.push({ label: a.label, sub: buttonName(keymap[a.id]), id: a.id, plain: true }));
    items.push({ label: 'Reset keyboard buttons', op: 'reset', plain: true });
    items.push({ label: 'Fixed buttons', header: true, fold: 'map.fixed' });
    [
      [buttonName(0), 'select'], [buttonName(1), 'back'], [buttonName(3), 'options'], [`${buttonName(4)} / ${buttonName(5)}`, 'switch tab'], ['D-pad', 'move'],
    ].forEach(([k, v]) => items.push({ label: k, sub: v, plain: true, info: true }));
    const it = await pick('Button mapping', items, index);
    if (!it) return;
    index = items.indexOf(it);
    if (it.info) continue;
    busy = true;
    try {
      if (it.op === 'reset') {
        keymap = (await api.settings('resetKeys')).keys;
        continue;
      }
    } finally {
      busy = false;
    }
    const n = await capture(it.label);
    if (n === null) continue;
    busy = true;
    try {
      const r = await api.settings('setKey', { action: it.id, button: n });
      keymap = r.keys;
      if (!r.ok) setStatus(r.error, true);
    } finally {
      busy = false;
    }
  }
}
