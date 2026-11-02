# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for libexec/tessera/joycons: grouping, button mapping by position, sticks, release, the command line.
   python3 -m unittest discover tools/joycons-test"""
import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

HELPER = os.path.join(os.path.dirname(__file__), '..', '..', 'system_files', 'usr', 'libexec', 'tessera', 'joycons')
tmp = tempfile.mkdtemp()
os.environ.update(TESSERA_JOYCONS_CONFIG=os.path.join(tmp, 'cfg', 'joycons.json'), TESSERA_JOYCONS_STATE=os.path.join(tmp, 'run', 'joycons.json'),
                  TESSERA_JOYCONS_SYS=os.path.join(tmp, 'sys'))
loader = importlib.machinery.SourceFileLoader('joycons', HELPER)
spec = importlib.util.spec_from_loader('joycons', loader)
jc = importlib.util.module_from_spec(spec)
loader.exec_module(jc)

L, R, L2, R2 = 'aa:aa/jl', 'bb:bb/jr', 'cc:cc/jl', 'dd:dd/jr'


class Grouping(unittest.TestCase):
    def test_left_and_right_join(self):
        g = jc.plan_groups({L: 'jl', R: 'jr'}, [L, R])
        self.assertEqual(g, [{'kind': 'joined', 'members': [L, R]}])

    def test_four_joycons_make_two_pads_in_arrival_order(self):
        g = jc.plan_groups({L: 'jl', R: 'jr', L2: 'jl', R2: 'jr'}, [L, R, L2, R2])
        self.assertEqual([x['members'] for x in g], [[L, R], [L2, R2]])

    def test_a_lone_joycon_is_its_own_sideways_player(self):
        g = jc.plan_groups({L: 'jl'}, [L])
        self.assertEqual(g, [{'kind': 'jl', 'members': [L]}])

    def test_separate_mode_joins_nothing(self):
        g = jc.plan_groups({L: 'jl', R: 'jr'}, [L, R], mode='separate')
        self.assertEqual([x['kind'] for x in g], ['jl', 'jr'])

    def test_single_stays_alone_and_its_partner_too(self):
        g = jc.plan_groups({L: 'jl', R: 'jr', L2: 'jl'}, [L, R, L2], singles=[L])
        self.assertEqual([x['members'] for x in g], [[L], [L2, R]])

    def test_a_chosen_pair_wins_over_arrival_order(self):
        g = jc.plan_groups({L: 'jl', R: 'jr', L2: 'jl', R2: 'jr'}, [L, R, L2, R2], pairs=[[L, R2]])
        self.assertIn([L, R2], [x['members'] for x in g])
        self.assertIn([L2, R], [x['members'] for x in g])

    def test_order_sets_the_player_numbers(self):
        g = jc.plan_groups({L: 'jl', R: 'jr', L2: 'jl', R2: 'jr'}, [L2, R2, L, R])
        self.assertEqual([x['members'] for x in g], [[L2, R2], [L, R]])


class Mapping(unittest.TestCase):
    def joined(self):
        return jc.Pad('joined', [L, R])

    def test_right_face_buttons_by_position_on_an_xbox_pad(self):
        p = self.joined()
        # hid_nintendo: bottom = SOUTH, right = EAST, left = WEST, top = NORTH. An Xbox pad's left is 0x133, top 0x134.
        self.assertEqual(p.feed(R, jc.EV_KEY, jc.SOUTH, 1), [(jc.EV_KEY, 0x130, 1)])
        self.assertEqual(p.feed(R, jc.EV_KEY, jc.EAST, 1), [(jc.EV_KEY, 0x131, 1)])
        self.assertEqual(p.feed(R, jc.EV_KEY, jc.WEST, 1), [(jc.EV_KEY, 0x133, 1)])
        self.assertEqual(p.feed(R, jc.EV_KEY, jc.NORTH, 1), [(jc.EV_KEY, 0x134, 1)])

    def test_a_repeat_does_nothing(self):
        p = self.joined()
        p.feed(R, jc.EV_KEY, jc.SOUTH, 1)
        self.assertEqual(p.feed(R, jc.EV_KEY, jc.SOUTH, 1), [])

    def test_joined_dpad_is_a_hat_and_zl_zr_are_triggers(self):
        p = self.joined()
        self.assertEqual(p.feed(L, jc.EV_KEY, jc.DUP, 1), [(jc.EV_ABS, jc.ABS_HAT0X, 0), (jc.EV_ABS, jc.ABS_HAT0Y, -1)])
        self.assertEqual(p.feed(L, jc.EV_KEY, jc.DLEFT, 1), [(jc.EV_ABS, jc.ABS_HAT0X, -1), (jc.EV_ABS, jc.ABS_HAT0Y, -1)])
        self.assertEqual(p.feed(L, jc.EV_KEY, jc.TL2, 1), [(jc.EV_ABS, jc.ABS_Z, 255)])
        self.assertEqual(p.feed(R, jc.EV_KEY, jc.TR2, 1), [(jc.EV_ABS, jc.ABS_RZ, 255)])

    def test_joined_leaves_out_the_side_buttons(self):
        p = self.joined()
        # on a left Joy-Con the kernel reports SL / SR as TR / TR2: they must not press R / ZR
        self.assertEqual(p.feed(L, jc.EV_KEY, jc.TR, 1), [])
        self.assertEqual(p.feed(L, jc.EV_KEY, jc.TR2, 1), [])
        self.assertEqual(p.feed(R, jc.EV_KEY, jc.TL, 1), [])

    def test_joined_sticks_are_left_and_right(self):
        p = self.joined()
        self.assertEqual(p.feed(L, jc.EV_ABS, jc.ABS_X, 32767), [(jc.EV_ABS, jc.ABS_X, 32767)])
        self.assertEqual(p.feed(R, jc.EV_ABS, jc.ABS_RY, -32767), [(jc.EV_ABS, jc.ABS_RY, -32767)])

    def test_sideways_right_joycon_buttons_and_stick(self):
        p = jc.Pad('jr', [R])
        # held sideways, A (EAST) is the bottom button; the pad's "A" (confirm) position
        self.assertEqual(p.feed(R, jc.EV_KEY, jc.EAST, 1), [(jc.EV_KEY, 0x130, 1)])
        self.assertEqual(p.feed(R, jc.EV_KEY, jc.START, 1), [(jc.EV_KEY, jc.START, 1)])
        self.assertEqual(p.feed(R, jc.EV_KEY, jc.TL, 1), [(jc.EV_KEY, jc.TL, 1)])   # SL is the left shoulder
        self.assertEqual(p.feed(R, jc.EV_ABS, jc.ABS_RX, 32767), [(jc.EV_ABS, jc.ABS_Y, 32767)])      # the stick turns a quarter
        self.assertEqual(p.feed(R, jc.EV_ABS, jc.ABS_RY, -32767), [(jc.EV_ABS, jc.ABS_X, 32767)])

    def test_sideways_left_joycon_uses_its_dpad_as_face_buttons(self):
        p = jc.Pad('jl', [L])
        self.assertEqual(p.feed(L, jc.EV_KEY, jc.DLEFT, 1), [(jc.EV_KEY, 0x130, 1)])
        self.assertEqual(p.feed(L, jc.EV_KEY, jc.DUP, 1), [(jc.EV_KEY, 0x133, 1)])
        self.assertEqual(p.feed(L, jc.EV_KEY, jc.SELECT, 1), [(jc.EV_KEY, jc.START, 1)])
        self.assertEqual(p.feed(L, jc.EV_ABS, jc.ABS_Y, 32767), [(jc.EV_ABS, jc.ABS_X, 32767)])

    def test_release_all_lets_go_of_everything(self):
        p = self.joined()
        p.feed(R, jc.EV_KEY, jc.SOUTH, 1); p.feed(L, jc.EV_KEY, jc.TL2, 1); p.feed(L, jc.EV_KEY, jc.DUP, 1); p.feed(L, jc.EV_ABS, jc.ABS_X, 5000)
        out = p.release_all()
        self.assertIn((jc.EV_KEY, 0x130, 0), out)
        self.assertIn((jc.EV_ABS, jc.ABS_Z, 0), out)
        self.assertIn((jc.EV_ABS, jc.ABS_HAT0Y, 0), out)
        self.assertIn((jc.EV_ABS, jc.ABS_X, 0), out)

    def test_every_mapped_button_exists_on_the_virtual_pad(self):
        for table in jc.BUTTON_TABLE.values():
            for idx in table.values():
                what, target = jc.STD[idx]
                if what == 'k':
                    self.assertIn(target, jc.OUT_KEYS)


class Devices(unittest.TestCase):
    def make(self, node, name, uniq, vendor='057e'):
        base = os.path.join(tmp, 'sys', node, 'device')
        os.makedirs(os.path.join(base, 'id'), exist_ok=True)
        for f, v in (('name', name), ('uniq', uniq), ('id/vendor', vendor)):
            with open(os.path.join(base, f), 'w') as fh:
                fh.write(v + '\n')

    def test_scan_finds_buttons_not_motion_sensors_or_other_makers(self):
        self.make('event26', 'Joy-Con (L) (IMU)', 'aa:aa')
        self.make('event27', 'Joy-Con (L)', 'AA:AA')
        self.make('event28', 'Joy-Con (R)', 'bb:bb')
        self.make('event29', 'Some Keyboard', 'cc', vendor='046d')
        self.make('event30', 'Nintendo Switch Pro Controller', 'dd')
        found = jc.scan()
        self.assertEqual([(d['node'], d['kind'], d['uniq']) for d in found], [('event27', 'jl', 'aa:aa/jl'), ('event28', 'jr', 'bb:bb/jr')])


class CommandLine(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, HELPER, *args], env=os.environ, capture_output=True, text=True)

    def test_settings_are_saved_and_cleared(self):
        self.assertEqual(self.run_cli('set-mode', 'separate').returncode, 0)
        self.assertEqual(self.run_cli('single', L).returncode, 0)
        self.assertEqual(self.run_cli('pair', L2, R2).returncode, 0)
        with open(os.environ['TESSERA_JOYCONS_CONFIG']) as f:
            c = json.load(f)
        self.assertEqual((c['mode'], c['singles'], c['pairs']), ('separate', [L], [[L2, R2]]))
        self.run_cli('pair', L, R)   # pairing makes it no longer a single
        with open(os.environ['TESSERA_JOYCONS_CONFIG']) as f:
            c = json.load(f)
        self.assertEqual(c['singles'], [])
        self.run_cli('forget')
        with open(os.environ['TESSERA_JOYCONS_CONFIG']) as f:
            c = json.load(f)
        self.assertEqual((c['singles'], c['pairs'], c['order']), ([], [], []))

    def test_bad_arguments_are_refused(self):
        self.assertEqual(self.run_cli('set-mode', 'nonsense').returncode, 2)
        self.assertEqual(self.run_cli('pair', L).returncode, 2)

    def test_status_is_json(self):
        r = self.run_cli('status')
        self.assertEqual(r.returncode, 0)
        self.assertIn('config', json.loads(r.stdout))


if __name__ == '__main__':
    unittest.main()
