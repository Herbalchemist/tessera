// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: Install Tessera, as it runs from the Tessera USB, on the real launcher in real
// Electron. The USB's root helper (live-install, from the tessera-mortar repo) is a stand-in that
// reports a made-up computer and pretends to install.
//   xvfb-run -a -s "-screen 0 1280x720x24" node qa/installer.cjs
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

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-inst-'));
const dataDir = path.join(temp, 'data');
const stateDir = path.join(temp, 'state-run');
fs.mkdirSync(dataDir, { recursive: true });
const probe = {
  ok: true,
  disks: [{ path: '/dev/nvme0n1', size: 1000204886016, model: 'Samsung SSD 980 1TB', transport: 'nvme', removable: false }],
  gpus: [{ slot: '0000:01:00.0', vendor: '10de', device: '1c81', cls: '030000' }],
  secureBoot: { efi: true, state: 'on', keyAvailable: true },
  images: ['tessera', 'tessera-nvidia', 'tessera-nvidia-open'],
  timezones: ['UTC', 'America/Denver', 'America/Phoenix', 'Europe/Berlin'],
};
const helper = path.join(temp, 'live-install');
fs.writeFileSync(helper, `#!/bin/bash
S=${JSON.stringify(stateDir)}; T=${JSON.stringify(temp)}
case "$1" in
  probe) cat "$T/probe.json";;
  online) if [ -f "$T/net" ]; then echo '{"online":true}'; else touch "$T/net"; echo '{"online":false}'; fi;;
  run)
    mkdir -p "$S"; cat > "$T/choices.json"
    for p in 10 40 70 95; do printf '{"phase":"running","percent":%s,"stage":"Copying Tessera onto the disk","line":"step %s"}' $p $p > "$S/state.json"; sleep 0.6; done
    printf '{"phase":"done","percent":100,"enrolled":true,"secureBoot":"on"}' > "$S/state.json";;
esac
`, { mode: 0o755 });
fs.writeFileSync(path.join(temp, 'probe.json'), JSON.stringify(probe));

(async () => {
  const errors = [];
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: temp, TESSERA_DATA_DIR: dataDir, TESSERA_DEV: '1', TESSERA_INSTALLER: '1', TESSERA_LIVE_INSTALL: helper,
      TESSERA_LIVE_INSTALL_NOSUDO: '1', TESSERA_INSTALL_STATE: stateDir, XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });
    const title = (t) => page.waitForFunction((x) => modal && modal.title === x, t, { timeout: 10000, polling: 200 });
    const choose = async (t, fn) => {
      await title(t);
      await page.evaluate((src) => { const f = new Function('x', 'return (' + src + ')(x)'); modal.index = modal.items.findIndex((x) => f(x)); modalPress('a'); }, fn.toString());
      await page.waitForTimeout(250);
    };
    const type = async (t, text) => { await page.waitForFunction((x) => modal && modal.kind === 'keys' && modal.title === x, t, { timeout: 8000, polling: 200 }); await page.keyboard.type(text); await page.keyboard.press('Enter'); await page.waitForTimeout(200); };

    await title('Welcome to Tessera');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.tab').length >= 5), true);
    await page.screenshot({ path: path.join(output, 'install-1-welcome.png') });
    checks.push('On the USB the launcher starts into "Welcome to Tessera": install, or try it first');

    // Try first, then come back through Settings.
    await choose('Welcome to Tessera', (x) => x.op === 'try');
    assert.equal(await page.evaluate(() => modal), null, 'trying closes it');
    const tiles = await page.evaluate(() => settingsRows()[0].tiles.map((t) => t.title));
    assert.deepEqual(tiles, ['Install Tessera'], 'Settings starts with Install Tessera');
    await page.evaluate(() => { openGuide(); });
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => modal && modal.items[0].op === 'install'), 'the guide offers it first');
    await page.evaluate(() => { const i = modal.items.findIndex((x) => x.op === 'install'); modal.index = i; modalPress('a'); });
    checks.push('"Try it first" leaves everything alone; Settings and the guide have Install Tessera');

    await choose('Welcome to Tessera', (x) => x.op === 'install');
    await title('Where should Tessera go?');
    assert.match(await page.evaluate(() => modal.items[0].sub), /1\.0 TB · NVME/);
    await page.screenshot({ path: path.join(output, 'install-2-disk.png') });
    await choose('Where should Tessera go?', (x) => x.disk);
    await title('Graphics');
    const g = await page.evaluate(() => ({ items: modal.items.map((i) => i.label + '|' + (i.sub || '')), body: modal.body }));
    assert.match(g.items[0], /^NVIDIA, GTX 900.1000\|Recommended/, 'a GTX 1050 gets the older-card build first: ' + g.items);
    assert.match(g.body, /10de:1c81|NVIDIA/);
    await page.screenshot({ path: path.join(output, 'install-3-graphics.png') });
    await choose('Graphics', (x) => /Recommended/.test(x.sub));
    checks.push('Disk list (never the USB) and the graphics build recommended for this computer');

    await type('Your name', 'Alex Rivera');
    await title('Your account');
    assert.match(await page.evaluate(() => modal.items[0].label), /User name: alexrivera/);
    await choose('Your account', (x) => x.op === 'ok');
    await type('Pick a password', 'hunter22');
    await type('Type the password again', 'hunter2');
    await choose("They don't match", () => true);
    await type('Your name', ''); // it remembers the name
    await choose('Your account', (x) => x.op === 'ok');
    await type('Pick a password', 'hunter22');
    await type('Type the password again', 'hunter22');
    checks.push('Account: user name from your name, password asked twice, a mismatch is caught');

    await choose('Time zone: region', (x) => x.x === 'America');
    await choose('Time zone: America', (x) => x.z === 'America/Phoenix');
    await title('Secure Boot');
    assert.match(await page.evaluate(() => modal.body), /Secure Boot is on right now/);
    await page.screenshot({ path: path.join(output, 'install-4-secureboot.png') });
    await choose('Secure Boot', (x) => x.v === 'auto');
    await title('Ready to install');
    const sum = await page.evaluate(() => ({ body: modal.body, index: modal.index }));
    assert.match(sum.body, /Samsung SSD 980 1TB.*erased completely/);
    assert.match(sum.body, /Account: alexrivera/);
    assert.match(sum.body, /America\/Phoenix/);
    assert.equal(sum.index, 1, 'the cursor starts on Go back, not on Erase');
    await page.screenshot({ path: path.join(output, 'install-5-ready.png') });
    checks.push('Time zone, Secure Boot (with the current state), and a summary that starts on Go back');

    await choose('Ready to install', (x) => x.op === 'go');
    await title('Installing Tessera');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(output, 'install-6-progress.png') });
    await title('Tessera is installed');
    const choices = JSON.parse(fs.readFileSync(path.join(temp, 'choices.json'), 'utf8'));
    assert.deepEqual(choices, { disk: '/dev/nvme0n1', variant: 'nvidia', user: 'alexrivera', fullName: 'Alex Rivera', password: 'hunter22', timezone: 'America/Phoenix', secureBoot: 'auto' });
    const done = await page.evaluate(() => modal.body);
    assert.match(done, /Enroll MOK/);
    assert.match(done, /universalblue/);
    assert.match(done, /US keyboard/);
    await page.screenshot({ path: path.join(output, 'install-7-done.png') });
    checks.push('The helper gets exactly the choices (password over stdin), progress shows, and the end walks through the Secure Boot screen');

    // A USB made for one PC (only the AMD / Intel build) on this NVIDIA machine says so.
    fs.writeFileSync(path.join(temp, 'probe.json'), JSON.stringify({ ...probe, images: ['tessera'] }));
    await page.evaluate(() => { const i = modal && modal.items.findIndex((x) => !x.ok); if (modal) { modal.index = i; modalPress('a'); } });
    await page.waitForTimeout(300);
    await page.evaluate(() => { installerShown = false; flowInstaller(); });
    await choose('Welcome to Tessera', (x) => x.op === 'install');
    await choose('Where should Tessera go?', (x) => x.disk);
    await title('Graphics');
    const g2 = await page.evaluate(() => ({ body: modal.body, items: modal.items.map((i) => i.label) }));
    assert.match(g2.body, /made with only the AMD \/ Intel build/);
    assert.deepEqual(g2.items, ['AMD / Intel']);
    await page.screenshot({ path: path.join(output, 'install-8-one-build-usb.png') });
    checks.push('A one-build USB on a PC that needs another build explains it and still offers what it has');
  } finally { await app.close(); }

  // The online installer (Mortar's "Online install"): no builds on the USB, the PC is offline at first.
  fs.writeFileSync(path.join(temp, 'probe.json'), JSON.stringify({ ...probe, images: ['tessera', 'tessera-nvidia', 'tessera-nvidia-open'], source: 'online', online: false }));
  fs.rmSync(path.join(temp, 'net'), { force: true });
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-inst2-'));
  const app2 = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: home2, TESSERA_DATA_DIR: path.join(home2, 'data'), TESSERA_DEV: '1', TESSERA_INSTALLER: '1', TESSERA_LIVE_INSTALL: helper,
      TESSERA_LIVE_INSTALL_NOSUDO: '1', TESSERA_INSTALL_STATE: path.join(home2, 'run'), XDG_CONFIG_HOME: path.join(home2, 'config'), XDG_STATE_HOME: path.join(home2, 'state') },
  });
  try {
    const page = await app2.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    // Like the first launch: out of fullscreen at once (fullscreen with no window manager on Xvfb
    // now and then ends Chromium with an X error).
    await app2.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });
    const title = (t) => page.waitForFunction((x) => modal && modal.title === x, t, { timeout: 10000, polling: 200 });
    const choose = async (t, fn) => {
      await title(t);
      await page.evaluate((src) => { const f = new Function('x', 'return (' + src + ')(x)'); modal.index = modal.items.findIndex((x) => f(x)); modalPress('a'); }, fn.toString());
      await page.waitForTimeout(250);
    };
    await choose('Welcome to Tessera', (x) => x.op === 'install');
    await title('Connect to the internet');
    await page.screenshot({ path: path.join(output, 'install-online-connect.png') });
    await choose('Connect to the internet', (x) => x.op === 'check');
    await choose('Still offline', () => true);
    await choose('Connect to the internet', (x) => x.op === 'check');
    await title('Where should Tessera go?');
    await choose('Where should Tessera go?', (x) => x.disk);
    await title('Graphics');
    assert.match(await page.evaluate(() => modal.body), /downloads during the install/);
    checks.push('Online installer: asks to connect first (Wi-Fi or cable, checks again), then the usual steps, noting the download');
  } finally { await app2.close(); }
  assert.deepEqual(errors, [], 'no page errors');
  for (const c of checks) console.log('ok -', c);
  console.log(`installer: ${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
