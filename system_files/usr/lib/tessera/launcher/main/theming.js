// SPDX-License-Identifier: GPL-3.0-or-later
// Themes: the factory themes, custom theme.json files and their settings.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get activeTheme() { return activeTheme; },
  get BUILTIN_THEMES() { return BUILTIN_THEMES; },
  get clip() { return clip; },
  get currentThemeValues() { return currentThemeValues; },
  get HEX_RE() { return HEX_RE; },
  get IMG_EXT() { return IMG_EXT; },
  get MAX_PROFILES() { return MAX_PROFILES; },
  get newThemeId() { return newThemeId; },
  get prefsPayload() { return prefsPayload; },
  get PROFILE_ID_RE() { return PROFILE_ID_RE; },
  get renameThemeFile() { return renameThemeFile; },
  get scanThemes() { return scanThemes; },
  get setThemeValue() { return setThemeValue; },
  get SETTING_ID_RE() { return SETTING_ID_RE; },
  get THEME_ID_RE() { return THEME_ID_RE; },
  get themeImage() { return themeImage; },
  get themeInUse() { return themeInUse; },
  get themePayload() { return themePayload; },
  get themeRev() { return themeRev; }, set themeRev(v) { themeRev = v; },
  get themes() { return themes; },
  get writeThemeFile() { return writeThemeFile; },
};

const fs = require('fs');
const path = require('path');
const prefs = require('./prefs');

// ------------------------------------------------------------ theme settings
// A theme is a list of settings the person can change. The stock list below
// is always there; a theme can change its defaults and add settings of its
// own in themes/<id>/theme.json. Values only ever become CSS custom
// properties (never code), so a theme can't run anything.
const THEME_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,23}$/;
const MAX_PROFILES = 16;
const SETTING_ID_RE = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/;
const VAR_RE = /^--(theme-)?[a-z][a-z0-9-]{0,30}$/;
const SAFE_VALUE_RE = /^[#a-zA-Z0-9 .%(),+-]{1,40}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const IMG_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_IMAGE = 12 * 1024 * 1024;
const STOCK_VARS = ['--use', '--font-scale', '--radius', '--border-w', '--accent', '--border', '--card', '--panel', '--bg', '--text', '--muted', '--bg-image', '--bg-dim', '--danger', '--ok', '--motion', '--wg-tint', '--wg-blur', '--wg-color', '--wg-sheen', '--wg-clear', '--shadow', '--ring', '--tab-shadow'];
// Seven themes ship with Tessera. They share one list of settings and differ
// only in their defaults, including a safe structural shell preset. ("stock"
// stays the id of Bright so saved choices carry over.)
// The two Mosaic themes turn on "selColor: pastel" (Theme Settings > Selector glow):
// the glow around whatever the selector lands on takes a new random pastel every
// move. The tile, tab, menu row or key itself keeps its own colour.
const BUILTIN_THEMES = [
  {
    id: 'stock', name: 'Tessera Bright', author: 'Tessera',
    defaults: {
      bg: '#f4f1fa', card: '#ffffff', panel: '#ffffff', text: '#2b2640', muted: '#6a6586', accent: '#6a58d8',
      border: '#2b2640', borderW: '0px', shadow: 60, radius: '20px', cancel: '#e5484d', confirm: '#12a37f',
      backdrop: 'glow', shellLayout: 'classic', layout: 'grid', gridPreset: 'c5r3',
      widgetStyle: 'frosted', widgetTint: 30, widgetBlur: 22, widgetClear: 60, widgetColor: '#ffffff',
    },
  },
  {
    id: 'dark', name: 'Tessera Dark', author: 'Tessera',
    defaults: {
      bg: '#0a0714', card: '#1a1230', panel: '#150e29', text: '#e9defc', muted: '#9a8bc0', accent: '#9d7bff',
      border: '#3b2a6b', borderW: '2px', radius: '14px', cancel: '#ff5d8f', confirm: '#3ee0b0',
      backdrop: 'mystic', shellLayout: 'classic', layout: 'rails', gridPreset: 'c5r3',
      widgetStyle: 'glass', widgetTint: 40, widgetBlur: 18, widgetClear: 55, widgetColor: '#1a1230',
    },
  },
  {
    id: 'mosaic', name: 'Tessera Mosaic', author: 'Tessera',
    defaults: {
      bg: '#f8f5ef', card: '#ffffff', panel: '#ffffff', text: '#2a2638', muted: '#6d6882', accent: '#6063d8',
      border: '#2a2638', borderW: '0px', shadow: 55, radius: '20px', cancel: '#e5546b', confirm: '#1fa67a',
      backdrop: 'tiles', selColor: 'pastel', shellLayout: 'classic', layout: 'grid', gridPreset: 'c5r3',
      widgetStyle: 'frosted', widgetTint: 35, widgetBlur: 22, widgetClear: 60, widgetColor: '#ffffff',
    },
  },
  {
    id: 'mosaic-dark', name: 'Tessera Mosaic Dark', author: 'Tessera',
    defaults: {
      bg: '#121018', card: '#1f1c2b', panel: '#1a1724', text: '#ece8f5', muted: '#9a94b0', accent: '#b4a7ff',
      border: '#3a3450', borderW: '0px', shadow: 70, radius: '20px', cancel: '#ff6b8b', confirm: '#4fe0b0',
      backdrop: 'tiles', selColor: 'pastel', shellLayout: 'classic', layout: 'grid', gridPreset: 'c5r3',
      widgetStyle: 'glass', widgetTint: 40, widgetBlur: 18, widgetClear: 55, widgetColor: '#1f1c2b',
    },
  },
  // Console homages: each takes a home screen's layout, colors and motion, never its artwork,
  // logos or sounds. Cartridge Pop and Dashboard Steel keep their ids so saved choices survive.
  {
    // A row of big square game tiles under a selection frame, round buttons below, clock up top.
    id: 'cartridge-pop', name: 'Cartridge Pop', author: 'Tessera',
    defaults: {
      bg: '#ebebeb', card: '#ffffff', panel: '#f6f6f6', text: '#2d2d2d', muted: '#7d7d7d', accent: '#00b4e6',
      border: '#d4d4d4', borderW: '0px', radius: '4px', shadow: 30, tabShadow: 40, selectRing: '5px',
      confirm: '#00b4e6', cancel: '#e60012', backdrop: 'none', selColor: 'accent', shellLayout: 'switch', layout: 'rails', gridPreset: 'c6r3',
      setPack: false, setNotes: true, setIcons: 'still',
      widgetStyle: 'solid', widgetTint: 35, widgetBlur: 18, widgetClear: 60, widgetColor: '#ffffff', widgetSheen: false,
      motion: true, browserAnim: 'zoom',
    },
  },
  {
    // Near-black glass, a row of small tiles that grows the one you're on, its art behind everything.
    id: 'nova-black', name: 'Nova Black', author: 'Tessera',
    defaults: {
      bg: '#06070d', card: '#1a1d2a', panel: '#11131c', text: '#ffffff', muted: '#9aa0b4', accent: '#ffffff',
      border: '#2b3042', borderW: '0px', radius: '10px', shadow: 80, tabShadow: 0, selectRing: '3px',
      confirm: '#3c7cff', cancel: '#ff5a6e', backdrop: 'none', selColor: 'accent', shellLayout: 'hero', layout: 'rails', gridPreset: 'c6r3',
      setPack: false, setNotes: true, setIcons: 'still',
      widgetStyle: 'glass', widgetTint: 30, widgetBlur: 24, widgetClear: 70, widgetColor: '#1a1d2a', widgetSheen: false,
      motion: true, browserAnim: 'fade',
    },
  },
  {
    // Flat square tiles, text pivots along the top, green highlights, a white focus frame.
    id: 'dashboard-steel', name: 'Dashboard Steel', author: 'Tessera',
    defaults: {
      bg: '#171717', card: '#2b2b2b', panel: '#1f1f1f', text: '#ffffff', muted: '#a0a0a0', accent: '#107c10',
      border: '#3a3a3a', borderW: '0px', radius: '4px', shadow: 20, tabShadow: 0, selectRing: '3px',
      confirm: '#107c10', cancel: '#d13438', backdrop: 'none', selColor: 'accent', shellLayout: 'pivot', layout: 'grid', gridPreset: 'c6r3', tileGap: 40,
      setPack: true, setNotes: true, setIcons: 'still',
      widgetStyle: 'solid', widgetTint: 40, widgetBlur: 10, widgetClear: 70, widgetColor: '#2b2b2b', widgetSheen: false,
      motion: true, browserAnim: 'slide',
    },
  },
  {
    // Deep indigo, chunky glossy menu buttons down the left, a turning cube, drifting cube outlines.
    id: 'indigo-cube', name: 'Indigo Cube', author: 'Tessera',
    defaults: {
      bg: '#120b38', card: '#2c2178', panel: '#1c1352', text: '#f4f0ff', muted: '#a99fdc', accent: '#9fd8ff',
      border: '#5a4bc6', borderW: '2px', radius: '20px', shadow: 90, tabShadow: 90, selectRing: '3px',
      confirm: '#3fd38a', cancel: '#ff5c7a', backdrop: 'cubes', selColor: 'accent', shellLayout: 'cube', layout: 'grid', gridPreset: 'c4r2',
      setPack: false, setNotes: true, setIcons: 'animated',
      widgetStyle: 'glass', widgetTint: 45, widgetBlur: 20, widgetClear: 55, widgetColor: '#2c2178', widgetSheen: true,
      motion: true, browserAnim: 'flip',
    },
  },
  {
    // A white pinstriped wall of wide rounded channels, blue glow, a curved bar with the clock.
    id: 'channel-white', name: 'Channel White', author: 'Tessera',
    defaults: {
      bg: '#f3f3f3', card: '#ffffff', panel: '#e9e9e9', text: '#4a4a4a', muted: '#9b9b9b', accent: '#34beed',
      border: '#cdcdcd', borderW: '2px', radius: '20px', shadow: 25, tabShadow: 30, selectRing: '5px',
      confirm: '#34beed', cancel: '#e5484d', backdrop: 'stripes', selColor: 'accent', shellLayout: 'channel', layout: 'grid', gridPreset: 'custom', gridCols: 4, gridRows: 3, tileGap: 70,
      setPack: false, setNotes: false, setIcons: 'still',
      widgetStyle: 'solid', widgetTint: 40, widgetBlur: 10, widgetClear: 70, widgetColor: '#ffffff', widgetSheen: true,
      motion: true, browserAnim: 'zoom',
    },
  },
  {
    // Not a console: an arcade cabinet's marquee glow.
    id: 'arcade-marquee', name: 'Arcade Marquee', author: 'Tessera',
    defaults: {
      bg: '#120a1a', card: '#1e1130', panel: '#180d28', text: '#fbeaff', muted: '#b79bd6', accent: '#ff4fd8',
      border: '#ff4fd8', borderW: '2px', radius: '28px', shadow: 100, tabShadow: 100, selectRing: '5px',
      confirm: '#3ee6c7', cancel: '#ff5d6c', backdrop: 'glow', selColor: 'accent', shellLayout: 'crossbar', layout: 'grid', gridPreset: 'c5r3',
      setPack: false, setNotes: true, setIcons: 'animated',
      widgetStyle: 'glass', widgetTint: 45, widgetBlur: 20, widgetClear: 55, widgetColor: '#1e1130', widgetSheen: true,
      motion: true,
    },
  },
];
const STOCK_THEME = {
  id: 'stock',
  name: 'Tessera Bright',
  author: 'Tessera',
  settings: [
    { id: 'screenUse', group: 'Screen', label: 'Screen area used', type: 'range', min: 70, max: 100, step: 5, unit: '%', default: 100, var: '--use', scale: 0.01, hint: 'Lower this if your TV cuts off the edges' },
    { id: 'fontScale', group: 'Screen', label: 'Text size', type: 'range', min: 80, max: 160, step: 10, unit: '%', default: 100, var: '--font-scale', scale: 0.01 },
    { id: 'radius', group: 'Shape', label: 'Corner roundness', type: 'choice', default: '14px', var: '--radius',
      options: [{ label: 'Sharp', value: '4px' }, { label: 'Slight', value: '10px' }, { label: 'Normal', value: '14px' }, { label: 'Soft', value: '20px' }, { label: 'Round', value: '28px' }, { label: 'Pill', value: '40px' }] },
    { id: 'borderW', group: 'Shape', label: 'Border thickness', type: 'choice', default: '0px', var: '--border-w',
      options: [{ label: 'None', value: '0px' }, { label: 'Thin', value: '2px' }, { label: 'Medium', value: '4px' }, { label: 'Thick', value: '6px' }] },
    { id: 'shadow', group: 'Shape', label: 'Tile shadow', type: 'range', min: 0, max: 100, step: 10, unit: '%', default: 100, var: '--shadow', scale: 0.01, hint: 'The soft shadow under tiles, strongest on the selected one' },
    { id: 'tabShadow', group: 'Shape', label: 'Tab highlight shadow', type: 'range', min: 0, max: 100, step: 10, unit: '%', default: 100, var: '--tab-shadow', scale: 0.01, hint: 'The glow and shadow around the selected tab at the top' },
    { id: 'selectRing', group: 'Shape', label: 'Selection outline', type: 'choice', default: '3px', var: '--ring',
      options: [{ label: 'None', value: '0px' }, { label: 'Thin', value: '2px' }, { label: 'Normal', value: '3px' }, { label: 'Thick', value: '5px' }] },
    { id: 'accent', group: 'Colors', label: 'Highlight color', type: 'color', default: '#7fb2ff', var: '--accent' },
    { id: 'selColor', group: 'Colors', label: 'Selector glow', type: 'choice', default: 'accent', hint: 'Random pastel gives the glow around whatever you select a new random color every time you move. Tiles and buttons keep their own colors.',
      options: [{ label: 'Highlight color', value: 'accent' }, { label: 'Random pastel', value: 'pastel' }] },
    { id: 'border', group: 'Colors', label: 'Border color', type: 'color', default: '#3b475a', var: '--border' },
    { id: 'card', group: 'Colors', label: 'Tile fill', type: 'color', default: '#1a222c', var: '--card' },
    { id: 'panel', group: 'Colors', label: 'Menu fill', type: 'color', default: '#161d27', var: '--panel' },
    { id: 'bg', group: 'Colors', label: 'Background color', type: 'color', default: '#10151c', var: '--bg' },
    { id: 'text', group: 'Colors', label: 'Text color', type: 'color', default: '#e9e4d8', var: '--text' },
    { id: 'muted', group: 'Colors', label: 'Small text color', type: 'color', default: '#8b95a3', var: '--muted' },
    { id: 'background', group: 'Background', label: 'Background picture', type: 'image', default: '', var: '--bg-image' },
    { id: 'bgDim', group: 'Background', label: 'Picture dimming', type: 'range', min: 0, max: 90, step: 10, unit: '%', default: 50, var: '--bg-dim', scale: 0.01 },
    { id: 'backdrop', group: 'Background', label: 'Backdrop effect', type: 'choice', default: 'none',
      options: [{ label: 'None', value: 'none' }, { label: 'Glow', value: 'glow' }, { label: 'Mystic', value: 'mystic' }, { label: 'Mosaic tiles', value: 'tiles' }, { label: 'Drifting cubes', value: 'cubes' }, { label: 'Pinstripes', value: 'stripes' }] },
    { id: 'confirm', group: 'Buttons', label: 'Done / Yes button color', type: 'color', default: '#3ddc97', var: '--ok' },
    { id: 'cancel', group: 'Buttons', label: 'Cancel / Close button color', type: 'color', default: '#ff6b6b', var: '--danger' },
    { id: 'shellLayout', group: 'Layout', label: 'Shell arrangement', type: 'choice', default: 'classic', hint: 'A structural preset for navigation and page framing. It does not edit your Home widgets or create arbitrary layouts.',
      options: [
        { label: 'Classic (top navigation)', value: 'classic' },
        { label: 'Bottom dock / card strip', value: 'dock' },
        { label: 'Crossbar (top categories)', value: 'crossbar' },
        { label: 'Dashboard (left sidebar)', value: 'dashboard' },
        { label: 'Home row (square tiles over round buttons)', value: 'switch' },
        { label: 'Spotlight (the selection fills the screen)', value: 'hero' },
        { label: 'Pivot (text headers over flat tiles)', value: 'pivot' },
        { label: 'Cube (chunky menu down the left)', value: 'cube' },
        { label: 'Channels (wide tiles over a curved clock bar)', value: 'channel' },
      ] },
    { id: 'partNav', group: 'Layout parts', label: 'Menu position', type: 'choice', default: 'auto', hint: 'Each part can come from a different arrangement. Auto keeps what the Shell arrangement above uses.',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Top, centered', value: 'top' }, { label: 'Top left', value: 'top-left' }, { label: 'Bottom', value: 'bottom' }, { label: 'Bottom dock', value: 'bottom-dock' }, { label: 'Curved bottom bar', value: 'bottom-bar' }, { label: 'Left sidebar', value: 'left' }] },
    { id: 'partTabs', group: 'Layout parts', label: 'Tab look', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Pills', value: 'pills' }, { label: 'Plain text', value: 'text' }, { label: 'Large text pivots', value: 'pivots' }, { label: 'Round icon buttons', value: 'round' }, { label: 'Chunky glossy buttons', value: 'chunky' }, { label: 'Full-width segments', value: 'segments' }] },
    { id: 'partClock', group: 'Layout parts', label: 'Clock', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Off', value: 'off' }, { label: 'Top corner', value: 'corner' }, { label: 'Across the top, with a profile icon', value: 'topbar' }, { label: 'In the curved bottom bar', value: 'bar' }] },
    { id: 'partFrame', group: 'Layout parts', label: 'Selection frame', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Glow', value: 'glow' }, { label: 'Frame with a gap', value: 'framed' }, { label: 'White outline', value: 'white' }, { label: 'Soft halo', value: 'halo' }] },
    { id: 'partTitle', group: 'Layout parts', label: 'Name of the selection', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Under the tiles', value: 'below' }, { label: 'Above the tiles', value: 'above' }, { label: 'Big, on the left', value: 'big' }] },
    { id: 'partTile', group: 'Layout parts', label: 'Tile shape', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Tall (box art)', value: 'portrait' }, { label: 'Square', value: 'square' }, { label: 'Wide', value: 'wide' }] },
    { id: 'partSize', group: 'Layout parts', label: 'Tile size (rows)', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Small', value: 'small' }, { label: 'Medium', value: 'medium' }, { label: 'Large', value: 'large' }] },
    { id: 'partRow', group: 'Layout parts', label: 'Row movement', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Selection stays in the middle', value: 'center' }, { label: 'Middle, other rows faded', value: 'focus' }, { label: 'Selection at the front, and it grows', value: 'start' }] },
    { id: 'partCard', group: 'Layout parts', label: 'Tile look', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Standard', value: 'standard' }, { label: 'Picture only', value: 'flat' }, { label: 'Flat with color', value: 'metro' }, { label: 'Glossy', value: 'glossy' }, { label: 'Rounded bezel', value: 'bezel' }] },
    { id: 'partSpot', group: 'Layout parts', label: 'Selection art behind everything', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Off', value: 'off' }, { label: 'On', value: 'on' }] },
    { id: 'partEmblem', group: 'Layout parts', label: 'Emblem over the menu', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'None', value: 'none' }, { label: 'Turning cube', value: 'cube' }] },
    { id: 'partHints', group: 'Layout parts', label: 'Button hints', type: 'choice', default: 'auto',
      options: [{ label: 'Auto (follow the arrangement)', value: 'auto' }, { label: 'Centered', value: 'center' }, { label: 'Left', value: 'left' }, { label: 'Right', value: 'right' }] },
    { id: 'layout', group: 'Layout', label: 'Tile layout', type: 'choice', default: 'rails',
      options: [{ label: 'Rails (sideways, like a console)', value: 'rails' }, { label: 'Grid', value: 'grid' }, { label: 'Flow grid (scrolls up and down)', value: 'flow' }] },
    { id: 'gridPreset', group: 'Layout', label: 'Grid size (default for every page)', type: 'choice', default: 'c5r3',
      options: [
        { label: '3 × 2', value: 'c3r2' }, { label: '4 × 2', value: 'c4r2' }, { label: '5 × 3', value: 'c5r3' },
        { label: '6 × 3', value: 'c6r3' }, { label: '6 × 4', value: 'c6r4' }, { label: '8 × 4', value: 'c8r4' },
        { label: 'Custom (use the two settings below)', value: 'custom' },
      ] },
    { id: 'tileGap', group: 'Layout', label: 'Space between tiles (grid and flow)', type: 'range', min: 20, max: 240, step: 10, unit: '%', default: 100, hint: 'The same space across and down' },
    { id: 'gridCols', group: 'Layout', label: 'Custom grid: columns', type: 'range', min: 2, max: 12, step: 1, unit: '', default: 5 },
    { id: 'gridRows', group: 'Layout', label: 'Custom grid: rows on screen', type: 'range', min: 1, max: 8, step: 1, unit: '', default: 3 },
    { id: 'setPack', group: 'Settings page', label: 'Small groups side by side (grid)', type: 'toggle', default: false, hint: 'Groups that fit share a row, so Settings needs less scrolling' },
    { id: 'setNotes', group: 'Settings page', label: 'Status under every tile', type: 'toggle', default: true, hint: 'Free space, theme, PIN, controller and more' },
    { id: 'setIcons', group: 'Settings page', label: 'Icons on tiles', type: 'choice', default: 'animated',
      options: [{ label: 'Animated (the selected tile moves)', value: 'animated' }, { label: 'Still', value: 'still' }, { label: 'Off', value: 'off' }] },
    { id: 'widgetStyle', group: 'Widgets', label: 'Widget style', type: 'choice', default: 'frosted',
      options: [{ label: 'Frosted (even, like sandblasted glass)', value: 'frosted' }, { label: 'Glass (a see-through pane)', value: 'glass' }, { label: 'Outline only (see-through)', value: 'outline' }, { label: 'Solid color', value: 'solid' }] },
    { id: 'widgetTint', group: 'Widgets', label: 'Frosted: how opaque', type: 'range', min: 0, max: 100, step: 5, unit: '%', default: 55, var: '--wg-tint', scale: 0.01 },
    { id: 'widgetBlur', group: 'Widgets', label: 'Frosted: diffusion (blur)', type: 'range', min: 0, max: 40, step: 2, unit: 'px', default: 16, var: '--wg-blur' },
    { id: 'widgetClear', group: 'Widgets', label: 'Glass: transparency', type: 'range', min: 0, max: 100, step: 5, unit: '%', default: 60, var: '--wg-clear', scale: 0.01 },
    { id: 'widgetColor', group: 'Widgets', label: 'Solid color: fill', type: 'color', default: '#ffffff', var: '--wg-color' },
    { id: 'widgetSheen', group: 'Widgets', label: 'Glass: shine', type: 'toggle', default: true, var: '--wg-sheen', on: '1', off: '0' },
    { id: 'motion', group: 'Motion', label: 'Animations', type: 'toggle', default: true, var: '--motion', on: '1', off: '0', hint: 'Turn off if movement makes you dizzy' },
    { id: 'browserAnim', group: 'Motion', label: 'Browser transition', type: 'choice', default: 'slide', hint: 'How the browser comes in and goes away',
      options: [
        { label: 'Slide (from the side you came from)', value: 'slide' },
        { label: 'Zoom (grows out of the Browser tab)', value: 'zoom' },
        { label: 'Fade', value: 'fade' },
        { label: 'Rise (comes up like a sheet)', value: 'rise' },
        { label: 'Flip (turns like a card)', value: 'flip' },
        { label: 'Doors (opens from the middle)', value: 'doors' },
        { label: 'None (instant)', value: 'none' },
      ] },
  ],
};
const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');

let themes = new Map(); // id -> { id, name, author, defaults, extra }
function scanThemes() {
  themes = new Map(BUILTIN_THEMES.map((t) => [t.id, { id: t.id, name: t.name, author: t.author, defaults: t.defaults, extra: [], builtin: true }]));
  let names = [];
  try { names = fs.readdirSync(addons.addonDir('themes'), { withFileTypes: true }); } catch { return; }
  for (const e of names.slice(0, 64)) {
    if (!e.isDirectory() || e.isSymbolicLink() || !THEME_ID_RE.test(e.name) || themes.has(e.name)) continue;
    let m;
    try {
      const f = path.join(addons.addonDir('themes'), e.name, 'theme.json');
      if (fs.statSync(f).size > 64 * 1024) continue;
      m = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch { continue; }
    if (!m || typeof m !== 'object') continue;
    const extra = [];
    for (const s of (Array.isArray(m.settings) ? m.settings : []).slice(0, 40)) {
      const d = cleanSetting(s);
      if (d) extra.push(d);
    }
    const defaults = {};
    if (m.defaults && typeof m.defaults === 'object')
      for (const [k, v] of Object.entries(m.defaults).slice(0, 80))
        if (SETTING_ID_RE.test(k) && (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) defaults[k] = v;
    themes.set(e.name, { id: e.name, name: clip(m.name, 40) || e.name, author: clip(m.author, 60), defaults, extra });
  }
}
// A theme someone is actually relying on right now: either it's the active theme (today's one
// implicit "whoever is playing"), or a profile has it as its own explicit choice. Deleting or
// renaming it then needs the PIN, same as anything else that could surprise someone mid-use.
function themeInUse(id) {
  if (activeTheme() === id) return true;
  return prefs.settings.profiles.some((p) => p.themeId === id);
}
// A free, valid folder name for a new theme, built from the name someone gave it.
function newThemeId(name) {
  const base = (clip(name, 24) || 'theme').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'theme';
  for (let i = 0; i < 1000; i++) {
    const id = i === 0 ? base : `${base}-${i}`;
    if (THEME_ID_RE.test(id) && !themes.has(id)) return id;
  }
  return null;
}
// The settings list as it actually stands right now for a theme (its resolved values, not just
// its defaults) — what "save as new" or "overwrite" should capture.
function currentThemeValues(id) {
  const out = {};
  const saved = prefs.settings.theme.values[id] || {};
  for (const d of schemaFor(id)) {
    if (d.type === 'image') continue; // a saved theme doesn't carry a picture reference yet
    const c = saved[d.id] !== undefined ? cleanValue(d, saved[d.id]) : undefined;
    out[d.id] = c === undefined ? d.default : c;
  }
  return out;
}
function writeThemeFile(id, name, defaultsObj) {
  try {
    const dir = path.join(addons.addonDir('themes'), id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ name: clip(name, 40) || id, author: 'You', defaults: defaultsObj }, null, 2));
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save the theme." };
  }
}
function renameThemeFile(id, name) {
  const f = path.join(addons.addonDir('themes'), id, 'theme.json');
  let m;
  try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { ok: false, error: "Couldn't read that theme." }; }
  if (!m || typeof m !== 'object') return { ok: false, error: "Couldn't read that theme." };
  m.name = clip(name, 40) || id;
  try { fs.writeFileSync(f, JSON.stringify(m, null, 2)); return { ok: true }; }
  catch { return { ok: false, error: "Couldn't rename it." }; }
}
// One setting from a theme file, or null if it doesn't make sense.
function cleanSetting(s) {
  if (!s || typeof s !== 'object' || !SETTING_ID_RE.test(s.id) || !['range', 'choice', 'color', 'toggle', 'image'].includes(s.type)) return null;
  const out = { id: s.id, type: s.type, label: clip(s.label, 40) || s.id, group: clip(s.group, 30) || 'Theme', hint: clip(s.hint, 120) };
  if (s.var !== undefined) {
    if (typeof s.var !== 'string' || !VAR_RE.test(s.var)) return null;
    if (!s.var.startsWith('--theme-') && !STOCK_VARS.includes(s.var)) return null;
    out.var = s.var;
  }
  if (s.type === 'range') {
    const n = (v, d) => (Number.isFinite(v) ? v : d);
    out.min = n(s.min, 0); out.max = n(s.max, 100); out.step = Math.max(n(s.step, 1), (out.max - out.min) / 100 || 1);
    if (out.max <= out.min) return null;
    out.unit = clip(s.unit, 4);
    out.scale = Number.isFinite(s.scale) ? s.scale : 1;
    out.default = Math.min(out.max, Math.max(out.min, n(s.default, out.min)));
  } else if (s.type === 'choice') {
    out.options = (Array.isArray(s.options) ? s.options : []).slice(0, 12)
      .map((o) => ({ label: clip(o && o.label, 30), value: o && typeof o.value === 'string' ? o.value : '' }))
      .filter((o) => o.label && SAFE_VALUE_RE.test(o.value) && !/url\(/i.test(o.value));
    if (!out.options.length) return null;
    out.default = out.options.some((o) => o.value === s.default) ? s.default : out.options[0].value;
  } else if (s.type === 'color') {
    out.default = HEX_RE.test(s.default) ? s.default.toLowerCase() : '#ffffff';
  } else if (s.type === 'toggle') {
    out.default = Boolean(s.default);
    out.on = typeof s.on === 'string' && SAFE_VALUE_RE.test(s.on) ? s.on : '1';
    out.off = typeof s.off === 'string' && SAFE_VALUE_RE.test(s.off) ? s.off : '0';
  } else {
    out.default = '';
  }
  return out;
}
function schemaFor(id) {
  const t = themes.get(id) || themes.get('stock');
  const list = STOCK_THEME.settings.map((s) => {
    const d = { ...s };
    const v = t.defaults[s.id];
    if (v !== undefined) {
      const c = cleanValue(d, v);
      if (c !== undefined) d.default = c;
    }
    return d;
  });
  for (const x of t.extra) {
    const at = list.findIndex((s) => s.id === x.id);
    if (at >= 0) list[at] = x;
    else list.push(x);
  }
  return list;
}
// A value for this setting, or undefined if it isn't allowed.
function cleanValue(def, v) {
  if (def.type === 'range') {
    if (!Number.isFinite(v)) return undefined;
    const snapped = Math.round((v - def.min) / def.step) * def.step + def.min;
    return Math.min(def.max, Math.max(def.min, Math.round(snapped * 1000) / 1000));
  }
  if (def.type === 'choice') return def.options.some((o) => o.value === v) ? v : undefined;
  if (def.type === 'color') return typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : undefined;
  if (def.type === 'toggle') return typeof v === 'boolean' ? v : undefined;
  if (def.type === 'image') return v === '' ? '' : typeof v === 'string' && path.isAbsolute(v) ? v : undefined;
  return undefined;
}
function activeTheme() {
  return themes.has(prefs.settings.theme.active) ? prefs.settings.theme.active : 'stock';
}
function themePayload() {
  const id = activeTheme();
  const saved = prefs.settings.theme.values[id] || {};
  const list = schemaFor(id).map((d) => {
    const c = saved[d.id] !== undefined ? cleanValue(d, saved[d.id]) : undefined;
    const value = c === undefined ? d.default : c;
    // The page never sees where a picture lives, only its file name.
    return { ...d, default: d.type === 'image' ? '' : d.default, value: d.type === 'image' ? (value ? path.basename(value) : '') : value };
  });
  const themeList = [...themes.values()].map((t) => ({ id: t.id, name: t.name, author: t.author, builtin: Boolean(t.builtin) }));
  // Two themes can end up with the same display name (a duplicate save, or two downloads of the
  // same pack). Their ids are always unique; flag the name collision so the page can show a short
  // tag next to it instead of silently showing two identical-looking rows.
  const counts = {};
  for (const t of themeList) counts[t.name.toLowerCase()] = (counts[t.name.toLowerCase()] || 0) + 1;
  for (const t of themeList) t.dup = counts[t.name.toLowerCase()] > 1;
  return {
    rev: themeRev,
    active: id,
    themes: themeList,
    settings: list,
  };
}
let themeRev = 0; // bumps whenever a theme value changes, so the page knows to reload pictures
function setThemeValue(sid, value) {
  const id = activeTheme();
  const def = schemaFor(id).find((s) => s.id === sid);
  if (!def) return false;
  const c = cleanValue(def, value);
  if (c === undefined) return false;
  prefs.settings.theme.values[id] = { ...(prefs.settings.theme.values[id] || {}), [sid]: c };
  themeRev++;
  prefs.saveSettings();
  return true;
}
// The picture for an image setting, as a data: URL. Only files inside the
// places Tessera may browse, only real PNG / JPEG / WebP files, and not huge.
function themeImage(sid) {
  const id = activeTheme();
  const def = schemaFor(id).find((s) => s.id === sid && s.type === 'image');
  const file = def && ((prefs.settings.theme.values[id] || {})[sid] || '');
  if (!file) return { dataUrl: '' };
  const rp = folderBrowser.real(file);
  const mime = rp && IMG_EXT[path.extname(rp).toLowerCase()];
  if (!rp || !mime || !folderBrowser.underRoot(path.dirname(rp))) return { dataUrl: '', error: "That picture can't be used." };
  const st = fs.statSync(rp);
  if (!st.isFile() || st.size > MAX_IMAGE) return { dataUrl: '', error: 'That picture is too large (12 MB max).' };
  const buf = fs.readFileSync(rp);
  const head = buf.subarray(0, 12);
  const ok = mime === 'image/png' ? head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    : mime === 'image/jpeg' ? head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!ok) return { dataUrl: '', error: "That file isn't a real picture." };
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
}
const prefsPayload = () => ({ live: installer.INSTALLER, pad: { ...prefs.settings.pad }, kb: prefs.kbPayload(), calib: prefs.settings.calib, pageGrid: prefs.settings.pageGrid, pin: pinLock.pinInfo(), vault: calibration.display(addons.VAULT_DIR), storage: { low: storage.lowSpace() }, calibration: calibration.calPayload(), theme: themePayload(), profiles: prefs.settings.profiles.map((p) => ({ id: p.id, name: p.name, themeId: p.themeId })) });

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const calibration = require('./calibration');
const folderBrowser = require('./folderBrowser');
const addons = require('./addons');
const storage = require('./storage');
const installer = require('./installer');
const pinLock = require('./pinLock');
