'use strict';
// Report a problem, on the real main process: nothing is made until asked, a report lands in the
// vault's reports folder, carries no home folder, computer name, IP address or PIN hash, and can be deleted.
// (The screens that show it are checked by ludus.py --qa.)
const test = require('node:test');
test.after(() => { setImmediate(() => process.exit()); });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./xbox-harness');

const LAUNCHER = path.join(__dirname, '..');

test('report: made only when asked, scrubbed, deletable', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'report-'));
  const data = path.join(tmp, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ firstRunDone: true, pin: { salt: '0'.repeat(32), hash: '1'.repeat(64) } }));
  const state = path.join(tmp, 'state', 'tessera');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'session.log'), `session start\nlauncher at ${path.join(tmp, 'home')}/x on ${os.hostname()} via 192.168.4.20\n`);
  for (const k of Object.keys(require.cache)) if (k.startsWith(LAUNCHER + path.sep) && !k.includes(path.sep + 'test' + path.sep)) delete require.cache[k];
  const h = await H.load({ launcher: LAUNCHER, tmp });
  const R = (op, p) => h.call('report', op, p || {});

  const c = await R('contents');
  assert.ok(c.ok && c.contents.length >= 6, 'it says what goes in it');
  const rep = c.folder;
  assert.strictEqual(fs.existsSync(rep) ? fs.readdirSync(rep).length : 0, 0, 'nothing is made until asked');

  const r = await R('make');
  assert.ok(r.ok, r.error);
  const files = fs.readdirSync(rep);
  assert.strictEqual(files.length, 1);
  assert.match(files[0], /^tessera-report-\d{8}-\d{6}\.txt$/);
  assert.strictEqual(r.name, files[0]);
  const text = fs.readFileSync(path.join(rep, files[0]), 'utf8');
  for (const s of ['== Tessera', '== System', '== Hardware', '== Starting up', '== Tessera session log (this session)', '== Settings']) assert.ok(text.includes(s), `has ${s}`);
  assert.ok(!text.includes(path.join(tmp, 'home')), 'no home folder');
  if (os.hostname().length > 1 && os.hostname() !== 'localhost') assert.ok(!text.includes(os.hostname()), 'no computer name');
  assert.ok(!text.includes('192.168.4.20'), 'no IP address');
  assert.ok(!/[0-9a-f]{64}/.test(text), 'not even the PIN hash');
  assert.strictEqual(r.text, text);

  assert.strictEqual((await R('delete', { name: '../../etc/passwd' })).ok, false, 'only report names');
  assert.ok((await R('delete', { name: r.name })).ok);
  assert.strictEqual(fs.readdirSync(rep).length, 0);
  assert.strictEqual((await R('nope')).ok, false);
});
