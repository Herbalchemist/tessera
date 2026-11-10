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


class ReadingButtonsTest(unittest.TestCase):
    def test_roles(self):
        # Xbox and PlayStation confirm with the bottom button, Nintendo with the right one ("auto")
        self.assertEqual(pads.role_of(0, 'xbox', {}), 0)
        self.assertEqual(pads.role_of(0, 'nintendo', {}), 1)
        self.assertEqual(pads.role_of(1, 'nintendo', {}), 0)
        self.assertEqual(pads.role_of(2, 'nintendo', {}), 2)            # the left and top buttons never move
        self.assertEqual(pads.role_of(0, 'xbox', {'confirm': 'right'}), 1)
        self.assertEqual(pads.role_of(0, 'nintendo', {'confirm': 'bottom'}), 0)
        self.assertEqual(pads.role_of(7, 'xbox', {'confirm': 'right'}), 7)

    def test_remap_wins(self):
        pad = {'confirm': 'right', 'remap': {'xbox': [1, 0, 3, 2, 5, 4]}}
        self.assertEqual(pads.role_of(0, 'xbox', pad), 1)
        self.assertEqual(pads.role_of(4, 'xbox', pad), 5)
        self.assertEqual(pads.role_of(0, 'playstation', pad), 1)        # no remap for it: "confirm" applies
        bad = {'remap': {'xbox': [0, 0, 0, 0, 0, 0]}}
        self.assertEqual(pads.role_of(2, 'xbox', bad), 2)               # a broken list is ignored

    def test_family(self):
        self.assertEqual(pads.family_of('054c'), 'playstation')
        self.assertEqual(pads.family_of('057e'), 'nintendo')
        self.assertEqual(pads.family_of('045e', 'Xbox Wireless Controller'), 'xbox')

    def test_snapshot(self):
        i = pads.PadInfo.__new__(pads.PadInfo)
        i.name, i.vendor, i.product = 'Pad', '045e', '0b12'
        i.keys, i.raw, i.range = {0x130: 1, 0x13d: 1}, {pads.HAT_Y: 1, 0: 32767, 2: 255}, {0: (-32768, 32767), 2: (0, 255)}
        i.right, i.trig = (3, 4), (2, 5)
        s = i.snapshot()
        self.assertEqual((s['buttons'][0], s['buttons'][10], s['buttons'][13], s['buttons'][1]), (1.0, 1.0, 1.0, 0.0))
        self.assertAlmostEqual(s['axes'][0], 1.0)
        self.assertEqual(s['buttons'][6], 1.0)                          # a fully pulled left trigger

    def test_rumble_is_safe_without_a_pad_that_can_shake(self):
        p = pads.Pads(lambda a: None)
        self.assertFalse(p.rumble(1, 1, 200))                      # no controller at all
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        pads.SYS, pads.DEV = os.path.join(tmp, 'sys'), os.path.join(tmp, 'dev')
        os.makedirs(pads.DEV)
        caps = os.path.join(pads.SYS, 'event3', 'device', 'capabilities')
        os.makedirs(caps)
        with open(os.path.join(caps, 'key'), 'w') as f:
            f.write('7fdb000000000000 0 0 0 0')
        os.mkfifo(os.path.join(pads.DEV, 'event3'))
        p.rescan()
        p.lastNode = 'event3'
        self.assertFalse(p.rumble(0.5, 0.5, 200))                  # a pipe takes no force-feedback request; no crash
        for fd, _ in p.open.values():
            os.close(fd)
        p.open.clear()

    def test_the_force_feedback_effect_is_the_size_the_kernel_expects(self):
        eff = struct.pack('=HhHHHHHxxHH', pads.FF_RUMBLE, -1, 0, 0, 0, 220, 0, 100, 200) + bytes(28)
        self.assertEqual(len(eff), 48)
        self.assertEqual(struct.unpack_from('=HH', eff, 16), (100, 200))   # the two motors sit right after the replay block
        self.assertEqual(pads.EVIOCSFF & 0xff, 0x80)
        self.assertEqual((pads.EVIOCSFF >> 16) & 0x3fff, 48)


if __name__ == '__main__':
    unittest.main()
