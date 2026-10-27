// SPDX-License-Identifier: GPL-3.0-or-later
// Power: restart, shut down, sleep.
// Part of the launcher's main process (see main.js for the order the parts load in).

const { ipcMain } = require('electron');
const config = require('./config');
const updates = require('./updates');

// ------------------------------------------------------------ power
// Restart, shut down, sleep: the normal permissions of someone sitting at the console, through logind.
const POWER_VERB = { restart: 'reboot', shutdown: 'poweroff', sleep: 'suspend' };
const POWER_FAIL = {
  restart: "Couldn't restart from here. Use the power button, or Desktop Mode.",
  shutdown: "Couldn't shut down from here. Hold the power button, or use Desktop Mode.",
  sleep: "Couldn't go to sleep from here.",
};
ipcMain.handle('power', async (_e, op) => {
  try {
    const verb = typeof op === 'string' && Object.prototype.hasOwnProperty.call(POWER_VERB, op) ? POWER_VERB[op] : null;
    if (!verb) return { ok: false, error: 'Unknown action.' };
    if (!pinLock.pinOk()) return pinLock.NEED_PIN;
    if (config.running) return { ok: false, error: 'Close the game first.' };
    const r = await updates.sysctl([verb], 15000);
    return r.ok ? { ok: true } : { ok: false, error: POWER_FAIL[op] };
  } catch {
    return { ok: false, error: 'Something went wrong.' };
  }
});

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const pinLock = require('./pinLock');
