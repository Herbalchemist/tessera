// Drives backend/flowhost.js with made-up main-process handlers; prints the events it saw as JSON.
// argv: root  scenario   (scenario: install | recover | backup)
'use strict';
const path = require('path');
const root = process.argv[2];
const scenario = process.argv[3];
const L = path.join(root, 'system_files/usr/lib/tessera/launcher');
const handlers = new Map();
const sawCalls = [];
const inst = { id: 'i1', disk: { model: 'Disk', size: 1e12 }, versions: [{ version: '1', index: 0 }], users: [{ name: 'alex', admin: true }] };
handlers.set('installer', { fn: async (e, op, p) => { sawCalls.push(['installer', op]); return { ok: false, error: 'no helper in a test' }; } });
handlers.set('recovery', { fn: async (e, op, p) => {
  sawCalls.push(['recovery', op, p && p.tool || '']);
  if (op === 'probe') return { ok: true, installs: [inst] };
  if (op === 'diagnose') return { ok: true, findings: [{ text: 'Start-up menu missing', fix: 'boot' }], graphics: {} };
  if (op === 'fix') return p.password === 'right' ? { ok: true, done: ['Rewrote the menu'] } : { ok: false, needPassword: true, error: 'Wrong password.' };
  return { ok: false };
} });
const events = [];
let fh;
// answers: what the "screen" does for each question, by title
const script = {
  install: { 'Welcome to Tessera': 'Install Tessera' },
  recover: { 'Welcome to Tessera': 'Recover', 'Recover': 'Repair the boot menu', 'Password for alex': 'right', 'Done': 'OK' },
};
let recoverDone = false;
const out = (m) => {
  events.push(m);
  const d = m.data;
  if (!d || !d.id) return;
  setTimeout(() => {
    if (d.kind === 'pick') {
      const want = (script[scenario] || {})[d.title];
      let i = want ? d.items.findIndex((x) => x.label === want) : -1;
      if (d.title === 'Done') recoverDone = true;
      if (scenario === 'recover' && recoverDone && d.title === 'Recover') i = -1; // back out of the menu
      fh.answer(d.id, i);
    } else if (d.kind === 'ask') fh.answer(d.id, (script[scenario] || {})[d.title] || null);
  }, 2);
};
fh = require(path.join(root, 'system_files/usr/lib/tessera/ludus-qt/backend/flowhost.js'))({ handlers, out, launcher: L, event: {} });
fh.start(scenario === 'recover' ? 'recover' : 'install');
const t0 = Date.now();
const wait = setInterval(() => {
  if (events.some((e) => e.data && e.data.kind === 'end') || Date.now() - t0 > 6000) {
    clearInterval(wait);
    console.log(JSON.stringify({ events: events.map((e) => e.data), calls: sawCalls }));
    process.exit(0);
  }
}, 20);
