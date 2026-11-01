// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

// Steam is a launcher for Tessera games, not the shell. Starting a URI without
// -silent lets Steam decide to foreground Big Picture/gamepad UI, which covers
// the console shell and exposes a desktop action that cannot end tessera-session.
// Keep Steam quiet while launching the requested game instead.
function appArgs(appId) {
  if (appId === undefined || appId === null || !/^\d+$/.test(String(appId))) return [];
  return ['-silent', '-applaunch', String(appId)];
}

function shortcutArgs(launchId) {
  if (launchId === undefined || launchId === null || !/^\d+$/.test(String(launchId))) return [];
  return ['-silent', `steam://rungameid/${launchId}`];
}

module.exports = { appArgs, shortcutArgs };
