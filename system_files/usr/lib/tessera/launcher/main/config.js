// SPDX-License-Identifier: GPL-3.0-or-later
// Where Tessera keeps its files, built-in widget presets, and limits used everywhere.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get ART_SCHEME() { return ART_SCHEME; },
  get BROWSE_MAX() { return BROWSE_MAX; },
  get BUILTIN_INLAYS() { return BUILTIN_INLAYS; },
  get DATA_DIR() { return DATA_DIR; },
  get DEV() { return DEV; },
  get GRID() { return GRID; },
  get GUIDE_ONLY() { return GUIDE_ONLY; },
  get HOME_ID() { return HOME_ID; },
  get KINDS() { return KINDS; },
  get LAUNCHER_PID_FILE() { return LAUNCHER_PID_FILE; },
  get LEGACY_FILE() { return LEGACY_FILE; },
  get LEGACY_TABS() { return LEGACY_TABS; },
  get LIBRARY_FILE() { return LIBRARY_FILE; },
  get LOG_DIR() { return LOG_DIR; },
  get mainWindow() { return mainWindow; }, set mainWindow(v) { mainWindow = v; },
  get MAX_TITLE() { return MAX_TITLE; },
  get RECENT_MAX() { return RECENT_MAX; },
  get running() { return running; }, set running(v) { running = v; },
  get SCAN_DEPTH() { return SCAN_DEPTH; },
  get SCAN_MAX_VISITS() { return SCAN_MAX_VISITS; },
  get SETTINGS_FILE() { return SETTINGS_FILE; },
  get TAB_ID_RE() { return TAB_ID_RE; },
  get WIDGET_SCHEME() { return WIDGET_SCHEME; },
  get WIDGET_TYPE_RE() { return WIDGET_TYPE_RE; },
};

const { protocol } = require('electron');
const path = require('path');
const os = require('os');

// Widgets are shown through their own scheme so the app can control exactly
// what they may load. Must be registered before the app is ready.
const WIDGET_SCHEME = 'tessera-widget';
const ART_SCHEME = 'tessera-art'; // game pictures, by library id (never by path)
protocol.registerSchemesAsPrivileged([
  { scheme: WIDGET_SCHEME, privileges: { standard: true, secure: true } },
  { scheme: ART_SCHEME, privileges: { standard: true, secure: true } },
]);

// Mutable data lives outside the read-only image, never under /usr.
// Override the folder with TESSERA_DATA_DIR, or the files with
// LAUNCHER_LIBRARY. library.json holds what you see; settings.json holds
// the folders you asked Tessera to scan. An older games.json still loads.
const DATA_DIR =
  process.env.TESSERA_DATA_DIR ||
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'tessera');
const LIBRARY_FILE = process.env.LAUNCHER_LIBRARY || path.join(DATA_DIR, 'library.json');
const LEGACY_FILE = process.env.LAUNCHER_GAMES || path.join(DATA_DIR, 'games.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEV = process.env.TESSERA_DEV === '1';
// Desktop Mode helper (tessera-guide): the same program, showing only the guide, in a hidden
// window that comes up over the desktop when a controller's Guide button is pressed.
const GUIDE_ONLY = process.env.TESSERA_GUIDE_ONLY === '1';

const LEGACY_TABS = ['home', 'library', 'apps']; // older files put rows on tabs
const KINDS = ['game', 'app'];
// Inlays are small live pieces (widgets) set into a page. A built-in preset is
// drawn by the renderer; a downloaded widget is a folder in widgets/ and runs
// in a locked-down frame (see "add-ons" below).
// Presets that ship with Tessera. Nothing is added to a page by default: the
// user picks one. Inlays sit on Home's grid (GRID cells across the whole
// screen, so a layout scales to any display). size/min/max are in cells.
const GRID = { cols: 12, rows: 6 };
const BUILTIN_INLAYS = {
  clock: {
    name: 'Clock', description: 'Time and date',
    size: { w: 3, h: 2 }, min: { w: 2, h: 1 }, max: { w: 12, h: 6 }, resizable: true,
  },
  recent: {
    name: 'Recently played', description: 'Your latest games and apps',
    size: { w: 4, h: 3 }, min: { w: 3, h: 2 }, max: { w: 8, h: 6 }, resizable: true,
  },
  // The six below all read from systemInfo() (see near the "summaries" IPC handler), polled by
  // the renderer itself once a second — nothing is pushed from here, and nothing here ever
  // spawns a process; it's all local /proc, /sys and Node's own os module, so polling it that
  // often costs nothing worth noticing.
  cpu: {
    name: 'CPU', description: 'Processor load',
    size: { w: 2, h: 2 }, min: { w: 2, h: 1 }, max: { w: 4, h: 3 }, resizable: true,
  },
  ram: {
    name: 'Memory', description: 'RAM used and free',
    size: { w: 2, h: 2 }, min: { w: 2, h: 1 }, max: { w: 4, h: 3 }, resizable: true,
  },
  storage: {
    name: 'Storage', description: 'Free space on the main drive',
    size: { w: 3, h: 2 }, min: { w: 2, h: 1 }, max: { w: 5, h: 3 }, resizable: true,
  },
  battery: {
    name: 'Battery', description: 'Charge level, if this device has one',
    size: { w: 2, h: 2 }, min: { w: 2, h: 1 }, max: { w: 4, h: 3 }, resizable: true,
  },
  network: {
    name: 'Network', description: 'Connection and live speed',
    size: { w: 3, h: 2 }, min: { w: 2, h: 1 }, max: { w: 5, h: 3 }, resizable: true,
  },
  uptime: {
    name: 'Uptime', description: 'How long this session has been running',
    size: { w: 2, h: 2 }, min: { w: 2, h: 1 }, max: { w: 4, h: 3 }, resizable: true,
  },
};
const RECENT_MAX = 30; // remembered plays (the widget shows as many as fit)
const WIDGET_TYPE_RE = /^widget:[a-z0-9][a-z0-9._-]{0,63}$/;
const TAB_ID_RE = /^(home|library|apps|m:[A-Za-z0-9._-]{1,80})$/;
const HOME_ID = '_home'; // Home is a built-in page that holds entries like any mosaic
const MAX_TITLE = 40;
const SCAN_DEPTH = 3;       // folders below a library folder
const SCAN_MAX_VISITS = 20000;
const BROWSE_MAX = 500;
const LOG_DIR = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'tessera', 'logs');
// While the launcher runs it leaves its process id here, so the desktop helper knows to stay quiet.
const LAUNCHER_PID_FILE = path.join(path.dirname(LOG_DIR), 'launcher.pid');

let mainWindow = null;
let running = false;
