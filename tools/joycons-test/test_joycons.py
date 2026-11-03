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


def grips(*pairs):
    g = jc.Grips()
    for uniq, kind in pairs:
        g.connect(uniq, kind)
    return g


class Gestures(unittest.TestCase):
    def test_nothing_is_assigned_until_the_player_says_so(self):
        g = grips((L, 'jl'), (R, 'jr'))
        self.assertEqual(jc.plan_groups({L: 'jl', R: 'jr'}, [L, R], 'ask', *g.choices()), [])

    def test_sl_and_sr_make_a_joycon_its_own_sideways_player(self):
        g = grips((L, 'jl'), (R, 'jr'))
        self.assertFalse(g.press(L, jc.TR, True))     # one of the two side buttons is not enough
        self.assertTrue(g.press(L, jc.TR2, True))     # a left Joy-Con's SL / SR arrive as TR / TR2
        self.assertEqual(g.assign, {L: 'single'})
        self.assertFalse(g.press(R, jc.TL, True))
        self.assertTrue(g.press(R, jc.TL2, True))     # a right Joy-Con's arrive as TL / TL2
        self.assertEqual(g.order, [L, R])
        groups = jc.plan_groups({L: 'jl', R: 'jr'}, g.order, 'ask', *g.choices())
        self.assertEqual([(x['kind'], x['members']) for x in groups], [('jl', [L]), ('jr', [R])])

    def test_l_and_r_together_join_a_left_and_a_right(self):
        g = grips((L, 'jl'), (R, 'jr'))
        self.assertFalse(g.press(L, jc.TL, True))     # L alone: only one Joy-Con is saying anything
        self.assertTrue(g.press(R, jc.TR, True))
        singles, pairs = g.choices()
        self.assertEqual((singles, pairs), ([], [[L, R]]))
        groups = jc.plan_groups({L: 'jl', R: 'jr'}, g.order, 'ask', singles, pairs)
        self.assertEqual([x['kind'] for x in groups], ['joined'])

    def test_two_lefts_or_two_rights_do_not_join(self):
        g = grips((L, 'jl'), (L2, 'jl'))
        g.press(L, jc.TL, True)
        self.assertFalse(g.press(L2, jc.TL, True))

    def test_a_released_button_does_not_count(self):
        g = grips((L, 'jl'), (R, 'jr'))
        g.press(L, jc.TL, True)
        g.press(L, jc.TL, False)
        self.assertFalse(g.press(R, jc.TR, True))

    def test_assigned_joycons_ignore_gestures_unless_the_grip_screen_is_open(self):
        g = grips((L, 'jl'), (R, 'jr'))
        g.set_single(L)
        g.set_single(R)
        g.press(L, jc.TL, True)
        self.assertFalse(g.press(R, jc.TR, True))     # playing: two bumpers are just two bumpers
        g.press(L, jc.TL, False); g.press(R, jc.TR, False)
        g.grip = True
        g.press(L, jc.TL, True)
        self.assertTrue(g.press(R, jc.TR, True))      # on the grip screen they regroup
        self.assertEqual(g.assign, {L: R, R: L})

    def test_in_an_automatic_mode_gestures_work_only_on_the_grip_screen(self):
        g = grips((L, 'jl'), (R, 'jr'))
        g.always_ask = False
        g.press(L, jc.TL, True)
        self.assertFalse(g.press(R, jc.TR, True))
        g.grip = True
        g.press(R, jc.TR, False); g.press(R, jc.TR, True)
        self.assertTrue(g.press(R, jc.TR, True) or g.assign == {L: R, R: L})

    def test_a_disconnect_forgets_how_it_was_held_and_frees_its_partner(self):
        g = grips((L, 'jl'), (R, 'jr'))
        g.set_pair(L, R)
        g.disconnect(R)
        self.assertEqual(g.assign, {})
        self.assertEqual(g.order, [])

    def test_choosing_again_replaces_the_old_choice(self):
        g = grips((L, 'jl'), (R, 'jr'), (R2, 'jr'))
        g.set_pair(L, R)
        g.set_pair(L, R2)
        self.assertEqual(g.assign, {L: R2, R2: L})   # R is free again

    def test_players_are_numbered_in_the_order_they_were_assigned_and_can_move(self):
        g = grips((L, 'jl'), (R, 'jr'), (L2, 'jl'))
        g.set_single(L2)
        g.set_pair(L, R)
        self.assertEqual(g.order, [L2, L, R])
        self.assertTrue(g.move(L, -1))                # the pair becomes player 1
        self.assertEqual(g.order, [L, R, L2])
        self.assertFalse(g.move(L, -1))               # already first
        self.assertFalse(g.move(L2, 1))               # already last


class ServiceCommands(unittest.TestCase):
    def service(self, *devices):
        s = jc.Service()
        s.cfg = {'mode': 'ask', 'singles': [], 'pairs': [], 'order': []}
        for uniq, kind in devices:
            s.devs[uniq] = {'info': {'node': 'event0', 'kind': kind, 'uniq': uniq, 'name': 'Joy-Con (%s)' % kind[1].upper()}, 'fd': os.open(os.devnull, os.O_RDONLY)}
            s.grips.connect(uniq, kind)
        return s

    def setUp(self):
        self.written = []
        self.real = (jc.make_virtual, jc.write_events, jc.save_config)
        jc.make_virtual = lambda name: os.open(os.devnull, os.O_WRONLY)
        jc.write_events = lambda fd, events: self.written.extend(events)
        jc.save_config = lambda c: None

    def tearDown(self):
        jc.make_virtual, jc.write_events, jc.save_config = self.real

    def state(self):
        with open(os.environ['TESSERA_JOYCONS_STATE']) as f:
            return json.load(f)

    def test_unassigned_joycons_are_listed_and_do_not_play(self):
        s = self.service((L, 'jl'), (R, 'jr'))
        s.rebuild()
        st = self.state()
        self.assertEqual((st['mode'], st['pads'], [u['uniq'] for u in st['unassigned']]), ('ask', [], [L, R]))
        s.handle(L, jc.EVENT.pack(0, 0, jc.EV_KEY, jc.DUP, 1))
        self.assertEqual(self.written, [])

    def test_the_gesture_makes_a_controller_that_then_plays(self):
        s = self.service((L, 'jl'), (R, 'jr'))
        s.rebuild()
        s.handle(L, jc.EVENT.pack(0, 0, jc.EV_KEY, jc.TL, 1))
        s.handle(R, jc.EVENT.pack(0, 0, jc.EV_KEY, jc.TR, 1))
        st = self.state()
        self.assertEqual([(p['player'], p['kind']) for p in st['pads']], [(1, 'joined')])
        self.assertEqual(st['unassigned'], [])
        s.handle(R, jc.EVENT.pack(0, 0, jc.EV_KEY, jc.SOUTH, 1))
        self.assertIn((jc.EV_KEY, 0x130, 1), self.written)

    def test_the_grip_screen_stops_play_and_ends_by_itself(self):
        s = self.service((L, 'jl'), (R, 'jr'))
        s.rebuild()
        s.command({'cmd': 'single', 'uniq': L})
        s.command({'cmd': 'single', 'uniq': R})
        s.command({'cmd': 'grip', 'on': True})
        self.assertTrue(self.state()['grip'])
        s.handle(R, jc.EVENT.pack(0, 0, jc.EV_KEY, jc.EAST, 1))
        self.assertEqual(self.written, [])
        s.command({'cmd': 'grip', 'on': False})
        self.assertFalse(self.state()['grip'])

    def test_commands_pair_split_move_and_forget(self):
        s = self.service((L, 'jl'), (R, 'jr'), (L2, 'jl'))
        s.rebuild()
        self.assertTrue(s.command({'cmd': 'pair', 'left': L, 'right': R})['ok'])
        self.assertTrue(s.command({'cmd': 'single', 'uniq': L2})['ok'])
        self.assertEqual([p['kind'] for p in self.state()['pads']], ['joined', 'jl'])
        s.command({'cmd': 'move', 'uniq': L2, 'delta': -1})
        self.assertEqual([p['kind'] for p in self.state()['pads']], ['jl', 'joined'])
        s.command({'cmd': 'unassign', 'uniq': L2})
        self.assertEqual([u['uniq'] for u in self.state()['unassigned']], [L2])
        s.command({'cmd': 'forget'})
        self.assertEqual(self.state()['pads'], [])

    def test_the_mode_can_be_changed_and_decides_by_itself(self):
        s = self.service((L, 'jl'), (R, 'jr'))
        s.rebuild()
        s.command({'cmd': 'mode', 'mode': 'together'})
        self.assertEqual([p['kind'] for p in self.state()['pads']], ['joined'])
        s.command({'cmd': 'mode', 'mode': 'separate'})
        self.assertEqual([p['kind'] for p in self.state()['pads']], ['jl', 'jr'])

    def test_bad_requests_are_refused_and_change_nothing(self):
        s = self.service((L, 'jl'), (R, 'jr'))
        s.rebuild()
        for bad in ({'cmd': 'single', 'uniq': 'nobody'}, {'cmd': 'mode', 'mode': 'x'}, {'cmd': 'move', 'uniq': L, 'delta': 5},
                    {'cmd': 'wat'}, 'text', None):
            self.assertFalse(s.command(bad)['ok'], bad)
        s.command({'cmd': 'pair', 'left': R, 'right': L})   # a right and a left the wrong way round: nothing happens
        self.assertEqual(self.state()['pads'], [])


class PlayerLights(unittest.TestCase):
    def setUp(self):
        self.leds = os.path.join(tmp, 'leds')
        jc.LEDS = self.leds
        for hid in ('0003:057E:2006.0001', '0003:057E:2007.0002'):
            for n in range(1, 5):
                d = os.path.join(self.leds, '%s:green:player-%d' % (hid, n))
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, 'brightness'), 'w') as f:
                    f.write('0')

    def lit(self, hid):
        out = []
        for n in range(1, 5):
            with open(os.path.join(self.leds, '%s:green:player-%d' % (hid, n), 'brightness')) as f:
                if f.read() == '1':
                    out.append(n)
        return out

    def test_a_player_lights_its_own_number_and_a_waiting_joycon_all_four(self):
        a, b = '0003:057E:2006.0001', '0003:057E:2007.0002'
        jc.set_player_lights(a, 2)
        jc.set_player_lights(b, None)
        self.assertEqual((self.lit(a), self.lit(b)), ([2], [1, 2, 3, 4]))
        jc.set_player_lights(a, 5)           # more than four players wraps round
        self.assertEqual(self.lit(a), [1])
        jc.set_player_lights('', 1)           # no light directory: nothing to do, nothing breaks
        jc.set_player_lights('0003:057E:9999.0009', 1)

    def test_the_service_lights_players_in_setup_order_both_halves_of_a_pair_alike(self):
        a, b = '0003:057E:2006.0001', '0003:057E:2007.0002'
        s = jc.Service()
        s.cfg = {'mode': 'ask', 'singles': [], 'pairs': [], 'order': []}
        for uniq, kind, hid in ((L, 'jl', a), (R, 'jr', b)):
            s.devs[uniq] = {'info': {'node': 'event0', 'kind': kind, 'uniq': uniq, 'name': 'Joy-Con', 'hid': hid}, 'fd': os.open(os.devnull, os.O_RDONLY)}
            s.grips.connect(uniq, kind)
        s.pads = []
        s.light_players()
        self.assertEqual((self.lit(a), self.lit(b)), ([1, 2, 3, 4], [1, 2, 3, 4]))   # both waiting
        s.grips.set_single(R)
        s.grips.set_single(L)                      # the right one was set up first: player 1
        real = jc.make_virtual, jc.write_events
        jc.make_virtual = lambda name: os.open(os.devnull, os.O_WRONLY)
        jc.write_events = lambda fd, events: None
        try:
            s.rebuild()
        finally:
            jc.make_virtual, jc.write_events = real
        self.assertEqual((self.lit(b), self.lit(a)), ([1], [2]))


if __name__ == '__main__':
    unittest.main()
