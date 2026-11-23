// SPDX-License-Identifier: GPL-3.0-or-later
// The boot animation's size is one number written in four places: the frames Plymouth plays
// (throbber-*.png), the empty spots the wait screen shows (slots.png, and the width and height
// splash.txt gives it), and the box those spots are drawn in on Plymouth's backdrop
// (watermark.png). Growing the symbol (128 -> 320) is only done when all of them grow together;
// this checks that, so a change to one of them cannot go unnoticed again.
//   node --test tools/branding/boot-theme.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const GRUB = path.join(ROOT, 'system_files/usr/share/tessera/grub');
const PLYMOUTH = path.join(ROOT, 'system_files/usr/share/plymouth/themes/tessera');

// A PNG's header: Chromium writes 8-bit, non-interlaced files (RGBA from a canvas, RGB or RGBA
// from a screenshot), which is what the readers below handle.
function header(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file}: not a PNG`);
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20), depth = b[24], colour = b[25];
  assert.equal(depth, 8, `${file}: ${depth}-bit PNG`);
  assert.ok(colour === 2 || colour === 6, `${file}: colour type ${colour}, expected RGB or RGBA`);
  assert.equal(b[28], 0, `${file}: interlaced PNG`);
  return { file, width, height, colour };
}

// The whole picture, as RGBA rows (the alpha of an RGB file is opaque).
function pixels(file) {
  const { width, height, colour } = header(file);
  const b = fs.readFileSync(file);
  const idat = [];
  for (let pos = 8; pos < b.length;) {
    const len = b.readUInt32BE(pos), type = b.toString('latin1', pos + 4, pos + 8);
    if (type === 'IDAT') idat.push(b.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const channels = colour === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1), filter = raw[row];
    const at = y * stride, prev = at - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[at + x - channels] : 0;
      const up = y > 0 ? out[prev + x] : 0;
      const ul = x >= channels && y > 0 ? out[prev + x - channels] : 0;
      let v = raw[row + 1 + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
      } else assert.equal(filter, 0, `${file}: row filter ${filter}`);
      out[at + x] = v & 0xff;
    }
  }
  const alpha = (x, y) => channels === 4 ? out[(y * width + x) * 4 + 3] : 255;
  return { width, height, alpha };
}

// The spots as the wait screen shows them: slots.png, and the box the theme gives it.
function theme(file) {
  const text = fs.readFileSync(path.join(GRUB, file), 'utf8');
  const box = /\+ image \{[^}]*?\bfile = "slots\.png"[^}]*?\}/s.exec(text);
  assert.ok(box, `${file}: no image showing slots.png`);
  const field = (name) => Number(new RegExp(`\\b${name} = (\\d+)\\b`).exec(box[0])[1]);
  return { file, width: field('width'), height: field('height') };
}

const slots = header(path.join(GRUB, 'slots.png'));
const size = slots.width;

test('the wait screen shows the spots at slots.png\'s size', () => {
  for (const file of ['splash.txt', 'splash-desktop.txt']) {
    const box = theme(file);
    assert.equal(box.width, size, `${file}: spots ${box.width} px wide, slots.png is ${size}`);
    assert.equal(box.height, size, `${file}: spots ${box.height} px tall, slots.png is ${size}`);
  }
});

test('every boot animation frame is slots.png\'s size', () => {
  assert.equal(slots.width, slots.height, 'slots.png is not square');
  const frames = fs.readdirSync(PLYMOUTH).filter((f) => /^throbber-\d+\.png$/.test(f)).sort();
  assert.ok(frames.length > 0, 'no throbber frames');
  frames.forEach((f, i) => {
    const n = Number(f.slice(9, 13));
    assert.equal(n, i + 1, `frames are numbered 0001 upwards without gaps, found ${f} at ${i + 1}`);
    const { width, height } = header(path.join(PLYMOUTH, f));
    assert.equal(`${width}x${height}`, `${size}x${size}`, `${f} is ${width}x${height}, slots.png is ${size}x${size}`);
  });
});

test('Plymouth\'s backdrop draws those spots at that size, centred', () => {
  const backdrop = pixels(path.join(PLYMOUTH, 'watermark.png'));
  const spots = pixels(path.join(GRUB, 'slots.png'));
  // the spots are drawn over the backdrop's centre, one pixel for one pixel, not scaled: 320 -> 128
  // in one place and 128 -> 320 in another would leave the stones landing beside their spots
  const left = (backdrop.width - size) / 2, top = (backdrop.height - size) / 2;
  assert.ok(Number.isInteger(left) && Number.isInteger(top),
    `backdrop ${backdrop.width}x${backdrop.height} puts the spots off the pixel grid`);
  const missing = (dx, dy) => {
    let n = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (spots.alpha(x, y) < 64) continue;  // the visible strokes, not the faint fill
        const X = left + dx + x, Y = top + dy + y;
        if (backdrop.alpha(X, Y) < 8) n++;
      }
    }
    return n;
  };
  assert.equal(missing(0, 0), 0,
    `watermark.png has no spots at ${left},${top} ${size}x${size}: it and slots.png disagree`);
  for (const d of [-1, 1]) {
    assert.ok(missing(d, 0) > 0 && missing(0, d) > 0,
      `the spots in watermark.png are drawn ${size} px but not on the centre at ${left},${top}`);
  }
});
