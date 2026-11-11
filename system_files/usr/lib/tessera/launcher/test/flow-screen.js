'use strict';
// A screen for the Install and Recover flows (ludus-qt/backend/flowhost.js): it answers each question
// by its title, picking the row whose label (or sub) matches, the way a person at the screen would.
const assert = require('node:assert');
const path = require('node:path');
const LAUNCHER = path.join(__dirname, '..');
const FLOWHOST = path.resolve(LAUNCHER, '..', 'ludus-qt', 'backend', 'flowhost.js');

// A screen that answers the flow: by title, picking the row whose label (or sub) matches.
function screen(handlers) {
  const events = [];
  const pending = [];
  const fh = require(FLOWHOST)({ handlers, out: (m) => { events.push(m.data); if (m.data && m.data.id) pending.push(m.data); }, launcher: LAUNCHER, event: {} });
  const waitFor = async (title, ms = 10000) => {
    const t0 = Date.now();
    for (;;) {
      const i = pending.findIndex((e) => e.title === title);
      if (i >= 0) return pending.splice(i, 1)[0];
      if (Date.now() - t0 > ms) throw new Error(`never asked "${title}"; asked: ${events.filter((e) => e.title).map((e) => e.title).join(' | ')}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  const find = (ev, want) => ev.items.findIndex((r) => (want instanceof RegExp ? want.test(`${r.label}|${r.sub || ''}`) : r.label === want));
  const api = {
    fh, events, waitFor,
    async show(title) { return waitFor(title); },
    async choose(title, want) {
      const ev = await waitFor(title);
      const i = find(ev, want);
      assert.ok(i >= 0, `"${title}" has no row ${want}: ${ev.items.map((r) => r.label).join(' / ')}`);
      fh.answer(ev.id, i);
      return ev;
    },
    async type(title, text) { const ev = await waitFor(title); fh.answer(ev.id, text === null ? ev.initial : text); return ev; },
  };
  return api;
}

module.exports = { screen };
