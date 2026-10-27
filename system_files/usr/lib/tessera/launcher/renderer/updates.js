// SPDX-License-Identifier: GPL-3.0-or-later
// Software updates and graphics builds.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ------------------------------------------------------------ software update
// Settings > Update software. One button does it all: look for a newer system build, download it if
// there is one, and offer a restart. The real work is done by system jobs that main.js starts (see
// tessera-update-*.service); this only shows what they are up to.
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const buildLabel = (b) => (b && b.version ? `Version ${b.version}` : b && b.time ? `The build from ${fmtDate(b.time)}` : 'The new version');

// Row notes sit to the right and are cut at about 40 characters: keep them short.
const UPDATE_ABOUT = 'Updates keep your games, saves and settings. The new version starts after a restart, and the previous one is kept in case you need to go back.';
function updateItems(info) {
  if (!info.supported || !info.booted) return [{ label: 'Try again', op: 'retry', plain: true }];
  const b = info.booted;
  const items = [{ label: 'Installed', header: true }];
  items.push({
    label: `Tessera ${info.launcher || ''}`.trim(),
    sub: [b.version ? `System ${b.version}` : '', b.time ? `built ${fmtDate(b.time)}` : ''].filter(Boolean).join(' · ') || undefined,
    info: true,
    plain: true,
  });
  items.push({ label: 'Update', header: true });
  if (info.rollbackQueued) {
    // going back is already set up: the only thing left to do is restart (and no new update on top of it)
    items.push({ label: 'Restart now', sub: info.rollback ? `Goes back to ${buildLabel(info.rollback)}` : 'Goes back to the previous version', op: 'reboot', ok: true });
    return items;
  }
  if (info.staged) items.push({ label: 'Restart now', sub: `${buildLabel(info.staged)} is ready`, op: 'reboot', ok: true });
  items.push({ label: 'Update now', sub: info.staged ? 'Look for something newer' : 'Get the newest version', op: 'update', plain: true });
  if (info.rollback && !info.staged) {
    items.push({ label: 'Previous version', header: true });
    items.push({ label: 'Go back to the previous version', sub: buildLabel(info.rollback), op: 'rollback', plain: true });
  }
  graphicsItems(info.graphics).forEach((x) => items.push(x));
  return items;
}
// ---- graphics builds (see gpu-match.js): a swapped graphics card may want a different Tessera build
let graphicsNotice = null; // the mismatch main reported at start, until it's dealt with
const buildName = (g, v) => (g && g.names && g.names[v]) || v;
function graphicsItems(g) {
  if (!g || !g.have) return [];
  const items = [{ label: 'Graphics', header: true, fold: 'update.graphics', open: Boolean(g.mismatch) }];
  items.push({ label: g.cards.length ? g.cards.join(' + ') : 'Graphics card', sub: `This build: ${buildName(g, g.have)}`, info: true, plain: true });
  if (g.switching) items.push({ label: `The ${buildName(g, g.need)} build is ready`, sub: 'Restart to finish switching', info: true, plain: true });
  else if (g.mismatch) items.push({ label: `Switch to the ${buildName(g, g.need)} build`, sub: 'Made for this card · games and settings stay', op: 'graphics', variant: g.need, ok: true });
  items.push({ label: 'Choose a build myself…', sub: 'For special setups, like an external card', op: 'graphicsPick', plain: true });
  return items;
}
const GRAPHICS_ABOUT = 'Tessera comes in a build for each kind of graphics card, because the NVIDIA driver is part of the system. Switching builds works like an update: your games, saves and settings stay, the new build starts after a restart, and the old one stays in the boot menu.';
// Download the build for `variant`. Resolves with what to tell the person.
async function graphicsSwitch(g, variant) {
  const why = g && g.mismatch && variant === g.need
    ? `This machine has ${g.cards.join(' + ') || 'a different graphics card'}, but Tessera is running the build for ${buildName(g, g.have)}.`
    : `Switch to the ${buildName(g, variant)} build?`;
  if (!(await confirm(`${why} The ${buildName(g, variant)} build downloads now and starts after a restart. Games, saves and settings stay.`, 'Switch'))) return '';
  if (!(await requirePin())) return '';
  const bad = await updateStart('graphics', { variant });
  const r = bad || (await updateWatch('graphics', { name: buildName(g, variant) }));
  const end = updateEnd(r);
  if (r.result === 'staged') { graphicsNotice = null; updateWaiting = true; return `The ${buildName(g, variant)} build is downloaded. Restart to finish switching.`; }
  return end !== null ? end : "I couldn't tell whether that worked. Open this screen again to see.";
}
// Main noticed at start that the card and the build don't match.
async function offerGraphics(g) {
  graphicsNotice = g;
  if (page === 'settings') render();
  if (modal || busy || gameOn || GUIDE_ONLY) { setStatus('New graphics card? Settings > Update software can switch to the build made for it.'); return; }
  const it = await pick('New graphics card?', [
    { label: `Switch to the ${buildName(g, g.need)} build`, sub: 'Recommended', op: 'go', ok: true },
    { label: 'Not now', sub: 'Settings > Update software has it too', op: 'later', plain: true },
  ], 0, { body: `This machine has ${g.cards.join(' + ') || 'a different graphics card'}, but Tessera is running the build for ${buildName(g, g.have)}. The build made for this card gets the most out of it. Switching keeps your games, saves and settings.` });
  if (!it || it.op !== 'go') return;
  const note = await graphicsSwitch(g, g.need);
  if (note) await pick(updateWaiting ? 'Ready' : 'Graphics build', updateWaiting ? [{ label: 'Restart now', op: 'reboot', ok: true }, { label: 'Later', op: 'later', plain: true }] : [{ label: 'OK', plain: true }], 0, { body: note })
    .then(async (x) => { if (x && x.op === 'reboot') { const r = await api.update('reboot', {}); if (r && !r.ok) setStatus(r.error, true); } });
  if (page === 'settings') render();
}
if (api.onGraphics) api.onGraphics((g) => { if (g && g.mismatch) offerGraphics(g); });

async function flowUpdate() {
  if (modal || busy) return;
  let info = null;
  let note = '';
  let resume = '';
  let at = -1; // where the cursor rests after a line that was only read; -1 means on the main action
  for (;;) {
    if (!info) {
      busy = true;
      setStatus('Checking what is installed…');
      try { info = await api.update('info', {}); } finally { busy = false; }
      setStatus('');
      if (!info || !info.ok) { setStatus((info && info.error) || "Couldn't read the system version.", true); break; }
      if (info.job) resume = info.job;
      updateWaiting = Boolean(info.staged);
    }
    if (resume) {
      // an update is already running (Tessera was restarted meanwhile): rejoin it
      const job = resume;
      resume = '';
      note = await updateNow(job);
      info = null;
      continue;
    }
    const items = updateItems(info);
    const problem = info.supported ? '' : [info.problem, info.detail ? `(${info.detail})` : ''].filter(Boolean).join(' ');
    const gfx = info.graphics && info.graphics.mismatch && !info.graphics.switching;
    const first = gfx ? items.findIndex((x) => x.op === 'graphics') : items.findIndex((x) => x.op);
    const it = await pick('Update software', items, at >= 0 ? at : Math.max(0, first), { body: note || problem || (gfx ? `Your graphics card changed. Tessera is running the build for ${buildName(info.graphics, info.graphics.have)}; switch to the one made for this card below.` : UPDATE_ABOUT) });
    note = '';
    if (!it) break;
    if (it.info) { at = items.indexOf(it); continue; } // a line to read: stay on it
    at = -1;
    if (it.op === 'retry') { info = null; continue; }
    if (it.op === 'reboot') {
      if (!(await requirePin())) continue;
      let r = await api.update('reboot', {});
      if (r && r.needPin) {
        if (!(await requirePin())) continue;
        r = await api.update('reboot', {});
      }
      if (r && r.ok) {
        await pick('Restarting…', [{ label: 'Close', op: 'close', plain: true }], 0, { body: 'The console is restarting. This takes a moment.' });
        break;
      }
      note = (r && r.error) || "Couldn't restart from here. Use the power button, or Desktop Mode.";
      continue;
    }
    if (it.op === 'update') {
      if (!(await requirePin())) continue;
      note = await updateNow('');
      info = null; // read where things stand now
    }
    if (it.op === 'graphics') { note = await graphicsSwitch(info.graphics, it.variant); info = null; continue; }
    if (it.op === 'graphicsPick') {
      const g = info.graphics;
      const opts = ['standard', 'nvidia', 'nvidia-open'];
      const c = await pick('Which build?', opts.map((v) => ({ label: buildName(g, v), sub: v === g.have ? 'running now' : v === g.need ? 'suits this card' : '', v, plain: true })), Math.max(0, opts.indexOf(g.need || g.have)), { body: GRAPHICS_ABOUT });
      if (c && c.v !== g.have) { note = await graphicsSwitch(g, c.v); info = null; }
      continue;
    }
    if (it.op === 'rollback') {
      if (!(await confirm(`Go back to ${buildLabel(info.rollback).toLowerCase()}? It starts after the next restart. Your games, saves and settings are kept.`, 'Go back'))) continue;
      const bad = await updateStart('rollback');
      const r = bad || (await updateWatch('rollback'));
      note = updateEnd(r) || "I couldn't tell whether that worked. Open this screen again to see.";
      info = null;
    }
  }
  if (page === 'settings') render(); // the Update software tile may now say "Restart to finish"
}

// Asks main to start a job. Null when it started, else what to tell the person.
async function updateStart(kind, extra = {}) {
  let r = await api.update('start', { ...extra, job: kind });
  if (r && r.needPin) {
    if (!(await requirePin())) return { result: 'canceled', quiet: true };
    r = await api.update('start', { ...extra, job: kind });
  }
  return r && r.ok ? null : { result: 'error', error: (r && r.error) || "Couldn't start the update.", detail: '' };
}
// What to tell the person about a job that ended, or null if it found an update that is still to be fetched.
function updateEnd(r) {
  switch (r.result) {
    case 'canceled': return r.quiet ? '' : 'Stopped. Nothing was changed.';
    case 'error': return r.error + (r.detail ? ` (${r.detail})` : '');
    case 'uptodate': return "You're up to date. This is the newest version.";
    case 'rolledback': return 'Done. The previous version starts after the next restart.';
    case 'staged': return `${buildLabel(r)} is downloaded. Restart to finish installing it.`;
    default: return null;
  }
}
// Check, then fetch if there is something to fetch. `resume` joins a job that is already running.
async function updateNow(resume) {
  let hint = {};
  if (resume !== 'apply') {
    const r = (resume ? null : await updateStart('check')) || (await updateWatch('check'));
    const end = updateEnd(r);
    if (end !== null) return end;
    hint = { version: r.version, size: r.size };
  }
  const r = (resume === 'apply' ? null : await updateStart('apply')) || (await updateWatch('apply', hint));
  const end = updateEnd(r);
  return end !== null ? end : "The update finished, but I couldn't tell whether anything new was installed. Open this screen again to see.";
}
// Follows one system job until it ends, then resolves with its result. B (or Stop) asks first.
function updateWatch(kind, hint = {}) {
  return new Promise((resolve) => {
    let mode = 'run'; // run | ask | stopping
    let p = { elapsed: 0, line: '' };
    let note = ''; // why Stop did not work, if it did not
    let over = false;
    // The status goes in the paragraph under the title (big enough to read from the sofa); the list only holds the choices.
    const itemsNow = () => {
      if (mode === 'ask') return [{ label: 'No, keep going', op: 'no', plain: true }, { label: 'Yes, stop', op: 'yes', danger: true }]; // the safe answer first
      if (mode === 'stopping') return [{ label: 'Stopping…', header: true }];
      return [{ label: 'Stop', op: 'stop', plain: true }];
    };
    const bodyNow = () => {
      if (mode === 'ask') return kind === 'rollback' ? 'Stop going back?\nNothing is changed until it finishes.' : 'Stop the update?\nWhat is already downloaded is kept for next time.';
      if (mode === 'stopping') return '';
      const what = kind === 'rollback' ? 'Setting up the previous version' : kind === 'check' ? 'Looking for a newer version' : kind === 'graphics' ? `Downloading the ${hint.name || 'new'} build` : hint.version ? `Downloading version ${hint.version}` : 'Downloading the update';
      const status = [what, kind === 'apply' && hint.size ? `about ${hint.size}` : '', fmtClock(p.elapsed)].filter(Boolean).join(' · ');
      const big = kind === 'apply' || kind === 'graphics';
      return [status, big ? 'Keep the console on until this finishes.' : '', big ? p.line : '', note].filter(Boolean).join('\n');
    };
    openList({
      title: kind === 'check' ? 'Checking for updates' : kind === 'rollback' ? 'Going back' : kind === 'graphics' ? 'Switching graphics build' : 'Updating',
      items: itemsNow(),
      index: 0,
      body: bodyNow(),
      onChoose: (it) => {
        if (mode === 'run' && it.op === 'stop') { mode = 'ask'; note = ''; }
        else if (mode === 'ask' && it.op === 'yes') {
          mode = 'stopping'; // the loop below sees the job end; if it can't be stopped, say so and carry on
          Promise.resolve(api.update('cancel', {})).then((r) => {
            if (r && !r.ok && !over) { mode = 'run'; note = r.error || "Couldn't stop it."; show(); }
          }).catch(() => {});
        } else if (mode === 'ask') mode = 'run';
        show();
      },
      onBack: () => {
        if (mode === 'run') mode = 'ask';
        else if (mode === 'ask') mode = 'run';
        show();
      },
    });
    const m = modal;
    function show() {
      m.items = itemsNow();
      m.body = bodyNow();
      m.index = 0;
      if (modal === m) renderModal();
    }
    const finish = (res) => {
      over = true;
      if (modal === m) closeModal();
      resolve(res);
    };
    (async () => {
      let lost = 0;
      await sleep(600);
      while (!over) {
        let q = null;
        try { q = await api.update('poll', {}); } catch { /* try again */ }
        if (over) return;
        if (!q || !q.ok) {
          if (++lost > 10) return finish({ result: 'error', error: 'Lost touch with the update.', detail: '' });
        } else if (q.phase === 'running') {
          lost = 0;
          p = q;
          if (mode === 'run' && modal === m) { m.items = itemsNow(); m.body = bodyNow(); renderModal(); }
        } else {
          return finish(q.phase === 'done' ? q : { result: 'unknown' });
        }
        await sleep(1000);
      }
    })();
  });
}
