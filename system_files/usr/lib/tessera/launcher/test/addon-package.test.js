'use strict';
// Add-on packages: the catalog's rules, safe unpacking, and installing over an older copy.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const P = require('../addon-package');

const tmp = [];
const dir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-pkg-')); tmp.push(d); return d; };
test.after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); });

// A raw tar written without any of writePackage's care, to build hostile packages.
function rawTar(entries) {
  const chunks = [];
  for (const e of entries) {
    const data = Buffer.from(e.data || '');
    const h = Buffer.alloc(512, 0);
    h.write(e.name, 0, 100, 'utf8');
    h.write('0000644\0', 100, 8);
    h.write('0000000\0', 108, 8); h.write('0000000\0', 116, 8);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12);
    h.write('00000000000\0', 136, 12);
    h.write('        ', 148, 8);
    h.write(e.type || '0', 156, 1);
    if (e.link) h.write(e.link, 157, 100);
    h.write('ustar\0', 257, 6); h.write('00', 263, 2);
    let sum = 0; for (let i = 0; i < 512; i++) sum += h[i];
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    chunks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}
const entryFor = (gz, over = {}) => ({ id: 'demo', kind: 'shard', name: 'Demo', version: '1.0.0', url: 'https://example.com/demo.tar.gz', sha256: P.sha256(gz), size: gz.length, ...over });
const shardFiles = (extra = []) => [{ name: 'addon.json', data: JSON.stringify({ id: 'demo', name: 'Demo', entry: 'index.js' }) }, { name: 'index.js', data: 'module.exports = {};' }, ...extra];

test('catalog: good entries kept, bad ones skipped with a reason', () => {
  const good = { id: 'xbox', kind: 'shard', name: 'Xbox', version: '0.1.0', url: 'https://github.com/x/y/releases/download/a/b.tar.gz', sha256: 'a'.repeat(64), size: 1000 };
  const c = P.parseCatalog(JSON.stringify({ version: 1, addons: [
    good,
    { ...good, id: 'xbox' }, // twice
    { ...good, id: '../evil' },
    { ...good, id: 'k', kind: 'kernel' },
    { ...good, id: 'u', url: 'file:///etc/passwd' },
    { ...good, id: 's', sha256: 'nope' },
    { ...good, id: 'z', size: 64 * 1024 * 1024 },
    { ...good, id: 'w', kind: 'widget', name: 'A\u0000widget\nname' },
  ] }));
  assert.deepStrictEqual(c.addons.map((a) => a.id), ['xbox', 'w']);
  assert.strictEqual(c.addons[1].name, 'A widget name');
  assert.deepStrictEqual(c.skipped.map((s) => s.why), ['listed twice', 'bad id', 'unknown kind', 'bad url', 'bad sha256', 'bad size']);
  assert.throws(() => P.parseCatalog('{"version":2,"addons":[]}'), /format/);
  assert.throws(() => P.parseCatalog('not json'), /valid/);
  assert.throws(() => P.parseCatalog('x'.repeat(300 * 1024)), /too big/);
});

test('package: written deterministically and read back the same', () => {
  const files = shardFiles([{ name: 'lib/deep/a.js', data: 'x' }]);
  const a = P.writePackage(files);
  const b = P.writePackage([...files].reverse());
  assert.ok(a.equals(b), 'same files, same bytes');
  const back = P.readPackage(a);
  assert.deepStrictEqual(back.filter((e) => !e.dir).map((e) => e.name), ['addon.json', 'index.js', 'lib/deep/a.js']);
  assert.deepStrictEqual(back.filter((e) => e.dir).map((e) => e.name), ['lib', 'lib/deep']);
  // system tar agrees with the format
  const d = dir();
  fs.writeFileSync(path.join(d, 'p.tar.gz'), a);
  const r = require('node:child_process').spawnSync('tar', ['-tzf', path.join(d, 'p.tar.gz')], { encoding: 'utf8' });
  if (r.status === 0) assert.match(r.stdout, /lib\/deep\/a\.js/);
});

test('package: hostile packages are refused whole', () => {
  const bad = {
    'a link': [{ name: 'addon.json', data: '{}' }, { name: 'evil', type: '2', link: '/etc/passwd' }],
    'a hard link': [{ name: 'evil', type: '1', link: 'addon.json' }],
    'a device': [{ name: 'evil', type: '3' }],
    'going up': [{ name: '../escape.js', data: 'x' }],
    'going up later': [{ name: 'a/../../escape.js', data: 'x' }],
    'absolute': [{ name: '/etc/cron.d/x', data: 'x' }],
    'hidden': [{ name: '.bashrc', data: 'x' }],
    'odd characters': [{ name: 'a b;rm.js', data: 'x' }],
    'twice': [{ name: 'a.js', data: '1' }, { name: 'a.js', data: '2' }],
    'file then folder': [{ name: 'a', data: '1' }, { name: 'a/b.js', data: '2' }],
  };
  for (const [what, entries] of Object.entries(bad)) assert.throws(() => P.readPackage(rawTar(entries)), Error, what);
  // a damaged header checksum
  const gz = rawTar([{ name: 'a.js', data: 'x' }]);
  const tar = zlib.gunzipSync(gz); tar[0] = 'b'.charCodeAt(0);
  assert.throws(() => P.readPackage(zlib.gzipSync(tar)), /damaged/);
  // too many files, and too big
  assert.throws(() => P.readPackage(P.writePackage(Array.from({ length: 501 }, (_, i) => ({ name: `f${i}`, data: '' })))), /too many/);
  assert.throws(() => P.readPackage(P.writePackage([{ name: 'big', data: Buffer.alloc(9 * 1024 * 1024) }])), /too big/);
  assert.throws(() => P.readPackage(Buffer.from('not gzip')), /unpacked/);
});

test('install: checks size and SHA-256, unpacks, and replaces an older copy only when the new one is ready', () => {
  const root = path.join(dir(), 'Shards');
  const gz = P.writePackage(shardFiles());
  assert.throws(() => P.installPackage(gz, entryFor(gz, { size: gz.length + 1 }), root), /size/);
  assert.throws(() => P.installPackage(gz, entryFor(gz, { sha256: 'b'.repeat(64) }), root), /SHA-256/);
  const r = P.installPackage(gz, entryFor(gz), root);
  assert.strictEqual(r.replaced, false);
  assert.strictEqual(fs.readFileSync(path.join(root, 'demo', 'index.js'), 'utf8'), 'module.exports = {};');
  // an update replaces the folder (old files go)
  fs.writeFileSync(path.join(root, 'demo', 'leftover.js'), 'old');
  const gz2 = P.writePackage(shardFiles([{ name: 'new.js', data: 'n' }]));
  assert.strictEqual(P.installPackage(gz2, entryFor(gz2), root).replaced, true);
  assert.ok(fs.existsSync(path.join(root, 'demo', 'new.js')));
  assert.ok(!fs.existsSync(path.join(root, 'demo', 'leftover.js')));
  // a broken update leaves the installed copy alone
  const broken = rawTar([{ name: 'addon.json', data: '{}' }, { name: '../x', data: 'x' }]);
  assert.throws(() => P.installPackage(broken, entryFor(broken), root));
  assert.ok(fs.existsSync(path.join(root, 'demo', 'new.js')));
  // no staging folders are left behind
  assert.deepStrictEqual(fs.readdirSync(path.dirname(root)).sort(), ['Shards']);
});

test('install: the package must be the add-on the list says', () => {
  const root = path.join(dir(), 'Shards');
  const noTop = P.writePackage([{ name: 'index.js', data: 'x' }]);
  assert.throws(() => P.installPackage(noTop, entryFor(noTop), root), /addon\.json/);
  const other = P.writePackage([{ name: 'addon.json', data: JSON.stringify({ id: 'someone-else', name: 'X', entry: 'i.js' }) }]);
  assert.throws(() => P.installPackage(other, entryFor(other), root), /someone-else/);
  const theme = P.writePackage([{ name: 'theme.json', data: '{"name":"T"}' }]);
  P.installPackage(theme, entryFor(theme, { kind: 'theme', id: 'my-theme' }), path.join(path.dirname(root), 'Themes'));
  assert.ok(fs.existsSync(path.join(path.dirname(root), 'Themes', 'my-theme', 'theme.json')));
});
