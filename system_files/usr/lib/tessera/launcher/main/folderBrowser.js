// SPDX-License-Identifier: GPL-3.0-or-later
// The folder browser used to pick game folders and library folders.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get isDir() { return isDir; },
  get real() { return real; },
  get underRoot() { return underRoot; },
};

const fs = require('fs');
const os = require('os');
const path = require('path');

// --------------------------------------------------------- folder browser
// The renderer never sends a path. It says "enter entry 3" and this file
// resolves that against the listing it produced itself. Browsing is limited
// to the home folder and removable/extra drives.

const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const real = (p) => {
  try { return fs.realpathSync(p); } catch { return null; }
};
// The places Tessera may browse. Looked up at most every few seconds: this is asked
// for every file it checks, and the answer almost never changes.
let browseRootsAt = 0;
let browseRootsList = [];
const browseRoots = () => {
  const now = Date.now();
  if (now - browseRootsAt > 5000) {
    browseRootsList = [os.homedir(), '/run/media', '/mnt', '/var/mnt'].map(real).filter((r) => r && isDir(r));
    browseRootsAt = now;
  }
  return browseRootsList;
};
const underRoot = (rp) => browseRoots().some((r) => rp === r || rp.startsWith(r + path.sep));
