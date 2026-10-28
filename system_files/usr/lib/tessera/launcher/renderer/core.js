// SPDX-License-Identifier: GPL-3.0-or-later
// Page elements, timings, and the built-in widgets (inlays).
// Part of the launcher page; the parts share one scope and load in the order index.html lists them.

const api = window.launcherAPI;
const tabsEl = document.getElementById('tabs');
const rowsEl = document.getElementById('rows');
const crumbEl = document.getElementById('crumb');
const titleEl = document.getElementById('title');
const statusEl = document.getElementById('status');
const modalEl = document.getElementById('modal');
const canvasEl = document.getElementById('canvas');

const REORDER_HOLD_MS = 3000;
const MAX_TEXT = 40;
const GRID_COLS = 12; // Home is a grid spread over the whole screen (keep in step with main.js)
const GRID_ROWS = 6;

// What Tessera calls a user-made page of tiles. One place to rename it.
const TERM = 'mosaic';
const Term = TERM[0].toUpperCase() + TERM.slice(1);

// ----------------------------------------------------------------- inlays
// Inlays are small live pieces (widgets) set into a page. Built-in presets are
// drawn here; add one by adding an entry below and to BUILTIN_INLAYS in
// main.js. Widgets people download are drawn by main's add-ons loader instead,
// in a sandboxed frame (see widgetFrame). Any page can hold either kind.
const INLAYS = {
  recent: {
    render(card) {
      const head = document.createElement('div');
      head.className = 'recent-head';
      head.textContent = 'Recently played';
      const list = document.createElement('div');
      list.className = 'recent-list';
      const items = data.recent || [];
      if (!items.length) {
        const none = document.createElement('div');
        none.className = 'recent-none';
        none.textContent = 'Nothing played yet';
        list.appendChild(none);
      }
      items.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'recent-row';
        const name = document.createElement('span');
        name.textContent = it.title;
        const kind = document.createElement('small');
        kind.textContent = it.kind === 'app' ? 'App' : 'Game';
        row.append(name, kind);
        list.appendChild(row); // rows past the bottom are clipped by the widget's size
      });
      card.append(head, list);
    },
  },
  clock: {
    render(card) {
      const time = document.createElement('div');
      time.className = 'clock-time';
      const date = document.createElement('div');
      date.className = 'clock-date';
      card.append(time, date);
    },
  },
  cpu: { render(card) { sysinfoCard(card, 'CPU', 'cpu'); } },
  ram: { render(card) { sysinfoCard(card, 'Memory', 'ram', true); } },
  storage: { render(card) { sysinfoCard(card, 'Storage', 'storage', true); } },
  battery: { render(card) { sysinfoCard(card, 'Battery', 'battery', true); } },
  network: { render(card) { sysinfoCard(card, 'Network', 'network', true); } },
  uptime: { render(card) { sysinfoCard(card, 'Uptime', 'uptime'); } },
};
// A plain label + big value (+ optional small sub-line), the same shape for all six system
// widgets below. tickInlays fills in the live numbers once a second; this just builds the DOM.
function sysinfoCard(card, label, key, withSub) {
  const l = document.createElement('div'); l.className = 'sysinfo-label'; l.textContent = label;
  const v = document.createElement('div'); v.className = `sysinfo-value sysinfo-${key}`; v.textContent = '–';
  card.append(l, v);
  if (withSub) { const s = document.createElement('div'); s.className = `sysinfo-sub sysinfo-${key}-sub`; card.append(s); }
}
function fmtUptime(s) {
  if (s == null || Number.isNaN(s)) return '–';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
// A downloaded widget runs in a sandboxed frame: scripts allowed, but it has
// no network, no access to this page, and can only load its own folder
// (enforced by the tessera-widget protocol in main.js).
function widgetFrame(id) {
  const f = document.createElement('iframe');
  f.className = 'widget-frame';
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('scrolling', 'no');
  f.tabIndex = -1;
  f.src = `tessera-widget://${id}/`;
  return f;
}
function tickInlays() {
  const now = new Date();
  document.querySelectorAll('.clock-time').forEach((el) => {
    el.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  });
  document.querySelectorAll('.clock-date').forEach((el) => {
    el.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  });
  if (!document.querySelector('.sysinfo-value')) return; // none of the six are on screen; skip the round trip
  api.systemInfo().then((s) => {
    if (!s) return;
    const set = (sel, text) => document.querySelectorAll(sel).forEach((el) => { el.textContent = text; });
    set('.sysinfo-cpu', s.cpu == null ? '–' : s.cpu + '%');
    set('.sysinfo-ram', s.ram ? fmtBytes(s.ram.used) : '–');
    set('.sysinfo-ram-sub', s.ram ? `of ${fmtBytes(s.ram.total)}` : '');
    set('.sysinfo-storage', s.storage ? fmtBytes(s.storage.free) : '–');
    set('.sysinfo-storage-sub', s.storage ? `free of ${fmtBytes(s.storage.total)}` : '');
    set('.sysinfo-battery', s.battery && s.battery.present ? `${s.battery.pct}%` : 'No battery');
    set('.sysinfo-battery-sub', s.battery && s.battery.present ? (s.battery.charging ? 'Charging' : 'On battery') : '');
    set('.sysinfo-network', s.network && s.network.connected ? 'Connected' : 'Disconnected');
    set('.sysinfo-network-sub', s.network && s.network.connected && s.network.rxRate != null ? `↓${fmtBytes(s.network.rxRate)}/s ↑${fmtBytes(s.network.txRate)}/s` : '');
    set('.sysinfo-uptime', fmtUptime(s.uptime));
  }).catch(() => {});
}
setInterval(tickInlays, 1000);
