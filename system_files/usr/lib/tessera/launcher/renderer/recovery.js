// SPDX-License-Identifier: GPL-3.0-or-later
// Recover (on the Tessera USB): a Tessera on this computer that won't start. Finds it, says what looks
// wrong, and offers the repairs; each repair asks for the password of an administrator of that
// Tessera. The work is done in the main process (main/recovery.js) by the USB's root helper.

const RECOVERY_TOOLS = {
  signin: { label: 'Start in Tessera at boot again', sub: 'for a computer stuck at a login or text screen' },
  pin: { label: 'Remove the admin PIN', sub: 'for a forgotten PIN; set a new one in Settings' },
  shards: { label: 'Turn off all shards', sub: 'in case an add-on stops Tessera from starting' },
};

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
    items.push({ label: 'More', header: true });
    items.push({ label: 'Make a problem report', sub: 'saved in its Tessera folder; read it first', op: 'report', plain: true });
    items.push({ label: 'Done', sub: 'restart without the USB to try it', op: 'done', plain: true });
    const it = await pick('Recover', items, index, { body });
    if (!it || it.op === 'done') return;
    index = items.indexOf(it);
    if (it.op === 'report') await recoveryReport(inst);
    else if (it.op === 'fix') await recoveryFix(inst, it.tool);
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

async function recoveryFix(inst, tool) {
  const admins = inst.users.filter((u) => u.admin);
  if (!admins.length) return void (await pick('No administrator', [{ label: 'OK', plain: true }], 0, { body: "This Tessera has no administrator account, so its repairs can't be confirmed." }));
  let user = admins[0].name;
  if (admins.length > 1) {
    const it = await pick('Whose password?', admins.map((u) => ({ label: u.name, user: u.name })), 0, { body: 'Repairs need the password of an administrator account of this Tessera.' });
    if (!it) return;
    user = it.user;
  }
  const t = RECOVERY_TOOLS[tool];
  for (;;) {
    const password = await ask(`Password for ${user}`, '', { secret: true, max: 128 });
    if (password === null || password === '') return;
    setStatus(`${t.label}…`);
    busy = true;
    let r;
    try { r = await api.recovery('fix', { id: inst.id, tool, user, password }); } finally { busy = false; setStatus(''); }
    if (r && r.ok) return void (await pick('Done', [{ label: 'OK', plain: true }], 0, { body: `${t.label}:\n${(r.done || []).map((x) => `• ${x}`).join('\n')}\n\nRestart without the USB to see if Tessera starts.` }));
    const again = await pick(r && r.needPassword ? 'Wrong password' : "Didn't work", [{ label: r && r.needPassword ? 'Try again' : 'OK', op: 'again', plain: true }, { label: 'Cancel', plain: true }], 0, { body: (r && r.error) || 'Something went wrong.' });
    if (!again || again.op !== 'again' || !(r && r.needPassword)) return;
  }
}
