// SPDX-License-Identifier: GPL-3.0-or-later
// Turns the logo SVGs (from make-logos.py) into the PNGs the image installs, Mortar's icon, and
// pictures for GitHub. Uses the Chromium that Playwright brings.
//   node tools/branding/render.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const BR = path.join(ROOT, 'system_files/usr/share/tessera/branding');
const OUT = path.join(__dirname, 'out');
const MORTAR_ICON = path.join(ROOT, '..', 'tessera-mortar', 'app', 'assets', 'icon.png');
const svgOf = (f) => fs.readFileSync(f, 'utf8');
const ratio = (svg) => { const v = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number); return v[2] / v[3]; };

async function shoot(page, html, w, h, out) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
const fit = (svg, w, h) => `<div style="width:${w}px;height:${h}px">${svg.replace('<svg ', `<svg width="${w}" height="${h}" `)}</div>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const logo = svgOf(path.join(BR, 'tessera-logo.svg'));
  for (const n of [16, 22, 24, 32, 36, 48, 64, 96, 128, 256, 512]) await shoot(page, fit(logo, n, n), n, n, path.join(BR, `tessera-logo-${n}.png`));
  await shoot(page, fit(svgOf(path.join(BR, 'tessera-logo-white.svg')), 256, 256), 256, 256, path.join(BR, 'tessera-logo-white-256.png'));

  // the boot splash's watermark: the wordmark, white letters, 44 px tall
  const word = svgOf(path.join(BR, 'tessera-wordmark.svg'));
  const ww = Math.round(44 * ratio(word));
  await shoot(page, fit(word, ww, 44), ww, 44, path.join(BR, 'tessera-plymouth-watermark.png'));

  const icon = svgOf(path.join(OUT, 'app-icon.svg'));
  await shoot(page, fit(icon, 512, 512), 512, 512, path.join(OUT, 'github-avatar.png'));
  if (fs.existsSync(path.dirname(MORTAR_ICON))) await shoot(page, fit(icon, 512, 512), 512, 512, MORTAR_ICON);

  // GitHub's social preview (Settings > Social preview): 1280 x 640
  const wh = 96;
  await shoot(page, `<div style="width:1280px;height:640px;background:#15131c;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:44px;font:500 34px Inter,sans-serif;color:#9a95ad">
      <div style="display:flex;align-items:center;gap:44px">${fit(logo, 168, 168)}${fit(word, Math.round(wh * ratio(word)), wh)}</div>
      <div>A controller-first gaming OS</div></div>`, 1280, 640, path.join(OUT, 'github-social-preview.png'));
  await browser.close();
  console.log('logo PNGs written');
})();
