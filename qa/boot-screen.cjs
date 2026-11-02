// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: Theme Settings > Boot screen. Picks the text boot screen, which starts
// tessera-boot-theme@details.service; afterwards Theme Settings says it shows after the next restart.
// With an update waiting for a restart it refuses, and starts nothing. systemctl, bootc and
// /proc/cmdline are stand-ins.
//   xvfb-run -a -s "-screen 0 1280x720x24" node qa/boot-screen.cjs
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

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-boot-'));
const dataDir = path.join(temp, 'data');
const upDir = path.join(temp, 'run');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(upDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ firstRunDone: true }));
fs.writeFileSync(path.join(temp, 'cmdline'), 'BOOT_IMAGE=/vmlinuz root=UUID=x rhgb quiet\n');
const status = (staged) => JSON.stringify({ status: {
  booted: { image: { image: { image: 'ghcr.io/herbalchemist/tessera:latest', transport: 'registry' }, version: '43.20261030', timestamp: '2026-10-30T00:00:00Z', imageDigest: 'sha256:aaa' } },
  staged: staged ? { image: { image: { image: 'ghcr.io/herbalchemist/tessera:latest', transport: 'registry' }, version: '43.20261031', timestamp: '2026-10-31T00:00:00Z', imageDigest: 'sha256:bbb' } } : null,
  rollback: null, rollbackQueued: false } });
fs.writeFileSync(path.join(temp, 'status-now.json'), status(false));
const ctl = path.join(temp, 'systemctl');
fs.writeFileSync(ctl, `#!/bin/bash
T=${JSON.stringify(temp)}; U=${JSON.stringify(upDir)}
args=("$@"); [ "\${args[0]}" = --no-ask-password ] && args=("\${args[@]:1}")
case "\${args[0]}" in
  show) u="\${args[1]}"; inv=$(cat "$T/inv-$u" 2>/dev/null || echo a); echo "ActiveState=inactive"; echo "Result=success"; echo "InvocationID=$inv"; echo "LoadState=loaded";;
  start)
    u="\${args[-1]}"
    case "$u" in
      tessera-update-status.service) cp "$T/status-now.json" "$U/status.json";;
      tessera-boot-theme@*.service) printf 'Setting the boot screen\\nDone: it shows from the next restart.\\n' > "$U/boot.log"; echo "$u" >> "$T/boot-started";;
      tessera-boot-menu-set@*.service) echo 'tessera-boot-menu: now off' > "$U/bootmenu.log"; echo "$u" >> "$T/menu-started";;
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
      TESSERA_CMDLINE: path.join(temp, 'cmdline'), TESSERA_PLAIN_MENU: path.join(temp, 'plain-boot-menu'), XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForFunction(() => !document.body.classList.contains('hold') && document.querySelectorAll('.tab').length >= 5);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });

    const openBootItem = async () => {
      page.evaluate(() => { flowTheme(); });
      await page.waitForFunction(() => modal && modal.title === 'Theme Settings' && modal.items.some((x) => x.op === 'boot'), null, { timeout: 10000, polling: 100 });
      return page.evaluate(() => { const it = modal.items.find((x) => x.op === 'boot'); return { label: it.label, sub: it.sub }; });
    };
    let item = await openBootItem();
    assert.equal(item.label, 'Tessera', 'the default boot screen: ' + JSON.stringify(item));
    assert.match(item.sub, /everyone/);
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.op === 'boot'); modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Boot screen', null, { timeout: 5000, polling: 100 });
    const choices = await page.evaluate(() => modal.items.map((x) => x.label));
    assert.deepEqual(choices, ['Tessera', 'Bazzite', 'Spinner', 'Text']);
    await page.screenshot({ path: path.join(output, 'boot-screen-choices.png') });
    checks.push('Theme Settings shows the boot screen (Tessera by default) and offers Tessera, Bazzite, Spinner and Text');

    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.id === 'details'); modalPress('a'); });
    await page.waitForFunction(() => /Text boot screen shows from the next restart/.test(document.getElementById('status').textContent), null, { timeout: 15000, polling: 200 });
    assert.equal(fs.readFileSync(path.join(temp, 'boot-started'), 'utf8').trim(), 'tessera-boot-theme@details.service');
    checks.push('Picking Text starts tessera-boot-theme@details.service and says it shows from the next restart');

    await page.evaluate(() => { if (modal) closeModal(); });
    await page.waitForTimeout(400);
    item = await openBootItem();
    assert.equal(item.label, 'Text');
    assert.match(item.sub, /after the next restart/);
    checks.push('Afterwards Theme Settings shows Text, "shows after the next restart"');

    // an update is waiting for a restart: refuse, start nothing
    fs.writeFileSync(path.join(temp, 'status-now.json'), status(true));
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.op === 'boot'); modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Boot screen', null, { timeout: 5000, polling: 100 });
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.id === 'bgrt'); modalPress('a'); });
    await page.waitForFunction(() => /update is waiting for a restart/.test(document.getElementById('status').textContent), null, { timeout: 15000, polling: 200 });
    assert.equal(fs.readFileSync(path.join(temp, 'boot-started'), 'utf8').trim().split('\n').length, 1, 'nothing more was started');
    checks.push('With an update waiting for a restart it refuses and starts nothing');

    // Boot menu: Tessera's by default; picking GRUB's starts tessera-boot-menu-set@off.service
    fs.writeFileSync(path.join(temp, 'status-now.json'), status(false));
    await page.evaluate(() => { if (modal) closeModal(); });
    await page.waitForTimeout(400);
    page.evaluate(() => { flowTheme(); });
    await page.waitForFunction(() => modal && modal.title === 'Theme Settings' && modal.items.some((x) => x.op === 'bootmenu'), null, { timeout: 10000, polling: 100 });
    assert.equal(await page.evaluate(() => modal.items.find((x) => x.op === 'bootmenu').label), 'Tessera');
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.op === 'bootmenu'); modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Boot menu', null, { timeout: 5000, polling: 100 });
    await page.screenshot({ path: path.join(output, 'boot-menu-choices.png') });
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.id === 'off'); modalPress('a'); });
    await page.waitForFunction(() => /GRUB's menu shows from the next start/.test(document.getElementById('status').textContent), null, { timeout: 15000, polling: 200 });
    assert.equal(fs.readFileSync(path.join(temp, 'menu-started'), 'utf8').trim(), 'tessera-boot-menu-set@off.service');
    checks.push("Boot menu: Tessera's by default; choosing GRUB's menu starts tessera-boot-menu-set@off.service");

    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  for (const c of checks) console.log('PASS', c);
  console.log(`${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
