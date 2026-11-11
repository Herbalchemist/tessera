'use strict';
// Install Tessera as it runs from the Tessera USB, on the real main process (its installer handler)
// and the real step code (ludus-qt/backend/flowhost.js), answering the questions the way the screen
// would. The USB's root helper (live-install) is a stand-in that reports a made-up computer and
// pretends to install.
const test = require('node:test');
test.after(() => { setImmediate(() => process.exit()); });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./xbox-harness');
const { screen } = require('./flow-screen');

const LAUNCHER = path.join(__dirname, '..');

const probe = {
  ok: true,
  disks: [{ path: '/dev/nvme0n1', size: 1000204886016, model: 'Samsung SSD 980 1TB', transport: 'nvme', removable: false }],
  gpus: [{ slot: '0000:01:00.0', vendor: '10de', device: '1c81', cls: '030000' }],
  secureBoot: { efi: true, state: 'on', keyAvailable: true },
  images: ['tessera', 'tessera-nvidia', 'tessera-nvidia-open'],
  timezones: ['UTC', 'America/Denver', 'America/Phoenix', 'Europe/Berlin'],
};

async function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-'));
  const state = path.join(tmp, 'state-run');
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  const helper = path.join(tmp, 'live-install');
  fs.writeFileSync(helper, `#!/bin/bash
S=${JSON.stringify(state)}; T=${JSON.stringify(tmp)}
case "$1" in
  probe) cat "$T/probe.json";;
  online) if [ -f "$T/net" ]; then echo '{"online":true}'; else touch "$T/net"; echo '{"online":false}'; fi;;
  run)
    mkdir -p "$S"; cat > "$T/choices.json"
    for p in 10 40 70 95; do printf '{"phase":"running","percent":%s,"stage":"Copying Tessera onto the disk","line":"step %s"}' $p $p > "$S/state.json"; sleep 0.2; done
    printf '{"phase":"done","percent":100,"enrolled":true,"secureBoot":"on"}' > "$S/state.json";;
esac
`, { mode: 0o755 });
  const setProbe = (p) => fs.writeFileSync(path.join(tmp, 'probe.json'), JSON.stringify(p));
  setProbe(probe);
  fs.writeFileSync(path.join(tmp, 'data', 'settings.json'), JSON.stringify({ firstRunDone: true }));
  Object.assign(process.env, { TESSERA_INSTALLER: '1', TESSERA_LIVE_INSTALL: helper, TESSERA_LIVE_INSTALL_NOSUDO: '1', TESSERA_INSTALL_STATE: state });
  for (const k of Object.keys(require.cache)) if (k.startsWith(LAUNCHER + path.sep) && !k.includes(path.sep + 'test' + path.sep)) delete require.cache[k];
  const h = await H.load({ launcher: LAUNCHER, tmp, realSpawn: true });
  const handlers = new Map(Object.keys(h.handlers).map((k) => [k, { fn: (e, ...a) => h.call(k, ...a) }]));
  const choices = () => JSON.parse(fs.readFileSync(path.join(tmp, 'choices.json'), 'utf8'));
  return { tmp, h, handlers, setProbe, choices };
}

test('Install Tessera from the USB: every step, and exactly the choices reach the helper', async () => {
  const s = await setup();
  const ui = screen(s.handlers);
  ui.fh.start('install');
  const welcome = await ui.show('Welcome to Tessera');
  assert.strictEqual(welcome.items.map((r) => r.label).join('|'), 'Install Tessera|Try it first|Recover');
  assert.ok(welcome.welcome);
  ui.fh.answer(welcome.id, 0);

  const disk = await ui.show('Where should Tessera go?');
  assert.match(disk.items[0].sub, /1\.0 TB · NVME/);
  ui.fh.answer(disk.id, 0);
  const g = await ui.show('Graphics');
  assert.match(`${g.items[0].label}|${g.items[0].sub}`, /^NVIDIA, GTX 900.1000\|Recommended/, 'a GTX 1050 gets the older-card build first');
  assert.match(g.body, /10de:1c81|NVIDIA/);
  ui.fh.answer(g.id, g.items.findIndex((r) => /Recommended/.test(r.sub)));

  await ui.type('Your name', 'Alex Rivera');
  const acct = await ui.show('Your account');
  assert.match(acct.items[0].label, /User name: alexrivera/);
  ui.fh.answer(acct.id, 0);
  await ui.type('Pick a password', 'hunter22');
  await ui.type('Type the password again', 'hunter2');
  const mism = await ui.show("They don't match");
  ui.fh.answer(mism.id, 0);
  const again = await ui.type('Your name', null);
  assert.strictEqual(again.initial, 'Alex Rivera', 'it remembers the name');
  const acct2 = await ui.show('Your account');
  ui.fh.answer(acct2.id, 0);
  await ui.type('Pick a password', 'hunter22');
  await ui.type('Type the password again', 'hunter22');

  await ui.choose('Time zone: region', 'America');
  await ui.choose('Time zone: America', /Phoenix/);
  const sb = await ui.show('Secure Boot');
  assert.match(sb.body, /Secure Boot is on right now/);
  ui.fh.answer(sb.id, 0);
  const ready = await ui.show('Ready to install');
  assert.match(ready.body, /Samsung SSD 980 1TB.*erased completely/);
  assert.match(ready.body, /Account: alexrivera/);
  assert.match(ready.body, /America\/Phoenix/);
  assert.strictEqual(ready.index, 1, 'the cursor starts on Go back, not on Erase');
  ui.fh.answer(ready.id, 0);

  const done = await ui.show('Tessera is installed');
  assert.deepStrictEqual(s.choices(), { disk: '/dev/nvme0n1', layout: 'erase', remove: [], variant: 'nvidia', user: 'alexrivera', fullName: 'Alex Rivera', password: 'hunter22', timezone: 'America/Phoenix', secureBoot: 'auto' });
  assert.match(done.body, /Enroll MOK/);
  assert.match(done.body, /universalblue/);
  assert.match(done.body, /US keyboard/);
  assert.ok(ui.events.some((e) => e.kind === 'progress'), 'progress showed');
});

async function restOfSteps(ui) {
  const g = await ui.show('Graphics');
  ui.fh.answer(g.id, g.items.findIndex((r) => /Recommended/.test(r.sub)));
  await ui.type('Your name', 'Alex Rivera');
  const a = await ui.show('Your account');
  ui.fh.answer(a.id, 0);
  await ui.type('Pick a password', 'hunter22');
  await ui.type('Type the password again', 'hunter22');
  await ui.choose('Time zone: region', 'America');
  await ui.choose('Time zone: America', /Phoenix/);
  const sb = await ui.show('Secure Boot');
  ui.fh.answer(sb.id, 0);
  return ui.show('Ready to install');
}

const MiB = 1024 ** 2, GB = 1e9, SECTOR = 512;
const winDisk = () => {
  const parts = [['/dev/nvme0n1p1', MiB, 100 * MiB], ['/dev/nvme0n1p2', 101 * MiB, 16 * MiB], ['/dev/nvme0n1p3', 117 * MiB, 400 * GB], ['/dev/nvme0n1p4', 117 * MiB + 400 * GB, 300 * GB]];
  return {
    path: '/dev/nvme0n1', size: 1000204886016, model: 'Samsung SSD 980 1TB', transport: 'nvme', removable: false,
    pttype: 'gpt', free: Math.floor((1000204886016 - (117 * MiB + 700 * GB)) / MiB) * MiB - MiB,
    esp: { path: '/dev/nvme0n1p1', size: 100 * MiB, systems: ['Microsoft'], free: 60 * MiB }, systems: ['Windows', 'Linux'],
    partitions: [
      { path: '/dev/nvme0n1p1', size: 100 * MiB, fstype: 'vfat', label: '', what: 'Boot partition (EFI)', esp: true },
      { path: '/dev/nvme0n1p2', size: 16 * MiB, fstype: '', label: '', what: 'Windows', esp: false },
      { path: '/dev/nvme0n1p3', size: 400 * GB, fstype: 'ntfs', label: 'Windows', what: 'Windows', esp: false },
      { path: '/dev/nvme0n1p4', size: 300 * GB, fstype: 'ext4', label: 'old', what: 'Linux', esp: false },
    ],
    table: { partitiontable: { label: 'gpt', sectorsize: SECTOR, firstlba: 2048, lastlba: Math.floor(1000204886016 / SECTOR) - 34, partitions: parts.map(([node, a, z]) => ({ node, start: Math.floor(a / SECTOR), size: Math.floor(z / SECTOR) })) } },
    alongside: { ok: true, room: 0, why: '' },
  };
};

test('a USB with one build, on a PC that needs another, says so and offers what it has', async () => {
  const s = await setup();
  s.setProbe({ ...probe, images: ['tessera'] });
  const ui = screen(s.handlers);
  ui.fh.start('install');
  await ui.choose('Welcome to Tessera', 'Install Tessera');
  await ui.choose('Where should Tessera go?', /TB|GB/);
  const g = await ui.show('Graphics');
  assert.match(g.body, /made with only the AMD \/ Intel build/);
  assert.strictEqual(g.items.map((r) => r.label).join('|'), 'AMD / Intel');
});

test('a disk with Windows on it: install next to it, and the helper is told so', async () => {
  const s = await setup();
  s.setProbe({ ...probe, disks: [winDisk()] });
  const ui = screen(s.handlers);
  ui.fh.start('install');
  await ui.choose('Welcome to Tessera', 'Install Tessera');
  await ui.choose('Where should Tessera go?', /TB|GB/);
  const lay = await ui.show('How should Tessera use this disk?');
  assert.match(`${lay.items[0].label}|${lay.items[0].sub}`, /^Install next to Windows and Linux\|uses the .*free space/);
  assert.strictEqual(lay.index, 0, 'next to what is there comes first when it fits');
  assert.match(`${lay.items[2].label}|${lay.items[2].sub}`, /^Erase the whole disk\|.*including Windows and Linux/);
  assert.match(lay.body, /Windows "Windows" \(400 GB\)/);
  ui.fh.answer(lay.id, 0);
  const ready = await restOfSteps(ui);
  assert.match(ready.body, /next to Windows and Linux \(its free space; nothing else changes\)/);
  assert.strictEqual(ready.items[0].label, 'Install');
  ui.fh.answer(ready.id, 0);
  await ui.show('Tessera is installed');
  const ch = s.choices();
  assert.strictEqual(ch.layout, 'alongside');
  assert.strictEqual(ch.remove.length, 0);
});

test('replacing partitions: the boot partition is never offered, ticking shows the room, a confirmation names what goes', async () => {
  const s = await setup();
  s.setProbe({ ...probe, disks: [winDisk()] });
  const ui = screen(s.handlers);
  ui.fh.start('install');
  await ui.choose('Welcome to Tessera', 'Install Tessera');
  await ui.choose('Where should Tessera go?', /TB|GB/);
  const lay = await ui.show('How should Tessera use this disk?');
  ui.fh.answer(lay.id, lay.items.findIndex((r) => /^Replace/.test(r.label)));
  const before = await ui.show('Which partitions should go?');
  assert.strictEqual(before.items.slice(0, 3).map((r) => r.label).join('|'), '☐  Windows|☐  Windows "Windows"|☐  Linux "old"', 'the boot partition is never offered');
  ui.fh.answer(before.id, before.items.findIndex((r) => /Linux "old"/.test(r.label)));
  const after = await ui.show('Which partitions should go?');
  assert.match(after.items[2].label, /^☑  Linux "old"/);
  assert.match(`${after.items[3].label}|${after.items[3].sub}`, /^Continue\|Tessera gets 600 GB/);
  ui.fh.answer(after.id, 3);
  const sure = await ui.show('Erase these partitions?');
  assert.match(sure.body, /Linux "old", 300 GB \(nvme0n1p4\)/);
  assert.strictEqual(sure.index, 1, 'starts on Go back');
  ui.fh.answer(sure.id, 0);
  const ready = await restOfSteps(ui);
  assert.match(ready.body, /1 partition erased \(nvme0n1p4\); the rest stays/);
  assert.strictEqual(ready.items[0].label, 'Erase those partitions and install');
  ui.fh.answer(ready.id, 0);
  await ui.show('Tessera is installed');
  const ch = s.choices();
  assert.strictEqual(ch.layout, 'replace');
  assert.strictEqual(ch.remove.join(','), '/dev/nvme0n1p4');
});

test('the online installer asks to connect first, checks again, then notes the download', async () => {
  const s = await setup();
  s.setProbe({ ...probe, source: 'online', online: false });
  const ui = screen(s.handlers);
  ui.fh.start('install');
  await ui.choose('Welcome to Tessera', 'Install Tessera');
  const c = await ui.show('Connect to the internet');
  ui.fh.answer(c.id, c.items.findIndex((r) => /check/i.test(r.label)));
  const off = await ui.show('Still offline');
  ui.fh.answer(off.id, 0);
  const c2 = await ui.show('Connect to the internet');
  ui.fh.answer(c2.id, c2.items.findIndex((r) => /check/i.test(r.label)));
  await ui.choose('Where should Tessera go?', /TB|GB/);
  const g = await ui.show('Graphics');
  assert.match(g.body, /downloads during the install/);
});
