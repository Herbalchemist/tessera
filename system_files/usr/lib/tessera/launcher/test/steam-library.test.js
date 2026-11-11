'use strict';
// Steam games saved before launches were made quiet (0.39.1) are upgraded when the library loads, so
// they launch quietly too, and a new scan finding the same game in the quiet form doesn't add it twice.
const test = require('node:test');
test.after(() => { setImmediate(() => process.exit()); });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./xbox-harness');

const LAUNCHER = path.join(__dirname, '..');

test('old Steam games load with quiet launch arguments and are not added twice', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'steamlib-'));
  const data = path.join(tmp, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ firstRunDone: true }));
  fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify({
    items: [
      { id: 'cs2', kind: 'game', title: 'Counter-Strike 2', path: '/usr/bin/steam', args: ['steam://rungameid/730'] },
      { id: 'added', kind: 'game', title: 'Added by hand', path: '/usr/bin/steam', args: ['steam://rungameid/12345678901234567890'] },
      { id: 'fp', kind: 'game', title: 'Flatpak Steam game', path: '/usr/bin/flatpak', args: ['run', 'com.valvesoftware.Steam', 'steam://rungameid/570'] },
      { id: 'lutris', kind: 'game', title: 'Lutris game', path: '/usr/bin/lutris', args: ['lutris:rungame/doom'] },
    ],
    categories: [],
  }));
  for (const k of Object.keys(require.cache)) if (k.startsWith(LAUNCHER + path.sep) && !k.includes(path.sep + 'test' + path.sep)) delete require.cache[k];
  await H.load({ launcher: LAUNCHER, tmp });
  const library = require(path.join(LAUNCHER, 'main', 'library.js'));
  const args = Object.fromEntries(['cs2', 'added', 'fp', 'lutris'].map((id) => [id, library.itemById(id).args]));
  assert.deepStrictEqual(args.cs2, ['-silent', '-applaunch', '730']);
  assert.deepStrictEqual(args.added, ['-silent', 'steam://rungameid/12345678901234567890']);
  assert.deepStrictEqual(args.fp, ['run', 'com.valvesoftware.Steam', '-silent', '-applaunch', '570']);
  assert.deepStrictEqual(args.lutris, ['lutris:rungame/doom']);
  assert.deepStrictEqual([
    library.addItem({ title: 'Counter-Strike 2', kind: 'game', file: '/usr/bin/steam', args: ['-silent', '-applaunch', '730'] }),
    library.addItem({ title: 'Added by hand', kind: 'game', file: '/usr/bin/steam', args: ['-silent', 'steam://rungameid/12345678901234567890'] }),
  ], [null, null]);
});
