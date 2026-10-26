// SPDX-License-Identifier: GPL-3.0-or-later
// Structural shell presets are deliberately data-only. Theme JSON may select one
// of these names, but cannot describe arbitrary DOM, CSS, or script of its own.
(function exposeShellLayout(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TesseraShellLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const PRESETS = Object.freeze({
    classic: Object.freeze({ id: 'classic', navigation: 'horizontal', contentEntry: 'down', contentExit: 'up' }),
    dock: Object.freeze({ id: 'dock', navigation: 'horizontal', contentEntry: 'up', contentExit: 'down' }),
    crossbar: Object.freeze({ id: 'crossbar', navigation: 'horizontal', contentEntry: 'down', contentExit: 'up' }),
    dashboard: Object.freeze({ id: 'dashboard', navigation: 'vertical', contentEntry: 'right', contentExit: 'left' }),
    // Console homages. Each is still only a named arrangement of the same launcher parts.
    switch: Object.freeze({ id: 'switch', navigation: 'horizontal', contentEntry: 'up', contentExit: 'down' }),     // a row of square tiles over round icon buttons
    hero: Object.freeze({ id: 'hero', navigation: 'horizontal', contentEntry: 'down', contentExit: 'up' }),         // small tabs top-left, a tile row, the selection's art filling the screen
    pivot: Object.freeze({ id: 'pivot', navigation: 'horizontal', contentEntry: 'down', contentExit: 'up' }),       // left-aligned text pivots over flat square tiles
    cube: Object.freeze({ id: 'cube', navigation: 'vertical', contentEntry: 'right', contentExit: 'left' }),        // chunky menu buttons down the left under a turning cube
    channel: Object.freeze({ id: 'channel', navigation: 'horizontal', contentEntry: 'up', contentExit: 'down' }),   // a wall of wide channels over a curved bar with the clock
  });

  function normalize(value) {
    return Object.prototype.hasOwnProperty.call(PRESETS, value) ? value : 'classic';
  }

  function describe(value) {
    return PRESETS[normalize(value)];
  }

  return Object.freeze({ PRESETS, normalize, describe });
});
