// SPDX-License-Identifier: GPL-3.0-or-later
// Nintendo Switch controllers (Pro Controller, Joy-Con) for the launcher. Main process only.
//
// Why this exists: Chromium (inside Electron) leaves every Nintendo controller out of its normal
// gamepad list on Linux and hands them to a separate "Nintendo data fetcher", which gives Tessera
// nothing. The kernel's own driver (hid_nintendo) already turns them into ordinary input devices,
// so Tessera reads those directly, the same way it reads the joystick devices while the browser has
// the screen: through `cat`, which can always be stopped cleanly.
//
// It only READS. It never grabs a device away from games, never writes to it, and stops reading
// while a game or the browser is running.
//
// It also does what the Switch does with Joy-Cons: a left and a right Joy-Con can be one controller
// (held together) or two players (each held sideways). The "Change grip/order" screen uses the
// Switch gestures: L + R on two Joy-Cons joins them, SL + SR on one Joy-Con makes it its own player.
//
// TESSERA_SYS_INPUT / TESSERA_DEV_INPUT / TESSERA_SYS_POWER are only for tests.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SYS = process.env.TESSERA_SYS_INPUT || '/sys/class/input';
const DEV = process.env.TESSERA_DEV_INPUT || '/dev/input';
const PSU = process.env.TESSERA_SYS_POWER || '/sys/class/power_supply';
const VENDOR = '057e';
const EV_SIZE = 24; // struct input_event on 64-bit Linux: 16 bytes of time, type u16, code u16, value s32
const STICK = 32767; // hid_nintendo reports sticks from -32767 to 32767, up is negative
const GYRO_PER_DPS = 14247 / 1000; // hid_nintendo: JC_IMU_GYRO_RES_PER_DPS is 14.247 units per degree/second (x1000)
const ACCEL_PER_G = 4096;

// Linux input codes
const EV_SYN = 0, EV_KEY = 1, EV_ABS = 3, SYN_REPORT = 0;
const K = {
  SOUTH: 0x130, EAST: 0x131, NORTH: 0x133, WEST: 0x134, Z: 0x135, TL: 0x136, TR: 0x137, TL2: 0x138, TR2: 0x139,
  SELECT: 0x13a, START: 0x13b, MODE: 0x13c, THUMBL: 0x13d, THUMBR: 0x13e,
  DUP: 0x220, DDOWN: 0x221, DLEFT: 0x222, DRIGHT: 0x223,
};
const A = { X: 0, Y: 1, Z: 2, RX: 3, RY: 4, RZ: 5, HAT0X: 0x10, HAT0Y: 0x11 };

// Standard gamepad button numbers (the W3C "standard" layout the launcher uses), plus 17 = Capture.
// The kernel names Nintendo buttons by POSITION (B is the bottom one, so BTN_SOUTH), which is
// exactly how the standard layout counts them too.
const FULL_KEYS = {
  [K.SOUTH]: 0, [K.EAST]: 1, [K.WEST]: 2, [K.NORTH]: 3, [K.TL]: 4, [K.TR]: 5, [K.TL2]: 6, [K.TR2]: 7,
  [K.SELECT]: 8, [K.START]: 9, [K.THUMBL]: 10, [K.THUMBR]: 11,
  [K.DUP]: 12, [K.DDOWN]: 13, [K.DLEFT]: 14, [K.DRIGHT]: 15, [K.MODE]: 16, [K.Z]: 17,
};
const BUTTONS = 18;

// A Joy-Con held sideways, rail up, stick on the left (how the Switch uses one on its own).
// Left Joy-Con: its D-pad becomes the face buttons, SL / SR the shoulders, Minus is Start.
const SIDE_L_KEYS = {
  [K.DLEFT]: 0, [K.DDOWN]: 1, [K.DUP]: 2, [K.DRIGHT]: 3, [K.TR]: 4, [K.TR2]: 5, [K.TL]: 6, [K.TL2]: 7,
  [K.SELECT]: 9, [K.THUMBL]: 10, [K.Z]: 16,
};
// Right Joy-Con: A is the bottom button, SL / SR the shoulders, Plus is Start, Home is Home.
const SIDE_R_KEYS = {
  [K.EAST]: 0, [K.NORTH]: 1, [K.SOUTH]: 2, [K.WEST]: 3, [K.TL]: 4, [K.TL2]: 5, [K.TR]: 6, [K.TR2]: 7,
  [K.START]: 9, [K.THUMBR]: 10, [K.MODE]: 16,
};
// Joined: the left Joy-Con brings its own half, the right one its half. SL / SR are left out
// (on the left Joy-Con the kernel reports them as TR / TR2, which would press R / ZR).
const JOINED_FROM_L = new Set([K.TL, K.TL2, K.SELECT, K.THUMBL, K.DUP, K.DDOWN, K.DLEFT, K.DRIGHT, K.Z]);
const JOINED_FROM_R = new Set([K.SOUTH, K.EAST, K.NORTH, K.WEST, K.TR, K.TR2, K.START, K.THUMBR, K.MODE]);

const clamp1 = (v) => Math.max(-1, Math.min(1, v));
const stick = (v) => clamp1((v || 0) / STICK);
const round3 = (v) => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------ finding the controllers

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}
function realOrNull(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

// What one eventN node is, or null when it is not a Nintendo Switch controller.
function describe(node) {
  const base = path.join(SYS, node, 'device');
  if (readText(path.join(base, 'id', 'vendor')).toLowerCase() !== VENDOR) return null;
  const product = readText(path.join(base, 'id', 'product')).toLowerCase();
  const name = readText(path.join(base, 'name')).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 80);
  if (!name) return null;
  const imu = /\(IMU\)\s*$/.test(name);
  let kind = 'pro';
  if (/^Joy-Con \(L\)/.test(name)) kind = 'jl';
  else if (/^Joy-Con \(R\)/.test(name)) kind = 'jr';
  else if (/wii|RVL-/i.test(name) || product === '0306' || product === '0330') return null; // Wii Remote: not yet, see notes
  const uniq = readText(path.join(base, 'uniq')).toLowerCase().replace(/[^0-9a-f:]/g, '');
  return { node, name: name.replace(/\s*\(IMU\)\s*$/, ''), product, kind, imu, uniq: uniq || node, hid: realOrNull(path.join(base, 'device')) };
}

function scan() {
  let nodes = [];
  try { nodes = fs.readdirSync(SYS).filter((n) => /^event\d+$/.test(n)); } catch { /* no input class (tests, containers) */ }
  return nodes.map(describe).filter(Boolean);
}

// Battery: hid_nintendo registers a power supply whose device is the controller's HID device.
function batteryFor(hid) {
  if (!hid) return null;
  let names = [];
  try { names = fs.readdirSync(PSU); } catch { return null; }
  for (const n of names) {
    if (realOrNull(path.join(PSU, n, 'device')) !== hid) continue;
    const cap = parseInt(readText(path.join(PSU, n, 'capacity')), 10);
    const level = readText(path.join(PSU, n, 'capacity_level')); // Full, High, Normal, Low, Critical
    const status = readText(path.join(PSU, n, 'status')); // Charging, Discharging, Full
    return {
      percent: Number.isFinite(cap) ? Math.max(0, Math.min(100, cap)) : null,
      level: /^(Full|High|Normal|Low|Critical)$/.test(level) ? level : '',
      charging: status === 'Charging',
    };
  }
  return null;
}

// ------------------------------------------------------------------ reading one device

function parseEvents(buf, onEvent) {
  for (let i = 0; i + EV_SIZE <= buf.length; i += EV_SIZE) {
    onEvent(buf.readUInt16LE(i + 16), buf.readUInt16LE(i + 18), buf.readInt32LE(i + 20));
  }
}

function openReader(file, onEvent, onFail) {
  const cat = spawn('cat', [file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let pending = Buffer.alloc(0);
  let errText = '';
  cat.stdout.on('data', (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const whole = pending.length - (pending.length % EV_SIZE);
    if (whole) parseEvents(pending.subarray(0, whole), onEvent);
    pending = pending.subarray(whole);
  });
  cat.stderr.on('data', (d) => { errText += String(d).slice(0, 200); });
  cat.on('error', () => onFail('error'));
  cat.on('close', () => onFail(/denied/i.test(errText) ? 'permission' : 'closed'));
  return () => { try { cat.kill(); } catch { /* gone */ } };
}

// ------------------------------------------------------------------ the controller set

function create({ onList = () => {}, onFrame = () => {}, onMotion = () => {}, prefs = () => ({}) } = {}) {
  const devs = new Map(); // uniq + kind -> { info, keys:Set, abs:{}, stop, error, imuStop, motion }
  let order = []; // device keys, in the order they arrived (player numbers)
  let groups = []; // [{ id, members:[devKey, ...], kind:'pro'|'joined'|'jl'|'jr' }]
  const manual = new Map(); // devKey -> 'single' | partner devKey   (from the grip screen, until disconnected)
  let paused = false;
  let grip = false;
  let motionOn = false;
  let watcher = null;
  let timer = null;
  let dirty = new Set();
  let flushQueued = false;
  let lastList = '';
  const devKey = (info) => info.uniq + '/' + info.kind;

  // ---- grouping: who plays as which controller
  function regroup() {
    const live = order.filter((k) => devs.has(k));
    const mode = prefs().joycons === 'separate' ? 'separate' : 'together';
    const used = new Set();
    const next = [];
    const add = (members, kind) => { members.forEach((m) => used.add(m)); next.push({ id: kind + ':' + members.join('+'), members, kind }); };
    // manual pairs first (both still here)
    for (const k of live) {
      const p = manual.get(k);
      if (used.has(k) || !p || p === 'single' || !devs.has(p) || used.has(p) || manual.get(p) !== k) continue;
      const [l, r] = devs.get(k).info.kind === 'jl' ? [k, p] : [p, k];
      add([l, r], 'joined');
    }
    if (mode === 'together') {
      const ls = live.filter((k) => !used.has(k) && devs.get(k).info.kind === 'jl' && manual.get(k) !== 'single');
      const rs = live.filter((k) => !used.has(k) && devs.get(k).info.kind === 'jr' && manual.get(k) !== 'single');
      while (ls.length && rs.length) add([ls.shift(), rs.shift()], 'joined');
    }
    for (const k of live) if (!used.has(k)) add([k], devs.get(k).info.kind);
    // keep player numbers stable: sort by the earliest arrival among the members
    const first = (g) => Math.min(...g.members.map((m) => order.indexOf(m)));
    next.sort((a, b) => first(a) - first(b));
    groups = next;
    publishList();
    for (const g of groups) dirty.add(g.id);
    queueFlush();
  }

  function groupName(g) {
    if (g.kind === 'joined') return 'Joy-Con (L+R)';
    const d = devs.get(g.members[0]);
    return d ? d.info.name : 'Controller';
  }

  function listPayload() {
    return {
      ok: true,
      grip,
      mode: prefs().joycons === 'separate' ? 'separate' : 'together',
      pads: groups.map((g, i) => {
        const members = g.members.map((m) => devs.get(m)).filter(Boolean);
        const bat = members.map((d) => batteryFor(d.info.hid)).filter(Boolean);
        const low = bat.reduce((lo, b) => (lo === null || (b.percent !== null && b.percent < lo.percent) ? b : lo), null);
        return {
          id: g.id,
          // the "Nintendo" and "Joy-Con" words make the launcher pick Nintendo button labels
          name: groupName(g) + ' (Nintendo)',
          kind: g.kind,
          player: i + 1,
          parts: members.map((d) => d.info.kind),
          sideways: g.kind === 'jl' || g.kind === 'jr',
          motion: members.some((d) => d.hasImu),
          battery: low ? { percent: low.percent, level: low.level, charging: low.charging } : null,
          error: members.map((d) => d.error).find(Boolean) || '',
        };
      }),
    };
  }
  function publishList() {
    const p = listPayload();
    const s = JSON.stringify(p);
    if (s === lastList) return;
    lastList = s;
    onList(p);
  }

  // ---- state of one group as a standard gamepad
  function frameOf(g) {
    const b = new Array(BUTTONS).fill(false);
    const ax = [0, 0, 0, 0];
    const press = (map, d, only) => { for (const code of d.keys) { if (only && !only.has(code)) continue; const n = map[code]; if (n !== undefined) b[n] = true; } };
    const hat = (d) => {
      const hx = d.abs[A.HAT0X] || 0, hy = d.abs[A.HAT0Y] || 0;
      if (hy < 0) b[12] = true; if (hy > 0) b[13] = true; if (hx < 0) b[14] = true; if (hx > 0) b[15] = true;
    };
    const d0 = devs.get(g.members[0]);
    if (!d0) return null;
    if (g.kind === 'joined') {
      const l = d0, r = devs.get(g.members[1]);
      press(FULL_KEYS, l, JOINED_FROM_L);
      if (r) press(FULL_KEYS, r, JOINED_FROM_R);
      ax[0] = stick(l.abs[A.X]); ax[1] = stick(l.abs[A.Y]);
      if (r) { ax[2] = stick(r.abs[A.RX]); ax[3] = stick(r.abs[A.RY]); }
    } else if (g.kind === 'jl') {
      press(SIDE_L_KEYS, d0);
      ax[0] = stick(d0.abs[A.Y]); ax[1] = clamp1(-stick(d0.abs[A.X]));
    } else if (g.kind === 'jr') {
      press(SIDE_R_KEYS, d0);
      ax[0] = clamp1(-stick(d0.abs[A.RY])); ax[1] = stick(d0.abs[A.RX]);
    } else {
      press(FULL_KEYS, d0);
      hat(d0);
      ax[0] = stick(d0.abs[A.X]); ax[1] = stick(d0.abs[A.Y]); ax[2] = stick(d0.abs[A.RX]); ax[3] = stick(d0.abs[A.RY]);
    }
    let bits = 0;
    b.forEach((on, n) => { if (on) bits |= 1 << n; });
    return { id: g.id, b: bits, a: ax.map(round3) };
  }

  function queueFlush() {
    if (flushQueued) return;
    flushQueued = true;
    setImmediate(() => {
      flushQueued = false;
      if (paused) { dirty.clear(); return; }
      for (const g of groups) {
        if (!dirty.has(g.id)) continue;
        const f = frameOf(g);
        if (f) onFrame(f);
      }
      dirty.clear();
    });
  }

  // ---- the grip screen gestures (only while that screen is open, like on the Switch)
  function gesture(key) {
    const d = devs.get(key);
    if (!grip || !d) return;
    const k = d.keys;
    if (d.info.kind === 'jl' && k.has(K.TR) && k.has(K.TR2)) return setSingle(key);
    if (d.info.kind === 'jr' && k.has(K.TL) && k.has(K.TL2)) return setSingle(key);
    // L on a left Joy-Con and R on a right Joy-Con, pressed together: join those two
    const wantL = d.info.kind === 'jl' ? k.has(K.TL) : false;
    const wantR = d.info.kind === 'jr' ? k.has(K.TR) : false;
    if (!wantL && !wantR) return;
    for (const [ok, o] of devs) {
      if (ok === key) continue;
      if (wantL && o.info.kind === 'jr' && o.keys.has(K.TR)) return setPair(key, ok);
      if (wantR && o.info.kind === 'jl' && o.keys.has(K.TL)) return setPair(ok, key);
    }
  }
  function unlink(k) {
    const p = manual.get(k);
    if (p && p !== 'single' && manual.get(p) === k) manual.set(p, 'single');
  }
  function setSingle(k) {
    if (manual.get(k) === 'single') return;
    unlink(k);
    manual.set(k, 'single');
    regroup();
  }
  function setPair(l, r) {
    if (manual.get(l) === r && manual.get(r) === l) return;
    unlink(l); unlink(r);
    manual.set(l, r); manual.set(r, l);
    regroup();
  }

  // ---- devices coming and going
  function attach(info) {
    const key = devKey(info);
    if (info.imu) {
      const d = devs.get(key);
      if (d) { d.hasImu = true; d.imuNode = info.node; if (motionOn) startMotion(d); publishList(); }
      else pendingImu.set(key, info.node);
      return;
    }
    if (devs.has(key)) return;
    const d = { info, keys: new Set(), abs: {}, stop: null, error: '', hasImu: pendingImu.has(key), imuNode: pendingImu.get(key) || null, imuStop: null, motion: { gyro: [0, 0, 0], accel: [0, 0, 0] } };
    pendingImu.delete(key);
    devs.set(key, d);
    if (!order.includes(key)) order.push(key);
    d.stop = paused ? null : openDevice(key, d);
    if (motionOn) startMotion(d);
    regroup();
  }
  const pendingImu = new Map();

  function openDevice(key, d) {
    return openReader(path.join(DEV, d.info.node), (type, code, value) => {
      if (type === EV_KEY) { if (value) d.keys.add(code); else d.keys.delete(code); gesture(key); }
      else if (type === EV_ABS) d.abs[code] = value;
      else if (type === EV_SYN && code === SYN_REPORT) {
        const g = groups.find((x) => x.members.includes(key));
        if (g) { dirty.add(g.id); queueFlush(); }
      }
    }, (why) => {
      if (devs.get(key) !== d || paused || d.stop === null) return;
      d.stop = null;
      if (why === 'permission') { d.error = 'permission'; publishList(); return; }
      // closed: the controller went away (the next scan removes it) or cat died; try again on the next scan
    });
  }

  function startMotion(d) {
    if (d.imuStop || !d.imuNode || paused) return;
    const raw = {};
    let last = 0;
    d.imuStop = openReader(path.join(DEV, d.imuNode), (type, code, value) => {
      if (type === EV_ABS) raw[code] = value;
      else if (type === EV_SYN && code === SYN_REPORT) {
        d.motion = {
          accel: [raw[A.X] || 0, raw[A.Y] || 0, raw[A.Z] || 0].map((v) => round3(v / ACCEL_PER_G)),
          gyro: [raw[A.RX] || 0, raw[A.RY] || 0, raw[A.RZ] || 0].map((v) => Math.round(v / GYRO_PER_DPS)),
        };
        const now = Date.now();
        if (now - last < 33) return; // about 30 updates a second is plenty for a picture
        last = now;
        const g = groups.find((x) => x.members.some((m) => devs.get(m) === d));
        if (g) onMotion({ id: g.id, part: d.info.kind, gyro: d.motion.gyro, accel: d.motion.accel });
      }
    }, () => { d.imuStop = null; });
  }
  function stopMotion(d) { if (d.imuStop) { d.imuStop(); d.imuStop = null; } }

  function detach(key) {
    const d = devs.get(key);
    if (!d) return;
    if (d.stop) d.stop();
    stopMotion(d);
    devs.delete(key);
    unlink(key);
    manual.delete(key);
    order = order.filter((k) => k !== key);
    regroup();
  }

  function rescan() {
    const found = scan();
    const keys = new Set(found.filter((f) => !f.imu).map(devKey));
    for (const key of [...devs.keys()]) if (!keys.has(key)) detach(key);
    for (const f of found) if (!f.imu) attach(f);
    for (const f of found) if (f.imu) attach(f);
    // a reader that stopped (not for permission reasons) is tried again
    if (!paused) for (const [key, d] of devs) if (!d.stop && !d.error) d.stop = openDevice(key, d);
    // batteries change slowly; the list is only sent again when something changed
    publishList();
  }

  return {
    start() {
      rescan();
      try { watcher = fs.watch(DEV, () => setTimeout(rescan, 400)); } catch { watcher = null; }
      timer = setInterval(rescan, watcher ? 15000 : 3000);
      if (timer.unref) timer.unref();
    },
    stop() {
      if (watcher) watcher.close();
      if (timer) clearInterval(timer);
      for (const key of [...devs.keys()]) { const d = devs.get(key); if (d.stop) d.stop(); stopMotion(d); }
      devs.clear();
    },
    // A game or the browser has the screen: read nothing at all until it is back.
    pause() {
      if (paused) return;
      paused = true;
      for (const d of devs.values()) { if (d.stop) d.stop(); d.stop = null; d.keys.clear(); stopMotion(d); }
    },
    resume() {
      if (!paused) return;
      paused = false;
      rescan();
      if (motionOn) for (const d of devs.values()) startMotion(d);
    },
    list: () => listPayload(),
    setGrip(on) { grip = Boolean(on); publishList(); return listPayload(); },
    setMotion(on) {
      motionOn = Boolean(on);
      for (const d of devs.values()) (motionOn ? startMotion : stopMotion)(d);
      return { ok: true, motion: motionOn };
    },
    regroup: () => { manual.clear(); regroup(); return listPayload(); },
    _t: { devs, groups: () => groups, frameOf, rescan },
  };
}

module.exports = { create, describe, scan, parseEvents, FULL_KEYS, SIDE_L_KEYS, SIDE_R_KEYS, K, A, EV_SIZE };
