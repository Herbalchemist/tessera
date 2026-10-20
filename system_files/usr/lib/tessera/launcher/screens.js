// SPDX-License-Identifier: GPL-3.0-or-later
// Settings > Wi-Fi, Bluetooth, Sound and Power. Loaded after renderer.js and built on its menus,
// on-screen keyboard and PIN prompt. Like the other flows, these only send operation names, ids
// that came from a list the system just gave, and the text the person typed. The work is in
// devices.js (main process), which checks everything again.
(function () {
  'use strict';

  const KIND_WORD = { controller: 'Controller', headset: 'Headset', speaker: 'Speaker', keyboard: 'Keyboard', mouse: 'Mouse', phone: 'Phone', computer: 'Computer', device: 'Device' };
  const AUDIO_WORD = { bluetooth: 'Bluetooth', tv: 'TV', usb: 'USB', headphones: 'Headphones', speakers: 'Speakers' };
  const hasText = (v) => typeof v === 'string' ? v : '';

  // Never lets an exception out of a call to the main process.
  async function call(f) {
    try { return (await f()) || { ok: false, error: 'Something went wrong.' }; } catch { return { ok: false, error: 'Something went wrong.' }; }
  }
  // Runs an action that may need the PIN: if main says so, asks for it and tries once more.
  async function gated(f) {
    let r = await call(f);
    if (r.needPin) {
      if (!(await requirePin())) return { ok: false, canceled: true, error: '' };
      r = await call(f);
    }
    return r;
  }
  const notice = (title, body) => pick(title, [{ label: 'OK', plain: true }], 0, { body });

  // Brings a menu to the screen and keeps it fresh: `reload` runs every few seconds while it is open.
  // Resolves with the chosen item (or null on back). `st.at` remembers where the cursor was.
  async function liveList(st, { title, items, body, reload, every = 4000 }) {
    const first = items(st);
    const at = st.at ? first.findIndex((x) => x.key === st.at) : -1;
    const p = pick(title, first, Math.max(0, at), { body: body(st) });
    const m = modal;
    let alive = true;
    let loading = false;
    const timer = setInterval(async () => {
      if (!alive || modal !== m || loading || Date.now() < (m.holdUntil || 0)) return;
      loading = true;
      try { await reload(st); } catch { /* try again next time */ }
      loading = false;
      if (!alive || modal !== m || Date.now() < (m.holdUntil || 0)) return;
      const was = m.items[m.index];
      m.items = items(st);
      m.body = body(st);
      const j = was && was.key ? m.items.findIndex((x) => x.key === was.key) : -1;
      m.index = j >= 0 ? j : Math.min(m.index, Math.max(0, m.items.length - 1));
      const unpickable = (i) => m.items[i] && m.items[i].header && !m.items[i].fold;
      while (unpickable(m.index) && m.index < m.items.length - 1) m.index++;
      while (unpickable(m.index) && m.index > 0) m.index--;
      renderModal();
    }, every);
    const it = await p;
    alive = false;
    clearInterval(timer);
    if (it && it.key) st.at = it.key;
    return it;
  }

  // Shows a job that takes a while (pairing, joining) and follows it until it is over. B or Cancel stops it.
  function watchJob(which, { title, body }) {
    return new Promise((resolve) => {
      let over = false;
      let canceling = false;
      let p = { elapsed: 0, stage: '', name: '' };
      const itemsNow = () => (canceling ? [{ label: 'Canceling…', header: true }] : [{ label: 'Cancel', op: 'cancel', danger: true }]);
      const stop = () => {
        if (over || canceling) return;
        canceling = true;
        Promise.resolve(api[which]('cancel')).catch(() => {});
        m.items = itemsNow();
        m.body = body(p, true);
        m.index = 0;
        if (modal === m) renderModal();
      };
      openList({ title, items: itemsNow(), index: 0, body: body(p, false), onChoose: stop, onBack: stop });
      const m = modal;
      (async () => {
        let lost = 0;
        await sleep(500);
        while (!over) {
          let q = null;
          try { q = await api[which]('poll'); } catch { /* try again */ }
          if (over) return;
          if (!q || !q.ok) {
            if (++lost > 12) { over = true; if (modal === m) closeModal(); return resolve({ phase: 'done', result: 'error', error: 'Lost touch with it.', detail: '' }); }
          } else if (q.phase === 'running') {
            lost = 0;
            p = q;
            if (modal === m) { m.body = body(p, canceling); renderModal(); }
          } else {
            over = true;
            try { await api[which]('ack'); } catch { /* it is cleared at the next start anyway */ }
            if (modal === m) closeModal();
            return resolve(q.phase === 'done' ? q : { phase: 'done', result: 'error', error: 'It stopped unexpectedly.', detail: '' });
          }
          await sleep(700);
        }
      })();
    });
  }
  const clock = (s) => (typeof fmtClock === 'function' ? fmtClock(s || 0) : `${s || 0}s`);

  // ------------------------------------------------------------------ Sound
  const sameDevice = (a, b) => {
    const mac = (s) => { const m = /([0-9A-F]{2}[_:]){5}[0-9A-F]{2}/i.exec(s || ''); return m ? m[0].replace(/:/g, '_').toUpperCase() : ''; };
    return Boolean(a && b && mac(a) && mac(a) === mac(b));
  };

  function volumeItem(st, kind, dev, label) {
    const level = () => (dev.volume === null || dev.volume === undefined ? 0 : dev.volume);
    const note = () => (dev.mute ? 'Muted' : `${level()}%`);
    const item = {
      key: 'v:' + kind,
      label,
      sub: note(),
      op: 'mute',
      kind,
      dev,
      plain: true,
      adjust: (dir) => {
        const v = Math.max(0, Math.min(100, level() + dir * 5));
        const unmute = dev.mute && dir > 0;
        if (v === level() && !unmute) return;
        dev.volume = v;
        if (unmute) { dev.mute = false; call(() => api.audio('mute', { kind, id: dev.id, on: false })); }
        item.sub = note();
        if (modal) modal.holdUntil = Date.now() + 2500; // don't redraw underneath a hand that is still turning it
        if (st.volTimer) clearTimeout(st.volTimer);
        st.volPending = { kind, dev };
        st.volTimer = setTimeout(() => flushVolume(st), 150);
      },
      graphic: (el) => {
        const g = document.createElement('div');
        g.className = 'ugfx';
        const bar = document.createElement('div');
        bar.className = 'ubar';
        const fill = document.createElement('i');
        fill.className = 'useg ' + (dev.mute ? 'o' : 'g');
        fill.style.width = `${Math.max(0, Math.min(100, level()))}%`;
        const rest = document.createElement('i');
        rest.className = 'useg f';
        bar.append(fill, rest);
        g.appendChild(bar);
        el.appendChild(g);
      },
    };
    return item;
  }
  // Sends the last volume that was dialled in (turning the bar quickly would otherwise send dozens).
  async function flushVolume(st) {
    if (st.volTimer) { clearTimeout(st.volTimer); st.volTimer = null; }
    const p = st.volPending;
    st.volPending = null;
    if (!p) return;
    const r = await call(() => api.audio('volume', { kind: p.kind, id: p.dev.id, pct: p.dev.volume }));
    if (!r.ok) st.note = r.error || "Couldn't change the volume.";
  }

  function soundItems(st) {
    const d = st.data;
    const out = [];
    const o = d.outputs.find((x) => x.isDefault);
    const i = d.inputs.find((x) => x.isDefault);
    out.push({ label: 'Volume', header: true, key: 'h:vol' });
    if (o) out.push(volumeItem(st, 'output', o, 'Volume'));
    else out.push({ label: 'No sound output found', info: true, plain: true, key: 'none' });
    if (i) out.push(volumeItem(st, 'input', i, 'Microphone'));
    if (d.outputs.length) {
      out.push({ label: 'Play sound through', header: true, key: 'h:out' });
      for (const x of d.outputs) out.push({ key: 'o:' + x.id, label: x.label, sub: [AUDIO_WORD[x.kind] || '', x.isDefault ? 'In use' : ''].filter(Boolean).join(' · '), op: 'out', dev: x, plain: true });
    }
    if (d.inputs.length > 1) {
      out.push({ label: 'Microphone', header: true, key: 'h:in' });
      for (const x of d.inputs) out.push({ key: 'i:' + x.id, label: x.label, sub: [AUDIO_WORD[x.kind] || '', x.isDefault ? 'In use' : ''].filter(Boolean).join(' · '), op: 'in', dev: x, plain: true });
    }
    const card = o && d.cards.find((c) => sameDevice(c.id, o.id));
    if (card && card.profiles.length > 1) {
      out.push({ label: 'Headset mode', header: true, key: 'h:mode' });
      for (const pr of card.profiles) out.push({ key: 'p:' + pr.id, label: pr.label, sub: card.profile === pr.id ? 'In use' : '', op: 'profile', card: card.id, profile: pr.id, plain: true });
    }
    return out;
  }

  async function flowSound() {
    if (modal || busy) return;
    const st = { data: null, note: '', at: '', volTimer: null, volPending: null, error: '' };
    const reload = async (s) => {
      const r = await call(() => api.audio('info', {}));
      if (r.ok) s.data = r;
      else if (!s.data) s.error = r.error || "Couldn't read the sound devices.";
    };
    busy = true;
    setStatus('Looking for sound devices…');
    try { await reload(st); } finally { busy = false; setStatus(''); }
    if (!st.data) { await notice('Sound', st.error); return refreshTileNotes(true); }
    for (;;) {
      const it = await liveList(st, {
        title: 'Sound',
        items: soundItems,
        body: (s) => s.note || 'Left and right change the volume. A on a volume bar mutes it.',
        reload,
        every: 5000,
      });
      st.note = '';
      if (!it) break;
      await flushVolume(st);
      let r = null;
      if (it.op === 'mute') r = await call(() => api.audio('mute', { kind: it.kind, id: it.dev.id, on: !it.dev.mute }));
      else if (it.op === 'out' || it.op === 'in') {
        r = await call(() => api.audio('setDefault', { kind: it.op === 'out' ? 'output' : 'input', id: it.dev.id }));
        if (r.ok) st.note = `Now using ${it.dev.label}.`;
      } else if (it.op === 'profile') {
        r = await call(() => api.audio('profile', { card: it.card, profile: it.profile }));
        if (r.ok) await sleep(700); // the headset needs a moment to switch
      }
      if (r && !r.ok) st.note = r.error || 'That did not work.';
      await reload(st);
    }
    await flushVolume(st);
    refreshTileNotes(true);
  }

  // ------------------------------------------------------------------ Bluetooth
  function btSub(d) {
    const parts = [KIND_WORD[d.kind] || 'Device'];
    if (d.paired) parts.push(d.connected ? 'Connected' : 'Not connected');
    else parts.push('Ready to pair');
    if (typeof d.battery === 'number') parts.push(`${d.battery}%`);
    return parts.join(' · ');
  }
  function btItems(st) {
    const d = st.data;
    const out = [{ label: 'Bluetooth', header: true, key: 'h:bt' }];
    out.push({ key: 'power', label: d.adapter.powered ? 'Bluetooth is on' : 'Bluetooth is off', sub: d.adapter.powered ? 'A switches it off' : 'A switches it on', op: 'power', plain: true });
    if (!d.adapter.powered) return out;
    const mine = d.devices.filter((x) => x.paired);
    const near = d.devices.filter((x) => !x.paired);
    if (mine.length) {
      out.push({ label: 'My devices', header: true, key: 'h:mine' });
      for (const x of mine) out.push({ key: 'd:' + x.id, label: x.name, sub: btSub(x), op: 'dev', dev: x, plain: true });
    }
    out.push({ label: st.scanning ? 'Nearby · searching…' : 'Nearby', header: true, key: 'h:near' });
    if (!near.length) out.push({ key: 'empty', label: st.scanning ? 'Put your device in pairing mode' : 'Nothing found yet', info: true, plain: true });
    for (const x of near) out.push({ key: 'd:' + x.id, label: x.name, sub: btSub(x), op: 'dev', dev: x, plain: true });
    out.push({ key: 'scan', label: st.scanning ? 'Stop searching' : 'Search for devices', op: 'scan', plain: true });
    return out;
  }
  const BT_WAIT = (name, op) => (p, stopping) => {
    if (stopping) return 'Canceling…';
    const what = op === 'pair' && p.stage !== 'Connecting' ? `Pairing with ${name}` : `Connecting to ${name}`;
    const tip = op === 'pair' ? 'Keep it switched on, in pairing mode, and close by.' : 'Keep it switched on and close by.';
    return `${what} · ${clock(p.elapsed)}\n${tip}`;
  };

  async function btAct(st, dev, op) {
    const r = await gated(() => api.bluetooth(op, { id: dev.id }));
    if (!r.ok) { st.note = r.canceled ? '' : r.error || 'That did not work.'; return; }
    const res = await watchJob('bluetooth', { title: op === 'pair' ? 'Pairing' : 'Connecting', body: BT_WAIT(dev.name, op) });
    if (op === 'pair') st.scanning = false; // pairing stops the search
    if (res.result === 'connected') st.note = `${dev.name} is connected.`;
    else if (res.result === 'canceled') st.note = 'Canceled.';
    else if (res.result === 'paired') st.note = `${dev.name} is paired, but not connected. ${res.error || ''}`.trim();
    else st.note = [res.error || "That didn't work.", res.detail ? `(${res.detail})` : ''].filter(Boolean).join(' ');
  }

  async function flowBluetooth() {
    if (modal || busy) return;
    const st = { data: null, note: '', at: '', scanning: false, error: '' };
    const reload = async (s) => {
      const r = await call(() => api.bluetooth('info', {}));
      if (r.ok) s.data = r;
      else if (!s.data) s.error = r.error || "Couldn't read Bluetooth.";
    };
    busy = true;
    setStatus('Looking for Bluetooth…');
    try { await reload(st); } finally { busy = false; setStatus(''); }
    if (!st.data) { await notice('Bluetooth', st.error); return refreshTileNotes(true); }
    if (!st.data.adapter.present) { await notice('Bluetooth', "No Bluetooth adapter was found on this machine."); return refreshTileNotes(true); }
    if (st.data.adapter.powered) { const r = await call(() => api.bluetooth('scan', { on: true })); st.scanning = Boolean(r.ok); }
    try {
      for (;;) {
        const it = await liveList(st, {
          title: 'Bluetooth',
          items: btItems,
          body: (s) => s.note || (s.data.adapter.powered ? 'To pair a controller or headset, put it in pairing mode, then choose it from Nearby.' : ''),
          reload,
          every: 3000,
        });
        st.note = '';
        if (!it) break;
        if (it.op === 'power') {
          const on = !st.data.adapter.powered;
          const r = await call(() => api.bluetooth('power', { on }));
          if (!r.ok) st.note = r.error || "Couldn't change Bluetooth.";
          else if (on) { const s = await call(() => api.bluetooth('scan', { on: true })); st.scanning = Boolean(s.ok); } else st.scanning = false;
        } else if (it.op === 'scan') {
          const r = await call(() => api.bluetooth('scan', { on: !st.scanning }));
          if (r.ok) st.scanning = !st.scanning; else st.note = r.error || "Couldn't search.";
        } else if (it.op === 'dev') {
          const d = it.dev;
          if (!d.paired) await btAct(st, d, 'pair');
          else {
            const c = await pick(d.name, [
              d.connected ? { label: 'Disconnect', op: 'disconnect', plain: true } : { label: 'Connect', op: 'connect', plain: true },
              { label: 'Forget this device', op: 'forget', plain: true },
              { label: 'Back', plain: true },
            ], 0, { body: btSub(d) });
            if (c && c.op === 'connect') await btAct(st, d, 'connect');
            else if (c && c.op === 'disconnect') {
              const r = await call(() => api.bluetooth('disconnect', { id: d.id }));
              st.note = r.ok ? `${d.name} is disconnected.` : r.error || "Couldn't disconnect.";
            } else if (c && c.op === 'forget') {
              if (await confirm(`Forget ${d.name}? You would have to pair it again.`, 'Forget')) {
                const r = await gated(() => api.bluetooth('forget', { id: d.id }));
                st.note = r.ok ? `${d.name} was removed.` : r.canceled ? '' : r.error || "Couldn't remove it.";
              }
            }
          }
        }
        await reload(st);
      }
    } finally {
      await call(() => api.bluetooth('stop', {}));
      refreshTileNotes(true);
    }
  }

  // ------------------------------------------------------------------ Wi-Fi
  const SEC_WORD = { open: 'Open', secured: 'Secured', enterprise: 'Sign-in needed', wep: 'Old security' };
  function wifiItems(st) {
    const d = st.data;
    const out = [{ label: 'Wi-Fi', header: true, key: 'h:wifi' }];
    out.push({ key: 'radio', label: d.radio ? 'Wi-Fi is on' : 'Wi-Fi is off', sub: d.radio ? 'A switches it off' : 'A switches it on', op: 'radio', plain: true });
    if (d.wired) out.push({ key: 'wired', label: 'Connected by cable', sub: 'Ethernet', info: true, plain: true });
    if (!d.radio) return out;
    out.push({ label: 'Networks', header: true, key: 'h:nets' });
    if (!d.networks.length) out.push({ key: 'empty', label: 'Looking for networks…', info: true, plain: true });
    for (const n of d.networks) {
      out.push({
        key: 'n:' + n.ssid,
        label: n.ssid,
        sub: [n.inUse ? 'Connected' : n.saved ? 'Saved' : '', n.word, SEC_WORD[n.security] || ''].filter(Boolean).join(' · '),
        op: 'net',
        net: n,
        plain: true,
      });
    }
    out.push({ key: 'hidden', label: 'Join a hidden network…', op: 'hidden', plain: true });
    out.push({ key: 'again', label: 'Look again', op: 'again', plain: true });
    return out;
  }
  const WIFI_WAIT = (name) => (p, stopping) => (stopping ? 'Canceling…' : `Joining ${name} · ${clock(p.elapsed)}\nThis can take up to half a minute.`);

  async function wifiJoin(st, ssid, security, hidden) {
    if (security === 'enterprise') { st.note = "Networks that ask for a user name aren't supported here yet. Use Desktop Mode for this one."; return; }
    if (security === 'wep') { st.note = "This network uses old WEP security, which isn't supported."; return; }
    let password = '';
    if (security === 'secured' || security === 'hiddenAsk') {
      const text = await ask(`Password for ${ssid}`, '', { max: 63, symbols: true });
      if (text === null) return;
      password = text;
      if (hidden && !password) { /* a hidden network that is open */ } else if (!/^[\x20-\x7e]{8,63}$/.test(password)) { st.note = 'A Wi-Fi password has 8 to 63 characters.'; return; }
    }
    const r = await gated(() => api.wifi('join', { ssid, password, hidden: Boolean(hidden) }));
    password = '';
    await wifiFinish(st, ssid, r);
  }
  async function wifiFinish(st, ssid, started) {
    if (!started.ok) { st.note = started.canceled ? '' : started.error || 'That did not work.'; return; }
    const res = await watchJob('wifi', { title: 'Joining', body: WIFI_WAIT(ssid) });
    if (res.result === 'connected') st.note = `Connected to ${ssid}.`;
    else if (res.result === 'canceled') st.note = 'Canceled.';
    else st.note = [res.error || "Couldn't join that network.", res.detail ? `(${res.detail})` : ''].filter(Boolean).join(' ');
  }

  async function flowWifi() {
    if (modal || busy) return;
    const st = { data: null, note: '', at: '', error: '' };
    const reload = async (s) => {
      const r = await call(() => api.wifi('info', {}));
      if (r.ok) s.data = r;
      else if (!s.data) s.error = r.error || "Couldn't read the network.";
    };
    busy = true;
    setStatus('Looking for networks…');
    try { await reload(st); } finally { busy = false; setStatus(''); }
    if (!st.data) { await notice('Wi-Fi', st.error); return refreshTileNotes(true); }
    if (!st.data.present) { await notice('Wi-Fi', st.data.wired ? 'No Wi-Fi was found. This machine is connected by cable.' : 'No Wi-Fi was found on this machine.'); return refreshTileNotes(true); }
    if (st.data.radio) call(() => api.wifi('rescan', {})); // a fresh look in the background; the list updates on its own
    try {
      for (;;) {
        const it = await liveList(st, {
          title: 'Wi-Fi',
          items: wifiItems,
          body: (s) => s.note || (s.data.networks.some((n) => n.inUse) ? '' : s.data.radio ? 'Not connected to a network.' : ''),
          reload,
          every: 4000,
        });
        st.note = '';
        if (!it) break;
        if (it.op === 'radio') {
          const on = !st.data.radio;
          const r = await gated(() => api.wifi('radio', { on }));
          if (!r.ok && !r.canceled) st.note = r.error || "Couldn't change Wi-Fi.";
          else if (r.ok && on) { await sleep(1500); call(() => api.wifi('rescan', {})); }
        } else if (it.op === 'again') {
          await call(() => api.wifi('rescan', {}));
          st.note = 'Looking again…';
          await sleep(2500);
          const r = await call(() => api.wifi('info', { rescan: false }));
          if (r.ok) st.data = r;
          st.note = '';
        } else if (it.op === 'hidden') {
          const name = await ask('Network name', '', { max: 32, symbols: true });
          if (name) await wifiJoin(st, name, 'hiddenAsk', true);
        } else if (it.op === 'net') {
          const n = it.net;
          if (n.inUse || n.saved) {
            const c = await pick(n.ssid, [
              n.inUse ? { label: 'Disconnect', op: 'disconnect', plain: true } : { label: 'Connect', op: 'connect', plain: true },
              { label: 'Forget this network', op: 'forget', plain: true },
              { label: 'Back', plain: true },
            ], 0, { body: [n.word, SEC_WORD[n.security]].filter(Boolean).join(' · ') });
            if (c && c.op === 'connect') await wifiFinish(st, n.ssid, await call(() => api.wifi('connect', { ssid: n.ssid })));
            else if (c && c.op === 'disconnect') {
              const r = await call(() => api.wifi('disconnect', {}));
              st.note = r.ok ? 'Disconnected.' : r.error || "Couldn't disconnect.";
            } else if (c && c.op === 'forget') {
              if (await confirm(`Forget ${n.ssid}? You would have to enter the password again.`, 'Forget')) {
                const r = await gated(() => api.wifi('forget', { ssid: n.ssid }));
                st.note = r.ok ? `${n.ssid} was forgotten.` : r.canceled ? '' : r.error || "Couldn't forget it.";
              }
            }
          } else {
            await wifiJoin(st, n.ssid, n.security, false);
          }
        }
        await reload(st);
      }
    } finally {
      refreshTileNotes(true);
    }
  }

  // ------------------------------------------------------------------ Power
  const POWER_ASK = { restart: ['Restart the console?', 'Restart'], shutdown: ['Shut the console down?', 'Shut down'] };
  async function flowPower() {
    if (modal || busy) return;
    const it = await pick('Power', [
      { label: 'Sleep', sub: 'Wake it with the controller', op: 'sleep', plain: true },
      { label: 'Restart', op: 'restart', plain: true },
      { label: 'Shut down', op: 'shutdown', plain: true },
      { label: 'Back', plain: true },
    ], 0, {});
    if (!it || !it.op) return;
    if (POWER_ASK[it.op] && !(await confirm(POWER_ASK[it.op][0], POWER_ASK[it.op][1]))) return;
    const r = await gated(() => api.power(it.op));
    if (r.canceled) return;
    if (!r.ok) { setStatus(r.error || 'That did not work.', true); return; }
    if (it.op === 'sleep') return;
    await pick(it.op === 'restart' ? 'Restarting…' : 'Shutting down…', [{ label: 'Close', op: 'close', plain: true }], 0, {
      body: it.op === 'restart' ? 'The console is restarting. This takes a moment.' : 'The console is shutting down.',
    });
  }

  // ------------------------------------------------------------------ notes on the Settings tiles
  let notesAt = 0;
  let notesBusy = false;
  function refreshTileNotes(force) {
    if (!api.summaries || notesBusy) return;
    if (!force && Date.now() - notesAt < 15000) return;
    notesBusy = true;
    notesAt = Date.now();
    Promise.resolve(api.summaries()).then((s) => {
      notesBusy = false;
      if (!s || typeof s !== 'object') return;
      const next = { wifi: hasText(s.wifi).slice(0, 40), bluetooth: hasText(s.bluetooth).slice(0, 40), audio: hasText(s.audio).slice(0, 40) };
      if (JSON.stringify(next) === JSON.stringify(tileNotes)) return;
      tileNotes = next;
      if (page === 'settings' && !stack.length && !modal) render();
    }).catch(() => { notesBusy = false; });
  }

  window.flowWifi = flowWifi;
  window.flowBluetooth = flowBluetooth;
  window.flowSound = flowSound;
  window.flowPower = flowPower;
  window.refreshTileNotes = refreshTileNotes;
})();
