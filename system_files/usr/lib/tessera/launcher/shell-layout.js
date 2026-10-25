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
  });

  function normalize(value) {
    return Object.prototype.hasOwnProperty.call(PRESETS, value) ? value : 'classic';
  }

  function describe(value) {
    return PRESETS[normalize(value)];
  }

  return Object.freeze({ PRESETS, normalize, describe });
});
