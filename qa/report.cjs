// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: Settings › Report a problem on the real launcher. The report is made only when
// asked, lands in ~/Tessera/Reports, can be read on screen, and carries no home folder or computer name.
//   xvfb-run -a -s "-screen 0 1280x720x24 -noreset" node qa/report.cjs
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const launcher = process.argv[2] || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher');
const output = process.env.TESSERA_QA_OUTPUT || path.resolve(process.cwd(), 'qa-output');
const executablePath = process.env.TESSERA_ELECTRON || require('electron');
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-report-'));
fs.mkdirSync(path.join(temp, 'data'), { recursive: true });
fs.writeFileSync(path.join(temp, 'data', 'settings.json'), JSON.stringify({ firstRunDone: true, pin: { salt: '0'.repeat(32), hash: '1'.repeat(64) } }));
const state = path.join(temp, 'state', 'tessera');
fs.mkdirSync(state, { recursive: true });
fs.writeFileSync(path.join(state, 'session.log'), `session start\nlauncher at ${temp}/x on ${os.hostname()} via 192.168.4.20\n`);

(async () => {
  const checks = [];
  const errors = [];
  const app = await electron.launch({
    executablePath, args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: temp, TESSERA_DATA_DIR: path.join(temp, 'data'), TESSERA_DEV: '1', XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForFunction(() => typeof flowReport === 'function' && document.querySelectorAll('.tab').length >= 4, null, { timeout: 20000 });
    await page.waitForTimeout(400);
    // From the Settings tile: no PIN asked (one is set and locked), the screen lists what goes in.
    await page.evaluate(() => { page = hoverId = 'settings'; render(); runAction('_report'); });
    await page.waitForFunction(() => modal && modal.title === 'Report a problem');
    const listed = await page.evaluate(() => modal.items.filter((x) => x.info).length);
    assert.ok(listed >= 6, 'it says what goes in it');
    const rep = path.join(temp, 'data', 'Tessera', 'Reports');
    assert.equal(fs.existsSync(rep) ? fs.readdirSync(rep).length : 0, 0, 'nothing is made until asked');
    await page.evaluate(() => modalPress('a'));
    await page.waitForFunction(() => modal && modal.title === 'Report saved', null, { timeout: 30000 });
    const files = fs.readdirSync(path.join(temp, 'data', 'Tessera', 'Reports'));
    assert.equal(files.length, 1);
    assert.match(files[0], /^tessera-report-\d{8}-\d{6}\.txt$/);
    const text = fs.readFileSync(path.join(temp, 'data', 'Tessera', 'Reports', files[0]), 'utf8');
    for (const s of ['== Tessera', '== System', '== Hardware', '== Starting up', '== Tessera session log (this session)', '== Settings']) assert.ok(text.includes(s), `has ${s}`);
    assert.ok(!text.includes(temp), 'no home folder');
    if (os.hostname().length > 1 && os.hostname() !== 'localhost') assert.ok(!text.includes(os.hostname()), 'no computer name');
    assert.ok(!text.includes('192.168.4.20'), 'no IP address');
    assert.ok(!/[0-9a-f]{64}/.test(text), 'not even the PIN hash');
    checks.push('Report a problem: made only when asked (no PIN needed), saved to ~/Tessera/Reports, with no home folder, computer name, IP or PIN hash');
    // Read it on screen, then delete it.
    await page.evaluate(() => { modal.index = 0; modalPress('a'); });
    await page.waitForFunction(() => modal && /^tessera-report-/.test(modal.title));
    assert.ok(await page.evaluate(() => modal.items.some((x) => x.header && x.label === 'Hardware')));
    await page.screenshot({ path: path.join(output, 'report-read.png') });
    await page.evaluate(() => modalPress('b'));
    await page.waitForFunction(() => modal && modal.title === 'Report saved');
    await page.evaluate(() => { modal.index = modal.items.findIndex((x) => x.op === 'delete'); modalPress('a'); });
    await page.waitForFunction(() => modal && /^Delete/.test(modal.title));
    await page.evaluate(() => { modal.index = 0; modalPress('a'); });
    await page.waitForFunction(() => !modal);
    assert.equal(fs.readdirSync(path.join(temp, 'data', 'Tessera', 'Reports')).length, 0);
    checks.push('It can be read on screen line by line, and deleted');
  } finally { await app.close(); }
  assert.deepEqual(errors, [], 'no page errors');
  for (const c of checks) console.log('ok -', c);
  console.log(`report: ${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
