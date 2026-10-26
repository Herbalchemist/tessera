// SPDX-License-Identifier: GPL-3.0-or-later
// Optional QA: screenshots of factory themes on the real launcher, with a fictional library.
//   xvfb-run -a -s "-screen 0 1920x1080x24" node qa/theme-shots.cjs [launcherDir]
// Env: THEMES=id,id (default: every builtin)  SIZES=1280x720,1920x1080  ART_DIR=/path/with/g0.png..g9.png
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const launcher = process.argv[2] || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher');
const output = process.env.TESSERA_QA_OUTPUT || path.resolve(process.cwd(), 'qa-output');
const executablePath = process.env.TESSERA_ELECTRON || require('electron');
const artDir = process.env.ART_DIR || '';
const sizes = (process.env.SIZES || '1280x720').split(',').map((s) => s.split('x').map(Number));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-themes-'));
const dataDir = path.join(temp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(output, { recursive: true });
// The shots are driven with keys; pin the hints to controller buttons so they look like a console.
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ firstRunDone: true, kb: { hints: process.env.HINTS || 'controller' } }));
const titles = ['Starfall', 'Coastal Circuit', 'Lantern Quest', 'Deep Orbit', 'Pixel Garden', 'Moonlight Rally', 'Cloudbound', 'Neon Frontier', 'Ember Keep', 'Tidal Drift'];
// Pictures must live under the home folder (the launcher refuses art from anywhere else).
const homeArt = path.join(temp, 'Pictures');
fs.mkdirSync(homeArt, { recursive: true });
const games = titles.map((title, i) => {
  const src = artDir && path.join(artDir, `g${i}.png`);
  let art;
  if (src && fs.existsSync(src)) { art = path.join(homeArt, `g${i}.png`); fs.copyFileSync(src, art); }
  return { id: `g${i}`, title, kind: 'game', path: '/usr/bin/true', ...(art ? { art } : {}) };
});
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
  items: games.concat([{ id: 'app0', title: 'Files', kind: 'app', path: '/usr/bin/true' }, { id: 'app1', title: 'Music', kind: 'app', path: '/usr/bin/true' }]),
  inlays: [{ id: 'clock0', type: 'clock' }, { id: 'cpu0', type: 'cpu' }, { id: 'ram0', type: 'ram' }],
  categories: [
    { id: '_home', title: 'Home', builtin: true, entries: ['clock0', 'cpu0', 'ram0'] },
    { id: 'favorites', title: 'Favorites', top: true, entries: ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'] },
    { id: 'racing', title: 'Racing', entries: ['g1', 'g5', 'g9'] },
  ],
}));

(async () => {
  const app = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', path.join(launcher, 'main.js')],
    env: { ...process.env, HOME: temp, TESSERA_DATA_DIR: dataDir, TESSERA_DEV: '1',
      XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_STATE_HOME: path.join(temp, 'state') },
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForFunction(() => !document.body.classList.contains('hold') && document.querySelectorAll('.tab').length >= 5);
    const all = await page.evaluate(async () => (await launcherAPI.settings('themeGet')).themes.map((t) => t.id));
    // THEMES entries can be "themeId" or "themeId+setting=value+setting=value" (applied on top).
    const ids = process.env.THEMES ? process.env.THEMES.split(',') : all;
    for (const [w, h] of sizes) {
      await app.evaluate(({ BrowserWindow }, s) => { const win = BrowserWindow.getAllWindows()[0]; win.setFullScreen(false); win.setContentSize(s[0], s[1]); win.setPosition(0, 0); }, [w, h]);
      await page.waitForTimeout(400);
      for (const id of ids) {
        await page.evaluate(async (spec) => {
          const [id, ...sets] = spec.split('+');
          let r = await launcherAPI.settings('themeUse', { id });
          if (!r.ok) throw Error('no theme ' + id);
          for (const kv of sets) {
            const [k, v] = kv.split('=');
            r = await launcherAPI.settings('themeSet', { id: k, value: /^\d+$/.test(v) ? Number(v) : v });
            if (!r.ok) throw Error('bad setting ' + kv);
          }
          applyTheme(r.theme);
        }, id);
        const name = id.replace(/[^a-z0-9=+-]/gi, '_');
        for (const view of ['library', 'home', 'settings']) {
          await page.evaluate((v) => { page = v; hoverId = v; stack = []; focus = 'content'; const c = cur(); c.row = 0; c.cols = {}; render(); }, view);
          if (view === 'library') { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150); await page.keyboard.press('ArrowRight'); }
          await page.waitForTimeout(900);
          await page.screenshot({ path: path.join(output, `theme-${name}-${view}-${w}.png`) });
        }
        // the tab bar focused
        await page.evaluate(() => { page = 'library'; hoverId = 'library'; focus = 'tabs'; render(); });
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(output, `theme-${name}-tabs-${w}.png`) });
      }
    }
    console.log(errors.length ? 'ERRORS ' + JSON.stringify(errors) : 'OK ' + ids.join(','));
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
