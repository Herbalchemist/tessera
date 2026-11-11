'use strict';
// Recover, on the Tessera USB: the real main process (its recovery handler) and the real step code
// (ludus-qt/backend/flowhost.js), answering like the screen would. The USB's root helper (live-recover,
// from the tessera-mortar repo, with its own tests there) is a stand-in that answers like the real one
// and records what it was asked. Recover is on the welcome screen; the install is found and what's wrong
// is shown with the suggested repairs; a repair asks for an administrator's password, which goes to the
// helper on its input (never its command line); a wrong password can be tried again; a report can be read.
const test = require('node:test');
test.after(() => { setImmediate(() => process.exit()); });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./xbox-harness');
const { screen } = require('./flow-screen');

const LAUNCHER = path.join(__dirname, '..');
const ID = '1234abcd-0000:default';
const INST = { id: ID, disk: { name: 'nvme0n1', model: 'Samsung SSD 980', size: 1000204886016 }, hostname: 'x', versions: [{ index: 0, version: '43.20261101.0', image: 'ghcr.io/herbalchemist/tessera:latest' }, { index: 1, version: '43.20261031.0', image: '' }], users: [{ name: 'alex', admin: true }, { name: 'kid', admin: false }] };

test('Recover: repairs, versions, graphics, reset, backup, disk check and space', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'data', 'settings.json'), JSON.stringify({ firstRunDone: true }));
  const helper = path.join(tmp, 'live-recover');
  fs.writeFileSync(path.join(tmp, 'probe.json'), JSON.stringify({ ok: true, installs: [INST] }));
  fs.writeFileSync(path.join(tmp, 'diagnose.json'), JSON.stringify({ ok: true, install: INST, findings: [{ key: 'signin', text: "Tessera isn't set to start at boot.", fix: 'signin' }, { key: 'firmware', text: 'Another system starts first (Windows Boot Manager).', fix: 'boot' }, { key: 'graphics', text: 'This Tessera is the AMD / Intel build, but this computer needs the NVIDIA GTX 16 / RTX build.', fix: 'graphics' }, { key: 'versions', text: 'An earlier version is kept.', fix: null }], graphics: { have: 'standard', want: 'nvidia-open', cards: ['NVIDIA'] } }));
  fs.writeFileSync(path.join(tmp, 'report.json'), JSON.stringify({ ok: true, text: 'Tessera recovery report\n== What was found\n- sign-in off\n', saved: '~/Tessera/Reports/tessera-recovery-report-1.txt (alex)' }));
  fs.writeFileSync(helper, `#!/bin/bash
T=${JSON.stringify(tmp)}
echo "$*" >> "$T/args"
case "$1" in
  probe|diagnose|report) cat "$T/$1.json" ;;
  space) echo '{"ok": true, "free": 1500000000, "total": 256000000000, "versions": 2, "people": [{"name": "alex", "home": 120000000000, "games": 100000000000, "caches": 3000000000, "shaders": 2000000000, "trash": 500000000}]}' ;;
  drives) echo '{"ok": true, "drives": [{"uuid": "AB12-CD34", "fstype": "exfat", "label": "STICK", "model": "SanDisk", "size": 64000000000, "free": 50000000000}]}' ;;
  state) n=$(cat "$T/polls" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$T/polls"; job=$(cat "$T/job" 2>/dev/null)
         if [ "$job" = check ]; then
           if [ $n -lt 3 ]; then echo '{"ok": true, "job": "check", "phase": "checking", "step": 3, "steps": 4, "line": "The main file system", "done": 5000000000, "total": 20000000000}'
           else echo '{"ok": true, "job": "check", "phase": "done", "repair": false, "healthy": false, "results": [{"ok": true, "text": "The drive reports good health."}, {"ok": false, "text": "The main file system: 2 damaged blocks found (Repair rewrites what has a second copy)."}], "files": ["alex/Games/big.bin"]}'; fi
         elif [ "$job" = repair ]; then
           if [ $n -lt 2 ]; then echo '{"ok": true, "job": "check", "phase": "checking", "step": 1, "steps": 4, "line": "The drive health"}'
           else echo '{"ok": true, "job": "check", "phase": "done", "repair": true, "healthy": true, "results": [{"ok": true, "text": "The main file system: 2 damaged blocks repaired from their second copy."}], "files": []}'; fi
         elif [ $n -lt 3 ]; then echo '{"ok": true, "phase": "copying", "done": 1000000, "total": 4000000, "line": "Pictures/a.png"}'; else echo '{"ok": true, "phase": "done", "copied": 42, "skipped": 1, "folder": "Tessera backup 2026-11-02 1200", "drive": "STICK"}'; fi ;;
  check) rm -f "$T/polls"
       if [ "$3" = --repair ]; then in=$(cat); echo "$in" >> "$T/stdin"
         if echo "$in" | grep -q '"password":"tessera1"'; then echo repair > "$T/job"; echo '{"ok": true, "started": true}'; else echo '{"ok": false, "needPassword": true, "error": "nope"}'; fi
       else echo check > "$T/job"; echo '{"ok": true, "started": true}'; fi ;;
  backup) rm -f "$T/polls" "$T/job"; in=$(cat); echo "$in" >> "$T/stdin"
       if echo "$in" | grep -q '"password":"tessera1"'; then echo '{"ok": true, "started": true}'; else echo '{"ok": false, "needPassword": true, "error": "nope"}'; fi ;;
  fix) in=$(cat); echo "$in" >> "$T/stdin"
       if echo "$in" | grep -q '"password":"tessera1"'; then echo '{"ok": true, "done": ["turned on for version 43.20261101.0"]}'; else echo '{"ok": false, "needPassword": true, "error": "That is not the password of an administrator account on this Tessera."}'; exit 1; fi ;;
esac
`, { mode: 0o755 });
  Object.assign(process.env, { TESSERA_INSTALLER: '1', TESSERA_LIVE_RECOVER: helper, TESSERA_LIVE_INSTALL_NOSUDO: '1' });
  for (const k of Object.keys(require.cache)) if (k.startsWith(LAUNCHER + path.sep) && !k.includes(path.sep + 'test' + path.sep)) delete require.cache[k];
  const h = await H.load({ launcher: LAUNCHER, tmp, realSpawn: true });
  const handlers = new Map(Object.keys(h.handlers).map((k) => [k, { fn: (e, ...a) => h.call(k, ...a) }]));
  const ui = screen(handlers);
  const stdin = () => fs.readFileSync(path.join(tmp, 'stdin'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const args = () => fs.readFileSync(path.join(tmp, 'args'), 'utf8');
  const rx = (s) => new RegExp(s.replace(/[.:]/g, '\\$&'));
  const labels = (ev) => ev.items.map((r) => r.label).join('|');
  const row = (ev, label) => ev.items.find((r) => r.label === label);
  const done = async () => { const d = await ui.show('Done'); ui.fh.answer(d.id, 0); return d; };

  ui.fh.start('install');
  const welcome = await ui.show('Welcome to Tessera');
  assert.strictEqual(labels(welcome), 'Install Tessera|Try it first|Recover');
  ui.fh.answer(welcome.id, 2);

  let menu = await ui.show('Recover');
  assert.match(menu.body, /Samsung SSD 980/);
  assert.match(menu.body, /isn't set to start at boot/);
  assert.strictEqual(JSON.stringify([row(menu, 'Start in Tessera at boot again').sub, row(menu, 'Start in Tessera at boot again').ok]), '["suggested",true]');
  assert.strictEqual(JSON.stringify([row(menu, 'Repair the boot menu').sub, row(menu, 'Repair the boot menu').ok]), '["suggested",true]');

  // the repair: a wrong password first, then the right one
  ui.fh.answer(menu.id, menu.items.findIndex((r) => r.label === 'Start in Tessera at boot again'));
  await ui.type('Password for alex', 'wrong');
  const wrong = await ui.show('Wrong password');
  ui.fh.answer(wrong.id, 0);
  await ui.type('Password for alex', 'tessera1');
  assert.match((await done()).body, /turned on for version 43\.20261101\.0/);
  assert.doesNotMatch(args(), /tessera1|wrong/, 'the password is never on the command line');
  assert.match(args(), new RegExp(`^fix ${ID.replace(/[.:]/g, '\\$&')}$`, 'm'));
  assert.strictEqual(JSON.stringify(stdin()), JSON.stringify([{ tool: 'signin', user: 'alex', password: 'wrong' }, { tool: 'signin', user: 'alex', password: 'tessera1' }]));

  // the report
  menu = await ui.show('Recover');
  ui.fh.answer(menu.id, menu.items.findIndex((r) => r.label === 'Make a problem report'));
  const rep = await ui.waitFor('Saved: ~/Tessera/Reports/tessera-recovery-report-1.txt (alex)');
  assert.ok(rep.items.some((r) => r.header && r.label === 'What was found'));
  ui.fh.answer(rep.id, -1);

  // Versions: undo the last update
  menu = await ui.show('Recover');
  ui.fh.answer(menu.id, menu.items.findIndex((r) => r.label === 'Versions'));
  const vs = await ui.show('Versions');
  assert.strictEqual(JSON.stringify(vs.items.map((r) => [r.label, r.sub])), JSON.stringify([['Version 43.20261101.0', 'starts by default'], ['Version 43.20261031.0', 'before the last update']]));
  ui.fh.answer(vs.id, 1);
  const v = await ui.show('Version 43.20261031.0');
  assert.strictEqual(v.items[0].sub, 'undoes the last update');
  ui.fh.answer(v.id, 0);
  await ui.type('Password for alex', 'tessera1');
  await done();
  assert.strictEqual(JSON.stringify(stdin().pop()), JSON.stringify({ tool: 'version', user: 'alex', password: 'tessera1', action: 'default', index: 1 }));

  // Repair the boot menu
  menu = await ui.show('Recover');
  ui.fh.answer(menu.id, menu.items.findIndex((r) => r.label === 'Repair the boot menu'));
  await ui.type('Password for alex', 'tessera1');
  await done();
  assert.strictEqual(JSON.stringify(stdin().pop()), JSON.stringify({ tool: 'boot', user: 'alex', password: 'tessera1' }));

  // Graphics: the wrong build is suggested; switching sends exactly that build
  menu = await ui.show('Recover');
  assert.strictEqual(row(menu, 'Graphics and how it starts').sub, 'suggested: the wrong build for this graphics card');
  ui.fh.answer(menu.id, menu.items.findIndex((r) => r.label === 'Graphics and how it starts'));
  const gx = await ui.show('Graphics and how it starts');
  assert.match(gx.body, /Graphics in this computer: NVIDIA\.\nThis Tessera is the AMD \/ Intel build; these graphics need the NVIDIA GTX 16 \/ RTX build\./);
  assert.strictEqual(labels(gx), 'Switch to the NVIDIA GTX 16 / RTX build|Next start: safe settings|Next start: the login screen|Next start: a repair console');
  ui.fh.answer(gx.id, 0);
  await ui.type('Password for alex', 'tessera1');
  await done();
  assert.strictEqual(JSON.stringify(stdin().pop()), JSON.stringify({ tool: 'graphics', user: 'alex', password: 'tessera1', action: 'switch', to: 'nvidia-open' }));

  // Reset Tessera: whose, how much, then the password (an administrator confirms for the kid's)
  menu = await ui.show('Recover');
  ui.fh.answer(menu.id, menu.items.findIndex((r) => r.label === 'Reset Tessera'));
  const who = await ui.show('Whose Tessera?');
  assert.strictEqual(labels(who), 'alex|kid|Everyone');
  ui.fh.answer(who.id, 1);
  const lvl = await ui.show('Reset Tessera');
  ui.fh.answer(lvl.id, 1);
  await ui.type('Password for alex', 'tessera1');
  await done();
  assert.strictEqual(JSON.stringify(stdin().pop()), JSON.stringify({ tool: 'reset', user: 'alex', password: 'tessera1', level: 'all', who: 'kid' }));

  // Back up to a USB drive
  menu = await ui.show('Recover');
  ui.fh.answer(menu.id, menu.items.findIndex((r) => r.label === 'Back up to a USB drive'));
  const files = await ui.show('Whose files?');
  ui.fh.answer(files.id, 0);
  const drv = await ui.show('Which USB drive?');
  assert.strictEqual(JSON.stringify(drv.items.map((r) => [r.label, r.sub])), JSON.stringify([['STICK', '50.0 GB free of 64.0 GB'], ['Look again', 'after plugging one in']]));
  ui.fh.answer(drv.id, 0);
  const what = await ui.show('What to copy');
  ui.fh.answer(what.id, 0);
  await ui.type('Password for alex', 'tessera1');
  const bu = await ui.waitFor('Backed up', 15000);
  assert.match(bu.body, /42 files copied to the folder "Tessera backup 2026-11-02 1200" on STICK[\s\S]*1 couldn't be copied/);
  ui.fh.answer(bu.id, 0);
  assert.ok(ui.events.some((e) => e.title === 'Backing up' || (e.kind === 'progress' && e.title === 'Backing up')), 'it showed the copy');
  assert.strictEqual(JSON.stringify(stdin().pop()), JSON.stringify({ user: 'alex', password: 'tessera1', who: 'alex', drive: 'AB12-CD34', what: 'mine' }));
  assert.doesNotMatch(args(), /tessera1/);

  // Check the disk: read-only first; problems found offer Repair, which needs the password
  menu = await ui.show('Recover');
  ui.fh.answer(menu.id, menu.items.findIndex((r) => r.label === 'Check the disk'));
  const pf = await ui.waitFor('Problems found', 15000);
  assert.match(pf.body, /✓ The drive reports good health\.\n✗ The main file system: 2 damaged blocks found/);
  assert.match(pf.body, /Damaged file:\n  alex\/Games\/big\.bin/);
  assert.match(args(), new RegExp(`^check ${ID.replace(/[.:]/g, '\\$&')}$`, 'm'));
  ui.fh.answer(pf.id, 0);
  await ui.type('Password for alex', 'tessera1');
  const rp = await ui.waitFor('Repaired', 15000);
  assert.match(rp.body, /✓ The main file system: 2 damaged blocks repaired/);
  ui.fh.answer(rp.id, 0);
  assert.strictEqual(JSON.stringify(stdin().pop()), JSON.stringify({ user: 'alex', password: 'tessera1' }));
  assert.match(args(), new RegExp(`^check ${ID.replace(/[.:]/g, '\\$&')} --repair$`, 'm'));

  // Free up space
  menu = await ui.show('Recover');
  ui.fh.answer(menu.id, menu.items.findIndex((r) => r.label === 'Free up space'));
  const sp = await ui.show('Free up space');
  assert.match(sp.body, /1\.5 GB free of 256\.0 GB/);
  assert.match(sp.body, /alex: 120\.0 GB \(games 100\.0 GB, caches 5\.0 GB, trash 500 MB\)/);
  assert.strictEqual(JSON.stringify([sp.items[0].label, sp.items[0].sub]), JSON.stringify(['Clear all three', '5.5 GB']));
  ui.fh.answer(sp.id, 0);
  await ui.type('Password for alex', 'tessera1');
  await done();
  assert.strictEqual(JSON.stringify(stdin().pop()), JSON.stringify({ tool: 'clean', user: 'alex', password: 'tessera1', what: ['caches', 'shaders', 'trash'] }));
});
