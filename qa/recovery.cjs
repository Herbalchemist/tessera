// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: Recover, on the Tessera USB. The USB's root helper (live-recover, from the
// tessera-mortar repo, with its own tests there) is a stand-in that answers like the real one and
// records what it was asked. Checks: Recover is on the welcome screen; the install is found and what's
// wrong is shown with the suggested repairs; a repair asks for an administrator's password, which
// goes to the helper on its input (never on its command line); a wrong password can be tried again;
// a report can be read.
//   xvfb-run -a -s "-screen 0 1280x720x24" node qa/recovery.cjs
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

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-recover-'));
const dataDir = path.join(temp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const ID = '1234abcd-0000:default';
const INST = { id: ID, disk: { name: 'nvme0n1', model: 'Samsung SSD 980', size: 1000204886016 }, hostname: 'x', versions: [{ index: 0, version: '43.20261101.0', image: 'ghcr.io/herbalchemist/tessera:latest' }, { index: 1, version: '43.20261031.0', image: '' }], users: [{ name: 'alex', admin: true }, { name: 'kid', admin: false }] };
const helper = path.join(temp, 'live-recover');
fs.writeFileSync(path.join(temp, 'probe.json'), JSON.stringify({ ok: true, installs: [INST] }));
fs.writeFileSync(path.join(temp, 'diagnose.json'), JSON.stringify({ ok: true, install: INST, findings: [{ key: 'signin', text: "Tessera isn't set to start at boot.", fix: 'signin' }, { key: 'versions', text: 'An earlier version is kept.', fix: null }] }));
fs.writeFileSync(path.join(temp, 'report.json'), JSON.stringify({ ok: true, text: 'Tessera recovery report\n== What was found\n- sign-in off\n', saved: '~/Tessera/Reports/tessera-recovery-report-1.txt (alex)' }));
fs.writeFileSync(helper, `#!/bin/bash
T=${JSON.stringify(temp)}
echo "$*" >> "$T/args"
case "$1" in
  probe|diagnose|report) cat "$T/$1.json" ;;
  fix) in=$(cat); echo "$in" >> "$T/stdin"
       if echo "$in" | grep -q '"password":"tessera1"'; then echo '{"ok": true, "done": ["turned on for version 43.20261101.0"]}'; else echo '{"ok": false, "needPassword": true, "error": "That is not the password of an administrator account on this Tessera."}'; exit 1; fi ;;
esac
`, { mode: 0o755 });

(async () => {
  const errors = [];
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: temp, TESSERA_DATA_DIR: dataDir, TESSERA_DEV: '1', TESSERA_INSTALLER: '1', TESSERA_LIVE_RECOVER: helper,
      TESSERA_LIVE_INSTALL_NOSUDO: '1', XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });
    await page.waitForFunction(() => modal && modal.title === 'Welcome to Tessera', null, { timeout: 20000, polling: 200 });
    const welcome = await page.evaluate(() => modal.items.map((x) => x.label));
    assert.deepEqual(welcome, ['Install Tessera', 'Try it first', 'Recover']);
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.op === 'recover'); modalPress('a'); });
    try { await page.waitForFunction(() => modal && modal.title === 'Recover', null, { timeout: 10000, polling: 200 }); } catch (e) { console.error('at:', await page.evaluate(() => ({ title: modal && modal.title, body: modal && modal.body, status: document.getElementById('status').textContent, busy }))); throw e; }
    const menu = await page.evaluate(() => ({ body: modal.body, items: modal.items.map((x) => ({ label: x.label, sub: x.sub, ok: Boolean(x.ok) })) }));
    assert.match(menu.body, /Samsung SSD 980/);
    assert.match(menu.body, /isn't set to start at boot/);
    assert.deepEqual(menu.items.find((x) => x.label === 'Start in Tessera at boot again'), { label: 'Start in Tessera at boot again', sub: 'suggested', ok: true });
    await page.screenshot({ path: path.join(output, 'recovery-menu.png') });
    checks.push("Recover is on the USB's welcome screen; it finds the install and shows what's wrong with the suggested repair");

    // the repair: a wrong password first, then the right one
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.tool === 'signin'); modalPress('a'); });
    await page.waitForFunction(() => modal && modal.kind === 'keys' && /Password for alex/.test(modal.title), null, { timeout: 5000, polling: 100 });
    await page.evaluate(() => { modal.text = 'wrong'; finishKeys(true); });
    await page.waitForFunction(() => modal && modal.title === 'Wrong password', null, { timeout: 10000, polling: 100 });
    await page.evaluate(() => { modal.index = 0; modalPress('a'); });
    await page.waitForFunction(() => modal && modal.kind === 'keys', null, { timeout: 5000, polling: 100 });
    await page.evaluate(() => { modal.text = 'tessera1'; finishKeys(true); });
    await page.waitForFunction(() => modal && modal.title === 'Done', null, { timeout: 10000, polling: 100 });
    assert.match(await page.evaluate(() => modal.body), /turned on for version 43\.20261101\.0/);
    const args = fs.readFileSync(path.join(temp, 'args'), 'utf8');
    assert.doesNotMatch(args, /tessera1|wrong/, 'the password is never on the command line');
    assert.match(args, new RegExp(`^fix ${ID.replace(/[.:]/g, '\\$&')}$`, 'm'));
    const stdin = fs.readFileSync(path.join(temp, 'stdin'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(stdin, [{ tool: 'signin', user: 'alex', password: 'wrong' }, { tool: 'signin', user: 'alex', password: 'tessera1' }]);
    checks.push("A repair asks for an administrator's password, sends it on the helper's input only, and lets a wrong one be tried again");

    // the report
    await page.evaluate(() => { modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Recover', null, { timeout: 10000, polling: 100 });
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.op === 'report'); modalPress('a'); });
    await page.waitForFunction(() => modal && /^Saved: ~\/Tessera\/Reports\//.test(modal.title), null, { timeout: 10000, polling: 100 });
    assert.ok(await page.evaluate(() => modal.items.some((x) => x.header && x.label === 'What was found')));
    checks.push('A problem report is made, saved in its Tessera folder, and can be read line by line');

    // Versions: undo the last update (start the one before it by default)
    await page.evaluate(() => { if (modal) closeModal(); });
    await page.waitForTimeout(300);
    page.evaluate(() => { flowRecovery(); });
    await page.waitForFunction(() => modal && modal.title === 'Recover', null, { timeout: 10000, polling: 100 });
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.op === 'versions'); modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Versions', null, { timeout: 5000, polling: 100 });
    const vs = await page.evaluate(() => modal.items.map((x) => [x.label, x.sub]));
    assert.deepEqual(vs, [['Version 43.20261101.0', 'starts by default'], ['Version 43.20261031.0', 'before the last update']]);
    await page.evaluate(() => { modal.index = 1; modalPress('a'); });
    await page.waitForFunction(() => modal && modal.title === 'Version 43.20261031.0', null, { timeout: 5000, polling: 100 });
    assert.equal(await page.evaluate(() => modal.items[0].sub), 'undoes the last update');
    await page.evaluate(() => { modal.index = 0; modalPress('a'); });
    await page.waitForFunction(() => modal && modal.kind === 'keys', null, { timeout: 5000, polling: 100 });
    await page.evaluate(() => { modal.text = 'tessera1'; finishKeys(true); });
    await page.waitForFunction(() => modal && modal.title === 'Done', null, { timeout: 10000, polling: 100 });
    const last = fs.readFileSync(path.join(temp, 'stdin'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
    assert.deepEqual(last, { tool: 'version', user: 'alex', password: 'tessera1', action: 'default', index: 1 });
    checks.push('Versions lists the kept versions; starting the one before the last update sends that exact change');

    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  for (const c of checks) console.log('PASS', c);
  console.log(`${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
