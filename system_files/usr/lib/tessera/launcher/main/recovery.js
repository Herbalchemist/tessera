// SPDX-License-Identifier: GPL-3.0-or-later
// Recover (on the Tessera USB): find a Tessera installed on this computer that won't start, see what's
// wrong, and repair it. Part of the launcher's main process (see main.js for the order the parts
// load in). The work is done by a root helper on the USB (/usr/libexec/tessera/live-recover, allowed
// through sudo, like live-install): it acts only on installs it found itself, and every repair needs
// the password of an administrator of that install, which goes to it on stdin and nowhere else.
'use strict';

module.exports = {};

const { spawn } = require('child_process');
const { ipcMain } = require('electron');
const installer = require('./installer');

const LIVE_RECOVER = process.env.TESSERA_LIVE_RECOVER || '/usr/libexec/tessera/live-recover';
const SUDO = process.env.TESSERA_LIVE_INSTALL_NOSUDO === '1' ? [] : ['sudo', '-n'];
const ID_RE = /^[0-9a-fA-F-]{8,40}:[A-Za-z0-9._-]{1,40}$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const TOOLS = ['signin', 'pin', 'shards', 'version'];
const VERSION_ACTIONS = ['default', 'keep', 'unkeep'];

function helper(args, input) {
  const cmd = [...SUDO, LIVE_RECOVER, ...args];
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { if (out.length < 4 << 20) out += d; });
    child.stderr.on('data', () => {});
    child.on('error', () => resolve({ ok: false, error: "The recovery tools aren't on this USB. Make it again with Mortar." }));
    child.on('close', () => {
      try { resolve(JSON.parse(out)); } catch { resolve({ ok: false, error: "The recovery tools didn't answer." }); }
    });
    child.stdin.on('error', () => { /* it didn't need its input */ });
    child.stdin.end(input || '');
  });
}

async function recoveryOp(op, p) {
  if (!installer.INSTALLER) return { ok: false, error: 'Recover works from the Tessera USB.' };
  if (op === 'probe') return helper(['probe']);
  if (!ID_RE.test(String(p.id || ''))) return { ok: false, error: 'Unknown Tessera.' };
  if (op === 'diagnose') return helper(['diagnose', p.id]);
  if (op === 'report') return helper(['report', p.id]);
  if (op === 'fix') {
    if (!TOOLS.includes(p.tool) || !USER_RE.test(String(p.user || '')) || typeof p.password !== 'string' || !p.password || p.password.length > 256) return { ok: false, error: 'Bad request.' };
    const req = { tool: p.tool, user: p.user, password: p.password };
    if (p.tool === 'version') {
      if (!VERSION_ACTIONS.includes(p.action) || !Number.isInteger(p.index) || p.index < 0 || p.index > 20) return { ok: false, error: 'Bad request.' };
      Object.assign(req, { action: p.action, index: p.index });
    }
    return helper(['fix', p.id], JSON.stringify(req));
  }
  return { ok: false, error: 'Unknown action.' };
}
ipcMain.handle('recovery', (_e, op, p) => recoveryOp(typeof op === 'string' ? op : '', p && typeof p === 'object' ? p : {}).catch(() => ({ ok: false, error: 'Something went wrong.' })));
