// SPDX-License-Identifier: GPL-3.0-or-later
// Tessera's launcher, main process. The work is split into parts in main/, one per area; they
// load in this order, which is the order the original single file ran in.
// Anything that slips through is written to the log instead of ending the launcher (and, with no
// handler, Electron would put a dialog on the TV that a controller can't close).
process.on('uncaughtException', (e) => {
  console.error('Tessera: unexpected error:', e);
  try {
    const fs = require('fs'), path = require('path'), os = require('os');
    const dir = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'tessera', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'launcher-errors.log'), `${new Date().toISOString()} ${(e && e.stack) || e}\n`);
  } catch { /* nowhere to write it */ }
});
require('./main/config'); // Where Tessera keeps its files, built-in widget presets, and limits used everywhere.
require('./main/library'); // The library: games, apps, pages (mosaics) and where entries sit on the grid.
require('./main/prefs'); // Settings: loading, cleaning and saving settings.json.
require('./main/theming'); // Themes: the factory themes, custom theme.json files and their settings.
require('./main/calibration'); // Display calibration made by eye, and handing it to Gamescope.
require('./main/folderBrowser'); // The folder browser used to pick game folders and library folders.
require('./main/driveList'); // Drives: what lsblk says is plugged in.
require('./main/art'); // Game pictures: Steam art, thumbnails and the tessera-art scheme.
require('./main/scanner'); // The game scanner: library folders, Steam, Heroic, Lutris and desktop entries.
require('./main/addons'); // Add-ons and the Tessera folder: widgets, themes, shards and the folders that hold them.
require('./main/shards'); // Shards (add-ons that are code): turning them on, running them, and installing add-ons.
require('./main/appWindow'); // The launcher window and app startup.
require('./main/storage'); // Storage: sizes, install location, drives for games, cleanup, back up and restore.
require('./main/ipc'); // Requests from the page for the library, folders, storage and add-ons.
require('./main/profiles'); // Profiles: who is using Tessera, and their theme.
require('./main/updates'); // Software updates through bootc: check, apply, roll back.
require('./main/installer'); // Installing Tessera from the live USB, and switching graphics builds.
require('./main/power'); // Power: restart, shut down, sleep.
require('./main/system'); // Sound, Bluetooth, Wi-Fi, controllers, and system info for the built-in widgets.
require('./main/pinLock'); // The PIN, and the settings and scan requests that it guards.
require('./main/web'); // The default web browser, launching games and apps, and the browser pointer.
require('./main/guide'); // The Guide button: over a running game, over the browser, and leaving Tessera.
require('./main/webView'); // The embedded browser view.
require('./main/report'); // "Report a problem": a report file, made only when asked, never sent anywhere.
