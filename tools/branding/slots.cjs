// SPDX-License-Identifier: GPL-3.0-or-later
// The empty stone spots, dashed, each in its stone's colour, in the symbol's own 64-unit space.
// Shared by the boot menu's wait screen (grub.cjs) and the Plymouth backdrop (render.cjs), so the
// animation starts on exactly the picture the wait screen showed and the stones land in the spots.
// Each spot sits a little inside its stone, so a placed stone covers it completely.
'use strict';
const fs = require('fs');
const path = require('path');

const SYM = JSON.parse(fs.readFileSync(path.join(__dirname, 'symbol.json'), 'utf8'));
const slotsBody = () => SYM.pieces.map((p) => {
  const pts = p.slot.map(([x, y]) => `${x},${y}`).join(' ');
  return `<polygon points="${pts}" fill="${p.color}" fill-opacity="0.06" stroke="${p.color}" stroke-opacity="0.6" stroke-width="1.2" stroke-dasharray="2.6 2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
}).join('');

module.exports = { slotsBody };
