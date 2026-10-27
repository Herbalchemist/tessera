// SPDX-License-Identifier: GPL-3.0-or-later
// Install Tessera, on the live USB.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ------------------------------------------------------------ Install Tessera (from the USB)
// On the Tessera USB the launcher starts here instead of the first-run setup. Each step is an ordinary
// menu, so a controller, a keyboard or a mouse all work. The disk work is done by the USB's root helper
// (live-install, through main.js); nothing on the computer changes before "Erase and install".
let installerShown = false;
const isLive = () => Boolean(prefs.live);
const fmtSize = (b) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : `${Math.round(b / 1e9)} GB`);
function installWatch() {
  return new Promise((resolve) => {
    let st = { percent: 0, stage: 'Starting', line: '' };
    const t0 = Date.now();
    // Copying the system takes several minutes and Anaconda says nothing meanwhile, so the bar creeps
    // forward on its own through that stage (never past 80%) instead of looking stuck.
    let shown = 0;
    let copyFrom = 0;
    const pct = () => {
      let p = st.percent || 0;
      if (/^Copying/.test(st.stage || '')) {
        if (!copyFrom) copyFrom = Date.now();
        p = Math.max(p, Math.min(80, p + (Date.now() - copyFrom) / 1000 * 0.13));
      }
      shown = Math.max(shown, Math.round(p));
      return shown;
    };
    const bar = (pc) => { const n = Math.round(pc / 5); return '▰'.repeat(n) + '▱'.repeat(20 - n); };
    const body = () => { const p = pct(); return [`${st.stage || 'Installing'} · ${p}% · ${fmtClock(Math.round((Date.now() - t0) / 1000))}`, bar(p), 'Usually 5 to 15 minutes. Keep the computer on and the USB plugged in.', st.line ? `\n${st.line}` : ''].filter(Boolean).join('\n'); };
    const row = () => [{ label: st.stage || 'Installing', sub: `${shown}%`, info: true, plain: true }];
    openList({ title: 'Installing Tessera', items: row(), index: 0, body: body(), onChoose: () => {}, onBack: () => {} });
    const m = modal;
    let lost = 0;
    (async () => {
      for (;;) {
        await sleep(1000);
        let q = null;
        try { q = await api.installer('poll', {}); } catch { /* try again */ }
        if (!q || !q.ok) { if (++lost > 30) return resolve({ phase: 'error', error: 'Lost touch with the installer.' }); continue; }
        lost = 0;
        if (q.phase === 'done' || q.phase === 'error') return resolve(q);
        if (q.phase === 'running') st = q;
        if (modal === m) { m.body = body(); m.items = row(); renderModal(); }
      }
    })();
  });
}
async function flowInstaller() {
  if (busy) return;
  installerShown = true;
  const first = await pick('Welcome to Tessera', [
    { label: 'Install Tessera', sub: 'on this computer', op: 'install', ok: true },
    { label: 'Try it first', sub: 'nothing is changed', op: 'try', plain: true },
  ], 0, { welcome: true, body: 'This USB installs Tessera, a gaming console for your PC, with no internet needed. You can also try it first: nothing on this computer changes until you choose Erase and install. Settings, and the guide, have Install Tessera whenever you\'re ready.' });
  reveal();
  if (!first || first.op !== 'install') return;
  setStatus('Looking at this computer…');
  busy = true;
  let probe;
  try { probe = await api.installer('probe', {}); } finally { busy = false; setStatus(''); }
  if (!probe || !probe.ok) return void (await pick("Can't install", [{ label: 'OK', plain: true }], 0, { body: (probe && probe.error) || "Couldn't look at this computer." }));
  if (!probe.disks.length) return void (await pick("Can't install", [{ label: 'OK', plain: true }], 0, { body: 'No disk here is big enough. Tessera needs a disk of 64 GB or more (the USB itself is never used).' }));
  if (!probe.available.length) return void (await pick("Can't install", [{ label: 'OK', plain: true }], 0, { body: "This USB doesn't have the Tessera builds on it. Make it again with Mortar." }));
  const names = probe.names || {};
  const online = probe.source === 'online';
  if (online && !probe.online) { // this USB downloads Tessera while installing: get the PC online first
    for (;;) {
      const it = await pick('Connect to the internet', [
        { label: 'Wi-Fi…', sub: 'pick a network', op: 'wifi', ok: true },
        { label: 'Check again', sub: 'after plugging in a cable', op: 'check', plain: true },
        { label: 'Cancel', op: 'cancel', plain: true },
      ], 0, { body: 'This USB is the online installer: it downloads Tessera (about 5 to 6 GB) while it installs. Plug in a network cable, or join Wi-Fi.' });
      if (!it || it.op === 'cancel') return;
      if (it.op === 'wifi' && window.flowWifi) await window.flowWifi();
      setStatus('Checking the connection…');
      const r = await api.installer('online', {});
      setStatus('');
      if (r && r.online) break;
      if (it.op === 'check') await pick('Still offline', [{ label: 'OK', plain: true }], 0, { body: "Tessera's download server can't be reached yet. Check the cable or the Wi-Fi, then try again." });
    }
  }
  const c = { secureBoot: 'auto', timezone: probe.timezones.includes('UTC') ? 'UTC' : probe.timezones[0] };
  let step = 0;
  for (;;) {
    if (step < 0) return;
    if (step === 0) { // the disk
      const it = await pick('Where should Tessera go?', probe.disks.map((d) => ({ label: d.model, sub: [fmtSize(d.size), d.transport ? d.transport.toUpperCase() : '', d.removable ? 'removable' : ''].filter(Boolean).join(' · '), disk: d }))
        , Math.max(0, probe.disks.findIndex((d) => d.path === c.disk)), { body: 'Everything on the disk you pick will be erased, including any other system on it. (Installing next to Windows comes later.)' });
      if (!it) { step--; continue; }
      c.disk = it.disk.path; c.diskLabel = `${it.disk.model} (${fmtSize(it.disk.size)})`; step++; continue;
    }
    if (step === 1) { // the graphics build
      const order = [probe.recommended, ...['standard', 'nvidia', 'nvidia-open'].filter((v) => v !== probe.recommended)].filter((v) => v && probe.available.includes(v));
      const cards = probe.cards.length ? probe.cards.join(' + ') : 'no graphics card was found';
      // A USB made for one PC (Mortar's "Create media for this PC") carries one build; say so if it's the wrong one here.
      const missing = probe.need && !probe.available.includes(probe.need);
      const it = await pick('Graphics', order.map((v) => ({ label: names[v] || v, sub: !missing && v === probe.recommended ? 'Recommended for this computer' : missing ? 'the build on this USB' : '', v })), Math.max(0, order.indexOf(c.variant || probe.recommended)), {
        body: missing
          ? `This computer has ${cards}, which works best with the ${names[probe.need] || probe.need} build, but this USB was made with only the ${probe.available.map((v) => names[v] || v).join(' and ')} build. You can install it anyway and switch builds later in Settings > Update software once the computer is online, or make a Quick install USB with Mortar, which carries every build.`
          : `This computer has ${cards}. Tessera comes in a build for each kind of graphics card; the recommended one is picked for you.${online ? ' It downloads during the install.' : ''} Settings can switch builds later if the card changes.`,
      });
      if (!it) { step--; continue; }
      c.variant = it.v; step++; continue;
    }
    if (step === 2) { // the account
      const full = await ask('Your name', c.fullName || '', { max: 40 });
      if (full === null) { step--; continue; }
      c.fullName = full.trim();
      let user = (c.fullName.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '') || 'player').replace(/^[0-9]+/, '').slice(0, 24) || 'player';
      if (['root', 'liveuser', 'tessera'].includes(user)) user = `${user}1`;
      const u = await pick('Your account', [{ label: `User name: ${user}`, sub: 'used for the desktop and settings', op: 'ok', ok: true }, { label: 'Change the user name', op: 'edit', plain: true }], 0, { body: 'Tessera starts by itself with this account. The password is for Desktop Mode and for system changes.' });
      if (!u) continue;
      if (u.op === 'edit') {
        const typed = await ask('User name (lowercase letters and numbers)', user, { max: 24 });
        if (typed === null) continue;
        user = typed.trim().toLowerCase();
        if (!/^[a-z_][a-z0-9_-]{0,23}$/.test(user)) { await pick('That user name won\'t work', [{ label: 'OK', plain: true }], 0, { body: 'Use lowercase letters and numbers, starting with a letter.' }); continue; }
      }
      c.user = user;
      const pw = await ask('Pick a password', '', { secret: true, max: 64 });
      if (pw === null) continue;
      if (pw.length < 4) { await pick('Too short', [{ label: 'OK', plain: true }], 0, { body: 'The password needs at least 4 characters.' }); continue; }
      const again = await ask('Type the password again', '', { secret: true, max: 64 });
      if (again === null) continue;
      if (again !== pw) { await pick("They don't match", [{ label: 'Try again', plain: true }], 0, { body: 'The two passwords were different.' }); continue; }
      c.password = pw; step++; continue;
    }
    if (step === 3) { // the time zone
      const zones = probe.timezones;
      const regions = [...new Set(zones.map((z) => z.split('/')[0]))];
      const r = await pick('Time zone: region', regions.map((x) => ({ label: x.replace(/_/g, ' '), sub: c.timezone.startsWith(`${x}/`) || c.timezone === x ? 'current' : '', x })), Math.max(0, regions.indexOf(c.timezone.split('/')[0])));
      if (!r) { step--; continue; }
      const inRegion = zones.filter((z) => z === r.x || z.startsWith(`${r.x}/`));
      if (inRegion.length > 1) {
        const z = await pick(`Time zone: ${r.x.replace(/_/g, ' ')}`, inRegion.map((x) => ({ label: x.split('/').slice(1).join(' / ').replace(/_/g, ' ') || x, z: x })), Math.max(0, inRegion.indexOf(c.timezone)));
        if (!z) continue;
        c.timezone = z.z;
      } else c.timezone = inRegion[0] || 'UTC';
      step++; continue;
    }
    if (step === 4) { // Secure Boot
      const sb = probe.secureBoot || {};
      const now = !sb.efi ? 'This computer started the USB in legacy (BIOS) mode, so Secure Boot doesn\'t apply here.' : sb.state === 'on' ? 'Secure Boot is on right now.' : sb.state === 'off' ? 'Secure Boot is off right now. Some games with anti-cheat want it on; this gets Tessera ready for when you turn it on.' : '';
      const it = await pick('Secure Boot', [
        { label: 'Set it up for me', sub: 'Recommended', v: 'auto', ok: true },
        { label: "I'll handle it myself", sub: 'skip this; it can be done later', v: 'manual', plain: true },
      ], c.secureBoot === 'manual' ? 1 : 0, { body: `${now} Tessera's system is signed with the Universal Blue key. "Set it up for me" registers that key with this computer: after the install, one blue screen asks you to confirm it, and the next screen will walk you through it.`.trim() });
      if (!it) { step--; continue; }
      c.secureBoot = it.v; step++; continue;
    }
    if (step === 5) { // last look
      const it = await pick('Ready to install', [
        { label: 'Erase and install', sub: c.diskLabel, op: 'go', danger: true },
        { label: 'Go back', op: 'back', plain: true },
      ], 1, { body: `Disk: ${c.diskLabel}, erased completely\nGraphics: ${names[c.variant] || c.variant}\nAccount: ${c.user}\nTime zone: ${c.timezone.replace(/_/g, ' ')}\nSecure Boot: ${c.secureBoot === 'auto' ? 'set up for me' : 'I\'ll handle it'}${online ? '\nDownload: about 5 to 6 GB, during the install' : ''}` });
      if (!it || it.op !== 'go') { step--; continue; }
      break;
    }
  }
  const r = await api.installer('start', { choices: { disk: c.disk, variant: c.variant, user: c.user, fullName: c.fullName, password: c.password, timezone: c.timezone, secureBoot: c.secureBoot } });
  c.password = '';
  if (!r || !r.ok) return void (await pick("Couldn't start", [{ label: 'OK', plain: true }], 0, { body: (r && r.error) || "The installer didn't start." }));
  const end = await installWatch();
  if (end.phase !== 'done') {
    const again = await pick('The install stopped', [{ label: 'Start over', op: 'again', plain: true }, { label: 'Close', plain: true }], 0, { body: end.error || "Something went wrong. The disk may be half written; installing again fixes that." });
    if (again && again.op === 'again') return flowInstaller();
    return;
  }
  const sbSteps = end.enrolled
    ? '\n\nAfter the restart a blue screen appears (Shim UEFI key management). This is how your computer confirms the new key, and only happens once:\n1. Press any key\n2. Choose Enroll MOK, then Continue, then Yes\n3. Type the password: universalblue\n   Nothing shows while you type, and it always uses a US keyboard layout.\n4. Choose Reboot'
    : '';
  const done = await pick('Tessera is installed', [{ label: 'Restart now', op: 'reboot', ok: true }, { label: 'Keep trying Tessera', plain: true }], 0, { body: `Take the USB out when the screen goes dark.${sbSteps}\n\nAfter that, Tessera starts by itself, with a short setup and an optional tour.` });
  if (done && done.op === 'reboot') {
    const rr = await api.installer('reboot', {});
    if (rr && !rr.ok) setStatus(rr.error, true);
  }
}
