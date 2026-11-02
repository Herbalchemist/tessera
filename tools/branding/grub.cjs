// SPDX-License-Identifier: GPL-3.0-or-later
// Pictures for Tessera's boot menu (system_files/usr/share/tessera/grub): the empty tile spots the
// wait screen shows (the tiles "waiting to be placed", in the same place and size as the boot
// animation that follows), the symbol for the Boot options header, the wordmark, and the
// highlight behind the chosen line (nine pieces, GRUB's way of drawing a box of any size).
//   node tools/branding/grub.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'system_files/usr/share/tessera/grub');
const BR = path.join(ROOT, 'system_files/usr/share/tessera/branding');
const SYM = JSON.parse(fs.readFileSync(path.join(__dirname, 'symbol.json'), 'utf8'));
const ACCENT = '#b4a7ff';

// the four spots, dashed, in each tile's colour; same 128 px frame as the boot animation (motion.cjs)
const slots = () => `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="-10 -10 84 84">${SYM.tiles.map(([x, y, w, r], i) => {
  const s = w - 1.4;
  return `<rect x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" rx="${s * 0.23}" fill="${SYM.colors[i]}" fill-opacity="0.06" stroke="${SYM.colors[i]}" stroke-opacity="0.55" stroke-width="1.4" stroke-dasharray="3.2 2.6" stroke-linecap="round" transform="translate(${x} ${y}) rotate(${r})"/>`;
}).join('')}</svg>`;

// the highlight: a rounded box, R px corners
const R = 10;
const corner = (rot) => `<svg xmlns="http://www.w3.org/2000/svg" width="${R}" height="${R}" viewBox="0 0 ${R} ${R}"><g transform="rotate(${rot} ${R / 2} ${R / 2})"><path d="M${R} 0 H${R} V${R} H0 V${R} A${R} ${R} 0 0 1 ${R} 0 Z" fill="${ACCENT}"/></g></svg>`;
const solid = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${ACCENT}"/></svg>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  const png = (svg, w, h) => page.evaluate(async ({ svg, w, h }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(svg); await img.decode();
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png').split(',')[1];
  }, { svg, w, h });
  const write = async (name, svg, w, h) => fs.writeFileSync(path.join(OUT, name), Buffer.from(await png(svg, w, h), 'base64'));
  await write('slots.png', slots(), 128, 128);
  await write('select_nw.png', corner(0), R, R);
  await write('select_ne.png', corner(90), R, R);
  await write('select_se.png', corner(180), R, R);
  await write('select_sw.png', corner(270), R, R);
  await write('select_n.png', solid(1, R), 1, R);
  await write('select_s.png', solid(1, R), 1, R);
  await write('select_w.png', solid(R, 1), R, 1);
  await write('select_e.png', solid(R, 1), R, 1);
  await write('select_c.png', solid(1, 1), 1, 1);
  fs.copyFileSync(path.join(BR, 'tessera-logo-64.png'), path.join(OUT, 'symbol.png'));
  fs.copyFileSync(path.join(BR, 'tessera-plymouth-watermark.png'), path.join(OUT, 'wordmark.png'));
  await browser.close();
  console.log('boot menu pictures written');
})();
