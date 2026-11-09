// SPDX-License-Identifier: GPL-3.0-or-later
// For the screenshot runs only (ludus.py --shot / --theme-shots): stands in for Wi-Fi, Bluetooth and
// sound hardware, which a build machine doesn't have, so the Settings menus can be drawn with
// something in them. Same answers the real handlers give (launcher/devices.js); nothing is touched.
'use strict';
module.exports = (handlers) => {
  const audio = {
    outputs: [
      { id: 'alsa_output.pci-0000_00_1f.3', label: 'Built-in Audio', kind: 'speakers', isDefault: true, volume: 62, mute: false },
      { id: 'bluez_output.AA_BB_CC_DD_EE_FF', label: 'Wireless Headset', kind: 'bluetooth', isDefault: false, volume: 40, mute: false },
    ],
    inputs: [{ id: 'alsa_input.pci-0000_00_1f.3', label: 'Built-in Microphone', kind: '', isDefault: true, volume: 75, mute: true }],
    cards: [],
  };
  const bt = {
    powered: true,
    devices: [
      { id: '11:22:33:44:55:66', name: 'Xbox Wireless Controller', kind: 'controller', paired: true, connected: true, battery: 80 },
      { id: 'AA:BB:CC:DD:EE:FF', name: 'Wireless Headset', kind: 'headset', paired: true, connected: false },
      { id: '77:88:99:AA:BB:CC', name: 'Pro Controller', kind: 'controller', paired: false, connected: false },
    ],
  };
  const wifi = {
    radio: true,
    networks: [
      { ssid: 'Home Wi-Fi', inUse: true, saved: true, word: 'Strong', security: 'secured' },
      { ssid: 'Cafe Guest', inUse: false, saved: false, word: 'Good', security: 'open' },
      { ssid: 'Neighbour 5G', inUse: false, saved: false, word: 'Weak', security: 'secured' },
    ],
  };
  const done = (result) => ({ ok: true, phase: 'done', result, error: '', detail: '' });
  const find = (list, id) => list.find((x) => x.id === id);
  const h = (fn) => ({ kind: 'handle', fn: async (_e, op, p) => fn(String(op), p || {}) });
  handlers.set('audio', h((op, p) => {
    if (op === 'info') return { ok: true, outputs: audio.outputs, inputs: audio.inputs, cards: audio.cards };
    const d = find(p.kind === 'input' ? audio.inputs : audio.outputs, p.id);
    if (!d) return { ok: false, error: 'Unknown device.' };
    if (op === 'volume') d.volume = p.pct;
    else if (op === 'mute') d.mute = p.on === true;
    else if (op === 'setDefault') (p.kind === 'input' ? audio.inputs : audio.outputs).forEach((x) => { x.isDefault = x === d; });
    return { ok: true };
  }));
  handlers.set('bluetooth', h((op, p) => {
    if (op === 'info') return { ok: true, adapter: { present: true, powered: bt.powered }, devices: bt.devices };
    if (op === 'power') bt.powered = p.on === true;
    if (op === 'poll') return done('connected');
    return { ok: true };
  }));
  handlers.set('wifi', h((op, p) => {
    if (op === 'info') return { ok: true, present: true, radio: wifi.radio, wired: false, networks: wifi.networks, saved: ['Home Wi-Fi'] };
    if (op === 'radio') wifi.radio = p.on === true;
    if (op === 'poll') return done('connected');
    return { ok: true };
  }));
  handlers.set('summaries', h(() => ({ wifi: 'Home Wi-Fi', bluetooth: '1 connected', audio: 'Built-in Audio', home: null, addons: 0, version: '' })));
};
