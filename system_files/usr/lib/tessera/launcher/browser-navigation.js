// SPDX-License-Identifier: GPL-3.0-or-later
// Main-process-only checks shared by the embedded browser entry points.
'use strict';

function validateHttpUrl(value) {
  if (typeof value !== 'string' || !value) return { ok: false, error: 'No address given.' };
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'Only web addresses are allowed.' };
    }
    return { ok: true, url: url.href };
  } catch {
    return { ok: false, error: 'That web address is invalid.' };
  }
}

function isHttpUrl(value) {
  return validateHttpUrl(value).ok;
}

function keyEvents(key) {
  if (!['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'ESC', 'TAB', 'PAGEUP', 'PAGEDOWN'].includes(key)) return [];
  const events = [{ type: 'keyDown', keyCode: key }];
  // Chromium's default Enter activation uses a character/keypress event. Sending
  // only down/up reaches JS listeners but does not activate a focused HTML button.
  if (key === 'ENTER') events.push({ type: 'char', keyCode: key });
  events.push({ type: 'keyUp', keyCode: key });
  return events;
}

module.exports = { validateHttpUrl, isHttpUrl, keyEvents };
