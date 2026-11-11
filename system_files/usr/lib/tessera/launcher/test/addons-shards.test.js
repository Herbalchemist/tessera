'use strict';
// Add-ons and shards on the real main process: the add-on list and installing from it (never runs it),
// refusing a download that differs from the list or comes from elsewhere, turning a shard on (unverified
// warning, its page cleaned up, only web links), its library source, updating while on, Shard safety,
// the PIN, removing. A stand-in server gives the list and the packages.
const test = require('node:test');
test.after(() => { setImmediate(() => process.exit()); });
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const H = require('./xbox-harness');

const LAUNCHER = path.join(__dirname, '..');
const P = require('../addon-package');

test('add-ons and shards', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'addons-'));
  const dataDir = path.join(tmp, 'data');
  const marks = path.join(tmp, 'marks');
  fs.mkdirSync(marks, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ firstRunDone: true }));
  const game = path.join(tmp, 'demo-game');
  fs.writeFileSync(game, '#!/bin/sh\n', { mode: 0o755 });
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
        { label: 'Say hello', sub: 'an action', action: 'hello' }, { label: 'Open a site', action: 'open' }, { label: 'A bad link', action: 'bad' },
        { label: 'Just text' }, { label: 'Odd action', action: '../../etc' } ] }),
      action: async (name) => name === 'hello' ? { message: 'Hello from the shard' }
        : name === 'open' ? { openUrl: 'https://example.com/' } : name === 'bad' ? { openUrl: 'javascript:alert(1)' } : {},
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
  const manifest = (id, version, extra) => JSON.stringify({ id, name: 'Demo Shard', author: 'QA', version, description: 'A shard for the test.', entry: 'index.js', tessera: { api: 1 }, ...extra });
  const shardPkg = P.writePackage([{ name: 'addon.json', data: manifest('demo', '1.0.0') }, { name: 'index.js', data: shardJs }]);
  const shardPkg2 = P.writePackage([{ name: 'addon.json', data: manifest('demo', '1.1.0') }, { name: 'index.js', data: shardJs.replace("'started'", "'started-again'") }]);
  const futurePkg = P.writePackage([
    { name: 'addon.json', data: JSON.stringify({ id: 'future', name: 'Future Shard', version: '1.0.0', entry: 'index.js', tessera: { api: 99 } }) },
    { name: 'index.js', data: `require('fs').writeFileSync(${JSON.stringify(path.join(marks, 'future'))}, 'ran');` }]);
  const themePkg = P.writePackage([{ name: 'theme.json', data: JSON.stringify({ name: 'QA Night', defaults: { accent: '#ff8800' } }) }]);
  const files = { 'demo.tar.gz': shardPkg, 'future.tar.gz': futurePkg, 'night.tar.gz': themePkg, 'bad.tar.gz': shardPkg };
  let base, catalog;
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
    entry('demo', 'shard', 'Demo Shard', shardPkg, 'demo.tar.gz'), entry('qa-night', 'theme', 'QA Night', themePkg, 'night.tar.gz'),
    entry('future', 'shard', 'Future Shard', futurePkg, 'future.tar.gz'), entry('tampered', 'shard', 'Tampered', shardPkg, 'bad.tar.gz', { sha256: 'f'.repeat(64) }),
    entry('elsewhere', 'shard', 'Elsewhere', shardPkg, 'demo.tar.gz', { url: 'https://evil.example.net/demo.tar.gz' }), { id: '../broken', kind: 'shard' } ] };
  process.env.TESSERA_ADDON_CATALOG = `${base}/catalog.json`;
  const h = await H.load({ launcher: LAUNCHER, tmp });
  const shards = (op, x) => h.call('shards', op, x || {});
  const S = (op, x) => h.call('settings', op, x || {});
  const shardsDir = path.join(tmp, 'vault', 'Shards');
  const settings = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
  try {
    // the list (a broken entry is left out), and installing a shard from it: never run by installing
    const cat = await shards('catalog');
    assert.ok(cat.ok, JSON.stringify(cat));
    assert.deepStrictEqual(cat.addons.map((a) => a.name), ['Demo Shard', 'QA Night', 'Future Shard', 'Tampered', 'Elsewhere']);
    let r = await shards('install', { id: 'demo' });
    assert.ok(r.ok, r.error);
    assert.match(r.message, /Installed Demo Shard\. It is unverified/);
    assert.ok(fs.existsSync(path.join(shardsDir, 'demo', 'index.js')));
    assert.ok(!fs.existsSync(path.join(marks, 'started')), 'installing must not run it');
    // a theme lands in Themes; a download that differs from the list, or from elsewhere, is refused
    r = await shards('install', { id: 'qa-night' });
    assert.ok(r.ok, r.error);
    assert.ok(fs.existsSync(path.join(tmp, 'vault', 'Themes', 'qa-night', 'theme.json')));
    r = await shards('install', { id: 'tampered' });
    assert.match(r.error, /doesn't match the add-on list/);
    assert.ok(!fs.existsSync(path.join(shardsDir, 'tampered')));
    r = await shards('install', { id: 'elsewhere' });
    assert.match(r.error, /isn't from a place Tessera trusts/);
    assert.ok(!fs.existsSync(path.join(shardsDir, 'elsewhere')));
    // turning it on runs it; its page is cleaned up, actions work, only web links open
    r = await shards('enable', { id: 'demo' });
    assert.ok(r.ok, r.error);
    const started = fs.readFileSync(path.join(marks, 'started'), 'utf8');
    assert.match(started, /^1 demo /);
    assert.ok(fs.existsSync(started.split(' ')[2]), 'it gets a data folder of its own');
    assert.deepStrictEqual(settings().codeAddons.enabled, ['demo']);
    const page = (await shards('panel', { id: 'demo', panel: 0 })).view;
    assert.ok(page.body.startsWith('Line one\nLine two') && !page.body.includes('\u0007') && page.body.length <= 1500, 'body is cleaned and capped');
    assert.deepStrictEqual(page.items.map((x) => x.action || null), ['hello', 'open', 'bad', null, null]);
    assert.match((await shards('action', { id: 'demo', panel: 0, action: 'hello' })).view.message, /Hello from the shard/);
    assert.strictEqual((await shards('action', { id: 'demo', panel: 0, action: 'open' })).view.openUrl, 'https://example.com/');
    assert.strictEqual((await shards('action', { id: 'demo', panel: 0, action: 'bad' })).view.openUrl, undefined, 'only web links may be opened');
    // its library source: good entries are offered, broken ones never reach the scan
    const scan = await h.call('scan', 'run');
    assert.deepStrictEqual(scan.found.filter((f) => f.source === 'Demo library').map((f) => f.title), ['Demo Game']);
    // an update while it's on restarts it on the new files
    files['demo.tar.gz'] = shardPkg2;
    catalog.addons[0] = { ...catalog.addons[0], version: '1.1.0', sha256: P.sha256(shardPkg2), size: shardPkg2.length };
    r = await shards('install', { id: 'demo' });
    assert.ok(r.ok, r.error);
    assert.match(r.message, /Updated Demo Shard.*Restarted with the new version/);
    assert.ok(fs.existsSync(path.join(marks, 'stopped')) && fs.existsSync(path.join(marks, 'started-again')));
    // off: it stops, and stays off
    fs.rmSync(path.join(marks, 'stopped'), { force: true });
    assert.ok((await shards('disable', { id: 'demo' })).ok);
    assert.ok(fs.existsSync(path.join(marks, 'stopped')));
    assert.deepStrictEqual(settings().codeAddons.enabled, []);
    assert.ok(!(await h.call('scan', 'run')).found.some((f) => f.source === 'Demo library'));
    // Shard safety: unverified shards refused when asked; a shard for a newer API never runs
    await h.call('addons', 'packsAllowUnverified', { value: false });
    r = await shards('enable', { id: 'demo' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /unverified, and Shard safety only allows Official/);
    await h.call('addons', 'packsAllowUnverified', { value: true });
    assert.ok((await shards('install', { id: 'future' })).ok);
    r = await shards('enable', { id: 'future' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /API 99/);
    assert.ok(!fs.existsSync(path.join(marks, 'future')), 'a shard for another API version never runs');
    // with a PIN, turning one on needs it
    await S('pinSet', { pin: '2468' });
    await S('pinLock');
    assert.strictEqual((await shards('enable', { id: 'demo' })).needPin, true);
    assert.ok(!(await h.call('addons', 'list')).packs.find((p) => p.id === 'demo').enabled);
    // removing it stops it, deletes its folder and forgets it was on
    await S('pinCheck', { pin: '2468' });
    await shards('enable', { id: 'demo' });
    r = await h.call('addons', 'remove', { dir: 'packs', id: 'demo' });
    assert.ok(r.ok, r.error);
    assert.ok(!fs.existsSync(path.join(shardsDir, 'demo')));
    assert.deepStrictEqual(settings().codeAddons.enabled, []);
    assert.match(fs.readFileSync(path.join(tmp, 'state', 'tessera', 'logs', 'shards.log'), 'utf8'), /\[demo\] hello from the log/);
  } finally { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
