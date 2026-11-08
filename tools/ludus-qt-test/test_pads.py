# SPDX-License-Identifier: GPL-3.0-or-later
# Ludus (Qt): controllers read straight from Linux, with stand-in devices (pipes).
import os
import shutil
import struct
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'system_files', 'usr', 'lib', 'tessera', 'ludus-qt'))
import pads  # noqa: E402


class PadsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        pads.SYS, pads.DEV = os.path.join(self.tmp, 'sys'), os.path.join(self.tmp, 'dev')
        os.makedirs(pads.DEV)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def device(self, node, gamepad=True):
        caps = os.path.join(pads.SYS, node, 'device', 'capabilities')
        os.makedirs(caps)
        with open(os.path.join(caps, 'key'), 'w') as f:
            f.write('7fdb000000000000 0 0 0 0' if gamepad else '0')   # bit 0x130 set in the fifth word from the right
        path = os.path.join(pads.DEV, node)
        os.mkfifo(path)
        return path

    def test_only_gamepads(self):
        self.device('event3')
        self.device('event4', gamepad=False)
        self.assertEqual(pads.gamepad_nodes(), ['event3'])

    def test_buttons_and_dpad_from_two_pads(self):
        got = []
        a, b = self.device('event3'), self.device('event5')
        p = pads.Pads(got.append)
        p.start()
        time.sleep(0.4)
        wa, wb = os.open(a, os.O_WRONLY), os.open(b, os.O_WRONLY)
        ev = lambda t, c, v: pads.EVENT.pack(0, 0, t, c, v)
        os.write(wa, ev(pads.EV_KEY, 0x130, 1) + ev(pads.EV_KEY, 0x130, 0))       # A on the first pad
        os.write(wb, ev(pads.EV_KEY, 0x134, 1))                                     # Y on the second
        os.write(wb, ev(pads.EV_ABS, pads.HAT_X, 1) + ev(pads.EV_ABS, pads.HAT_X, 0))  # D-pad right, let go
        time.sleep(0.3)
        p.paused = True
        os.write(wa, ev(pads.EV_KEY, 0x131, 1))                                     # B while a game runs: ignored
        time.sleep(0.3)
        p.stop = True
        os.close(wa)
        os.close(wb)
        self.assertEqual(sorted(got), ['a', 'right', 'y'])   # two pads at once: either may be read first

    def test_holding_a_direction_repeats(self):
        got = []
        a = self.device('event3')
        p = pads.Pads(got.append)
        p.start()
        time.sleep(0.4)
        w = os.open(a, os.O_WRONLY)
        os.write(w, pads.EVENT.pack(0, 0, pads.EV_ABS, pads.HAT_Y, 1))
        time.sleep(0.8)
        os.write(w, pads.EVENT.pack(0, 0, pads.EV_ABS, pads.HAT_Y, 0))
        time.sleep(0.3)
        n = len(got)
        time.sleep(0.3)
        p.stop = True
        os.close(w)
        self.assertGreaterEqual(n, 3)
        self.assertTrue(all(g == 'down' for g in got))
        self.assertEqual(len(got), n, 'stops when let go')

    def test_stick(self):
        s = pads.Stick(-1)
        s.feed(pads.ABS_X, 32767)
        self.assertEqual(s.direction(), 'right')
        s.feed(pads.ABS_X, 0)
        s.feed(pads.ABS_Y, -32768)
        self.assertEqual(s.direction(), 'up')
        s.feed(pads.ABS_Y, -5000)
        self.assertIsNone(s.direction())


if __name__ == '__main__':
    unittest.main()
