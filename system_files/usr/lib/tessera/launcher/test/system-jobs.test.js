'use strict';
// The system jobs the main process starts through systemd, with a stand-in systemctl: a graphics card swap
// (noticed shortly after start, the matching build offered and switched to, an unknown build refused before
// systemctl), the boot screen and boot menu choices. No real service, bootc or PCI bus is involved.
const test = require('node:test');
test.after(() => { setImmediate(() => process.exit()); });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./xbox-harness');

const LAUNCHER = path.join(__dirname, '..');
const status = (ref, staged) => JSON.stringify({ status: {
  booted: { image: { image: { image: ref, transport: 'registry' }, version: '43.20261026', timestamp: '2026-10-26T00:00:00Z', imageDigest: 'sha256:aaa' } },
  staged: staged ? { image: { image: { image: staged, transport: 'registry' }, version: '43.20261026', timestamp: '2026-10-26T01:00:00Z', imageDigest: 'sha256:bbb' } } : null,
  rollback: null, rollbackQueued: false } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await wait(50); } }

async function boot(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-'));
  const data = path.join(tmp, 'data'), run = path.join(tmp, 'run');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ firstRunDone: true }));
  for (const [f, v] of Object.entries(files || {})) fs.writeFileSync(path.join(tmp, f), v);
  const ctl = path.join(tmp, 'systemctl');
  fs.writeFileSync(ctl, `#!/bin/bash
T=${JSON.stringify(tmp)}; U=${JSON.stringify(run)}
echo "$@" >> "$T/calls"
args=("$@"); [ "\${args[0]}" = --no-ask-password ] && args=("\${args[@]:1}")
case "\${args[0]}" in
  show) u="\${args[1]}"; inv=$(cat "$T/inv-$u" 2>/dev/null || echo a); echo "ActiveState=inactive"; echo "Result=success"; echo "InvocationID=$inv"; echo "LoadState=loaded";;
  start)
    u="\${args[-1]}"
    case "$u" in
      tessera-update-status.service) cp "$T/status-now.json" "$U/status.json";;
      tessera-graphics-switch@*.service) echo "Switching to ghcr.io/herbalchemist/tessera:latest" > "$U/graphics.log"; cp "$T/status-after.json" "$T/status-now.json"; echo "$u" > "$T/switched";;
      tessera-boot-theme@*.service) printf 'Setting the boot screen\\nDone: it shows from the next restart.\\n' > "$U/boot.log"; echo "$u" >> "$T/boot-started";;
      tessera-boot-menu-set@*.service) echo 'tessera-boot-menu: now off' > "$U/bootmenu.log"; echo "$u" >> "$T/menu-started";;
    esac
    echo b > "$T/inv-$u";;
esac
exit 0
`, { mode: 0o755 });
  Object.assign(process.env, { TESSERA_SYSTEMCTL: ctl, TESSERA_UPDATE_DIR: run, TESSERA_GRAPHICS_DELAY_MS: '300', TESSERA_PCI_DIR: path.join(tmp, 'pci'),
    TESSERA_CMDLINE: path.join(tmp, 'cmdline'), TESSERA_PLAIN_MENU: path.join(tmp, 'plain-boot-menu') });
  for (const k of Object.keys(require.cache)) if (k.startsWith(LAUNCHER + path.sep) && !k.includes(path.sep + 'test' + path.sep)) delete require.cache[k];
  const h = await H.load({ launcher: LAUNCHER, tmp });
  return { h, tmp, U: (op, x) => h.call('update', op, x || {}), calls: () => { try { return fs.readFileSync(path.join(tmp, 'calls'), 'utf8'); } catch { return ''; } } };
}
const pci = (tmp, slot, vendor, device, cls) => { const d = path.join(tmp, 'pci', slot); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'vendor'), `0x${vendor}\n`); fs.writeFileSync(path.join(d, 'device'), `0x${device}\n`); fs.writeFileSync(path.join(d, 'class'), `0x${cls}\n`); };

test('a graphics card swap: noticed, the matching build offered, switched to through its job, bad names refused', async () => {
  const { h, tmp, U, calls } = await boot({
    'status-now.json': status('ghcr.io/herbalchemist/tessera-nvidia:latest'),
    'status-after.json': status('ghcr.io/herbalchemist/tessera-nvidia:latest', 'ghcr.io/herbalchemist/tessera:latest'),
  });
  pci(tmp, '0000:03:00.0', '1002', '73bf', '030000'); // AMD Radeon RX 6800
  pci(tmp, '0000:03:00.1', '1002', 'ab28', '040300'); // its HDMI audio: not graphics
  // the check runs a moment after the window starts; ask for it again now that the card is "there"
  const gfx = await until(() => h.sent.find(([ch]) => ch === 'graphics') || (require(path.join(LAUNCHER, 'main', 'installer')).graphicsCheck(), null), 5000).catch(() => null);
  const g = gfx && gfx[1];
  assert.ok(g, 'a card/build mismatch is noticed');
  assert.strictEqual(g.mismatch, true);
  assert.strictEqual(g.need, 'standard', 'the AMD / Intel build is the one to switch to');
  assert.match(JSON.stringify(g), /AMD|1002/);
  // an unknown build never reaches systemctl
  const bad = await U('start', { job: 'graphics', variant: 'evil; rm -rf' });
  assert.strictEqual(bad.ok, false);
  assert.ok(!calls().includes('evil'));
  // switching runs the job for the matching build, and ends with the new build waiting for a restart
  const go = await U('start', { job: 'graphics', variant: 'standard' });
  assert.ok(go.ok, JSON.stringify(go));
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'switched'), 'utf8').trim(), 'tessera-graphics-switch@standard.service');
  let poll;
  await until(async () => { poll = await U('poll'); return poll.phase === 'done'; });
  assert.strictEqual(poll.result, 'staged');
  const info = await U('info');
  assert.match(JSON.stringify(info), /graphics/i);
});

test('the boot screen: Tessera by default, a choice starts its job, nothing starts while an update waits', async () => {
  const { U, tmp } = await boot({ 'cmdline': 'BOOT_IMAGE=/vmlinuz root=UUID=x rhgb quiet\n', 'status-now.json': status('ghcr.io/herbalchemist/tessera:latest') });
  let info = await U('bootInfo');
  assert.strictEqual(info.current, 'tessera', 'the default boot screen');
  assert.deepStrictEqual(info.themes, ['tessera', 'bgrt', 'spinner', 'details']);
  assert.strictEqual(info.menu, 'on', "Tessera's boot menu by default");
  assert.strictEqual((await U('start', { job: 'boot', theme: 'nonsense' })).ok, false);
  assert.ok((await U('start', { job: 'boot', theme: 'details' })).ok);
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'boot-started'), 'utf8').trim(), 'tessera-boot-theme@details.service');
  let poll;
  await until(async () => { poll = await U('poll'); return poll.phase === 'done'; });
  assert.strictEqual(poll.result, 'bootset');
  assert.strictEqual(poll.theme, 'details');
  info = await U('bootInfo');
  assert.strictEqual(info.pending, 'details', 'it shows after the next restart');
  // GRUB's own menu
  assert.ok((await U('start', { job: 'bootmenu', menu: 'off' })).ok);
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'menu-started'), 'utf8').trim(), 'tessera-boot-menu-set@off.service');
  assert.strictEqual((await U('start', { job: 'bootmenu', menu: 'sideways' })).ok, false);
});

test('with an update waiting for a restart the boot screen is refused and nothing is started', async () => {
  const { U, tmp } = await boot({ 'cmdline': 'rhgb quiet\n', 'status-now.json': status('ghcr.io/herbalchemist/tessera:latest', 'ghcr.io/herbalchemist/tessera:latest') });
  const r = await U('start', { job: 'boot', theme: 'bgrt' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /update is waiting for a restart/);
  assert.ok(!fs.existsSync(path.join(tmp, 'boot-started')));
});
