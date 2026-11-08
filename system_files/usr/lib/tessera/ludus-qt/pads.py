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
BUTTONS = {0x130: 'a', 0x131: 'b', 0x133: 'x', 0x134: 'y', 0x136: 'lb', 0x137: 'rb', 0x13b: 'start',
           0x13a: 'select', 0x13c: 'guide', 0x220: 'up', 0x221: 'down', 0x222: 'left', 0x223: 'right'}
ABS_X, ABS_Y, HAT_X, HAT_Y = 0x00, 0x01, 0x10, 0x11
REPEAT_DELAY, REPEAT_EVERY = 0.38, 0.11


def has_key(path, code):
    try:
        words = open(path).read().split()
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

    def close(self, n):
        fd, _ = self.open.pop(n)
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
            if typ == EV_KEY and code in BUTTONS and value == 1:
                act = BUTTONS[code]
                if act in ('up', 'down', 'left', 'right'):
                    self.held[n] = (act, time.monotonic() + REPEAT_DELAY)
                self.emit(act)
            elif typ == EV_KEY and code in BUTTONS and value == 0 and BUTTONS[code] in ('up', 'down', 'left', 'right'):
                self.held[n] = (None, 0)
            elif typ == EV_ABS:
                before = stick.direction()
                stick.feed(code, value)
                after = stick.direction()
                if after != before:
                    self.held[n] = (after, time.monotonic() + REPEAT_DELAY)
                    if after:
                        self.emit(after)
