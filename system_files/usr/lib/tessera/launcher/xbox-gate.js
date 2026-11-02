// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Xbox games need the admin PIN. Finding them is an add-on's job (the Xbox PC Games Setup shard
// offers them with `xbox: true`); this is only the rule Tessera itself enforces:
//   xboxOn(settings)   Xbox games are allowed: a PIN is set and Settings > PIN > Allow Xbox games is on
//   isXbox(item)       a library item that is an Xbox game
//   xboxGate(state)    null when an Xbox game may start, else the sentence to show
//
// Tessera also recognises the commands Xodus Nexus writes (".../shortcuts/launch-game <id>"), so a
// Nexus game that reaches the library some other way (added by hand, or Steam's list of games added
// to Steam) is held back too, and never offered by Tessera's own scan as an ordinary game.

const NEXUS_SCRIPT = /(^|\/)shortcuts\/launch-(game|nexus)$/;
const looksLikeNexus = (args) => Array.isArray(args) && args.some((a) => typeof a === 'string' && NEXUS_SCRIPT.test(a));
// Steam's launch options for a shortcut Nexus made:  "<dir>/shortcuts/launch-game" "<id>"  or  ".../launch-nexus"
const nexusSteamOptions = (options) => typeof options === 'string' && /(^|[\/"])shortcuts\/launch-(game|nexus)"?(\s|$)/.test(options);

const xboxOn = (settings) => Boolean(settings && settings.pin) && settings.xboxEnabled === true;
const isXbox = (it) => Boolean(it && (it.xbox === true || looksLikeNexus(it.args)));

function xboxGate({ isXbox: xbox, enabled, pinSet, pinOk }) {
  if (!xbox) return null;
  if (!pinSet) return 'Xbox games need a PIN. Set one in Settings > PIN.';
  if (!enabled) return 'Xbox games are off. Turn them on in Settings > PIN.';
  if (!pinOk) return 'Enter the PIN first.';
  return null;
}

module.exports = { xboxOn, isXbox, xboxGate, looksLikeNexus, nexusSteamOptions };
