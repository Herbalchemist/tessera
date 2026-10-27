// SPDX-License-Identifier: GPL-3.0-or-later
// Setting, changing and asking for the PIN.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ------------------------------------------------------------ PIN
const PIN_ROWS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['back', '0', 'done'], ['cancel']];
const askPin = (title) => ask(title, '', { rows: PIN_ROWS, mask: true, max: 8, digits: true, pattern: true });
// True when no PIN is set, it was entered recently, or it is entered now.
async function requirePin(reason) {
  let st;
  try { st = await api.settings('pinStatus'); } catch { return true; }
  if (!st.set || st.unlocked) return true;
  for (let i = 0; i < 5; i++) {
    const pin = await askPin(reason || 'Enter the PIN');
    if (pin === null) return false;
    const r = await api.settings('pinCheck', { pin });
    if (r.ok) return true;
    setStatus(r.error || "That isn't the PIN.", true);
    if (r.wait) return false;
  }
  return false;
}
async function flowSetPin(old) {
  const a = await askPin('Choose a PIN (4 to 8 digits)');
  if (a === null) return false;
  if (!/^\d{4,8}$/.test(a)) { setStatus('Use 4 to 8 digits.', true); return false; }
  const b = await askPin('Enter it again');
  if (b === null) return false;
  if (a !== b) { setStatus("Those didn't match.", true); return false; }
  const r = await api.settings('pinSet', { pin: a, old });
  if (r.prefs) applyPrefs(r.prefs);
  setStatus(r.ok ? 'PIN set.' : r.error, !r.ok);
  return Boolean(r.ok);
}
async function flowPin() {
  let index = 1;
  for (;;) {
    const st = prefs.pin;
    const items = [{ label: st.set ? 'A PIN is set' : 'No PIN yet', header: true }];
    if (!st.set) {
      items.push({ label: 'Set a PIN', sub: 'keeps Settings, adding and deleting behind a code', op: 'set', plain: true });
    } else {
      items.push({ label: 'Change PIN', op: 'change', plain: true });
      items.push({ label: 'Remove PIN', op: 'remove', plain: true });
      items.push({ label: 'Lock now', sub: 'ask for the PIN again right away', op: 'lock', plain: true });
      items.push({ label: 'Also protect the browser', sub: st.browser ? 'On' : 'Off', op: 'browser', plain: true });
    }
    items.push({ label: 'Good to know', header: true });
    items.push({ label: 'Forgot it?', sub: 'Desktop Mode, then run tessera-reset-pin (needs your login)', info: true, plain: true });
    const it = await pick('PIN', items, index);
    if (!it) return;
    index = items.indexOf(it);
    if (it.info) continue;
    if (it.op === 'set') await flowSetPin();
    else if (it.op === 'change') {
      const old = await askPin('Enter the current PIN');
      if (old !== null) await flowSetPin(old);
    } else if (it.op === 'remove') {
      const pin = await askPin('Enter the PIN to remove it');
      if (pin !== null) {
        const r = await api.settings('pinRemove', { pin });
        if (r.prefs) applyPrefs(r.prefs);
        setStatus(r.ok ? 'PIN removed.' : r.error, !r.ok);
      }
    } else if (it.op === 'lock') {
      await api.settings('pinLock');
      setStatus('Locked.');
    } else if (it.op === 'browser') {
      const r = await api.settings('pinBrowser', { value: !st.browser });
      if (r.prefs) applyPrefs(r.prefs);
      else if (r.error) setStatus(r.error, true);
    }
  }
}
// Shown once, the first time Tessera starts.
let welcomed = false;
async function flowWelcome() {
  if (welcomed) return;
  welcomed = true;
  const W = { welcome: true };
  // 1. Hello
  const hi = await pick('Welcome to Tessera', [
    { label: 'Get started', op: 'go', plain: true },
    { label: 'Skip setup', sub: 'Everything here is in Settings too', op: 'skip', plain: true },
  ], 0, { ...W, body: "Let's set a few things up: who's playing, how Tessera looks, and whether to lock things behind a PIN. It takes about a minute." });
  if (hi && hi.op === 'go') {
    // 2. Who's playing
    const who = await pick("Who's playing?", [
      { label: 'Add my name', op: 'name', plain: true },
      { label: 'Skip', sub: 'Profiles can be added later in Settings > Profiles', op: 'skip', plain: true },
    ], 0, { ...W, body: 'A profile keeps your own theme, and the guide shows who is playing. More people can be added later.' });
    let profileId = null;
    if (who && who.op === 'name') {
      const name = await ask('Your name', '', { max: 24 });
      if (name && name.trim()) {
        const r = await api.profiles('add', { name });
        if (r && r.ok) {
          const mine = (r.profiles || []).find((p) => p.name === name.trim()) || (r.profiles || []).slice(-1)[0];
          if (mine) { profileId = mine.id; await api.profiles('use', { id: mine.id }); }
        } else if (r && r.error) setStatus(r.error, true);
      }
    }
    // 3. How it looks. The launcher is shown behind the menu now, so each choice is seen whole.
    reveal();
    let t = await api.settings('themeGet');
    for (;;) {
      const themesList = t.themes.map((th) => ({ label: th.name, sub: th.id === t.active ? 'this one' : '', id: th.id, plain: true }));
      const cur = Math.max(0, themesList.findIndex((x) => x.id === t.active));
      const it = await pick('Pick a look', [...themesList, { label: 'Keep this one', op: 'keep', ok: true }], cur, { body: 'Choose one to see it. Every part of it can be changed later in Theme Settings.' });
      if (!it || it.op === 'keep') break;
      const r = await api.settings('themeUse', { id: it.id });
      if (r && r.ok) { applyTheme(r.theme); t = await api.settings('themeGet'); }
    }
    if (profileId) await api.profiles('setTheme', { id: profileId, themeId: t.active });
  }
  // 4. PIN
  const pinIt = await pick(hi && hi.op === 'go' ? 'A PIN?' : 'Welcome to Tessera', [
    { label: 'Set a PIN', sub: 'Choose 4 to 8 digits', op: 'set', plain: true },
    { label: 'Skip for now', sub: 'You can set one later in Settings', op: 'skip', plain: true },
  ], 0, {
    welcome: document.body.classList.contains('hold'),
    body: 'Want an extra layer of security? With a PIN set, changing settings, adding or deleting games and apps, and opening the browser all ask for it first. Handy if you like a little peace of mind day to day.',
  });
  if (pinIt && pinIt.op === 'set') {
    if (!(await flowSetPin())) setStatus('No PIN was set. You can set one in Settings > PIN.');
  }
  // 5. Done, with the one thing worth knowing
  if (hi && hi.op === 'go') {
    reveal();
    const end = await pick("You're all set", [{ label: 'Start playing', ok: true }, { label: 'Take a quick tour', sub: 'a minute, shows where everything is', tour: true }], 0, {
      body: `Press ${hintName(16)} any time for quick settings, profiles and power, even during a game. ${hintName(4)} and ${hintName(5)} switch tabs.`,
    });
    wantTour = Boolean(end && end.tour);
  }
  const r = await api.settings('firstRunDone');
  if (r && r.prefs) applyPrefs(r.prefs);
  if (wantTour) runTour();
}
