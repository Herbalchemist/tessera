// SPDX-License-Identifier: GPL-3.0-or-later
// Pure Nintendo-controller frame mapping shared by built-in and external browser input.
'use strict';

function direction(x, y, threshold) {
  if (Math.abs(x) > Math.abs(y)) return Math.abs(x) > threshold ? (x < 0 ? 'LEFT' : 'RIGHT') : '';
  return Math.abs(y) > threshold ? (y < 0 ? 'UP' : 'DOWN') : '';
}

function actionsForFrame(frame, previousButtons = 0, previousLeft = '', previousRight = '') {
  const buttons = Number(frame && frame.b) || 0;
  const down = buttons & ~previousButtons;
  const keys = [];
  for (const [bit, key] of [[12, 'UP'], [13, 'DOWN'], [14, 'LEFT'], [15, 'RIGHT']]) {
    if (down & (1 << bit)) keys.push(key);
  }
  // Switch controller standard mapping: B is bit 0 (back), A is bit 1 (activate).
  if (down & (1 << 1)) keys.push('ENTER');
  if (down & (1 << 0)) keys.push('ESC');

  const axes = Array.isArray(frame && frame.a) ? frame.a : [];
  const lx = Number(axes[0]) || 0;
  const ly = Number(axes[1]) || 0;
  const rx = Number(axes[2]) || 0;
  const ry = Number(axes[3]) || 0;
  const leftDirection = direction(lx, ly, 0.65);
  if (leftDirection && leftDirection !== previousLeft) keys.push(leftDirection);

  // The right stick scrolls a browser by page-sized keyboard steps. Emit on direction
  // transitions to avoid spawning a key event for every high-frequency controller frame.
  const rightDirection = direction(rx, ry, 0.55);
  if (rightDirection && rightDirection !== previousRight) {
    keys.push(rightDirection === 'UP' ? 'PAGEUP'
      : rightDirection === 'DOWN' ? 'PAGEDOWN' : rightDirection);
  }
  return { keys, leftDirection, rightDirection };
}

module.exports = { actionsForFrame };
