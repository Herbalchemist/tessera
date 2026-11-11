// SPDX-License-Identifier: GPL-3.0-or-later
// The line icons Ludus draws for its tabs (TAB_ICONS) and its Settings tiles (ICONS): SVG path data in a
// 24 x 24 box. ludus.py reads this file; nothing runs it as a program.
const TAB_ICONS = {
  browser: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.6 5.2 3.6 8.5s-1 6.1-3.6 8.5M12 3.5c-2.6 2.4-3.6 5.2-3.6 8.5s1 6.1 3.6 8.5"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6.5 9.5V19h11V9.5"/><path d="M10.5 19v-5h3v5"/>',
  library: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  apps: '<circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="7" r="2.3"/><circle cx="7" cy="17" r="2.3"/><circle cx="17" cy="17" r="2.3"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18"/>',
  new: '<path d="M12 5v14M5 12h14"/>',
  mosaic: '<rect x="4" y="4" width="9" height="9" rx="1.5"/><rect x="15" y="4" width="5" height="5" rx="1"/><rect x="15" y="11" width="5" height="9" rx="1"/><rect x="4" y="15" width="9" height="5" rx="1"/>',
};

const ICONS = {
  wifi: { anim: 'seq', parts: [['path', { d: 'M8.5 15.5a5 5 0 0 1 7 0', class: 'a1' }], ['path', { d: 'M5.5 12.2a9.5 9.5 0 0 1 13 0', class: 'a2' }], ['path', { d: 'M2.5 8.9a14 14 0 0 1 19 0', class: 'a3' }], ['circle', { cx: 12, cy: 19, r: 1.3, class: 'dot' }]] },
  bluetooth: { anim: 'seq', parts: [['path', { d: 'M7 7.5l10 9-5 4.5V3l5 4.5-10 9' }], ['circle', { cx: 3.5, cy: 12, r: 1.1, class: 'dot a1' }], ['circle', { cx: 20.5, cy: 12, r: 1.1, class: 'dot a2' }]] },
  sound: { anim: 'seq', parts: [['path', { d: 'M3.5 9.5h3.5L11.5 6v12L7 14.5H3.5z' }], ['path', { d: 'M15 9.5a3.5 3.5 0 0 1 0 5', class: 'a1' }], ['path', { d: 'M17.5 7a7 7 0 0 1 0 10', class: 'a2' }], ['path', { d: 'M20 4.5a10.5 10.5 0 0 1 0 15', class: 'a3' }]] },
  pad: { anim: 'seq', parts: [['path', { d: 'M7 8h10a4 4 0 0 1 3.9 3.1l1 4.6a2.4 2.4 0 0 1-4.3 1.9L16 16H8l-1.6 1.6a2.4 2.4 0 0 1-4.3-1.9l1-4.6A4 4 0 0 1 7 8z' }], ['path', { d: 'M8 10.6v3.4M6.3 12.3h3.4' }], ['circle', { cx: 15.6, cy: 11.4, r: 0.9, class: 'dot a1' }], ['circle', { cx: 17.6, cy: 13.3, r: 0.9, class: 'dot a2' }]] },
  keyboard: { anim: 'press', parts: [['rect', { x: 2.5, y: 6, width: 19, height: 12, rx: 2 }], ['path', { d: 'M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01', class: 'a1' }], ['path', { d: 'M7.5 12.5h.01M10.5 12.5h.01M13.5 12.5h.01M16.5 12.5h.01', class: 'a2' }], ['path', { d: 'M8 15.3h8', class: 'a3' }]] },
  controls: { anim: 'press', parts: [['rect', { x: 3, y: 5, width: 5, height: 5, rx: 1.3, class: 'a1' }], ['rect', { x: 9.5, y: 5, width: 5, height: 5, rx: 1.3, class: 'a2' }], ['rect', { x: 16, y: 5, width: 5, height: 5, rx: 1.3, class: 'a3' }], ['rect', { x: 3, y: 13, width: 18, height: 5.5, rx: 1.3 }]] },
  report: { anim: 'press', parts: [['path', { d: 'M6 3.5h8.5L19 8v12.5H6z' }], ['path', { d: 'M14.5 3.5V8H19' }], ['path', { d: 'M9 12h7M9 15h7', class: 'a1' }], ['path', { d: 'M9 18h4', class: 'a2' }]] },
  theme: { anim: 'pop', parts: [['path', { d: 'M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z' }], ['circle', { cx: 7.5, cy: 11, r: 1.2, class: 'dot a1' }], ['circle', { cx: 9.5, cy: 7, r: 1.2, class: 'dot a2' }], ['circle', { cx: 14.5, cy: 7, r: 1.2, class: 'dot a3' }], ['circle', { cx: 17.2, cy: 10.6, r: 1.2, class: 'dot a4' }]] },
  profiles: { anim: 'pop', parts: [['circle', { cx: 16, cy: 7.5, r: 2.2, class: 'a2' }], ['path', { d: 'M12.3 19c.3-2.8 2.1-4.6 4.2-4.6s3.9 1.8 4.2 4.6', class: 'a2' }], ['circle', { cx: 8.5, cy: 8.5, r: 2.6, class: 'a1' }], ['path', { d: 'M3.5 19c0-3.3 2.2-5.5 5-5.5s5 2.2 5 5.5', class: 'a1' }]] },
  display: { anim: 'draw', parts: [['rect', { x: 3, y: 4, width: 18, height: 12.5, rx: 2 }], ['path', { d: 'M9 20.5h6M12 16.5v4' }], ['path', { d: 'M6 13l3.2-3.2 2.6 2.6 2.2-2.2L17.8 14', class: 'a1', pathLength: 1 }]] },
  storage: { anim: 'seq', parts: [['rect', { x: 3, y: 4.5, width: 18, height: 6.5, rx: 2 }], ['rect', { x: 3, y: 13, width: 18, height: 6.5, rx: 2 }], ['circle', { cx: 17, cy: 7.75, r: 1, class: 'dot a1' }], ['circle', { cx: 17, cy: 16.25, r: 1, class: 'dot a2' }], ['path', { d: 'M6.5 7.75h5M6.5 16.25h5' }]] },
  update: { anim: 'spin', parts: [['path', { d: 'M19.5 12a7.5 7.5 0 0 1-13.6 4.4M4.5 12a7.5 7.5 0 0 1 13.6-4.4' }], ['path', { d: 'M18.6 3.4v4.4h-4.4M5.4 20.6v-4.4h4.4' }]] },
  addons: { anim: 'wiggle', parts: [['path', { d: 'M10 4.5a2 2 0 0 1 4 0V6h3.5a1.5 1.5 0 0 1 1.5 1.5V11h-1.5a2 2 0 0 0 0 4H19v3.5a1.5 1.5 0 0 1-1.5 1.5H14v-1.5a2 2 0 0 0-4 0V20H6.5A1.5 1.5 0 0 1 5 18.5V15h1.5a2 2 0 0 0 0-4H5V7.5A1.5 1.5 0 0 1 6.5 6H10z' }]] },
  pin: { anim: 'lift', parts: [['rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2.2 }], ['path', { d: 'M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5', class: 'a1' }], ['path', { d: 'M12 14.3v2.6' }]] },
  power: { anim: 'pulse', parts: [['path', { d: 'M12 3.5v8', class: 'a1' }], ['path', { d: 'M7.2 6.2a7.6 7.6 0 1 0 9.6 0' }]] },
  desktop: { anim: 'slide', parts: [['rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }], ['path', { d: 'M9 20.5h6M12 17v3.5' }], ['rect', { x: 5.8, y: 6.8, width: 7, height: 5, rx: 1, class: 'a1' }], ['rect', { x: 11.2, y: 9.6, width: 7, height: 5, rx: 1, class: 'a2' }]] },
};
