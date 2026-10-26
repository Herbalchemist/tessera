// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: a graphics card swap. The machine "has" an AMD card while the "installed" build
// is tessera-nvidia; Tessera should notice shortly after start, offer the AMD / Intel build, and switch
// through the tessera-graphics-switch@standard job. systemctl, bootc and the PCI bus are stand-ins.
//   xvfb-run -a -s "-screen 0 1280x720x24" node qa/graphics.cjs
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');

const launcher = process.argv[2] || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher');
const output = process.env.TESSERA_QA_OUTPUT || path.resolve(process.cwd(), 'qa-output');
const executablePath = process.env.TESSERA_ELECTRON || require('electron');
fs.mkdirSync(output, { recursive: true });
const checks = [];

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-gfx-'));
const dataDir = path.join(temp, 'data');
const upDir = path.join(temp, 'run');
const pci = path.join(temp, 'pci');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(upDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ firstRunDone: true }));
const dev = (slot, vendor, device, cls) => { const d = path.join(pci, slot); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'vendor'), `0x${vendor}\n`); fs.writeFileSync(path.join(d, 'device'), `0x${device}\n`); fs.writeFileSync(path.join(d, 'class'), `0x${cls}\n`); };
dev('0000:03:00.0', '1002', '73bf', '030000'); // AMD Radeon RX 6800
dev('0000:03:00.1', '1002', 'ab28', '040300'); // its HDMI audio: not graphics

const status = (ref, staged) => JSON.stringify({ status: {
  booted: { image: { image: { image: ref, transport: 'registry' }, version: '43.20261026', timestamp: '2026-10-26T00:00:00Z', imageDigest: 'sha256:aaa' } },
  staged: staged ? { image: { image: { image: staged, transport: 'registry' }, version: '43.20261026', timestamp: '2026-10-26T01:00:00Z', imageDigest: 'sha256:bbb' } } : null,
  rollback: null, rollbackQueued: false } });
fs.writeFileSync(path.join(temp, 'status-now.json'), status('ghcr.io/herbalchemist/tessera-nvidia:latest'));
fs.writeFileSync(path.join(temp, 'status-after.json'), status('ghcr.io/herbalchemist/tessera-nvidia:latest', 'ghcr.io/herbalchemist/tessera:latest'));
// A stand-in systemctl: the status job copies status-now.json; the graphics job "switches" instantly.
const ctl = path.join(temp, 'systemctl');
fs.writeFileSync(ctl, `#!/bin/bash
T=${JSON.stringify(temp)}; U=${JSON.stringify(upDir)}
echo "$@" >> "$T/calls"
args=("$@"); [ "\${args[0]}" = --no-ask-password ] && args=("\${args[@]:1}")
case "\${args[0]}" in
  show) u="\${args[1]}"; inv=$(cat "$T/inv-$u" 2>/dev/null || echo a); echo "ActiveState=inactive"; echo "Result=success"; echo "InvocationID=$inv"; echo "LoadState=loaded";;
  start)
    u="\${args[-1]}"
    case "$u" in
      tessera-update-status.service) cp "$T/status-now.json" "$U/status.json";;
      tessera-graphics-switch@*.service) echo "Switching to ghcr.io/herbalchemist/tessera:latest" > "$U/graphics.log"; cp "$T/status-after.json" "$T/status-now.json"; echo "$u" > "$T/switched";;
    esac
    echo b > "$T/inv-$u";;
esac
exit 0
`, { mode: 0o755 });

(async () => {
  const errors = [];
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: temp, TESSERA_DATA_DIR: dataDir, TESSERA_DEV: '1', TESSERA_SYSTEMCTL: ctl, TESSERA_UPDATE_DIR: upDir,
      TESSERA_PCI_DIR: pci, TESSERA_GRAPHICS_DELAY_MS: '1500', XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForFunction(() => !document.body.classList.contains('hold') && document.querySelectorAll('.tab').length >= 5);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });
    await page.waitForFunction(() => modal && modal.title === 'New graphics card?', null, { timeout: 15000, polling: 200 });
    const body = await page.evaluate(() => modal.body);
    assert.match(body, /AMD|1002/, 'names the new card: ' + body);
    assert.match(body, /NVIDIA, GTX 900/, 'names the running build: ' + body);
    await page.screenshot({ path: path.join(output, 'graphics-offer.png') });
    checks.push('Shortly after start, a card/build mismatch is noticed and the matching build is offered');

    await page.evaluate(() => { modal.index = 0; modalPress('a'); }); // Switch
    await page.waitForTimeout(300);
    const conf = await page.evaluate(() => modal && modal.title);
    assert.match(conf, /AMD \/ Intel build downloads now/, 'asks first: ' + conf);
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.ok || /Switch/.test(x.label)); modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Ready', null, { timeout: 15000, polling: 200 });
    assert.equal(fs.readFileSync(path.join(temp, 'switched'), 'utf8').trim(), 'tessera-graphics-switch@standard.service');
    assert.match(await page.evaluate(() => modal.body), /AMD \/ Intel build is downloaded/);
    await page.screenshot({ path: path.join(output, 'graphics-ready.png') });
    checks.push('Switching runs tessera-graphics-switch@standard and ends with "restart to finish"');
    await page.evaluate(() => { modal.index = 1; modalPress('a'); }); // Later
    await page.waitForTimeout(200);

    // Settings > Update software shows the graphics section, now waiting for a restart.
    await page.evaluate(() => { flowUpdate(); });
    await page.waitForFunction(() => modal && modal.title === 'Update software', null, { timeout: 15000, polling: 200 });
    const labels = await page.evaluate(() => modal.items.map((i) => i.label + ' | ' + (i.sub || '')));
    assert.ok(labels.some((l) => /^Graphics \|/.test(l)), 'a Graphics section: ' + labels);
    assert.ok(labels.some((l) => /build is ready/.test(l)), 'the switch is ready: ' + labels);
    assert.ok(labels.some((l) => /^Restart now/.test(l)), 'Restart now offered');
    await page.screenshot({ path: path.join(output, 'graphics-update-screen.png') });
    checks.push('Update software shows the card, the running build, and the switch waiting for a restart');

    // A bogus build name never reaches systemctl.
    const r = await page.evaluate(() => api.update('start', { job: 'graphics', variant: 'evil; rm -rf' }));
    assert.equal(r.ok, false);
    assert.ok(!fs.readFileSync(path.join(temp, 'calls'), 'utf8').includes('evil'));
    checks.push('Unknown build names are refused before any job starts');
  } finally { await app.close(); }
  assert.deepEqual(errors, [], 'no page errors');
  for (const c of checks) console.log('ok -', c);
  console.log(`graphics: ${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
