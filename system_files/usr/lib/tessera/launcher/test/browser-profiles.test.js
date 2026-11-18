// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// The embedded browser keeps each person's browsing apart: every profile opens a page in its own
// session partition (cookies, logins, history), switching people closes the page that was open so
// nothing of theirs is carried over, and removing a profile takes its browser data with it.
// (The real Chromium storage is Electron's; this checks the launcher asks it for the right ones.)
const test = require('node:test');
test.after(() => { setImmediate(() => process.exit()); });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./xbox-harness');

const LAUNCHER = path.join(__dirname, '..');
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const BROWSER = 'persist:tessera-browser';
const partitionOf = (id) => `${BROWSER}-${id}`;

async function boot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-prof-'));
  made.push(tmp);
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'data', 'settings.json'), JSON.stringify({ firstRunDone: true }));
  for (const k of Object.keys(require.cache)) if (k.startsWith(LAUNCHER + path.sep) && !k.includes(path.sep + 'test' + path.sep)) delete require.cache[k]; // a fresh main process each time
  const h = await H.load({ launcher: LAUNCHER, tmp });
  const P = (op, x) => h.call('profiles', op, x || {});
  // The pages (not the pointer cursor, which is a view without a partition of its own).
  const pages = () => h.views.filter((v) => v.webPreferences.partition !== undefined);
  const last = () => pages()[pages().length - 1];
  const open = () => h.call('browser', 'open', { url: 'https://example.com/' });
  return { h, P, pages, last, open, sessions: h.sessions };
}

test('each profile browses with its own storage, and switching people closes the open page', async () => {
  const { P, pages, last, open } = await boot();

  // Everyone (nobody's profile) still browses in the storage Tessera always had. (Once profiles
  // exist, Guest's browser is the admin's call; that is checked in profiles.test.js.)
  assert.strictEqual((await open()).ok, true);
  assert.strictEqual(last().webPreferences.partition, BROWSER);

  const ana = (await P('add', { name: 'Ana', start: 'fresh' })).id;
  const bo = (await P('add', { name: 'Bo', start: 'fresh' })).id;

  assert.ok((await P('use', { id: ana })).ok, 'switch to Ana');
  const everyone = last();
  assert.strictEqual(everyone.attached, false, 'the page the previous person had is taken off screen');
  assert.strictEqual(everyone.webContents.isDestroyed(), true, "and closed, so none of their page is left for Ana");

  await open();
  const anaPage = last();
  assert.strictEqual(anaPage.webPreferences.partition, partitionOf(ana), "Ana's own cookies, logins and history");

  assert.ok((await P('use', { id: bo })).ok, 'switch to Bo');
  assert.strictEqual(anaPage.webContents.isDestroyed(), true, "Ana's page goes when Bo sits down");
  await open();
  assert.strictEqual(last().webPreferences.partition, partitionOf(bo), "Bo's own, not Ana's");

  assert.ok((await P('use', { id: ana })).ok, 'back to Ana');
  await open();
  assert.strictEqual(last().webPreferences.partition, partitionOf(ana), 'Ana finds her own logins again');
  assert.notStrictEqual(last(), anaPage, 'in a fresh page');

  const used = pages().map((v) => v.webPreferences.partition).sort();
  assert.deepStrictEqual([...new Set(used)], [BROWSER, partitionOf(ana), partitionOf(bo)].sort(), 'three separate browsers');
});

test("removing a profile clears that profile's browser data, and nobody else's", async () => {
  const { P, last, open, sessions } = await boot();
  const ana = (await P('add', { name: 'Ana', start: 'fresh' })).id;
  const bo = (await P('add', { name: 'Bo', start: 'fresh' })).id;
  await P('use', { id: ana });
  await open();
  await P('use', { id: bo });
  await open();
  const boSession = sessions.get(partitionOf(bo));

  assert.ok((await P('remove', { id: ana })).ok);
  const anaSession = sessions.get(partitionOf(ana));
  assert.strictEqual(anaSession.cleared, 1, "Ana's cookies, logins and history are wiped");
  assert.strictEqual(anaSession.caches, 1, 'and her cached pages');
  assert.strictEqual(boSession.cleared, 0, "Bo's browser is left alone");
  assert.strictEqual(boSession.caches, 0);
  assert.strictEqual(last().webContents.isDestroyed(), false, "Bo's page is still open");
});
