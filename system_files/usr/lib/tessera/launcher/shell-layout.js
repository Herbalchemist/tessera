// SPDX-License-Identifier: GPL-3.0-or-later
// Structural shell presets are deliberately data-only. Theme JSON may select one
// of these names, but cannot describe arbitrary DOM, CSS, or script of its own.
//
// A shell is a preset of layout *parts* (where the menu sits, how tabs look, where the
// clock goes, ...). Each part can also be picked on its own in Theme Settings, so pieces
// of different arrangements mix. Every part value is a fixed name the stylesheet knows.
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

  // The parts, each with its allowed values. The first value is what Classic uses.
  const PARTS = Object.freeze({
    nav: Object.freeze(['top', 'top-left', 'bottom', 'bottom-dock', 'bottom-bar', 'left']),   // where the menu (tabs) sits
    tabs: Object.freeze(['pills', 'text', 'pivots', 'round', 'chunky', 'segments']),          // how the tabs look
    clock: Object.freeze(['off', 'corner', 'topbar', 'bar']),                                  // where the clock is
    frame: Object.freeze(['glow', 'framed', 'white', 'halo']),                                 // how the selected tile is marked
    title: Object.freeze(['below', 'above', 'big']),                                           // where the selection's name is
    tile: Object.freeze(['portrait', 'square', 'wide']),                                       // tile shape
    size: Object.freeze(['medium', 'small', 'large']),                                         // tile size (rows of tiles)
    row: Object.freeze(['center', 'focus', 'start']),                                          // how a row of tiles moves
    card: Object.freeze(['standard', 'flat', 'metro', 'glossy', 'bezel']),                     // how a tile looks
    spot: Object.freeze(['off', 'on']),                                                        // the selection's art behind everything
    emblem: Object.freeze(['none', 'cube']),                                                   // a decoration over the menu
    hints: Object.freeze(['center', 'left', 'right']),                                         // where the button hints sit
  });
  const PART_IDS = Object.freeze(Object.keys(PARTS));

  const P = (o) => Object.freeze({
    nav: 'top', tabs: 'pills', clock: 'off', frame: 'glow', title: 'below', tile: 'portrait', size: 'medium',
    row: 'center', card: 'standard', spot: 'off', emblem: 'none', hints: 'center', ...o,
  });
  const PRESET_PARTS = Object.freeze({
    classic: P({}),
    dock: P({ nav: 'bottom-dock', tile: 'wide', hints: 'left' }),
    crossbar: P({ tabs: 'segments' }),
    dashboard: P({ nav: 'left', hints: 'left' }),
    switch: P({ nav: 'bottom', tabs: 'round', clock: 'topbar', frame: 'framed', title: 'above', tile: 'square', size: 'large', row: 'focus', card: 'flat', hints: 'right' }),
    hero: P({ nav: 'top-left', tabs: 'text', clock: 'corner', title: 'big', tile: 'square', size: 'small', row: 'start', card: 'flat', spot: 'on', hints: 'left' }),
    pivot: P({ nav: 'top-left', tabs: 'pivots', clock: 'corner', frame: 'white', tile: 'square', card: 'metro', hints: 'left' }),
    cube: P({ nav: 'left', tabs: 'chunky', card: 'glossy', emblem: 'cube', hints: 'left' }),
    channel: P({ nav: 'bottom-bar', clock: 'bar', frame: 'halo', tile: 'wide', card: 'bezel' }),
  });

  function normalize(value) {
    return Object.prototype.hasOwnProperty.call(PRESETS, value) ? value : 'classic';
  }

  function describe(value) {
    return PRESETS[normalize(value)];
  }

  // The parts in effect: the shell's own, with any part picked on its own on top.
  // Anything unknown (including "auto") falls back to the shell's value.
  function resolveParts(shell, picks) {
    const base = PRESET_PARTS[normalize(shell)];
    const out = { ...base };
    for (const id of PART_IDS) {
      const v = picks && picks[id];
      if (typeof v === 'string' && PARTS[id].includes(v)) out[id] = v;
    }
    return Object.freeze(out);
  }

  // Which way the controller goes between the menu and the tiles follows where the menu is.
  function handoffs(nav) {
    if (nav === 'left') return { navigation: 'vertical', contentEntry: 'right', contentExit: 'left' };
    if (nav === 'bottom' || nav === 'bottom-dock' || nav === 'bottom-bar') return { navigation: 'horizontal', contentEntry: 'up', contentExit: 'down' };
    return { navigation: 'horizontal', contentEntry: 'down', contentExit: 'up' };
  }

  return Object.freeze({ PRESETS, PARTS, PART_IDS, PRESET_PARTS, normalize, describe, resolveParts, handoffs });
});
