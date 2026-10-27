// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: add-ons from the add-on list, and shards (add-ons that are code), on the real
// launcher in real Electron. The add-on list is a stand-in served from this machine; the shard is a
// made-up one that leaves marks on disk, so the test can see exactly when it runs.
//   xvfb-run -a -s "-screen 0 1280x720x24 -noreset" node qa/addons.cjs
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');

const launcher = process.argv[2] || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher');
const P = require(path.join(launcher, 'addon-package.js'));
const output = process.env.TESSERA_QA_OUTPUT || path.resolve(process.cwd(), 'qa-output');
const executablePath = process.env.TESSERA_ELECTRON || require('electron');
fs.mkdirSync(output, { recursive: true });
const checks = [];

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-addons-'));
const dataDir = path.join(temp, 'data');
const marks = path.join(temp, 'marks');
fs.mkdirSync(marks, { recursive: true });
const game = path.join(temp, 'demo-game');
fs.writeFileSync(game, '#!/bin/sh\n', { mode: 0o755 });

// The made-up shard: a page with actions, a library source, and marks on disk when it starts and stops.
const shardJs = `
const fs = require('fs'); const path = require('path');
const M = ${JSON.stringify(marks)};
module.exports = {
  activate(t) {
    fs.writeFileSync(path.join(M, 'started'), String(t.apiVersion) + ' ' + t.id + ' ' + t.dataDir);
    t.log('hello from the log');
    t.addPanel({
      title: 'Demo page',
      render: () => ({ body: 'Line one\\u0007\\nLine two' + 'x'.repeat(5000), items: [
        { label: 'Say hello', sub: 'an action', action: 'hello' },
        { label: 'Open a site', action: 'open' },
        { label: 'A bad link', action: 'bad' },
        { label: 'Just text' },
        { label: 'Odd action', action: '../../etc' },
      ] }),
      action: async (name) => name === 'hello' ? { message: 'Hello from the shard' }
        : name === 'open' ? { openUrl: 'https://example.com/' }
        : name === 'bad' ? { openUrl: 'javascript:alert(1)' } : {},
    });
    t.addLibrarySource({ name: 'Demo library', scan(offer) {
      offer({ title: 'Demo Game', kind: 'game', file: ${JSON.stringify(game)}, args: ['--fast'] });
      offer({ title: 'Relative', kind: 'game', file: 'bin/game', args: [] });
      offer({ title: 'Odd kind', kind: 'kernel', file: '/bin/true', args: [] });
      offer({ title: 'Bad args', kind: 'app', file: '/bin/true', args: 'rm -rf /' });
    } });
  },
  deactivate() { fs.writeFileSync(path.join(M, 'stopped'), 'yes'); },
};`;
const shardPkg = P.writePackage([
  { name: 'addon.json', data: JSON.stringify({ id: 'demo', name: 'Demo Shard', author: 'QA', version: '1.0.0', description: 'A shard for the test.', entry: 'index.js', tessera: { api: 1 } }) },
  { name: 'index.js', data: shardJs },
]);
const shardPkg2 = P.writePackage([
  { name: 'addon.json', data: JSON.stringify({ id: 'demo', name: 'Demo Shard', author: 'QA', version: '1.1.0', description: 'A shard for the test, newer.', entry: 'index.js', tessera: { api: 1 } }) },
  { name: 'index.js', data: shardJs.replace("'started'", "'started-again'") },
]);
const futurePkg = P.writePackage([
  { name: 'addon.json', data: JSON.stringify({ id: 'future', name: 'Future Shard', version: '1.0.0', entry: 'index.js', tessera: { api: 99 } }) },
  { name: 'index.js', data: `require('fs').writeFileSync(${JSON.stringify(path.join(marks, 'future'))}, 'ran');` },
]);
const themePkg = P.writePackage([{ name: 'theme.json', data: JSON.stringify({ name: 'QA Night', defaults: { accent: '#ff8800' } }) }]);
const files = { 'demo.tar.gz': shardPkg, 'future.tar.gz': futurePkg, 'night.tar.gz': themePkg, 'bad.tar.gz': shardPkg };

(async () => {
  let base;
  let catalog;
  const server = http.createServer((req, res) => {
    const name = req.url.replace(/^\//, '');
    if (name === 'catalog.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(catalog)); }
    if (files[name]) return res.end(files[name]);
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const entry = (id, kind, name, pkg, file, extra = {}) => ({ id, kind, name, version: '1.0.0', author: 'QA', description: `${name}.`, url: `${base}/${file}`, sha256: P.sha256(pkg), size: pkg.length, ...extra });
  catalog = { version: 1, addons: [
    entry('demo', 'shard', 'Demo Shard', shardPkg, 'demo.tar.gz'),
    entry('qa-night', 'theme', 'QA Night', themePkg, 'night.tar.gz'),
    entry('future', 'shard', 'Future Shard', futurePkg, 'future.tar.gz'),
    entry('tampered', 'shard', 'Tampered', shardPkg, 'bad.tar.gz', { sha256: 'f'.repeat(64) }),
    entry('elsewhere', 'shard', 'Elsewhere', shardPkg, 'demo.tar.gz', { url: 'https://evil.example.net/demo.tar.gz' }),
    { id: '../broken', kind: 'shard' },
  ] };

  const errors = [];
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: temp, TESSERA_DATA_DIR: dataDir, TESSERA_DEV: '1', TESSERA_ADDON_CATALOG: `${base}/catalog.json`,
      XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e)));
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setFullScreen(false); w.setContentSize(1280, 720); w.setPosition(0, 0); });
    await page.waitForFunction(() => typeof flowAddons === 'function' && typeof api !== 'undefined', null, { timeout: 15000 });
    await page.evaluate(() => { if (modal) closeModal(); });
    const title = (t) => page.waitForFunction((x) => modal && (x instanceof RegExp ? false : modal.title === x), t, { timeout: 10000, polling: 100 });
    const titleLike = (re) => page.waitForFunction((src) => modal && new RegExp(src).test(modal.title), re.source, { timeout: 10000, polling: 100 });
    const press = async (fn) => {
      await page.evaluate((src) => { const f = new Function('x', 'return (' + src + ')(x)'); const i = modal.items.findIndex((x) => f(x)); if (i < 0) throw new Error('no such item in ' + modal.title + ': ' + src); modal.index = i; modalPress('a'); }, fn.toString());
      await page.waitForTimeout(200);
    };
    const back = async () => { await page.evaluate(() => modalPress('b')); await page.waitForTimeout(200); };
    const status = () => page.evaluate(() => document.getElementById('status').textContent);
    const waitStatus = async (re) => {
      try { await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('status').textContent), re.source, { timeout: 15000, polling: 100 }); }
      catch { throw new Error(`waited for ${re} but the status says: ${await status()} (modal: ${await page.evaluate(() => modal && modal.title)})`); }
    };
    const shardsDir = path.join(dataDir, 'Tessera', 'Shards');
    const settings = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));

    // The list, and installing a shard from it. Installing never runs it.
    page.evaluate(() => { flowAddons(); });
    await title('Add-ons');
    await press((x) => x.op === 'store');
    await title('Get add-ons');
    const listed = await page.evaluate(() => modal.items.map((x) => x.label));
    assert.deepEqual(listed, ['Demo Shard', 'QA Night', 'Future Shard', 'Tampered', 'Elsewhere']);
    await page.screenshot({ path: path.join(output, 'addons-1-list.png') });
    await press((x) => x.addon && x.addon.id === 'demo');
    await titleLike(/^Install “Demo Shard”/);
    assert.match(await page.evaluate(() => modal.title), /Installing it does not turn it on/);
    await press((x) => x.yes);
    await waitStatus(/Installed Demo Shard\. It is unverified/);
    assert.ok(fs.existsSync(path.join(shardsDir, 'demo', 'index.js')));
    assert.ok(!fs.existsSync(path.join(marks, 'started')), 'installing must not run it');
    checks.push('Get add-ons lists the good entries (a broken one is left out) and installs a shard without running it');

    // A theme from the list lands in Themes.
    await title('Get add-ons');
    await press((x) => x.addon && x.addon.id === 'qa-night');
    await press((x) => x.yes);
    await waitStatus(/Installed QA Night/);
    assert.ok(fs.existsSync(path.join(dataDir, 'Tessera', 'Themes', 'qa-night', 'theme.json')));
    // A download that doesn't match the list, and one from a place Tessera doesn't trust, are refused.
    await title('Get add-ons');
    await press((x) => x.addon && x.addon.id === 'tampered');
    await press((x) => x.yes);
    await waitStatus(/doesn't match the add-on list/);
    assert.ok(!fs.existsSync(path.join(shardsDir, 'tampered')));
    await title('Get add-ons');
    await press((x) => x.addon && x.addon.id === 'elsewhere');
    await press((x) => x.yes);
    await waitStatus(/isn't from a place Tessera trusts/);
    assert.ok(!fs.existsSync(path.join(shardsDir, 'elsewhere')));
    checks.push('A theme installs into Themes; a download that differs from the list, or comes from elsewhere, is refused');

    // Turning it on runs it (after saying it's unverified); its page shows cleaned-up text.
    await title('Get add-ons');
    await back();
    await title('Add-ons');
    await press((x) => x.view === 'packs');
    await title('Add-ons · Shards');
    assert.match(await page.evaluate(() => modal.items[0].sub), /^Off · Unverified/);
    await press((x) => x.shard && x.shard.id === 'demo');
    await title('Shards · Demo Shard');
    await press((x) => x.op === 'enable');
    await titleLike(/^Turn on “Demo Shard”\? It isn't signed by Tessera/);
    await press((x) => x.yes);
    await waitStatus(/Demo Shard is on/);
    const started = fs.readFileSync(path.join(marks, 'started'), 'utf8');
    assert.match(started, /^1 demo /);
    assert.ok(fs.existsSync(started.split(' ')[2]), 'it gets a data folder of its own');
    assert.deepEqual(settings().codeAddons.enabled, ['demo']);
    await title('Shards · Demo Shard');
    await press((x) => x.panel === 0);
    await title('Demo page');
    const view = await page.evaluate(() => ({ body: modal.body, items: modal.items.map((x) => ({ label: x.label, act: x.act || null })) }));
    assert.ok(view.body.startsWith('Line one\nLine two') && !view.body.includes('\u0007') && view.body.length <= 1500, 'body is cleaned and capped');
    assert.deepEqual(view.items.map((x) => x.act), ['hello', 'open', 'bad', null, null]);
    await page.screenshot({ path: path.join(output, 'addons-2-shard-page.png') });
    await press((x) => x.act === 'hello');
    await waitStatus(/Hello from the shard/);
    await title('Demo page');
    const open = await page.evaluate(() => api.shards('action', { id: 'demo', panel: 0, action: 'open' }));
    assert.equal(open.view.openUrl, 'https://example.com/');
    const bad = await page.evaluate(() => api.shards('action', { id: 'demo', panel: 0, action: 'bad' }));
    assert.equal(bad.view.openUrl, undefined, 'only web links may be opened');
    checks.push('Turning a shard on warns it is unverified, then runs it; its page is cleaned up, actions work, and only web links open');

    // Its library source: good entries are offered, broken ones never reach the scan.
    const scan = await page.evaluate(() => api.scan('run'));
    const fromShard = scan.found.filter((f) => f.source === 'Demo library').map((f) => f.title);
    assert.deepEqual(fromShard, ['Demo Game']);
    checks.push("A shard's library source offers its games to Find games; malformed entries are dropped");

    // An update while it's on restarts it on the new files.
    files['demo.tar.gz'] = shardPkg2;
    catalog.addons[0] = { ...catalog.addons[0], version: '1.1.0', sha256: P.sha256(shardPkg2), size: shardPkg2.length };
    const upd = await page.evaluate(() => api.shards('install', { id: 'demo' }));
    assert.ok(upd.ok, upd.error);
    assert.match(upd.message, /Updated Demo Shard.*Restarted with the new version/);
    assert.ok(fs.existsSync(path.join(marks, 'stopped')) && fs.existsSync(path.join(marks, 'started-again')));
    checks.push('Updating a shard that is on stops the old one and starts the new one');

    // Off: it stops, and stays off after a restart of the scan.
    await back(); await title('Shards · Demo Shard');
    fs.rmSync(path.join(marks, 'stopped'), { force: true });
    await press((x) => x.op === 'disable');
    await waitStatus(/Demo Shard is off/);
    assert.ok(fs.existsSync(path.join(marks, 'stopped')));
    assert.deepEqual(settings().codeAddons.enabled, []);
    const scan2 = await page.evaluate(() => api.scan('run'));
    assert.ok(!scan2.found.some((f) => f.source === 'Demo library'));
    checks.push('Turning it off stops it and its library source');

    // Shard safety: with unverified shards not allowed, it won't start; a shard for a newer API never runs.
    await page.evaluate(() => api.addons('packsAllowUnverified', { value: false }));
    const refused = await page.evaluate(() => api.shards('enable', { id: 'demo' }));
    assert.equal(refused.ok, false);
    assert.match(refused.error, /unverified, and Shard safety only allows Official/);
    await page.evaluate(() => api.addons('packsAllowUnverified', { value: true }));
    assert.ok((await page.evaluate(() => api.shards('install', { id: 'future' }))).ok);
    const fut = await page.evaluate(() => api.shards('enable', { id: 'future' }));
    assert.equal(fut.ok, false);
    assert.match(fut.error, /API 99/);
    assert.ok(!fs.existsSync(path.join(marks, 'future')), 'a shard for another API version never runs');
    checks.push('Shard safety blocks unverified shards when asked to; a shard for a newer add-on API never runs');

    // With a PIN, turning one on needs it.
    await page.evaluate(() => api.settings('pinSet', { pin: '2468' }));
    await page.evaluate(() => api.settings('pinLock', {}));
    const locked = await page.evaluate(() => api.shards('enable', { id: 'demo' }));
    assert.equal(locked.needPin, true);
    assert.ok(!(await page.evaluate(() => api.addons('list'))).packs.find((p) => p.id === 'demo').enabled);
    checks.push('With a PIN set, turning a shard on asks for it');

    // Removing it deletes the folder and forgets it was on.
    await page.evaluate(() => api.settings('pinCheck', { pin: '2468' }));
    await page.evaluate(() => api.shards('enable', { id: 'demo' }));
    const rm = await page.evaluate(() => api.addons('remove', { dir: 'packs', id: 'demo' }));
    assert.ok(rm.ok, rm.error);
    assert.ok(!fs.existsSync(path.join(shardsDir, 'demo')));
    assert.deepEqual(settings().codeAddons.enabled, []);
    checks.push('Removing a shard stops it, deletes its folder and forgets it was on');
    assert.match(fs.readFileSync(path.join(temp, 'state', 'tessera', 'logs', 'shards.log'), 'utf8'), /\[demo\] hello from the log/);
  } finally {
    await app.close();
    server.close();
  }
  assert.deepEqual(errors, [], 'no page errors');
  for (const c of checks) console.log('ok -', c);
  console.log(`addons: ${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
