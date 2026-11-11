// SPDX-License-Identifier: GPL-3.0-or-later
// Color code for the Qt screens: text on a tile, shades, pastel picks.
.pragma library

var selHue = null; // the hue of the last pastel pick

function lumOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function onColor(hex) {
  const lum = lumOf(hex);
  return (lum + 0.05) / 0.057 >= 1.05 / (lum + 0.05) ? '#10151c' : '#ffffff';
}

function oklchRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

function oklchHex(L, C, hDeg) {
  const enc = (v) => { const x = Math.min(1, Math.max(0, v)); return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)); };
  for (let k = 0; k < 14; k++) {
    const rgb = oklchRgb(L, C, hDeg);
    if (inGamut(rgb)) return '#' + rgb.map((v) => enc(v).toString(16).padStart(2, '0')).join('');
    C *= 0.92;
  }
  return '#' + enc(L).toString(16).padStart(2, '0').repeat(3);
}

function maxChroma(L, hDeg) {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchRgb(L, mid, hDeg))) lo = mid; else hi = mid;
  }
  return lo;
}

function nextPastel(tone) {
  let hue = Math.random() * 360;
  for (let i = 0; selHue !== null && i < 20; i++) {
    const d = Math.abs(hue - selHue) % 360;
    if (Math.min(d, 360 - d) >= 25) break;
    hue = Math.random() * 360;
  }
  selHue = hue;
  const dark = tone === 'dark';
  // Every hue comes out equally soft, so none turns neon: yellows are made lighter (they go mustard when dark),
  // cyan is softened, and the color never goes past what the screen can show.
  const yellow = Math.max(0, Math.cos(((hue - 100) * Math.PI) / 180));
  const cyan = Math.max(0, Math.cos(((hue - 195) * Math.PI) / 180)) ** 2;
  const L = (dark ? 0.81 : 0.82) + (dark ? 0.06 : 0.075) * yellow ** 2 + (Math.random() - 0.5) * 0.04;
  const C = Math.min((dark ? 0.10 : 0.125) * (1 - 0.3 * cyan) * (0.92 + Math.random() * 0.16), 0.92 * maxChroma(L, hue));
  const glow = oklchHex(L, C, hue);
  if (dark) return { glow, ring: glow };
  // On a light page the outline is a touch deeper than the glow so it stays visible (less so for yellows).
  return { glow, ring: oklchHex(L - 0.045 * (1 - 0.85 * yellow), C + 0.02, hue) };
}
