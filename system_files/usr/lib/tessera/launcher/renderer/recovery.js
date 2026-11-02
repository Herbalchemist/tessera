// SPDX-License-Identifier: GPL-3.0-or-later
// Recover (on the Tessera USB): a Tessera on this computer that won't start. Finds it, says what looks
// wrong, and offers the repairs; each repair asks for the password of an administrator of that
// Tessera. The work is done in the main process (main/recovery.js) by the USB's root helper.

const RECOVERY_TOOLS = {
  boot: { label: 'Repair the boot menu', sub: 'when Windows starts instead, or start-up stops at "grub>" or a black screen' },
  signin: { label: 'Start in Tessera at boot again', sub: 'for a computer stuck at a login or text screen' },
  pin: { label: 'Remove the admin PIN', sub: 'for a forgotten PIN; set a new one in Settings' },
  shards: { label: 'Turn off all shards', sub: 'in case an add-on stops Tessera from starting' },
};

const fmtBackupSize = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} KB`);

function recoveryPlace(inst) {
  const d = inst.disk || {};
  return [d.model || d.name || 'a disk', d.size ? fmtSize(d.size) : ''].filter(Boolean).join(' · ');
}

async function flowRecovery() {
  if (busy) return;
  setStatus('Looking for Tessera on this computer…');
  busy = true;
  let r;
  try { r = await api.recovery('probe', {}); } finally { busy = false; setStatus(''); }
  if (!r || !r.ok) return void (await pick("Can't look", [{ label: 'OK', plain: true }], 0, { body: (r && r.error) || "Couldn't look at this computer's disks." }));
  if (!r.installs.length) return void (await pick('No Tessera here', [{ label: 'OK', plain: true }], 0, { body: "No installed Tessera was found on this computer's disks (the USB itself is never counted). To put Tessera on it, choose Install Tessera." }));
  let inst = r.installs[0];
  if (r.installs.length > 1) {
    const it = await pick('Which Tessera?', r.installs.map((x) => ({ label: `Tessera on ${recoveryPlace(x)}`, sub: x.versions[0] ? `version ${x.versions[0].version}` : '', inst: x })));
    if (!it) return;
    inst = it.inst;
  }
  return recoveryMenu(inst);
}

async function recoveryMenu(inst) {
  let index = 0;
  for (;;) {
    setStatus('Looking at what went wrong…');
    busy = true;
    let d;
    try { d = await api.recovery('diagnose', { id: inst.id }); } finally { busy = false; setStatus(''); }
    if (!d || !d.ok) return void (await pick("Can't look", [{ label: 'OK', plain: true }], 0, { body: (d && d.error) || "Couldn't look at that Tessera." }));
    const findings = d.findings || [];
    const suggested = new Set(findings.map((f) => f.fix).filter(Boolean));
    const body = [
      `Tessera on ${recoveryPlace(inst)}${inst.versions[0] ? `, version ${inst.versions[0].version}` : ''}.`,
      findings.length ? findings.map((f) => `• ${f.text}`).join('\n') : 'Nothing obviously wrong was found. A problem report can still help.',
    ].join('\n\n');
    const items = [{ label: 'Repairs', header: true }];
    for (const [tool, t] of Object.entries(RECOVERY_TOOLS)) items.push({ label: t.label, sub: suggested.has(tool) ? 'suggested' : t.sub, op: 'fix', tool, ok: suggested.has(tool), plain: !suggested.has(tool) });
    if (inst.versions.length) items.push({ label: 'Versions', sub: inst.versions.length > 1 ? `${inst.versions.length} kept: start another, keep one for good` : 'keep this one for good', op: 'versions', plain: true });
    const gfxWrong = findings.some((f) => f.key === 'graphics');
    items.push({ label: 'Graphics and how it starts', sub: gfxWrong ? 'suggested: the wrong build for this graphics card' : 'safe settings, the login screen or a repair console, next start only', op: 'graphics', gfx: d.graphics || {}, ok: gfxWrong, plain: !gfxWrong });
    const diskWorry = findings.some((f) => f.key === 'fs');
    items.push({ label: 'Check the disk', sub: diskWorry ? 'suggested: errors were recorded' : 'the drive\'s health and every file system; read-only', op: 'check', ok: diskWorry, plain: !diskWorry });
    items.push({ label: 'Free up space', sub: suggested.has('clean') ? 'suggested: the disk is nearly full' : 'see what uses the disk; clear caches and the trash', op: 'space', ok: suggested.has('clean'), plain: !suggested.has('clean') });
    items.push({ label: 'Back up to a USB drive', sub: 'copy a home folder off this computer first', op: 'backup', plain: true });
    items.push({ label: 'More', header: true });
    items.push({ label: 'Make a problem report', sub: 'saved in its Tessera folder; read it first', op: 'report', plain: true });
    items.push({ label: 'Done', sub: 'restart without the USB to try it', op: 'done', plain: true });
    const it = await pick('Recover', items, index, { body });
    if (!it || it.op === 'done') return;
    index = items.indexOf(it);
    if (it.op === 'versions') { const fresh = await recoveryVersions(inst); if (fresh) inst = fresh; } else if (it.op === 'report') await recoveryReport(inst);
    else if (it.op === 'fix') await recoveryFix(inst, it.tool);
    else if (it.op === 'backup') await recoveryBackup(inst);
    else if (it.op === 'space') await recoverySpace(inst);
    else if (it.op === 'check') await recoveryCheck(inst);
    else if (it.op === 'graphics') await recoveryGraphics(inst, it.gfx);
  }
}

async function recoveryReport(inst) {
  setStatus('Making the report…');
  busy = true;
  let r;
  try { r = await api.recovery('report', { id: inst.id }); } finally { busy = false; setStatus(''); }
  if (!r || !r.ok) return void (await pick("Couldn't make it", [{ label: 'OK', plain: true }], 0, { body: (r && r.error) || 'The report could not be made.' }));
  const lines = r.text.split('\n').slice(0, 900);
  await pick(r.saved ? `Saved: ${r.saved}` : 'Report (not saved)', lines.map((l) => (/^== /.test(l) ? { label: l.slice(3), header: true } : { label: l || ' ', plain: true, info: true })));
}

// Versions: the system versions this Tessera keeps (newest first). Start another by default (to undo
// an update that broke something), or keep one for good so updates never remove it.
async function recoveryVersions(inst) {
  const vs = inst.versions;
  const vit = await pick('Versions', vs.map((v, i) => ({
    label: v.version ? `Version ${v.version}` : `Version ${i + 1}`,
    sub: [i === 0 ? 'starts by default' : i === 1 ? 'before the last update' : 'older', v.kept ? 'kept for good' : ''].filter(Boolean).join(' · '),
    v, i,
  })), 0, { body: 'Tessera keeps the version before each update, so a bad update can be undone. Keeping one for good means updates never remove it.' });
  if (!vit) return null;
  const actions = [];
  if (vit.i !== 0) actions.push({ label: 'Start this version by default', sub: vit.i === 1 ? 'undoes the last update' : '', action: 'default', ok: true });
  actions.push(vit.v.kept ? { label: 'Stop keeping it for good', action: 'unkeep', plain: true } : { label: 'Keep it for good', sub: 'updates never remove it', action: 'keep', plain: true });
  const a = await pick(vit.label, actions);
  if (!a) return null;
  const ok = await recoveryFix(inst, 'version', { action: a.action, index: vit.v.index }, a.label);
  if (!ok) return null;
  const r = await api.recovery('probe', {});
  return (r && r.ok && r.installs.find((x) => x.id === inst.id)) || null;
}

// Which administrator confirms a change (null: none, or the choice was cancelled).
async function recoveryAdmin(inst) {
  const admins = inst.users.filter((u) => u.admin);
  if (!admins.length) { await pick('No administrator', [{ label: 'OK', plain: true }], 0, { body: "This Tessera has no administrator account, so changes to it can't be confirmed." }); return null; }
  if (admins.length === 1) return admins[0].name;
  const it = await pick('Whose password?', admins.map((u) => ({ label: u.name, user: u.name })), 0, { body: 'Changes need the password of an administrator account of this Tessera.' });
  return it ? it.user : null;
}

// Asks for the password and sends the request until it works, the password is right but the request
// failed, or the person cancels. Returns the helper's answer (ok) or null.
async function recoveryWithPassword(user, status, send) {
  for (;;) {
    const password = await ask(`Password for ${user}`, '', { secret: true, max: 128 });
    if (password === null || password === '') return null;
    setStatus(status);
    busy = true;
    let r;
    try { r = await send(password); } finally { busy = false; setStatus(''); }
    if (r && r.ok) return r;
    const again = await pick(r && r.needPassword ? 'Wrong password' : "Didn't work", [{ label: r && r.needPassword ? 'Try again' : 'OK', op: 'again', plain: true }, { label: 'Cancel', plain: true }], 0, { body: (r && r.error) || 'Something went wrong.' });
    if (!again || again.op !== 'again' || !(r && r.needPassword)) return null;
  }
}

async function recoveryFix(inst, tool, extra = {}, title = '') {
  const user = await recoveryAdmin(inst);
  if (!user) return false;
  const t = RECOVERY_TOOLS[tool] || { label: title || 'Change' };
  const r = await recoveryWithPassword(user, `${t.label}…`, (password) => api.recovery('fix', { id: inst.id, tool, user, password, ...extra }));
  if (!r) return false;
  await pick('Done', [{ label: 'OK', plain: true }], 0, { body: `${t.label}:\n${(r.done || []).map((x) => `• ${x}`).join('\n')}\n\nRestart without the USB to see if Tessera starts.` });
  return true;
}

// Graphics and how it starts: switch to the build for this machine's graphics card (done at the next
// start, once online), or choose how the next start goes (safe settings, the login screen, a text
// repair console); the start after that is normal again.
const GFX_NAMES = { standard: 'AMD / Intel', nvidia: 'NVIDIA GTX 900-1000', 'nvidia-open': 'NVIDIA GTX 16 / RTX' };
async function recoveryGraphics(inst, g) {
  const items = [];
  const wrong = g.have && g.want && g.have !== g.want;
  if (wrong) items.push({ label: `Switch to the ${GFX_NAMES[g.want]} build`, sub: 'at the next start, once online; games and saves stay', action: 'switch', to: g.want, ok: true });
  items.push({ label: 'Next start: safe settings', sub: 'no display calibration, no shards', action: 'safe', plain: wrong, ok: !wrong });
  items.push({ label: 'Next start: the login screen', sub: 'Desktop Mode, with the password', action: 'desktop', plain: true });
  items.push({ label: 'Next start: a repair console', sub: 'text only, for experts', action: 'console', plain: true });
  const body = [
    g.cards && g.cards.length ? `Graphics in this computer: ${g.cards.join(', ')}.` : '',
    g.have ? `This Tessera is the ${GFX_NAMES[g.have] || g.have} build${wrong ? `; these graphics need the ${GFX_NAMES[g.want]} build.` : '.'}` : '',
    'Each choice is for the next start only.',
  ].filter(Boolean).join('\n');
  const it = await pick('Graphics and how it starts', items, 0, { body });
  if (!it) return;
  await recoveryFix(inst, 'graphics', { action: it.action, ...(it.to ? { to: it.to } : {}) }, it.label);
}

// Check the disk: the drive's own health report, the start-up and boot partitions, and every block
// of the main file system (read-only). If something is wrong, Repair runs only the repairs that are
// safe unattended, after an administrator's password, and names files that couldn't be saved.
async function recoveryCheck(inst) {
  setStatus('Starting the check…');
  busy = true;
  let r;
  try { r = await api.recovery('check', { id: inst.id }); } finally { busy = false; setStatus(''); }
  if (!r || !r.ok) return void (await pick("Can't check", [{ label: 'OK', plain: true }], 0, { body: (r && r.error) || 'The check could not start.' }));
  let end = await recoveryJobProgress('Checking the disk', 'check');
  if (end.phase === 'done' && !end.healthy) {
    const it = await pick('Problems found', [
      { label: 'Repair', sub: 'only repairs that are safe to run on their own', op: 'repair', ok: true },
      { label: 'Not now', plain: true },
    ], 0, { body: recoveryCheckBody(end) + '\n\nBack up first if you can (Back up to a USB drive).' });
    if (!it || it.op !== 'repair') return;
    const user = await recoveryAdmin(inst);
    if (!user) return;
    if (!(await recoveryWithPassword(user, 'Starting the repair…', (password) => api.recovery('check', { id: inst.id, repair: true, user, password })))) return;
    end = await recoveryJobProgress('Repairing the disk', 'check');
  }
  if (end.phase === 'done') await pick(end.healthy ? (end.repair ? 'Repaired' : 'No problems found') : "Some problems remain", [{ label: 'OK', plain: true }], 0, { body: recoveryCheckBody(end) });
  else if (end.phase === 'canceled') await pick('Stopped', [{ label: 'OK', plain: true }], 0, { body: 'The check was stopped. Nothing was changed by stopping it.' });
  else await pick("The check didn't finish", [{ label: 'OK', plain: true }], 0, { body: end.error || 'Something went wrong.' });
}

function recoveryCheckBody(end) {
  const lines = (end.results || []).map((x) => `${x.ok === false ? '✗' : x.ok ? '✓' : '•'} ${x.text}`);
  const files = end.files || [];
  if (files.length) lines.push('', `Damaged file${files.length === 1 ? '' : 's'}:`, ...files.slice(0, 12).map((f) => `  ${f}`), files.length > 12 ? `  and ${files.length - 12} more` : '');
  return lines.filter((l, i, a) => l !== '' || i < a.length - 1).join('\n');
}

// Follows a long job of the helper's (a backup or a disk check) until it ends; B stops it.
function recoveryJobProgress(title, job) {
  return new Promise((resolve) => {
    let st = { job, done: 0, total: 0, line: job === 'check' ? 'Starting' : '' };
    const t0 = Date.now();
    const pc = () => (st.total ? Math.min(100, Math.floor((st.done / st.total) * 100)) : 0);
    const bar = (p) => { const n = Math.round(p / 5); return '▰'.repeat(n) + '▱'.repeat(20 - n); };
    const body = () => {
      const head = st.job === 'check' ? `Step ${st.step || 1} of ${st.steps || 4}: ${st.line || ''}` : `Copying · ${pc()}%`;
      const size = st.total ? `${fmtBackupSize(st.done)} of ${fmtBackupSize(st.total)}` : (st.job === 'check' ? '' : 'Counting what to copy…');
      return [`${head} · ${fmtClock(Math.round((Date.now() - t0) / 1000))}`, st.total ? bar(pc()) : '', size,
        st.job === 'check' ? 'Reading every block can take a while on a big disk. B stops it.' : 'Keep the drive plugged in. B stops the backup.',
        st.job !== 'check' && st.line ? `\n${st.line}` : ''].filter(Boolean).join('\n');
    };
    const row = () => [{ label: title, sub: st.total ? `${pc()}%` : '', info: true, plain: true }];
    let stopping = false;
    const onBack = async () => { if (!stopping) { stopping = true; await api.recovery('cancel', {}); } };
    openList({ title, items: row(), index: 0, body: body(), onChoose: () => {}, onBack });
    const m = modal;
    let lost = 0;
    (async () => {
      for (;;) {
        await sleep(1000);
        let q = null;
        try { q = await api.recovery('state', {}); } catch { /* try again */ }
        if (!q || !q.ok) { if (++lost > 30) return resolve({ phase: 'error', error: 'Lost touch with the recovery tools.' }); continue; }
        lost = 0;
        if (['done', 'error', 'canceled'].includes(q.phase)) { if (modal === m) closeModal(); return resolve(q); }
        if (q.phase === 'copying' || q.phase === 'checking') st = q;
        if (modal === m) { m.body = body(); m.items = row(); renderModal(); }
      }
    })();
  });
}

// Free up space: what uses the disk, per person, and clearing what comes back by itself (caches,
// shader caches) or was thrown away (the trash). Games and files are never deleted here.
async function recoverySpace(inst) {
  setStatus('Measuring what uses the disk…');
  busy = true;
  let u;
  try { u = await api.recovery('space', { id: inst.id }); } finally { busy = false; setStatus(''); }
  if (!u || !u.ok) return void (await pick("Can't look", [{ label: 'OK', plain: true }], 0, { body: (u && u.error) || "Couldn't measure the disk." }));
  const sum = (k) => u.people.reduce((n, x) => n + (x[k] || 0), 0);
  const lines = u.people.map((x) => `• ${x.name}: ${fmtBackupSize(x.home)} (games ${fmtBackupSize(x.games)}, caches ${fmtBackupSize(x.caches + x.shaders)}, trash ${fmtBackupSize(x.trash)})`);
  const body = [`${fmtBackupSize(u.free)} free of ${fmtBackupSize(u.total)}.`, lines.join('\n'), `The system keeps ${u.versions} version${u.versions === 1 ? '' : 's'} (see Versions). Games can be uninstalled from Steam once Tessera starts.`].filter(Boolean).join('\n\n');
  const all = ['caches', 'shaders', 'trash'];
  const it = await pick('Free up space', [
    { label: 'Clear all three', sub: fmtBackupSize(sum('caches') + sum('shaders') + sum('trash')), what: all, ok: true },
    { label: 'Clear caches', sub: `${fmtBackupSize(sum('caches'))} · made again as needed`, what: ['caches'], plain: true },
    { label: 'Clear shader caches', sub: `${fmtBackupSize(sum('shaders'))} · games rebuild them (first starts are slower)`, what: ['shaders'], plain: true },
    { label: 'Empty the trash', sub: fmtBackupSize(sum('trash')), what: ['trash'], plain: true },
  ], 0, { body });
  if (!it) return;
  await recoveryFix(inst, 'clean', { what: it.what }, it.label);
}

// Back up to a USB drive: one person's home folder, copied in the background with progress. "My
// files" leaves out what can be downloaded again (installed Steam games, caches); game saves stay.
async function recoveryBackup(inst) {
  const people = inst.users;
  if (!people.length) return void (await pick('Nothing to back up', [{ label: 'OK', plain: true }], 0, { body: 'No home folders were found on this Tessera.' }));
  let who = people[0].name;
  if (people.length > 1) {
    const it = await pick('Whose files?', people.map((u) => ({ label: u.name, sub: u.admin ? 'administrator' : '', who: u.name })));
    if (!it) return;
    who = it.who;
  }
  let drive;
  for (;;) {
    setStatus('Looking for USB drives…');
    busy = true;
    let d;
    try { d = await api.recovery('drives', {}); } finally { busy = false; setStatus(''); }
    const list = (d && d.ok && d.drives) || [];
    const items = list.map((x) => ({ label: x.label || x.model || 'USB drive', sub: [`${fmtBackupSize(x.free)} free of ${fmtBackupSize(x.size)}`, x.fstype === 'vfat' ? 'FAT: no files over 4 GB' : ''].filter(Boolean).join(' · '), drive: x, ok: true }));
    items.push({ label: 'Look again', sub: 'after plugging one in', op: 'again', plain: true });
    const it = await pick('Which USB drive?', items, 0, { body: list.length ? 'The backup goes in a new folder on it; nothing already there is changed.' : 'Plug in a USB drive (not this Tessera USB), then choose Look again.' });
    if (!it) return;
    if (it.drive) { drive = it.drive; break; }
  }
  const what = await pick('What to copy', [
    { label: 'My files', sub: 'everything but installed games and caches; game saves are kept', what: 'mine', ok: true },
    { label: 'Everything', sub: 'installed games too (can be very large)', what: 'all', plain: true },
  ]);
  if (!what) return;
  const user = await recoveryAdmin(inst);
  if (!user) return;
  const r = await recoveryWithPassword(user, 'Starting the backup…', (password) => api.recovery('backup', { id: inst.id, user, password, who, drive: drive.uuid, what: what.what }));
  if (!r) return;
  const end = await recoveryJobProgress('Backing up', 'backup');
  if (end.phase === 'done') {
    await pick('Backed up', [{ label: 'OK', plain: true }], 0, { body: `${end.copied || 0} files copied to the folder "${end.folder}" on ${end.drive}.${end.skipped ? `\n\n${end.skipped} couldn't be copied; they're listed in "not copied.txt" in that folder.` : ''}\n\nWait for this screen before unplugging the drive. It's done now.` });
  } else if (end.phase === 'canceled') {
    await pick('Stopped', [{ label: 'OK', plain: true }], 0, { body: 'The backup was stopped. What was copied so far is on the drive.' });
  } else {
    await pick("Backup didn't finish", [{ label: 'OK', plain: true }], 0, { body: end.error || 'Something went wrong.' });
  }
}
