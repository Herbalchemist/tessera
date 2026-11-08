// SPDX-License-Identifier: GPL-3.0-or-later
// Settings > Screens: which screen Ludus uses, its resolution and refresh rate, and a built-in
// screen's orientation. Part of the launcher's main process (see main.js for the order the parts
// load in). The screens and what each can do come from the graphics driver
// (/usr/libexec/tessera/display-info, which also turns the settings into gamescope options for
// tessera-session). Nothing is hardcoded: only modes a screen reports can be chosen.
//
// A change is tried first: Ludus starts again with it and asks "Keep these settings?" for 15
// seconds; without a yes it goes back (the session drops an unconfirmed setting by itself too, so
// a screen that shows nothing never leaves anyone stuck). A newly plugged-in screen is offered.
'use strict';

module.exports = {};

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { ipcMain, app } = require('electron');
const config = require('./config');
const pinLock = require('./pinLock');
const appWindow = require('./appWindow');

const HELPER = process.env.TESSERA_DISPLAY_INFO || '/usr/libexec/tessera/display-info';
const FILE = process.env.TESSERA_DISPLAY_FILE || path.join(path.dirname(config.SETTINGS_FILE), 'display.json');
const SYS = process.env.TESSERA_DRM_SYS || '/sys/class/drm';
const NAME_RE = /^[A-Za-z0-9-]{1,32}$/;
const ORIENTATIONS = ['normal', 'left', 'right', 'upsidedown'];
const nested = () => Boolean(process.env.TESSERA_NESTED);
const canRestart = () => Boolean(process.env.TESSERA_RESTART_FILE);

function helper(args) {
  return new Promise((resolve) => {
    execFile(HELPER, args, { timeout: 15000, encoding: 'utf8', env: { ...process.env, TESSERA_DISPLAY_FILE: FILE } }, (err, stdout) => {
      if (err && !stdout) return resolve({ ok: false, error: "Couldn't read the screens." });
      try { resolve(JSON.parse(stdout)); } catch { resolve({ ok: !err }); }
    });
  });
}

function load() {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return d && typeof d === 'object' ? d : {}; } catch { return {}; }
}
function save(d) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

// Only a mode the chosen screen reports, on a screen that is connected now.
async function validChoice(p) {
  const list = await helper(['list']);
  const screens = (list && list.screens) || [];
  const s = screens.find((x) => x.name === p.output);
  if (!NAME_RE.test(String(p.output || '')) || !s) return null;
  const out = { output: s.name };
  if (p.width !== undefined || p.height !== undefined) {
    const m = s.modes.find((x) => x.width === p.width && x.height === p.height && (p.refresh === undefined || x.refresh === p.refresh));
    if (!m) return null;
    out.width = m.width; out.height = m.height;
    if (p.refresh !== undefined) out.refresh = m.refresh;
  }
  if (p.orientation !== undefined) {
    if (!ORIENTATIONS.includes(p.orientation) || (!s.internal && p.orientation !== 'normal')) return null;
    out.orientation = p.orientation;
  }
  return out;
}

function restartLudus() {
  if (!canRestart()) return false;
  try { fs.writeFileSync(process.env.TESSERA_RESTART_FILE, String(Date.now())); } catch { return false; }
  setTimeout(() => app.exit(0), 300);
  return true;
}

// Settings > System > Try the new Ludus: the session starts Ludus (Qt) instead, from now on, until
// it's turned off there (or it fails to start, and the session comes back here by itself).
function tryQtLudus() {
  const prefs = require('./prefs').settings;
  if (prefs.pin || (Array.isArray(prefs.profiles) && prefs.profiles.length)) return { ok: false, error: "The new Ludus doesn't have PINs and profiles yet, so it stays off while they're set up." };
  if (!fs.existsSync('/usr/lib/tessera/ludus-qt/ludus.py')) return { ok: false, error: 'The new Ludus isn\'t in this version of Tessera yet. Update first.' };
  if (!canRestart()) return { ok: false, error: 'Only inside the Tessera session.' };
  const home = require('os').homedir();
  const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'tessera');
  const stateDir = path.join(process.env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'tessera');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ludus'), 'qt\n');
    fs.rmSync(path.join(stateDir, 'ludus-qt-failed'), { force: true }); // chosen again: try again
  } catch { return { ok: false, error: "Couldn't save the choice." }; }
  return { ok: restartLudus() };
}

async function displayOp(op, p) {
  if (op === 'tryQt') return tryQtLudus();
  if (op === 'list') {
    const r = await helper(['list']);
    return { ...r, nested: nested(), canRestart: canRestart() };
  }
  if (op === 'try') {
    if (nested()) return { ok: false, error: "Ludus on top of Opus uses Opus's screen settings." };
    if (!pinLock.pinOk()) return { ok: false, needPin: true, error: 'Enter the PIN first.' };
    const choice = p.auto ? {} : await validChoice(p);
    if (!choice) return { ok: false, error: "That screen or mode isn't available now." };
    const d = load();
    d.trying = choice;
    d.tried = false;
    save(d);
    if (!restartLudus()) return { ok: true, restarted: false };
    return { ok: true, restarted: true };
  }
  // The countdown after a restart: keep, or go back (neither needs the PIN: going back is the safe way).
  if (op === 'confirm') return helper(['confirm']).then(() => ({ ok: true }));
  if (op === 'revert') {
    await helper(['revert']);
    return { ok: true, restarted: p.restart ? restartLudus() : false };
  }
  if (op === 'ignore') {
    if (!NAME_RE.test(String(p.output || ''))) return { ok: false };
    const d = load();
    d.ignore = [...new Set([...(Array.isArray(d.ignore) ? d.ignore : []), p.output])].slice(-20);
    save(d);
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
}
ipcMain.handle('display', (_e, op, p) => displayOp(typeof op === 'string' ? op : '', p && typeof p === 'object' ? p : {}).catch(() => ({ ok: false, error: 'Something went wrong.' })));

// A screen plugged in while Ludus runs (the full session only): the connector's status file says
// so without asking the screen anything (asking makes some screens flicker).
function connectedNow() {
  const out = new Set();
  let names = [];
  try { names = fs.readdirSync(SYS); } catch { return out; }
  for (const n of names) {
    const m = /^card\d+-(.+)$/.exec(n);
    if (!m || !NAME_RE.test(m[1])) continue;
    try { if (fs.readFileSync(path.join(SYS, n, 'status'), 'utf8').trim() === 'connected') out.add(m[1]); } catch { /* gone */ }
  }
  return out;
}
let known = null;
function watchScreens() {
  if (nested() || config.GUIDE_ONLY) return;
  known = connectedNow();
  setInterval(() => {
    const now = connectedNow();
    if (config.running) { known = new Set([...known].filter((n) => now.has(n))); return; } // asked after the game
    const added = [...now].filter((n) => !known.has(n));
    known = now;
    const ignore = new Set(load().ignore || []);
    const fresh = added.filter((n) => !ignore.has(n));
    if (fresh.length) appWindow.send('display-new', { outputs: fresh });
  }, 3000).unref();
}
app.whenReady().then(watchScreens);
