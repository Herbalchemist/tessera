'use strict';
// Games added to Steam by hand (shortcuts.vdf): parsing, launch ids, and finding the files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../steam-shortcuts');

const tmp = [];
test.after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); });

// ------------------------------------------------------- steam shortcuts parsing
function enc(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') parts.push(Buffer.concat([Buffer.from([1]), Buffer.from(k + '\0' + v + '\0')]));
    else if (typeof v === 'number') { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(Buffer.concat([Buffer.from([2]), Buffer.from(k + '\0'), b])); }
    else parts.push(Buffer.concat([Buffer.from([0]), Buffer.from(k + '\0'), enc(v)]));
  }
  return Buffer.concat([...parts, Buffer.from([8])]);
}
const vdf = (entries) => Buffer.concat([Buffer.from([0]), Buffer.from('shortcuts\0'), enc(Object.fromEntries(entries.map((e, i) => [String(i), e]))), Buffer.from([8])]);

test('crc32 matches the standard test vector', () => {
  assert.strictEqual(S.crc32('123456789'), 0xcbf43926);
});

test('shortcuts: stored id, computed id, odd key case, hidden flag', () => {
  const buf = vdf([
    { appid: -1234567890, AppName: 'Gears of War: E-Day', Exe: '"/home/u/xodus/launch.sh"', StartDir: '"/home/u"', IsHidden: 0, tags: {} },
    { appname: 'Old Entry', exe: '"/usr/bin/thing"', ishidden: 1 },
    { AppName: 'No Exe' },
  ]);
  const list = S.parse(buf);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].name, 'Gears of War: E-Day');
  assert.strictEqual(list[0].launchId, (BigInt(-1234567890 >>> 0) * 4294967296n + 33554432n).toString());
  assert.strictEqual(list[1].appid, null);
  assert.strictEqual(list[1].hidden, true);
  const short = BigInt(list[1].launchId) >> 32n;
  assert.strictEqual(short, BigInt((S.crc32('"/usr/bin/thing"Old Entry') | 0x80000000) >>> 0));
  assert.ok(short >= 0x80000000n); // the top bit marks a shortcut
  assert.strictEqual(BigInt(list[1].launchId) & 0xffffffffn, 0x02000000n);
});

test('shortcuts: damaged files give nothing and never throw', () => {
  const good = vdf([{ appid: 5, AppName: 'A', Exe: 'a' }]);
  for (const cut of [0, 1, 5, 12, 30, good.length - 1]) assert.doesNotThrow(() => S.parse(good.subarray(0, cut)));
  assert.deepStrictEqual(S.parse(Buffer.from('not a vdf file at all')), []);
  assert.deepStrictEqual(S.parse(Buffer.from([0, 0x73, 0, 9, 9, 9])), []);
  assert.deepStrictEqual(S.parse('text'), []);
  assert.deepStrictEqual(S.parse(Buffer.concat([good, Buffer.alloc(9 * 1024 * 1024)])), []); // over the size cap
  assert.strictEqual(S.parse(good).length, 1);
});

test('shortcuts: finds files for every Steam user once, even through a symlinked folder', () => {
  const home = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'xr-'));
  tmp.push(home);
  const steam = path.join(home, '.local/share/Steam');
  for (const u of ['111', '222', 'anonymous']) {
    fs.mkdirSync(path.join(steam, 'userdata', u, 'config'), { recursive: true });
    fs.writeFileSync(path.join(steam, 'userdata', u, 'config', 'shortcuts.vdf'), vdf([{ appid: -77, AppName: 'Game ' + u, Exe: 'x' }]));
  }
  fs.mkdirSync(path.join(home, '.steam'), { recursive: true });
  fs.symlinkSync(steam, path.join(home, '.steam/steam'));
  const files = S.shortcutFiles(home);
  assert.strictEqual(files.length, 2); // 'anonymous' is not a user id, and the symlink is the same folder
  const list = S.read(home);
  assert.strictEqual(list.length, 1); // same id in both users' files: offered once
});

test('shortcuts: launch options are kept (so Heroic and Lutris entries can be told apart)', () => {
  const list = S.parse(vdf([{ appid: -9, AppName: 'Via Heroic', Exe: '"/usr/bin/flatpak"', LaunchOptions: 'run com.heroicgameslauncher.hgl heroic://launch/x' }]));
  assert.match(list[0].options, /heroic/);
});
