// SPDX-License-Identifier: GPL-3.0-or-later
// The four empty tile spots, dashed, in each tile's colour, in the symbol's own 64-unit space.
// Shared by the boot menu's wait screen (grub.cjs) and the boot animation (motion.cjs), so the
// animation starts on exactly the picture the wait screen showed and the tiles land in the spots.
'use strict';
const fs = require('fs');
const path = require('path');

const SYM = JSON.parse(fs.readFileSync(path.join(__dirname, 'symbol.json'), 'utf8'));
const slotsBody = () => SYM.tiles.map(([x, y, w, r], i) => {
  const s = w - 1.4;
  return `<rect x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" rx="${s * 0.23}" fill="${SYM.colors[i]}" fill-opacity="0.06" stroke="${SYM.colors[i]}" stroke-opacity="0.55" stroke-width="1.4" stroke-dasharray="3.2 2.6" stroke-linecap="round" transform="translate(${x} ${y}) rotate(${r})"/>`;
}).join('');

module.exports = { slotsBody };
