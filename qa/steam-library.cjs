// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA check: Steam games saved before launches were made quiet (0.39.1) are upgraded when
// the library loads, so they launch quietly too, and a new scan finding the same game in the quiet
// form doesn't add it a second time.
//   xvfb-run -a -s "-screen 0 1280x720x24" node qa/steam-library.cjs
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');

const launcher = process.argv[2] || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher');
const executablePath = process.env.TESSERA_ELECTRON || require('electron');
const checks = [];

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-steamlib-'));
const dataDir = path.join(temp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ firstRunDone: true }));
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
  items: [
    { id: 'cs2', kind: 'game', title: 'Counter-Strike 2', path: '/usr/bin/steam', args: ['steam://rungameid/730'] },
    { id: 'added', kind: 'game', title: 'Added by hand', path: '/usr/bin/steam', args: ['steam://rungameid/12345678901234567890'] },
    { id: 'fp', kind: 'game', title: 'Flatpak Steam game', path: '/usr/bin/flatpak', args: ['run', 'com.valvesoftware.Steam', 'steam://rungameid/570'] },
    { id: 'lutris', kind: 'game', title: 'Lutris game', path: '/usr/bin/lutris', args: ['lutris:rungame/doom'] },
  ],
  categories: [],
}));

(async () => {
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: temp, TESSERA_DATA_DIR: dataDir, TESSERA_DEV: '1', XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !document.body.classList.contains('hold') && document.querySelectorAll('.tab').length >= 5);
    const got = await app.evaluate((_electron, dir) => {
      const library = process.mainModule.require(dir + '/main/library.js');
      const args = Object.fromEntries(['cs2', 'added', 'fp', 'lutris'].map((id) => [id, library.itemById(id).args]));
      // a new scan offers the same games in the quiet form: neither is added again
      const again = [
        library.addItem({ title: 'Counter-Strike 2', kind: 'game', file: '/usr/bin/steam', args: ['-silent', '-applaunch', '730'] }),
        library.addItem({ title: 'Added by hand', kind: 'game', file: '/usr/bin/steam', args: ['-silent', 'steam://rungameid/12345678901234567890'] }),
      ];
      return { args, again };
    }, launcher);
    assert.deepEqual(got.args.cs2, ['-silent', '-applaunch', '730']);
    assert.deepEqual(got.args.added, ['-silent', 'steam://rungameid/12345678901234567890']);
    assert.deepEqual(got.args.fp, ['run', 'com.valvesoftware.Steam', '-silent', '-applaunch', '570']);
    assert.deepEqual(got.args.lutris, ['lutris:rungame/doom']);
    checks.push('Steam games saved the old way (native, added by hand, flatpak) load with quiet launch arguments; others are untouched');
    assert.deepEqual(got.again, [null, null]);
    checks.push('A new scan finding the same Steam games does not add them a second time');
  } finally {
    await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  for (const c of checks) console.log('PASS', c);
  console.log(`${checks.length} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
