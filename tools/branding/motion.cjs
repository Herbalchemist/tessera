// SPDX-License-Identifier: GPL-3.0-or-later
// Tessera's symbol, built tile by tile: the boot animation (Plymouth) and the busy cursor.
// Reads symbol.json (written by make-logos.py) so the motion always matches the logo.
//   node tools/branding/motion.cjs            frames, cursors
//   node tools/branding/motion.cjs --preview  also out/boot-preview.mp4 and out/cursor-preview.mp4
//
// The build: the big tile drops in, then the three small ones snap into place beside it, each
// settling with a little overshoot, like tesserae being set. It holds, fades, and starts again.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SYM = JSON.parse(fs.readFileSync(path.join(__dirname, 'symbol.json'), 'utf8'));
const THEME = path.join(ROOT, 'system_files/usr/share/plymouth/themes/tessera');
const CURSORS = path.join(ROOT, 'system_files/usr/share/icons/Tessera/cursors');
const OUT = path.join(__dirname, 'out');

// ---- the motion, as a function of time (seconds) within one loop
const LOOP = 2.8;
const START = [0.15, 0.5, 0.68, 0.86];
const DUR = [0.5, 0.34, 0.34, 0.38];
const EXIT = 2.15, EXIT_STAGGER = 0.06, EXIT_DUR = 0.3;
const clamp = (x) => Math.max(0, Math.min(1, x));
const outBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2; };
const outCubic = (p) => 1 - (1 - p) ** 3;
const inCubic = (p) => p ** 3;

// One frame of the symbol as SVG markup, in the symbol's own 64-unit space.
function symbolAt(t) {
  let out = '';
  SYM.tiles.forEach(([x, y, w, rot], i) => {
    const p = clamp((t - START[i]) / DUR[i]);
    if (p <= 0) return;
    const q = clamp((t - EXIT - i * EXIT_STAGGER) / EXIT_DUR);
    const opacity = clamp(p / 0.35) * (1 - q);
    if (opacity <= 0.003) return;
    const scale = (0.3 + 0.7 * outBack(p)) * (1 - 0.25 * inCubic(q));
    const r = rot + (1 - outCubic(p)) * (i % 2 ? -30 : 30);
    const dy = -(1 - outCubic(p)) * 10;
    const s = w * scale;
    out += `<rect x="${(-s / 2).toFixed(3)}" y="${(-s / 2).toFixed(3)}" width="${s.toFixed(3)}" height="${s.toFixed(3)}" rx="${(s * 0.23).toFixed(3)}" ` +
      `fill="${SYM.colors[i]}" fill-opacity="${opacity.toFixed(3)}" transform="translate(${x} ${(y + dy).toFixed(3)}) rotate(${r.toFixed(2)})"/>`;
  });
  return out;
}

// The pointer from the launcher (renderer/input.js), for the "busy but you can still click" cursor.
const ARROW = '<path d="M5 3 L5 25 L11 19.5 L15 28.5 L19 26.8 L15.2 18 L23 18 Z" fill="#ffffff" stroke="#17151f" stroke-width="2" stroke-linejoin="round"/>';

const svg = (size, view, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${view}">${body}</svg>`;
// the boot frame: 128 px, the symbol drawn 100 px wide in the middle (room for the overshoot)
const bootFrame = (t) => svg(128, '-10 -10 84 84', symbolAt(t));
// "wait": only the symbol, building
const waitFrame = (t, n) => svg(n, '-6 -6 76 76', symbolAt(t));
// "progress": the pointer, and the symbol building at its lower right
const progressFrame = (t, n) => svg(n, '0 0 32 32',
  `<g transform="scale(0.72)">${ARROW}</g><g transform="translate(15.5 15.5) scale(0.25)">${symbolAt(t)}</g>`);

// ---- Xcursor files (the format X and Wayland desktops read cursors from)
// frames: [{ size, w, h, xhot, yhot, delay, argb: Uint32Array (premultiplied) }]
function xcursor(frames) {
  const ntoc = frames.length;
  const head = 16 + ntoc * 12;
  let pos = head;
  const chunks = frames.map((f) => { const at = pos; pos += 36 + f.w * f.h * 4; return at; });
  const buf = Buffer.alloc(pos);
  buf.write('Xcur', 0, 'latin1');
  buf.writeUInt32LE(16, 4); buf.writeUInt32LE(0x10000, 8); buf.writeUInt32LE(ntoc, 12);
  frames.forEach((f, i) => {
    const t = 16 + i * 12;
    buf.writeUInt32LE(0xfffd0002, t); buf.writeUInt32LE(f.size, t + 4); buf.writeUInt32LE(chunks[i], t + 8);
    let o = chunks[i];
    for (const v of [36, 0xfffd0002, f.size, 1, f.w, f.h, f.xhot, f.yhot, f.delay]) { buf.writeUInt32LE(v, o); o += 4; }
    for (let k = 0; k < f.argb.length; k++, o += 4) buf.writeUInt32LE(f.argb[k] >>> 0, o);
  });
  return buf;
}

// Draws SVG frames in the browser: PNG files, or raw pixels for the cursors.
async function draw(page, svgs, n, as) {
  return page.evaluate(async ({ svgs, n, as }) => {
    const c = document.createElement('canvas'); c.width = n; c.height = n;
    const g = c.getContext('2d');
    const out = [];
    for (const s of svgs) {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(s);
      await img.decode();
      g.clearRect(0, 0, n, n); g.drawImage(img, 0, 0, n, n);
      out.push(as === 'png' ? c.toDataURL('image/png').split(',')[1] : Array.from(g.getImageData(0, 0, n, n).data));
    }
    return out;
  }, { svgs, n, as });
}
const premultiplied = (rgba) => {
  const a = new Uint32Array(rgba.length / 4);
  for (let i = 0; i < a.length; i++) {
    const [r, g, b, al] = rgba.slice(i * 4, i * 4 + 4);
    const m = (v) => Math.round((v * al) / 255);
    a[i] = ((al << 24) | (m(r) << 16) | (m(g) << 8) | m(b)) >>> 0;
  }
  return a;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  // ---- the boot animation: 30 frames a second (Plymouth's throbber rate)
  const FPS = 30;
  const count = Math.round(LOOP * FPS);
  fs.mkdirSync(THEME, { recursive: true });
  for (const f of fs.readdirSync(THEME)) if (/^throbber-\d+\.png$/.test(f)) fs.unlinkSync(path.join(THEME, f));
  const boot = await draw(page, Array.from({ length: count }, (_, i) => bootFrame(i / FPS)), 128, 'png');
  boot.forEach((b64, i) => fs.writeFileSync(path.join(THEME, `throbber-${String(i + 1).padStart(4, '0')}.png`), Buffer.from(b64, 'base64')));

  // ---- the busy cursors: a quicker loop, 20 frames a second, at the usual cursor sizes
  const CLOOP = 1.6, CFPS = 20, cframes = Math.round(CLOOP * CFPS);
  const ct = (i) => (i / cframes) * LOOP; // the same motion, played faster
  fs.mkdirSync(CURSORS, { recursive: true });
  for (const [name, frame, hot] of [['wait', waitFrame, (n) => [n / 2, n / 2]], ['progress', progressFrame, (n) => [Math.round(5 * 0.72 * n / 32), Math.round(3 * 0.72 * n / 32)]]]) {
    const frames = [];
    for (const n of [24, 32, 48, 64]) {
      const px = await draw(page, Array.from({ length: cframes }, (_, i) => frame(ct(i), n)), n, 'raw');
      const [xhot, yhot] = hot(n);
      px.forEach((rgba) => frames.push({ size: n, w: n, h: n, xhot: Math.round(xhot), yhot: Math.round(yhot), delay: Math.round(1000 / CFPS), argb: premultiplied(rgba) }));
    }
    fs.writeFileSync(path.join(CURSORS, name), xcursor(frames));
  }
  // the other names programs ask for the same two cursors by
  const aliases = {
    watch: 'wait', 'half-busy': 'progress', left_ptr_watch: 'progress',
    '08e8e1c95fe2fc01f976f1e063a24ccd': 'progress', '3ecb610c1bf2410f44200f48c40d3599': 'progress',
  };
  for (const [a, to] of Object.entries(aliases)) {
    const p = path.join(CURSORS, a);
    try { fs.unlinkSync(p); } catch { /* new */ }
    fs.symlinkSync(to, p);
  }

  // ---- previews for people to look at (not installed)
  if (process.argv.includes('--preview')) {
    fs.mkdirSync(OUT, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(OUT, 'pv-'));
    const word = fs.readFileSync(path.join(ROOT, 'system_files/usr/share/tessera/branding/tessera-plymouth-watermark.png')).toString('base64');
    await page.setViewportSize({ width: 960, height: 540 });
    for (let i = 0; i < count * 2; i++) {
      const b = boot[i % count];
      await page.setContent(`<body style="margin:0;background:#000;width:960px;height:540px;position:relative">
        <img src="data:image/png;base64,${b}" style="position:absolute;left:416px;top:206px;width:128px">
        <img src="data:image/png;base64,${word}" style="position:absolute;left:50%;bottom:22px;transform:translateX(-50%)"></body>`);
      await page.screenshot({ path: path.join(tmp, `f${String(i).padStart(4, '0')}.png`) });
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.png'), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', path.join(OUT, 'boot-preview.mp4')]);
    for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
    // the cursors, big, on a desktop-ish background
    await page.setViewportSize({ width: 480, height: 240 });
    const w = await draw(page, Array.from({ length: cframes }, (_, i) => waitFrame(ct(i), 96)), 96, 'png');
    const pr = await draw(page, Array.from({ length: cframes }, (_, i) => progressFrame(ct(i), 96)), 96, 'png');
    for (let i = 0; i < cframes * 3; i++) {
      await page.setContent(`<body style="margin:0;width:480px;height:240px;background:linear-gradient(135deg,#2b2540,#1a1726);display:flex;align-items:center;justify-content:space-around;font:14px sans-serif;color:#aaa">
        <div style="text-align:center"><img src="data:image/png;base64,${w[i % cframes]}"><br>busy</div>
        <div style="text-align:center"><img src="data:image/png;base64,${pr[i % cframes]}"><br>working, still clickable</div></body>`);
      await page.screenshot({ path: path.join(tmp, `c${String(i).padStart(4, '0')}.png`) });
    }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(CFPS), '-i', path.join(tmp, 'c%04d.png'), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', path.join(OUT, 'cursor-preview.mp4')]);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  await browser.close();
  console.log(`boot: ${count} frames; cursors: wait, progress (${cframes} frames each)`);
})();
