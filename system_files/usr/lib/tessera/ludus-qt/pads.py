# SPDX-License-Identifier: GPL-3.0-or-later
"""Ludus (Qt): every controller, read straight from Linux (Qt 6 has no gamepad support of its own).

Any controller can drive the screens; presses become the same actions the keyboard gives:
up/down/left/right, a, b, x, y, lb, rb, start. Holding a direction repeats it.
No Qt in here: `Pads(on_action)` calls on_action(name) from its own thread.
"""
import fcntl
import os
import select
import struct
import threading
import time

SYS = os.environ.get('TESSERA_PADS_SYS', '/sys/class/input')
DEV = os.environ.get('TESSERA_PADS_DEV', '/dev/input')
EVENT = struct.Struct('llHHi')
EV_KEY, EV_ABS = 0x01, 0x03
BTN_SOUTH = 0x130
# Linux button codes as an Xbox-style pad sends them (and Tessera's own Joy-Con pads, which say they are one)
BUTTONS = {0x130: 'a', 0x131: 'b', 0x133: 'x', 0x134: 'y', 0x136: 'lb', 0x137: 'rb', 0x13b: 'start', 0x13d: 'l3', 0x13e: 'r3', 0x138: 'lt', 0x139: 'rt',
           0x13a: 'select', 0x13c: 'guide', 0x220: 'up', 0x221: 'down', 0x222: 'left', 0x223: 'right'}
ABS_X, ABS_Y, HAT_X, HAT_Y = 0x00, 0x01, 0x10, 0x11
# Settings > Controller > Confirm button and Settings > Button mapping (input-actions.js, the same rules):
# a button is read by POSITION. Roles 0-5 are the face buttons and bumpers: a, b, x, y, lb, rb.
ROLE_ACTION = ['a', 'b', 'x', 'y', 'lb', 'rb']
POSITION = {0x130: 0, 0x131: 1, 0x133: 2, 0x134: 3, 0x136: 4, 0x137: 5}
# position of every button the capture screen takes (the standard layout's numbers)
CAPTURE_POSITION = {**POSITION, 0x138: 6, 0x139: 7, 0x13a: 8, 0x13b: 9, 0x13d: 10, 0x13e: 11, 0x13c: 16}


def family_of(vendor, name=''):
    if vendor == '054c' or any(w in name.lower() for w in ('dualsense', 'dualshock', 'playstation', 'sony')):
        return 'playstation'
    if vendor == '057e' or any(w in name.lower() for w in ('nintendo', 'joy-con', 'joycon', 'switch', 'pro controller')):
        return 'nintendo'
    return 'xbox'


def role_of(position, family, pad):
    """The job the button at this position does, for this controller under the person's settings."""
    if position > 5:
        return position
    remap = (pad.get('remap') or {}).get(family)
    if isinstance(remap, list) and len(remap) == 6 and sorted(remap) == list(range(6)):
        return remap[position]
    confirm = pad.get('confirm')
    right = confirm == 'right' or (confirm not in ('bottom', 'right') and family == 'nintendo')
    return {0: 1, 1: 0}.get(position, position) if right else position
REPEAT_DELAY, REPEAT_EVERY = 0.38, 0.11


def has_key(path, code):
    try:
        with open(path) as f:
            words = f.read().split()
        word = int(words[len(words) - 1 - code // 64], 16)
    except (OSError, IndexError, ValueError):
        return False
    return bool(word >> (code % 64) & 1)


def gamepad_nodes():
    try:
        names = os.listdir(SYS)
    except OSError:
        return []
    out = []
    for n in names:
        if n.startswith('event') and has_key(os.path.join(SYS, n, 'device', 'capabilities', 'key'), BTN_SOUTH):
            out.append(n)
    return sorted(out)


def abs_range(fd, code):
    """(min, max) of an axis, from the kernel (EVIOCGABS)."""
    buf = bytearray(24)
    try:
        fcntl.ioctl(fd, 0x80184540 + code, buf)
        _, lo, hi, _, _, _ = struct.unpack('iiiiii', bytes(buf))
        return (lo, hi) if hi > lo else (-32768, 32767)
    except (OSError, ValueError):
        return (-32768, 32767)


def sys_text(n, rel):
    try:
        with open(os.path.join(SYS, n, 'device', rel)) as f:
            return f.read().strip()
    except OSError:
        return ''


# The standard layout's button numbers (the same ones the full Ludus shows) and the Linux codes behind them
STANDARD = {0: 0x130, 1: 0x131, 2: 0x133, 3: 0x134, 4: 0x136, 5: 0x137, 8: 0x13a, 9: 0x13b, 10: 0x13d, 11: 0x13e, 16: 0x13c}


class PadInfo:
    """What one controller reports right now, for the controller test: its buttons by the standard
    layout's numbers, its sticks and its triggers. (A PlayStation pad puts its right stick and
    triggers on other axes than an Xbox one does.)"""
    def __init__(self, fd, n):
        self.name = sys_text(n, 'name') or 'Controller'
        self.vendor = sys_text(n, 'id/vendor').lower() or '0000'
        self.product = sys_text(n, 'id/product').lower() or '0000'
        self.keys = {}
        self.raw = {}
        self.range = {c: abs_range(fd, c) for c in (0, 1, 2, 3, 4, 5, 9, 10)}
        sony = self.vendor == '054c'
        self.right = (0x02, 0x05) if sony else (0x03, 0x04)
        self.trig = ((0x03, 0x04) if sony else (0x02, 0x05))

    @property
    def id(self):
        """The way the full Ludus names a controller (what its saved stick calibration is keyed by)."""
        return ('%s (STANDARD GAMEPAD Vendor: %s Product: %s)' % (self.name, self.vendor, self.product))[:80]

    def feed(self, typ, code, value):
        if typ == EV_KEY:
            self.keys[code] = value
        elif typ == EV_ABS:
            self.raw[code] = value

    def axis(self, code):
        if code not in self.raw:
            return 0.0
        lo, hi = self.range.get(code, (-32768, 32767))
        return max(-1.0, min(1.0, (2.0 * (self.raw[code] - lo) / (hi - lo)) - 1.0))

    def trigger(self, code, button):
        if self.keys.get(button):
            return 1.0
        if code in self.raw:
            lo, hi = self.range.get(code, (0, 255))
            return max(0.0, min(1.0, (self.raw[code] - lo) / float(hi - lo)))
        return 0.0

    def snapshot(self):
        hx, hy = self.raw.get(HAT_X, 0), self.raw.get(HAT_Y, 0)
        pressed = [1.0 if i in STANDARD and self.keys.get(STANDARD[i]) else 0.0 for i in range(17)]
        pressed[6] = self.trigger(self.trig[0], 0x138)
        pressed[7] = self.trigger(self.trig[1], 0x139)
        pressed[12] = 1.0 if hy < 0 or self.keys.get(0x220) else 0.0
        pressed[13] = 1.0 if hy > 0 or self.keys.get(0x221) else 0.0
        pressed[14] = 1.0 if hx < 0 or self.keys.get(0x222) else 0.0
        pressed[15] = 1.0 if hx > 0 or self.keys.get(0x223) else 0.0
        return {'id': self.id, 'name': self.name, 'buttons': pressed,
                'axes': [self.axis(0), self.axis(1), self.axis(self.right[0]), self.axis(self.right[1])]}


class Stick:
    """Turns one pad's stick and hat into a held direction."""
    def __init__(self, fd):
        self.range = {ABS_X: abs_range(fd, ABS_X), ABS_Y: abs_range(fd, ABS_Y)}
        self.v = {ABS_X: 0.0, ABS_Y: 0.0, HAT_X: 0, HAT_Y: 0}

    def feed(self, code, value):
        if code in (ABS_X, ABS_Y):
            lo, hi = self.range[code]
            self.v[code] = (2.0 * (value - lo) / (hi - lo)) - 1.0
        elif code in (HAT_X, HAT_Y):
            self.v[code] = value

    def direction(self):
        x = self.v[HAT_X] or (-1 if self.v[ABS_X] < -0.55 else 1 if self.v[ABS_X] > 0.55 else 0)
        y = self.v[HAT_Y] or (-1 if self.v[ABS_Y] < -0.55 else 1 if self.v[ABS_Y] > 0.55 else 0)
        if x and abs(self.v[ABS_X]) < abs(self.v[ABS_Y]) and not self.v[HAT_X]:
            x = 0
        if y and x:
            y = 0
        return 'left' if x < 0 else 'right' if x > 0 else 'up' if y < 0 else 'down' if y > 0 else None


class Pads:
    def __init__(self, on_action):
        self.on_action = on_action
        self.paused = False
        self.open = {}      # node -> (fd, Stick)
        self.info = {}      # node -> PadInfo
        self.lastNode = None   # the controller touched last
        self.padSettings = {}  # prefs.pad: confirm, remap
        self.capturing = None  # a function to hand the next button's role to (the Button mapping screen), and the roles it takes
        self.held = {}      # node -> (direction, next repeat time)
        self.stop = False
        self.thread = threading.Thread(target=self.run, daemon=True)

    def start(self):
        self.thread.start()

    def rescan(self):
        nodes = set(gamepad_nodes())
        for n in list(self.open):
            if n not in nodes:
                self.close(n)
        for n in nodes - set(self.open):
            try:
                fd = os.open(os.path.join(DEV, n), os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC)
            except OSError:
                continue
            self.open[n] = (fd, Stick(fd))
            self.info[n] = PadInfo(fd, n)

    def close(self, n):
        fd, _ = self.open.pop(n)
        self.info.pop(n, None)
        if self.lastNode == n:
            self.lastNode = None
        self.held.pop(n, None)
        try:
            os.close(fd)
        except OSError:
            pass

    def emit(self, act):
        if not self.paused:
            self.on_action(act)

    def run(self):
        last_scan = 0
        while not self.stop:
            now = time.monotonic()
            if now - last_scan > 2:
                last_scan = now
                self.rescan()
            fds = {fd: n for n, (fd, _) in self.open.items()}
            try:
                ready, _, _ = select.select(list(fds), [], [], 0.05) if fds else ([], [], [])
                if not fds:
                    time.sleep(0.25)
            except (OSError, ValueError):
                ready = []
            for fd in ready:
                self.read(fds[fd])
            now = time.monotonic()
            for n, (d, at) in list(self.held.items()):
                if d and now >= at:
                    self.held[n] = (d, now + REPEAT_EVERY)
                    self.emit(d)

    def read(self, n):
        fd, stick = self.open[n]
        try:
            data = os.read(fd, EVENT.size * 64)
        except BlockingIOError:
            return
        except OSError:
            self.close(n)   # unplugged
            return
        for off in range(0, len(data) - EVENT.size + 1, EVENT.size):
            _, _, typ, code, value = EVENT.unpack_from(data, off)
            if n in self.info and typ in (EV_KEY, EV_ABS):
                self.info[n].feed(typ, code, value)
                if typ == EV_KEY or code in (0, 1, 2, 3, 4, 5, 16, 17):
                    self.lastNode = n
            if typ == EV_KEY and value == 1 and self.capturing and code in CAPTURE_POSITION:
                info = self.info.get(n)
                role = role_of(CAPTURE_POSITION[code], family_of(info.vendor, info.name) if info else 'xbox', self.padSettings)
                take, only = self.capturing
                if only is None or role in only:
                    self.capturing = None
                    take(role)
                continue
            if self.capturing and typ == EV_KEY:
                continue
            if typ == EV_KEY and code in BUTTONS and value == 1:
                act = BUTTONS[code]
                if code in POSITION:
                    info = self.info.get(n)
                    act = ROLE_ACTION[role_of(POSITION[code], family_of(info.vendor, info.name) if info else 'xbox', self.padSettings)]
                if act in ('up', 'down', 'left', 'right'):
                    self.held[n] = (act, time.monotonic() + REPEAT_DELAY)
                self.emit(act)
            elif typ == EV_KEY and code in BUTTONS and value == 0 and BUTTONS[code] in ('up', 'down', 'left', 'right'):
                self.held[n] = (None, 0)
            elif typ == EV_KEY and code in BUTTONS and value == 0:
                released = BUTTONS[code]
                if code in POSITION:
                    info = self.info.get(n)
                    released = ROLE_ACTION[role_of(POSITION[code], family_of(info.vendor, info.name) if info else 'xbox', self.padSettings)]
                if released == 'y':
                    self.emit('yup')     # the Y button let go: a tap opens options, holding 3 s picks a tab up
            elif typ == EV_ABS:
                before = stick.direction()
                stick.feed(code, value)
                after = stick.direction()
                if after != before:
                    self.held[n] = (after, time.monotonic() + REPEAT_DELAY)
                    if after:
                        self.emit(after)

    def snapshot(self):
        """The controller touched last (or the only one), as the test screen shows it; {} when none."""
        n = self.lastNode if self.lastNode in self.info else next(iter(self.info), None)
        out = self.info[n].snapshot() if n else {}
        if out:
            out['count'] = len(self.info)
        return out
