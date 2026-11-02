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

// Games saved before launches were made quiet still carry the old arguments (the library keeps
// what the scan found), so they would keep opening Steam's own interface, and a new scan would add
// each of them a second time. On load the library upgrades them: Steam itself, or Steam's flatpak,
// with nothing but steam://rungameid/<id>. Native games have ids below 2^32; games added to Steam
// by hand ("shortcuts") have the 64-bit kind and keep their steam:// form. Anything else, including
// arguments a person set up differently, is left as it is.
function upgrade(file, args) {
  if (!Array.isArray(args)) return args;
  const flatpak = file === '/usr/bin/flatpak' && args[0] === 'run' && args[1] === 'com.valvesoftware.Steam';
  if (file !== '/usr/bin/steam' && !flatpak) return args;
  const pre = flatpak ? args.slice(0, 2) : [];
  const rest = args.slice(pre.length);
  const m = rest.length === 1 ? /^steam:\/\/rungameid\/(\d{1,20})$/.exec(rest[0]) : null;
  if (!m) return args;
  const next = BigInt(m[1]) > 0xffffffffn ? shortcutArgs(m[1]) : appArgs(m[1]);
  return next.length ? [...pre, ...next] : args;
}

module.exports = { appArgs, shortcutArgs, upgrade };
