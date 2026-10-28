// SPDX-License-Identifier: GPL-3.0-or-later
// The guide: the overlay the Guide button opens.
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

// ------------------------------------------------------------------ the guide
// The Guide button (Xbox / PS / Home) opens this panel from anywhere: the launcher, the
// browser, or in front of a running game (the main process watches the button and brings
// Tessera up). It holds game controls, quick settings, profiles, notifications and power.
// The Desktop Mode helper loads this page with ?guide: only the guide is ever shown.
const GUIDE_ONLY = new URLSearchParams(location.search).has('guide');
if (GUIDE_ONLY) document.body.classList.add('guide-only');
let guideWatching = 0;     // controllers the main process reads Guide from (0: the page reads it)
let guideOpen = false;
let gameOn = null;         // { title, since } while Tessera is up in front of a running game
let guideBrowserHidden = false;
function refreshGuideWatch() {
  if (!api.guide) return;
  api.guide('status').then((st) => { guideWatching = (st && st.watching) || 0; }).catch(() => {});
}
refreshGuideWatch();
setInterval(refreshGuideWatch, 20000);
// The page itself saw Guide (keyboard F1/Home, or a pad the main process can't read).
function guidePressFromPage() {
  const press = (prefs.pad.guideButton || 'menu-home') === 'home-menu' ? 'home' : 'menu';
  if (api.guide) api.guide('press', { action: press }).catch(() => handleGuide({ action: press }));
  else handleGuide({ action: press });
}
// Whatever menu is up gets backed out of first, so its flow ends cleanly.
function dismissModal() {
  if (!modal) return;
  if (modal.kind === 'list' && modal.onBack) return modal.onBack();
  if (modal.kind === 'keys') return finishKeys(false);
  if (modal.kind === 'capture') return modal.finish(null);
  if (modal.kind === 'color') return colorButton(1);
  closeModal();
}
function handleGuide(msg) {
  if (!msg) return;
  if (msg.action === 'blur') { if (GUIDE_ONLY && guideOpen) closeGuide(); return; } // clicked away on the desktop
  if (msg.inGame) {
    gameOn = { title: msg.title || 'Game', since: gameOn ? gameOn.since : Date.now() };
    if (suspended) { suspended = false; update(); }
  }
  if (msg.action === 'home') return guideGoHome();
  if (guideOpen) return closeGuide();
  return openGuide();
}
function guideGoHome() {
  if (guideOpen) closeGuide({ stay: true });
  while (modal) dismissModal();
  if (browserOpen) closeBrowser(-1);
  page = 'home'; hoverId = 'home'; stack = []; focus = 'content';
  render();
  if (gameOn) setStatus(`${gameOn.title} is still running. Press Guide to go back to it.`);
}
async function closeGuide({ stay = false } = {}) {
  if (!guideOpen) return;
  guideOpen = false;
  if (modal && /\bguide\b/.test(modal.cls || '')) closeModal();
  if (GUIDE_ONLY) { if (!stay) await api.guide('hideHelper'); return; }
  if (guideBrowserHidden) {
    guideBrowserHidden = false;
    const c = browserCurtain();
    c.classList.remove('dim');
    if (browserOpen) { await api.browser('show'); setTimeout(() => { if (browserOpen) c.hidden = true; }, 300); }
  }
  // Closing the guide in front of a game goes back to the game, unless Home was asked for.
  if (gameOn && !stay) await resumeGame();
}
async function resumeGame() {
  if (!gameOn) return;
  gameOn = null;
  suspended = true;
  dropAllArt();
  setStatus('');
  try { await api.guide('resume'); } catch { /* the game may have just ended */ }
}
const fmtAgo = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
async function openGuide() {
  if (guideOpen) return;
  while (modal) dismissModal();
  guideOpen = true;
  // The page draws over everything: step it aside, leaving a dimmed picture behind the guide.
  if (browserOpen && !guideBrowserHidden) {
    guideBrowserHidden = true;
    const c = browserCurtain();
    try {
      const snap = await api.browser('snapshot');
      if (snap && snap.ok) browserShot = snap.image;
      paintCurtain(c, browserShot);
      await decodeShot(browserShot);
      c.hidden = false;
      c.classList.add('dim');
    } catch { /* no picture: the guide still opens */ }
    await api.browser('hide');
  }
  let info = {}; let audio = null; let prof = { profiles: [], active: null }; let wifi = null; let bt = null; let st = {};
  const quick = (pr) => Promise.race([Promise.resolve(pr).catch(() => null), sleep(1500).then(() => null)]);
  [info, audio, prof, wifi, bt, st] = await Promise.all([
    quick(api.systemInfo ? api.systemInfo() : null), quick(api.audio('info')), quick(api.profiles('list')),
    quick(api.wifi('info', {})), quick(api.bluetooth('info')), quick(api.guide ? api.guide('status') : null),
  ]);
  if (!guideOpen) return;
  info = info || {}; prof = prof || { profiles: [], active: null }; st = st || {};
  if (st.running && !gameOn) gameOn = { title: st.title || 'Game', since: st.since || Date.now() };
  const out = audio && audio.ok ? audio.outputs.find((o) => o.isDefault) : null;
  const items = [];
  // ---- what's running
  if (gameOn) {
    items.push({ label: `Playing · ${gameOn.title}`, header: true });
    items.push({ label: `Resume ${gameOn.title}`, sub: `started ${fmtAgo(gameOn.since)}`, op: 'resume', plain: true });
    items.push({ label: `Close ${gameOn.title}`, op: 'closeGame', danger: true });
  }
  items.push({ label: 'Go', header: true });
  if (GUIDE_ONLY) {
    items.push({ label: 'Return to Tessera', sub: 'Closes the desktop and starts Tessera', op: 'returnTessera', plain: true });
  } else {
    items.push({ label: 'Home', op: 'home', plain: true });
    if (browserOpen) items.push({ label: 'Back to the browser', op: 'close', plain: true });
    items.push({ label: 'Settings', op: 'settings', plain: true });
  }
  if (isLive() && !GUIDE_ONLY) items.unshift({ label: 'Install Tessera', sub: 'on this computer', op: 'install', ok: true });
  // ---- quick settings
  items.push({ label: 'Quick settings', header: true });
  if (out) {
    const vol = {
      label: 'Volume', sub: out.mute ? 'Muted' : `${out.volume}%`, op: 'mute', plain: true,
      adjust: (dir) => {
        const v = Math.max(0, Math.min(100, (out.volume || 0) + dir * 5));
        if (v === out.volume && !out.mute) return;
        out.volume = v;
        if (out.mute && dir > 0) { out.mute = false; api.audio('mute', { kind: 'output', id: out.id, on: false }).catch(() => {}); }
        vol.sub = out.mute ? 'Muted' : `${v}%`;
        api.audio('volume', { kind: 'output', id: out.id, pct: v }).catch(() => {});
      },
    };
    items.push(vol);
  }
  if (wifi && wifi.ok && wifi.present) {
    const cur = (wifi.networks || []).find((n) => n.active || n.connected || n.inUse);
    items.push({ label: 'Wi-Fi', sub: wifi.radio ? (cur ? `On · ${cur.ssid}` : 'On') : 'Off', op: 'wifi', on: Boolean(wifi.radio), plain: true });
  }
  if (bt && bt.ok && bt.adapter && bt.adapter.present) items.push({ label: 'Bluetooth', sub: bt.adapter.powered ? 'On' : 'Off', op: 'bt', on: Boolean(bt.adapter.powered), plain: true });
  for (const pad of info.pads || []) {
    const level = pad.pct !== null && pad.pct !== undefined ? `${pad.pct}%` : (pad.level || 'unknown');
    items.push({ label: pad.name, sub: `Battery ${level}${pad.charging ? ', charging' : ''}`, plain: true, info: true });
  }
  // ---- profiles
  items.push({ label: 'Profiles', header: true });
  for (const pr of prof.profiles || []) items.push({ label: pr.name, sub: pr.id === prof.active ? 'playing now' : '', op: 'profile', id: pr.id, plain: true });
  if (!GUIDE_ONLY) items.push({ label: (prof.profiles || []).length ? 'Manage profiles…' : 'Add a profile…', op: 'profiles', plain: true });
  // (notifications have their own panel on the right: see guideNotes below)
  if (!GUIDE_ONLY) { items.push({ label: 'Help', header: true }); items.push({ label: 'Take the tour', sub: 'a quick look around Tessera', op: 'tour', plain: true }); }
  // ---- power
  items.push({ label: 'Power', header: true, fold: 'guide.power' });
  items.push({ label: 'Sleep', op: 'sleep', plain: true });
  items.push({ label: 'Restart', op: 'restart', plain: true });
  items.push({ label: 'Shut down', op: 'shutdown', plain: true });
  if (!GUIDE_ONLY) items.push({ label: 'Desktop Mode', op: 'desktop', plain: true });

  const now = new Date();
  const who = (prof.profiles || []).find((p) => p.id === prof.active);
  const bits = [now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })];
  if (info.battery && info.battery.present && info.battery.pct !== null) bits.push(`Battery ${info.battery.pct}%${info.battery.charging ? ' ⚡' : ''}`);
  if (wifi && wifi.ok && wifi.present && wifi.radio) { const cur = (wifi.networks || []).find((n) => n.active || n.connected || n.inUse); if (cur) bits.push(cur.ssid); }
  if (who) bits.push(who.name);
  openList({
    title: 'Guide',
    body: bits.join('  ·  '),
    items,
    index: 0,
    cls: 'guide guide-' + (GUIDE_STYLES.includes(prefs.pad.guideStyle) ? prefs.pad.guideStyle : 'side'),
    onChoose: (it) => guideChoose(it),
    onBack: () => closeGuide(),
    onRender: (box) => guideNotesPanel(box),
  });
  guideNotesButtons();
}

// ---- notifications: a panel of their own on the right of the guide. X hides or shows it (they
// stay in the queue), Y clears them (gone from the queue). Low storage comes back if it's still low
// next time Tessera checks.
const GUIDE_STYLES = ['side', 'float', 'compact'];
let guideNotesHidden = false;
const clearedLow = new Set(); // low-storage warnings cleared this session, by drive
function guideNotes() {
  const notes = [];
  for (const l of (prefs.storage && prefs.storage.low) || []) {
    if (!clearedLow.has(l.name + '|' + l.free)) notes.push({ text: `Low storage on ${l.name}`, sub: `${fmtBytes(l.free)} left`, error: true, low: l });
  }
  for (const m of statusLog) notes.push({ text: m.msg.length > 90 ? m.msg.slice(0, 88) + '…' : m.msg, sub: fmtAgo(m.at), error: m.isError });
  return notes;
}
// The guide's X and Y act on the panel while there's something in it.
function guideNotesButtons() {
  if (!modal || !guideOpen) return;
  const n = guideNotes().length;
  modal.onX = n ? () => { guideNotesHidden = !guideNotesHidden; guideNotesButtons(); renderModal(); } : null;
  modal.xLabel = guideNotesHidden ? `Show notifications (${n})` : 'Hide notifications';
  modal.onY = n ? () => { guideClearNotes(); guideNotesButtons(); renderModal(); } : null;
  modal.yLabel = 'Clear notifications';
}
function guideClearNotes() {
  for (const l of (prefs.storage && prefs.storage.low) || []) clearedLow.add(l.name + '|' + l.free);
  statusLog.length = 0;
  guideNotesHidden = false;
  setStatus('');
}
// Each guide style has its own: the side panel gets a panel on the right; the floating card a
// second card tucked behind it; compact a strip inside the panel itself.
const BELL = '<svg class="gn-bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>';
function guideNotesPanel(box) {
  const notes = guideNotes();
  if (!notes.length) return;
  const style = /\bguide-(float|compact)\b/.exec(modal.cls || '');
  const kind = style ? style[1] : 'side';
  const panel = document.createElement('aside');
  panel.className = `gnotes gn-${kind}` + (guideNotesHidden ? ' hidden' : '');
  const head = document.createElement('div');
  head.className = 'gn-head';
  head.innerHTML = BELL;
  const title = document.createElement('h4');
  const count = `${notes.length} notification${notes.length === 1 ? '' : 's'}`;
  title.textContent = guideNotesHidden ? (kind === 'side' ? count : String(notes.length)) : 'Notifications';
  head.appendChild(title);
  panel.appendChild(head);
  if (!guideNotesHidden) {
    const list = document.createElement('div');
    list.className = 'gn-list';
    for (const n of kind === 'compact' ? notes.slice(0, 3) : notes) {
      const row = document.createElement('div');
      row.className = 'gn-item' + (n.error ? ' error' : '');
      const t = document.createElement('span');
      t.textContent = n.text;
      const sub = document.createElement('small');
      sub.textContent = n.sub;
      row.append(t, sub);
      list.appendChild(row);
    }
    panel.appendChild(list);
  }
  // Buttons for the mouse, named for the controller or keyboard in use.
  const bar = document.createElement('div');
  bar.className = 'gn-bar';
  const button = (g, label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    const k = document.createElement('b');
    k.dataset.g = g;
    b.append(k, label);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    bar.appendChild(b);
  };
  button('2', guideNotesHidden ? 'Show' : 'Hide', () => modal && modal.onX && modal.onX());
  if (!(kind === 'float' && guideNotesHidden)) button('3', 'Clear', () => modal && modal.onY && modal.onY());
  if (kind === 'compact' && !guideNotesHidden && notes.length > 3) {
    const more = document.createElement('small');
    more.className = 'gn-more';
    more.textContent = `and ${notes.length - 3} more`;
    bar.prepend(more);
  }
  panel.appendChild(bar);
  if (kind === 'side' || !box) modalEl.appendChild(panel);
  else if (kind === 'float') box.appendChild(panel); // behind the card (see style.css)
  else box.insertBefore(panel, box.querySelector('.mlist')); // compact: under the clock, above the menu
  applyGlyphs();
}
async function guideChoose(it) {
  if (!it || it.info) return;
  const op = it.op;
  if (op === 'close') return closeGuide({ stay: true });
  if (op === 'resume') return closeGuide();
  if (op === 'home') return guideGoHome();
  if (op === 'returnTessera') { await closeGuide({ stay: true }); await api.guide('returnToTessera'); return api.guide('hideHelper'); }
  if (op === 'closeGame') {
    const title = gameOn ? gameOn.title : 'the game';
    closeGuide({ stay: true });
    if (!(await confirm(`Close ${title}? Anything you haven't saved in it is lost.`, 'Close it'))) return openGuide();
    const r = await api.guide('closeGame');
    setStatus(r && r.ok ? `Closing ${title}…` : (r && r.error) || "Couldn't close it.", !(r && r.ok));
    return;
  }
  if (op === 'mute') {
    const out = modal.items.find((x) => x.label === 'Volume');
    const a = await api.audio('info');
    const o = a && a.ok && a.outputs.find((x) => x.isDefault);
    if (o) { await api.audio('mute', { kind: 'output', id: o.id, on: !o.mute }); if (out) out.sub = !o.mute ? 'Muted' : `${o.volume}%`; renderModal(); }
    return;
  }
  if (op === 'wifi' || op === 'bt') {
    if (!(await requirePin())) return;
    const r = op === 'wifi' ? await api.wifi('radio', { on: !it.on }) : await api.bluetooth('power', { on: !it.on });
    if (r && r.ok) { it.on = !it.on; it.sub = it.on ? 'On' : 'Off'; renderModal(); }
    else setStatus((r && r.error) || "Couldn't change that.", true);
    return;
  }
  if (op === 'profile') {
    const r = await api.profiles('use', { id: it.id });
    if (r && r.ok) {
      if (r.theme) applyTheme(r.theme);
      for (const x of modal.items) if (x.op === 'profile') x.sub = x.id === it.id ? 'playing now' : '';
      renderModal();
      setStatus(`Hi, ${it.label}!`);
    }
    return;
  }
  const leaveTo = async (fn) => { await closeGuide({ stay: true }); fn(); };
  if (op === 'settings') return leaveTo(() => { page = 'settings'; hoverId = 'settings'; stack = []; focus = 'content'; render(); });
  if (op === 'profiles') return leaveTo(() => flowProfiles());
  if (op === 'tour') return leaveTo(() => runTour());
  if (op === 'install') return leaveTo(() => flowInstaller());
  if (op === 'storage') return leaveTo(() => flowStorage());
  if (op === 'sleep' || op === 'restart' || op === 'shutdown' || op === 'desktop') {
    await closeGuide({ stay: true });
    const words = { sleep: ['Go to sleep?', 'Sleep'], restart: ['Restart the computer?', 'Restart'], shutdown: ['Shut down the computer?', 'Shut down'], desktop: ['Switch to Desktop Mode?', 'Switch'] }[op];
    if (gameOn && op !== 'sleep') { setStatus(`Close ${gameOn.title} first.`, true); return openGuide(); }
    const done = () => { if (GUIDE_ONLY) api.guide('hideHelper'); };
    if (!(await confirm(words[0], words[1]))) return done();
    if (!(await requirePin())) return done();
    const r = op === 'desktop' ? await api.quit() : await api.power(op);
    if (r && !r.ok) setStatus(r.error || "Couldn't do that.", true);
    done();
  }
}
if (api.onGuide) api.onGuide(handleGuide);
