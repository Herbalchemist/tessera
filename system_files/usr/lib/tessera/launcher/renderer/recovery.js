// SPDX-License-Identifier: GPL-3.0-or-later
// Recover (on the Tessera USB): a Tessera on this computer that won't start. Finds it, says what looks
// wrong, and offers the repairs; each repair asks for the password of an administrator of that
// Tessera. The work is done in the main process (main/recovery.js) by the USB's root helper.

const RECOVERY_TOOLS = {
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
  const end = await recoveryBackupProgress();
  if (end.phase === 'done') {
    await pick('Backed up', [{ label: 'OK', plain: true }], 0, { body: `${end.copied || 0} files copied to the folder "${end.folder}" on ${end.drive}.${end.skipped ? `\n\n${end.skipped} couldn't be copied; they're listed in "not copied.txt" in that folder.` : ''}\n\nWait for this screen before unplugging the drive. It's done now.` });
  } else if (end.phase === 'canceled') {
    await pick('Stopped', [{ label: 'OK', plain: true }], 0, { body: 'The backup was stopped. What was copied so far is on the drive.' });
  } else {
    await pick("Backup didn't finish", [{ label: 'OK', plain: true }], 0, { body: end.error || 'Something went wrong.' });
  }
}

function recoveryBackupProgress() {
  return new Promise((resolve) => {
    let st = { done: 0, total: 0, line: '' };
    const t0 = Date.now();
    const pc = () => (st.total ? Math.min(100, Math.floor((st.done / st.total) * 100)) : 0);
    const bar = (p) => { const n = Math.round(p / 5); return '▰'.repeat(n) + '▱'.repeat(20 - n); };
    const body = () => [`Copying · ${pc()}% · ${fmtClock(Math.round((Date.now() - t0) / 1000))}`, bar(pc()), st.total ? `${fmtBackupSize(st.done)} of ${fmtBackupSize(st.total)}` : 'Counting what to copy…', 'Keep the drive plugged in. B stops the backup.', st.line ? `\n${st.line}` : ''].filter(Boolean).join('\n');
    const row = () => [{ label: 'Backing up', sub: `${pc()}%`, info: true, plain: true }];
    let stopping = false;
    const onBack = async () => {
      if (stopping) return;
      stopping = true;
      await api.recovery('cancel', {});
    };
    openList({ title: 'Backing up', items: row(), index: 0, body: body(), onChoose: () => {}, onBack });
    const m = modal;
    let lost = 0;
    (async () => {
      for (;;) {
        await sleep(1000);
        let q = null;
        try { q = await api.recovery('state', {}); } catch { /* try again */ }
        if (!q || !q.ok) { if (++lost > 30) return resolve({ phase: 'error', error: 'Lost touch with the backup.' }); continue; }
        lost = 0;
        if (['done', 'error', 'canceled'].includes(q.phase)) { if (modal === m) closeModal(); return resolve(q); }
        if (q.phase === 'copying') st = q;
        if (modal === m) { m.body = body(); m.items = row(); renderModal(); }
      }
    })();
  });
}
