// SPDX-License-Identifier: GPL-3.0-or-later
// Install Tessera and Recover (on the live USB), for the Qt screen.
// The steps (installer-steps.js and recovery-steps.js, beside this file), run here as they
// are, so nothing in them is rewritten or can drift: they are plain "ask, wait for the answer, go on"
// code, which the screen's QML (no async/await) can't run. Their menus and questions go to the screen:
//   event flow-ui { id, kind: pick | ask | progress | progress-set | progress-close | status, ... }
// and the screen answers with the call __flow ['answer', id, value] ('back', id for the progress menu).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function flowHost({ handlers, out, launcher, event }) {
  let seq = 0;
  const waiting = new Map(); // id -> resolve
  let running = null;        // the flow in progress, if any
  let progress = null;       // the progress menu open now, if any

  const ui = (msg) => new Promise((resolve) => { const id = ++seq; waiting.set(id, resolve); out({ event: 'flow-ui', data: { id, ...msg } }); });
  const note = (msg) => out({ event: 'flow-ui', data: { id: 0, ...msg } });
  // what the screen needs of a menu row: the words and the look; the rest stays here
  const rows = (items) => items.map((it) => {
    const r = { label: String(it.label == null ? '' : it.label) };
    for (const k of ['sub', 'header', 'plain', 'ok', 'danger', 'info', 'dim']) if (it[k] !== undefined && it[k] !== '') r[k] = it[k];
    return r;
  });

  const call = (name) => async (op, payload) => {
    const h = handlers.get(name);
    if (!h) return { ok: false, error: `${name} isn't here` };
    return h.fn(event, op, payload);
  };

  const ctx = {
    console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Object, Array, Set, Map, String, Number, Boolean, RegExp, Error,
    prefs: { live: true },
    busy: false,
    modal: null,
    api: { installer: call('installer'), recovery: call('recovery') },
    reveal() {},
    setStatus(msg, isError) { note({ kind: 'status', text: String(msg || ''), error: Boolean(isError) }); },
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    fmtClock: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
    async pick(title, items, index = 0, extra = {}) {
      const i = await ui({ kind: 'pick', title, items: rows(items), index, body: extra.body || '', welcome: Boolean(extra.welcome) });
      return typeof i === 'number' && i >= 0 && i < items.length ? items[i] : null;
    },
    async ask(title, initial = '', opts = {}) {
      const t = await ui({ kind: 'ask', title, initial: String(initial || ''), opts: { secret: Boolean(opts.secret), max: opts.max || 0, digits: Boolean(opts.digits) } });
      return typeof t === 'string' ? t : null;
    },
    // the one menu these flows keep open and change as a job goes on (the install, a backup, a disk check)
    openList(o) {
      const m = { title: o.title, items: o.items, body: o.body || '', onBack: o.onBack || (() => {}) };
      ctx.modal = progress = m;
      note({ kind: 'progress', title: m.title, items: rows(m.items), body: m.body });
    },
    renderModal() { if (progress && ctx.modal === progress) note({ kind: 'progress-set', items: rows(progress.items), body: progress.body }); },
    closeModal() { if (progress) note({ kind: 'progress-close' }); progress = null; ctx.modal = null; },
  };
  vm.createContext(ctx);
  let loaded = false;
  function load() {
    if (loaded) return;
    for (const f of ['installer-steps.js', 'recovery-steps.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
    }
    loaded = true;
  }

  return {
    // __flow ['start', 'install' | 'recover'] -> true when it started (one at a time)
    start(which) {
      load();
      if (running) return false;
      const fn = which === 'recover' ? 'flowRecovery' : 'flowInstaller';
      running = vm.runInContext(`${fn}()`, ctx).catch((e) => { ctx.setStatus(`That didn't work: ${(e && e.message) || e}`, true); })
        .finally(() => { running = null; ctx.busy = false; ctx.closeModal(); note({ kind: 'end' }); });
      return true;
    },
    answer(id, value) { const r = waiting.get(id); if (r) { waiting.delete(id); r(value); } return true; },
    back() { if (progress) progress.onBack(); return true; },
  };
};
