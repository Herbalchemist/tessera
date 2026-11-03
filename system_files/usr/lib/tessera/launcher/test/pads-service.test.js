// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus and the Joy-Con service (libexec/tessera/joycons): while it runs, Ludus leaves the Joy-Cons to
// it, shows what it made and the Joy-Cons still waiting for the player to say how they hold them, and
// passes the grip screen's choices on through its socket.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-pads-svc-'));
const sys = path.join(tmp, 'sys');
const stateFile = path.join(tmp, 'joycons.json');
const sockFile = path.join(tmp, 'joycons.sock');
Object.assign(process.env, { TESSERA_SYS_INPUT: sys, TESSERA_DEV_INPUT: path.join(tmp, 'dev'), TESSERA_SYS_POWER: path.join(tmp, 'power'), TESSERA_JOYCONS_STATE: stateFile, TESSERA_JOYCONS_SOCK: sockFile });
const pads = require('../pads');

const joycon = (node, name, uniq) => {
  const base = path.join(sys, node, 'device');
  fs.mkdirSync(path.join(base, 'id'), { recursive: true });
  fs.writeFileSync(path.join(base, 'id', 'vendor'), '057e\n');
  fs.writeFileSync(path.join(base, 'id', 'product'), '2006\n');
  fs.writeFileSync(path.join(base, 'name'), name + '\n');
  fs.writeFileSync(path.join(base, 'uniq'), uniq + '\n');
};
joycon('event5', 'Joy-Con (L)', 'aa:aa');
joycon('event6', 'Joy-Con (R)', 'bb:bb');
const L = 'aa:aa/jl', R = 'bb:bb/jr';
const ctl = () => pads.create({ prefs: () => ({ joycons: 'ask' }), onList: () => {}, onMotion: () => {}, onFrame: () => {} });
const writeState = (st) => fs.writeFileSync(stateFile, JSON.stringify(st));

test('without the service Ludus reads the Joy-Cons itself', () => {
  const c = ctl();
  assert.equal(pads.scan().length, 2);
  c._t.rescan();
  assert.equal(c.list().service, false);
  c.stop();
});

test('with the service running Ludus leaves the Joy-Cons alone and shows what the service says', () => {
  writeState({ active: true, mode: 'ask', grip: false, pads: [{ player: 1, kind: 'joined', members: [L, R], names: [] }], unassigned: [{ uniq: 'cc:cc/jl', name: 'Joy-Con (L)', kind: 'jl' }] });
  assert.deepEqual(pads.scan(), []);
  const c = ctl();
  c._t.rescan();
  const l = c.list();
  assert.equal(l.service, true);
  assert.deepEqual(l.pads, [], 'its controllers reach Ludus as ordinary gamepads, not through here');
  assert.deepEqual(l.svc.map((p) => [p.kind, p.player, p.parts]), [['joined', 1, ['jl', 'jr']], ['unassigned', 0, ['jl']]]);
  c.stop();
});

test('other controllers share the player numbers with the Joy-Cons', () => {
  writeState({ active: true, mode: 'ask', grip: false, pads: [{ player: 1, kind: 'joined', members: [L, R], names: [] }],
    others: [{ player: 2, name: 'Nintendo Wii Remote' }], unassigned: [] });
  const c = ctl();
  c._t.rescan();
  assert.deepEqual(c.list().svc.map((p) => [p.kind, p.player, p.name]), [['joined', 1, 'Joy-Con (L+R) (Nintendo)'], ['other', 2, 'Nintendo Wii Remote']]);
  c.stop();
});

test('a service that is not active (no controller could be made) is ignored', () => {
  writeState({ active: false, pads: [], unassigned: [] });
  assert.equal(pads.scan().length, 2);
});

test('the grip screen and the setup choice reach the service', async () => {
  writeState({ active: true, mode: 'ask', grip: false, pads: [], unassigned: [] });
  const got = [];
  const server = net.createServer((s) => s.on('data', (d) => { got.push(JSON.parse(String(d))); s.end('{"ok":true}\n'); }));
  await new Promise((r) => server.listen(sockFile, r));
  const c = ctl();
  c.setGrip(true);
  await new Promise((r) => setTimeout(r, 200));
  c.setGrip(false);
  await new Promise((r) => setTimeout(r, 200));
  c.regroup();
  await new Promise((r) => setTimeout(r, 200));
  c.stop();
  await new Promise((r) => server.close(r));
  assert.deepEqual(got, [{ cmd: 'grip', on: true }, { cmd: 'grip', on: false }, { cmd: 'mode', mode: 'ask' }]);
});
