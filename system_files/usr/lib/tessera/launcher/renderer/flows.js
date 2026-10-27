// SPDX-License-Identifier: GPL-3.0-or-later
// The flows: Settings menus, adding and arranging games, apps and pages.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// -------------------------------------------------------------- the flows
// Each flow only sends ids, names and menu choices to the main process.

async function lib(op, payload, { quiet = false } = {}) {
  busy = true;
  let r;
  try {
    r = await api.library(op, payload);
  } finally {
    busy = false;
  }
  applyView(r.view);
  if (!quiet) setStatus(r.ok ? r.message : r.error, !r.ok);
  return r;
}

async function confirm(question, yesLabel = 'Yes') {
  const r = await pick(question, [{ label: yesLabel, yes: true }, { label: 'Cancel' }]);
  return Boolean(r && r.yes);
}

// What "+" offers depends on where it is.
async function flowAdd(ctx) {
  if (!(await requirePin())) return;
  const into = ctx.catId;
  const onlyGame = ctx.kind === 'game';
  const onlyApp = ctx.kind === 'app';
  const items = [];
  if (into && libraryChoices(into).length) items.push({ label: 'Add something from your library…', op: 'existing' });
  if (into === '_home') items.push({ label: 'Add a widget…', op: 'inlay' });
  if (!onlyApp && ctx.tab !== 'apps') items.push({ label: 'Add a game from a file…', op: 'game' });
  if (!onlyGame && ctx.tab !== 'library') items.push({ label: 'Add an app from a file…', op: 'app' });
  if (!onlyApp && ctx.tab !== 'apps') items.push({ label: 'Scan for games', op: 'scan' });
  if (into === '_home') items.push({ label: `New ${TERM}…`, op: 'mosaic' });
  else if (into) items.push({ label: 'New folder here…', op: 'folder' });
  const it = items.length === 1 ? items[0] : await pick('Add', items);
  if (!it) return;
  switch (it.op) {
    case 'existing': return flowAddExisting(into);
    case 'inlay': return flowAddInlay(into);
    case 'game': return flowBrowse('addGame', undefined, into);
    case 'app': return flowBrowse('addApp', undefined, into);
    case 'scan': return flowScan(into);
    case 'mosaic': return flowNewMosaic({});
    case 'folder': return flowNewMosaic({ parent: into });
  }
}

// Nothing is added for you: pick a preset or an installed widget.
async function flowAddInlay(into) {
  for (;;) {
    busy = true;
    let info;
    try { info = await api.addons('list'); } finally { busy = false; }
    const sub = (d, kind) =>
      [d.description || kind, `${d.size.w} × ${d.size.h}`, d.resizable ? 'resizable' : ''].filter(Boolean).join(' · ');
    const items = [
      ...info.presets.map((p) => ({ label: p.name, sub: sub(p, 'preset'), type: p.type })),
      ...info.widgets.map((w) => ({ label: w.name, sub: sub(w, 'widget'), type: w.type })),
      { label: '↻  Reload add-ons', op: 'reload' },
    ];
    const it = await pick('Add an inlay', items);
    if (!it) return;
    if (it.op === 'reload') {
      busy = true;
      try { await api.addons('rescan'); } finally { busy = false; }
      continue;
    }
    const d = [...info.presets, ...info.widgets].find((x) => x.type === it.type);
    // Nothing is placed yet: choose where it goes first.
    const at = firstFree(d.size.w, d.size.h);
    return startPlace({ type: it.type, name: d.name, def: d, ...at, w: d.size.w, h: d.size.h });
  }
}

function flowPlaceExisting(t) {
  const def = { size: { w: t.w, h: t.h }, min: t.min, max: t.max, resizable: t.resizable };
  startPlace({ id: t.id, name: t.title, def, x: t.x, y: t.y, w: t.w, h: t.h });
}

// Settings → Add-ons: what's installed and where downloads go, sorted into
// sections. Rejected widgets say why (handy for people making their own).
async function flowAddons() {
  let op = 'list';
  let view = 'top';
  let index = 0;
  for (;;) {
    busy = true;
    let info;
    try { info = await api.addons(op); } finally { busy = false; }
    op = 'list';
    const inert = (label, sub) => ({ label, sub, info: true });
    let items;
    let title;
    if (view === 'top') {
      title = 'Add-ons';
      items = [
        { label: 'Installed', header: true },
        { label: 'Widgets', sub: `${info.widgets.length} installed${info.rejected.length ? ` · ${info.rejected.length} problem${info.rejected.length === 1 ? '' : 's'}` : ''}`, view: 'widgets' },
        { label: 'Themes', sub: info.themes.length ? `${info.themes.length} installed` : 'none installed', view: 'themes' },
        { label: 'Shards', sub: `${info.packs.length} installed${info.rejectedPacks.length ? ` · ${info.rejectedPacks.length} problem${info.rejectedPacks.length === 1 ? '' : 's'}` : ''}`, view: 'packs' },
        { label: 'Built in', sub: info.presets.map((p) => p.name).join(', '), view: 'builtin' },
        { label: 'Get more', header: true },
        { label: 'Get add-ons', sub: 'from the Tessera add-on list (needs internet)', op: 'store' },
        { label: 'Where to put downloads', sub: 'widgets, themes, shards, art, fonts, sounds', view: 'folders' },
        { label: '↻  Reload add-ons', op: 'reload' },
      ];
    } else if (view === 'widgets') {
      title = 'Add-ons · Widgets (A removes one)';
      items = info.widgets.map((w) => ({ label: w.name, sub: [w.author, `${w.size.w} × ${w.size.h}${w.resizable ? ' · resizable' : ''}`].filter(Boolean).join(' · '), rm: { dir: 'widgets', id: w.id }, plain: true }));
      info.rejected.forEach((x) => items.push(inert('⚠  ' + x.id, x.reason)));
      if (!items.length) items.push(inert('No widgets installed yet', info.dirs.widgets));
    } else if (view === 'themes') {
      title = 'Add-ons · Themes (A to switch)';
      // Every builtin plus anything downloaded — not just stock. (Removal, just below, stays
      // scoped to downloaded themes only; you can't delete a factory one.)
      items = info.allThemes.map((t) => ({
        label: t.name,
        sub: t.builtin ? 'built in' : (t.author || ''),
        theme: t.id,
      }));
      if (info.themes.length) items.push({ label: 'Remove a theme…', view: 'rmthemes', plain: true });
      items.push(inert('Theme packs go in', info.dirs.themes));
    } else if (view === 'rmthemes') {
      title = 'Add-ons · Remove a theme (A removes it)';
      items = info.themes.map((t) => ({ label: t.name, sub: t.author || '', rm: { dir: 'themes', id: t.id }, plain: true }));
      if (!items.length) items.push(inert('No downloaded themes', ''));
    } else if (view === 'packs') {
      title = 'Add-ons · Shards';
      items = info.packs.map((p) => ({
        label: p.name,
        sub: [p.running ? 'On' : p.enabled ? 'On, but not running' : 'Off', p.official ? 'Official' : 'Unverified', p.author, p.version].filter(Boolean).join(' · '),
        shard: p,
        plain: !p.running,
      }));
      info.rejectedPacks.forEach((x) => items.push(inert('⚠  ' + x.id, x.reason)));
      items.push({ label: 'Shard safety…', view: 'packsSettings', plain: true });
      if (!info.packs.length && !info.rejectedPacks.length) items.push(inert('No shards installed yet', info.dirs.packs));
    } else if (view === 'packsSettings') {
      title = 'Add-ons · Shard safety';
      items = [
        inert('What a shard is', 'A shard is real code with Tessera’s own access to this device — your files, your hardware, your settings. It is not sandboxed the way a widget is, and nothing here checks that it’s safe, only whose it is.'),
        { label: 'Require PIN to install or remove a shard', sub: info.codeAddons.pinRequired ? 'On' : 'Off', op: 'togglePacksPin' },
        { label: 'Allow unverified shards', sub: info.codeAddons.allowUnverified ? 'On — anything, not just Official' : 'Off — Official (signed by Tessera) only', op: 'toggleUnverified' },
        inert('Official', 'Signed by the Tessera project itself — a real check against a key only the project holds, not just a label a shard can give itself.'),
        inert('Unverified', 'Nobody vouches for this one — it didn’t come signed by the Tessera project. It runs with the same reach Tessera itself has: your files, your hardware, your settings. Same deal as running any program you downloaded from somewhere other than an app store — you already know that trade. This toggle is just how you tell Tessera you’re making it.'),
      ];
    } else if (view === 'builtin') {
      title = 'Add-ons · Built in';
      items = info.presets.map((p) => inert(p.name, p.description || ''));
    } else {
      title = 'Add-ons · Where downloads go';
      items = [
        inert('Widgets', info.dirs.widgets),
        inert('Themes', info.dirs.themes),
        inert('Shards', info.dirs.packs),
        inert('Art', info.dirs.art),
        inert('Fonts', info.dirs.fonts),
        inert('Sounds', info.dirs.sounds),
      ];
    }
    const it = await pick(title, items, view === 'top' ? Math.max(index, 1) : 0);
    if (!it) {
      if (view === 'top') return;
      view = 'top';
      continue;
    }
    if (view === 'top') index = items.indexOf(it);
    if (it.rm) {
      if (await confirm(`Remove “${it.label}”? Its folder is deleted from your Tessera folder.`, 'Remove')) {
        if (await requirePin()) {
          busy = true;
          let r;
          try { r = await api.addons('remove', it.rm); } finally { busy = false; }
          setStatus(r.ok ? `Removed ${it.label}.` : r.error, !r.ok);
          if (r.ok && it.rm.dir === 'widgets') lib('none', {}, { quiet: true });
        }
      }
      continue;
    }
    if (it.op === 'store') { await flowAddonStore(); continue; }
    if (it.shard) { await flowShard(it.shard.id); continue; }
    if (it.rmPack) {
      // A shard's PIN requirement is its own owner-controlled setting (Shard safety, above), not
      // the blanket "always ask" the widgets/themes removal above uses — so ask the server
      // first and only interrupt for the PIN when it actually says so.
      if (await confirm(`Remove “${it.label}”? Its folder is deleted from your Tessera folder.`, 'Remove')) {
        busy = true;
        let r;
        try { r = await api.addons('remove', { dir: 'packs', id: it.rmPack.id }); } finally { busy = false; }
        if (r && r.needPin) {
          if (!(await requirePin())) continue;
          busy = true;
          try { r = await api.addons('remove', { dir: 'packs', id: it.rmPack.id }); } finally { busy = false; }
        }
        setStatus(r && r.ok ? `Removed ${it.label}.` : (r && r.error) || "Couldn't remove that.", !(r && r.ok));
      }
      continue;
    }
    if (it.op === 'togglePacksPin' || it.op === 'toggleUnverified') {
      const apiOp = it.op === 'togglePacksPin' ? 'packsPinRequired' : 'packsAllowUnverified';
      const next = it.op === 'togglePacksPin' ? !info.codeAddons.pinRequired : !info.codeAddons.allowUnverified;
      busy = true;
      let r;
      try { r = await api.addons(apiOp, { value: next }); } finally { busy = false; }
      if (r && r.needPin) { if (!(await requirePin())) continue; busy = true; try { r = await api.addons(apiOp, { value: next }); } finally { busy = false; } }
      setStatus(r && r.ok ? 'Updated.' : (r && r.error) || "Couldn't change that.", !(r && r.ok));
      continue;
    }
    if (it.view) view = it.view;
    else if (it.op === 'reload') op = 'rescan';
    else if (it.theme) {
      busy = true;
      try {
        const r = await api.settings('themeUse', { id: it.theme });
        if (r.theme) applyTheme(r.theme);
        setStatus(`Theme: ${it.label}`);
      } finally { busy = false; }
    }
  }
}

// Calls the shards request, asking for the PIN only if the main process says it's needed.
async function shardsCall(op, p) {
  busy = true;
  let r;
  try { r = await api.shards(op, p); } finally { busy = false; }
  if (r && r.needPin) {
    if (!(await requirePin())) return null;
    busy = true;
    try { r = await api.shards(op, p); } finally { busy = false; }
  }
  return r;
}

// One shard: what it is, on or off, its pages, and removing it.
async function flowShard(id) {
  for (;;) {
    let info;
    busy = true;
    try { info = await api.addons('list'); } finally { busy = false; }
    const s = info.packs.find((x) => x.id === id);
    if (!s) return;
    const items = [];
    if (s.running) s.panels.forEach((pn) => items.push({ label: pn.title, sub: 'open', panel: pn.index }));
    items.push(s.enabled ? { label: 'Turn off', op: 'disable' } : { label: 'Turn on', sub: s.official ? 'Official: signed by Tessera' : 'Unverified: nobody vouches for it', op: 'enable' });
    items.push({ label: 'Remove…', op: 'remove', plain: true });
    const body = [
      s.description,
      s.official ? 'Official: signed by the Tessera project.' : `Unverified: ${s.reason}. It would run with Tessera's own access to this device.`,
      s.error ? `Not running: ${s.error}` : '',
    ].filter(Boolean).join('\n\n');
    const it = await pick(`Shards · ${s.name}`, items, 0, { body });
    if (!it) return;
    if (it.panel !== undefined) { await flowShardPanel(id, it.panel, it.label); continue; }
    if (it.op === 'enable' && !s.official && !(await confirm(`Turn on “${s.name}”? It isn't signed by Tessera, and it would run with Tessera's own access to this device: your files, your hardware, your settings.`, 'Turn on'))) continue;
    if (it.op === 'enable' || it.op === 'disable') {
      const r = await shardsCall(it.op, { id });
      if (r) setStatus(r.ok ? r.message : r.error, !r.ok);
      continue;
    }
    if (it.op === 'remove') {
      if (!(await confirm(`Remove “${s.name}”? Its folder is deleted from your Tessera folder.`, 'Remove'))) continue;
      busy = true;
      let r;
      try { r = await api.addons('remove', { dir: 'packs', id }); } finally { busy = false; }
      if (r && r.needPin) {
        if (!(await requirePin())) continue;
        busy = true;
        try { r = await api.addons('remove', { dir: 'packs', id }); } finally { busy = false; }
      }
      setStatus(r && r.ok ? `Removed ${s.name}.` : (r && r.error) || "Couldn't remove that.", !(r && r.ok));
      if (r && r.ok) return;
    }
  }
}

// A page a shard draws: its text, and rows that can each run one of its actions.
async function flowShardPanel(id, panel, title) {
  let r = await shardsCall('panel', { id, panel });
  let inner = false; // showing a page an action opened (B goes back to the shard's own page)
  for (;;) {
    if (!r) return;
    if (!r.ok) { setStatus(r.error, true); return; }
    const v = r.view;
    if (v.message) setStatus(v.message);
    if (v.openUrl) { browserUrl = v.openUrl; await launchBrowser(1); return; }
    const items = v.items.length ? v.items.map((x) => (x.action ? { label: x.label, sub: x.sub, act: x.action } : { label: x.label, sub: x.sub, info: true })) : [{ label: 'Nothing to show', info: true }];
    const it = await pick(title, items, Math.max(0, items.findIndex((x) => x.act)), { body: v.body });
    if (!it) {
      if (!inner) return;
      inner = false;
      r = await shardsCall('panel', { id, panel });
      continue;
    }
    if (!it.act) continue;
    r = await shardsCall('action', { id, panel, action: it.act });
    if (r && r.ok && (r.view.items.length || r.view.body)) inner = true;
    if (r && r.ok && !r.view.items.length && !r.view.body && !r.view.openUrl) { // only a message: show it and stay on this page
      if (r.view.message) setStatus(r.view.message);
      r = await shardsCall('panel', { id, panel });
      if (r && r.ok) delete r.view.message;
    }
  }
}

// Settings > Add-ons > Get add-ons: the Tessera add-on list, installed with one press.
async function flowAddonStore() {
  setStatus('Getting the add-on list…');
  let r = await shardsCall('catalog', { fresh: true });
  setStatus('');
  if (!r) return;
  if (!r.ok) { setStatus(r.error, true); return; }
  const kinds = { shard: 'Shard', widget: 'Widget', theme: 'Theme' };
  for (;;) {
    const items = r.addons.map((a) => ({
      label: a.name,
      sub: [kinds[a.kind], a.version, a.installed ? (a.update ? `update from ${a.installedVersion}` : 'installed') : fmtBytes(a.size)].filter(Boolean).join(' · '),
      addon: a,
    }));
    if (!items.length) items.push({ label: 'The list is empty for now', info: true });
    const it = await pick('Get add-ons', items, 0, { body: 'Add-ons from the Tessera project. Shards are code: they only run once you turn them on in Add-ons > Shards.' });
    if (!it || !it.addon) return;
    const a = it.addon;
    const what = [a.description, a.author ? `By ${a.author}.` : '', a.requires ? `Needs ${a.requires}.` : '', a.kind === 'shard' ? 'A shard is code with Tessera\'s own access to this device. Installing it does not turn it on.' : ''].filter(Boolean).join(' ');
    if (!(await confirm(`${a.installed && !a.update ? 'Install again' : a.update ? 'Update' : 'Install'} “${a.name}” (${fmtBytes(a.size)})? ${what}`, a.update ? 'Update' : 'Install'))) continue;
    setStatus(`Downloading ${a.name}…`);
    const done = await shardsCall('install', { id: a.id });
    setStatus(done ? (done.ok ? done.message : done.error) : '', Boolean(done && !done.ok));
    const again = await shardsCall('catalog', {});
    if (again && again.ok) r = again;
  }
}

// Things in your library that aren't in this page yet.
function libraryChoices(into) {
  const have = new Set(((data.folders[into] || {}).tiles || []).map((t) => t.id));
  const rowTiles = (tabId, rowId) => ((data.tabs[tabId] || []).find((r) => r.id === rowId) || {}).tiles || [];
  const things = [...rowTiles('library', '_all_games'), ...rowTiles('apps', '_all_apps')];
  const folders = Object.entries(data.folders)
    .filter(([id]) => id !== '_home')
    .map(([id, f]) => ({ id, title: f.title, kind: 'folder' }));
  return [...things, ...folders].filter((t) => t.id !== into && !have.has(t.id));
}

async function flowAddExisting(into) {
  const choices = libraryChoices(into);
  const items = [{ label: 'Add selected', op: 'confirm' }];
  choices.forEach((t) =>
    items.push({ label: t.title, sub: { folder: 'Folder', app: 'App', game: 'Game' }[t.kind], checked: false, id: t.id })
  );
  openList({
    title: 'Add to this page',
    items,
    multi: true,
    onChoose: async (it) => {
      if (it.op !== 'confirm') {
        it.checked = !it.checked;
        return;
      }
      const ids = items.filter((x) => x.checked).map((x) => x.id);
      closeModal();
      let n = 0;
      let last = null;
      for (const id of ids) {
        last = await lib('addEntry', { catId: into, ref: id });
        if (last.ok) n++;
      }
      if (ids.length) setStatus(n ? `Added ${n}.` : last.error, !n);
    },
    onBack: () => closeModal(),
  });
}

// A new mosaic gets its own tab and opens straight away. A new folder
// (parent given) lives inside that page.
async function flowNewMosaic({ parent } = {}) {
  const title = await ask(parent ? 'Name your folder' : `Name your ${TERM}`);
  if (title === null) return;
  const r = await lib('newCategory', parent ? { title, parentId: parent } : { title });
  if (r.ok && r.id && !parent) {
    page = hoverId = 'm:' + r.id;
    stack = [];
    focus = 'content';
    render();
  }
}

function openMenu() {
  if (suspended || busy || modal || focus !== 'content') return;
  const t = selectedTile();
  const row = selectedRow();
  const catRow = Boolean(row) && Boolean(data.folders[row.id]);
  const renamable = catRow && row.id !== '_home';
  const inFolder = stack.length > 0;
  const items = [];
  const isThing = t && (t.kind === 'game' || t.kind === 'app' || t.kind === 'folder');
  if (isThing) {
    items.push({ label: `Add to a ${TERM} or folder…`, op: 'addTo' });
    if (catRow) items.push({ label: 'Remove from this page', op: 'removeFromRow' });
    if (t.kind === 'folder') {
      items.push({ label: 'Rename this folder…', op: 'renameTile' });
      items.push({ label: 'Delete this folder…', op: 'deleteTile' });
    } else {
      items.push({ label: 'Rename…', op: 'renameItem' });
      items.push({ label: 'Change picture…', op: 'pickArt' });
      if (t.custom) items.push({ label: 'Use the automatic picture', op: 'clearArt' });
      items.push({ label: 'Remove from library…', op: 'deleteItem' });
      if (t.deletable) items.push({ label: 'Delete the files…', op: 'deleteFiles' });
    }
  } else if (t && t.kind === 'inlay') {
    if (!t.missing) items.push({ label: t.resizable ? 'Move / resize…' : 'Move…', op: 'resize' });
    if (catRow) items.push({ label: 'Remove this widget', op: 'removeFromRow' });
  }
  if (homeMode()) items.push({ label: 'Add a widget…', op: 'addWidget' });
  if (renamable) {
    items.push({ label: inFolder ? 'Rename the open folder…' : `Rename this ${TERM}…`, op: 'renameRow' });
    items.push({ label: inFolder ? 'Delete the open folder…' : `Delete this ${TERM}…`, op: 'deleteRow' });
  }
  if (catRow) items.push({ label: 'New folder here…', op: 'newFolder' });
  if (layoutCfg().mode !== 'rails' && !homeMode()) {
    const lc = layoutCfg();
    items.push({ label: 'Grid size for this page…', sub: `${lc.cols} × ${lc.rows}${(prefs.pageGrid || {})[curKey()] ? ' (this page)' : ' (from Theme Settings)'}`, op: 'pageGrid' });
  }
  items.push({ label: `New ${TERM}…`, op: 'newCat' });
  items.push({ label: 'Add a game from a file…', op: 'addGame' });
  items.push({ label: 'Add an app from a file…', op: 'addApp' });
  items.push({ label: 'Scan for games', op: 'scan' });
  pick('Options', items).then((it) => it && runMenu(it.op, t, row));
}

const PIN_OPS = new Set(['addGame', 'addApp', 'scan', 'addWidget', 'deleteItem', 'deleteTile', 'deleteRow', 'deleteFiles', 'removeFromRow']);
async function runMenu(op, t, row) {
  if (PIN_OPS.has(op) && !(await requirePin())) return;
  const into = row && data.folders[row.id] ? row.id : undefined;
  switch (op) {
    case 'addWidget': return flowAddInlay('_home');
    case 'pageGrid': return flowPageGrid();
    case 'addTo': return flowAddTo(t, row);
    case 'resize': return flowPlaceExisting(t);
    case 'removeFromRow': return lib('removeEntry', { catId: row.id, ref: t.id });
    case 'renameTile': return flowRename('renameCategory', t.id, t.title);
    case 'renameItem': return flowRename('renameItem', t.id, t.title);
    case 'pickArt': return flowBrowse('pickArt', undefined, undefined, t.id);
    case 'clearArt': return lib('clearArt', { id: t.id });
    case 'deleteTile':
      if (await confirm(`Delete “${t.title}”?`, 'Delete (things inside are kept)'))
        return lib('deleteCategory', { id: t.id });
      return;
    case 'deleteItem':
      if (await confirm(`Remove “${t.title}” from your library?`, 'Remove (files are not touched)'))
        return lib('deleteItem', { id: t.id });
      return;
    case 'deleteFiles':
      if (await confirm(`Delete “${t.title}” and its files from your Tessera folder? This can't be undone.`, 'Delete files'))
        return lib('deleteFiles', { id: t.id });
      return;
    case 'renameRow': return flowRename('renameCategory', row.id, row.title);
    case 'deleteRow':
      if (await confirm(`Delete “${row.title}”?`, 'Delete (your games and apps are kept)'))
        return lib('deleteCategory', { id: row.id });
      return;
    case 'newFolder': return flowNewMosaic({ parent: into });
    case 'newCat': return flowNewMosaic({});
    case 'addGame': return flowBrowse('addGame', undefined, into);
    case 'addApp': return flowBrowse('addApp', undefined, into);
    case 'scan': return flowScan(into);
  }
}

// Rows and columns for this page only. Rails, grid and flow stay a Theme Settings choice for everything.
async function flowPageGrid() {
  const key = curKey();
  const lc = layoutCfg();
  const has = Boolean((prefs.pageGrid || {})[key]);
  const save = async (payload) => {
    busy = true;
    try {
      const r = await api.settings('pageGridSet', { key, ...payload });
      if (r && r.prefs) applyPrefs(r.prefs);
      else if (r && !r.ok) setStatus('That size isn\'t allowed.', true);
    } finally { busy = false; }
    sizeGrid();
    render();
  };
  const presets = [[3, 2], [4, 2], [5, 3], [6, 3], [6, 4], [8, 4]];
  const items = [
    { label: 'Use the Theme Settings size', sub: has ? 'for this page' : 'current', reset: true, plain: true },
    ...presets.map(([c, r]) => ({ label: `${c} × ${r}`, sub: has && lc.cols === c && lc.rows === r ? 'current' : '', c, r, plain: true })),
    { label: 'Custom…', sub: 'pick columns and rows', custom: true, plain: true },
  ];
  const it = await pick('Grid size for this page (columns × rows)', items);
  if (!it) return;
  if (it.reset) return save({});
  if (it.custom) {
    const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const cp = await pick('Columns', range(2, 12).map((v) => ({ label: String(v), sub: v === lc.cols ? 'current' : '', v, plain: true })), Math.max(0, lc.cols - 2));
    if (!cp) return;
    const rp = await pick('Rows on screen', range(1, 8).map((v) => ({ label: String(v), sub: v === lc.rows ? 'current' : '', v, plain: true })), Math.max(0, lc.rows - 1));
    if (!rp) return;
    return save({ cols: cp.v, rows: rp.v });
  }
  return save({ cols: it.c, rows: it.r });
}

async function flowRename(op, id, current) {
  const text = await ask('Rename', current);
  if (text !== null) await lib(op, { id, title: text });
}

async function flowAddTo(t, row) {
  const targets = Object.entries(data.folders)
    .filter(([id]) => id !== t.id && !(row && id === row.id))
    .map(([id, f]) => ({ label: f.title, id }));
  if (!targets.length) return setStatus(`Make a ${TERM} first (the + ${Term} tab).`, true);
  const choice = await pick(`Add “${t.title}” to…`, targets);
  if (choice) await lib('addEntry', { catId: choice.id, ref: t.id });
}

// Browse the file system through main. We only ever say "enter entry N".
async function flowBrowse(purpose, after, into, item) {
  busy = true;
  let r;
  try { r = await api.browse('start', { purpose, into, item }); } finally { busy = false; }
  showBrowse(r, purpose, after);
}
function showBrowse(r, purpose, after) {
  if (!r || r.error) {
    closeModal();
    setStatus((r && r.error) || 'Could not open that.', true);
    return after && after();
  }
  const items = [];
  if (r.canUp) items.push({ label: '⬆  Up one level', op: 'up' });
  if (r.canChooseHere) items.push({ label: purpose === 'backupTo' ? '✔  Save the backup in this folder' : purpose === 'restoreFrom' ? '✔  Restore from this folder' : '✔  Use this folder', op: 'here' });
  r.entries.forEach((e, i) =>
    items.push({ label: e.isDir && !r.renamable ? e.name + '/' : e.name, sub: e.sub, key: e.key, op: e.isDir ? 'enter' : 'choose', i })
  );
  const go = async (op, payload) => {
    busy = true;
    let res;
    try { res = await api.browse(op, payload); } finally { busy = false; }
    return res;
  };
  openList({
    title: r.crumb + (r.truncated ? '  (first 500 shown)' : ''),
    items,
    index: r.canUp ? (r.entries.length ? 1 + Number(Boolean(r.canChooseHere)) : 0) : 0,
    onChoose: async (it) => {
      if (it.op === 'up') return showBrowse(await go('up'), purpose, after);
      if (it.op === 'enter') return showBrowse(await go('enter', { index: it.i }), purpose, after);
      const res = await go('choose', { index: it.op === 'here' ? -1 : it.i });
      if (res.error) return setStatus(res.error, true);
      closeModal();
      if (res.view) applyView(res.view);
      if (res.theme) applyTheme(res.theme);
      setStatus(res.message);
      if (after) after();
    },
    // Y on a drive: give it a name you'd actually say.
    onY: r.renamable
      ? async (it) => {
          if (!it || !it.key) return;
          await renameDrive(it.key, '');
          showBrowse(await go('refresh'), purpose, after);
        }
      : undefined,
    onBack: async () => {
      if (r.canUp) return showBrowse(await go('up'), purpose, after);
      await go('close');
      closeModal();
      if (after) after();
    },
  });
}

async function renameDrive(key, current) {
  const name = await ask('Name this drive (empty = automatic name)', current || '');
  if (name === null) return false;
  busy = true;
  try { await api.settings('driveName', { key, name }); } finally { busy = false; }
  return true;
}

// Settings → Library folders → Name your drives.
async function flowDrives() {
  let index = 0;
  for (;;) {
    busy = true;
    let r;
    try { r = await api.settings('drives'); } finally { busy = false; }
    const items = r.drives.map((d) => ({ label: d.name, sub: d.tech, key: d.key, custom: d.custom }));
    if (!items.length) items.push({ label: 'No extra drives found', sub: 'Plug one in and open this again', header: true });
    const it = await pick('Your drives · A to rename', items, index);
    if (!it) return;
    if (!it.key) continue;
    index = items.indexOf(it);
    await renameDrive(it.key, it.custom ? it.label : '');
  }
}

async function flowRoots(backTo) {
  busy = true;
  let r;
  try { r = await api.settings('get'); } finally { busy = false; }
  const items = [{ label: '+  Add a folder…', op: 'add' }, { label: '✎  Name your drives…', op: 'drives' }];
  r.roots.forEach((p, i) => items.push({ label: p.name, sub: p.tech || 'A to remove', op: 'rm', i }));
  const it = await pick('Library folders (scanned for games)', items);
  if (!it) return backTo ? backTo() : undefined;
  if (it.op === 'add') return flowBrowse('addRoot', () => flowRoots(backTo));
  if (it.op === 'drives') { await flowDrives(); return flowRoots(backTo); }
  if (await confirm(`Stop scanning ${it.label}?`, 'Remove from list (files are not touched)')) {
    busy = true;
    try { await api.settings('removeRoot', { index: it.i }); } finally { busy = false; }
  }
  flowRoots(backTo);
}
