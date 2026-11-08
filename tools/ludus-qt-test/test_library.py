# SPDX-License-Identifier: GPL-3.0-or-later
# Ludus (Qt): the library layer. python3 -m unittest discover tools/ludus-qt-test
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'system_files', 'usr', 'lib', 'tessera', 'ludus-qt'))
import library  # noqa: E402


def sample(tmp):
    """A library like the full Ludus writes: games, an app, Home, a mosaic with a folder in it."""
    game = os.path.join(tmp, 'Game One', 'run')
    os.makedirs(os.path.dirname(game))
    with open(game, 'w') as f:
        f.write('#!/bin/sh\nexit 0\n')
    os.chmod(game, stat.S_IRWXU)
    return {
        'items': [{'id': 'g1', 'kind': 'game', 'title': 'Game One', 'path': game},
                  {'id': 'g2', 'kind': 'game', 'title': 'Another Game', 'path': os.path.join(tmp, 'missing', 'run')},
                  {'id': 'x1', 'kind': 'game', 'title': 'Nexus game', 'path': game, 'args': ['/opt/x/shortcuts/launch-game', '1']},
                  {'id': 'a1', 'kind': 'app', 'title': 'Steam', 'path': '/usr/bin/steam'}],
        'inlays': [{'id': 'clock-1', 'type': 'clock', 'x': 0, 'y': 0, 'w': 2, 'h': 1}],
        'categories': [{'id': '_home', 'title': 'Home', 'builtin': True, 'entries': ['clock-1', 'g1']},
                       {'id': 'couch', 'title': 'Couch', 'top': True, 'entries': ['g1', 'co-op', 'clock-1']},
                       {'id': 'co-op', 'title': 'Co-op night', 'entries': ['g1']}],
        'tabOrder': ['home', 'library', 'apps', 'm:couch'],
        'recent': [],
        'layoutKey': '_everyone',
        'layouts': {'kid': {'categories': [], 'inlays': [], 'tabOrder': [], 'recent': []}},
    }


class LibraryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, 'library.json')
        with open(self.path, 'w') as f:
            json.dump(sample(self.tmp), f)
        self.lib = library.Library(self.path)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def saved(self):
        with open(self.path) as f:
            return json.load(f)

    def test_tabs_and_tiles(self):
        self.assertEqual([t['id'] for t in self.lib.tabs()], ['library', 'apps', 'm:couch'])
        self.assertEqual([t['title'] for t in self.lib.tiles('library')], ['Another Game', 'Game One', 'Nexus game'])
        self.assertEqual([t['id'] for t in self.lib.tiles('apps')], ['a1'])
        # a mosaic: its game and its folder; widgets aren't shown in this version
        self.assertEqual([(t['id'], t['kind']) for t in self.lib.tiles('m:couch')], [('g1', 'game'), ('co-op', 'folder')])
        self.assertEqual([t['id'] for t in self.lib.tiles('f:co-op')], ['g1'])

    def test_mosaics_create_rename_move_delete(self):
        new = self.lib.create_mosaic('  Party   games ')
        self.assertEqual(self.lib.cat(new)['title'], 'Party games')
        self.assertEqual([t['id'] for t in self.lib.tabs()][-1], 'm:' + new)
        unnamed = self.lib.create_mosaic('')
        self.assertEqual(self.lib.cat(unnamed)['title'], 'Mosaic 3')
        self.assertTrue(self.lib.move_tab('m:' + new, -1))
        self.assertEqual([t['id'] for t in self.lib.tabs()][2:], ['m:' + new, 'm:couch', 'm:' + unnamed])
        self.assertTrue(self.lib.rename('couch', 'Sofa'))
        self.assertFalse(self.lib.rename('_home', 'Mine'))
        self.assertFalse(self.lib.rename('couch', '   '))
        self.assertTrue(self.lib.delete_mosaic('couch'))
        self.assertIsNone(self.lib.cat('couch'))
        self.assertIsNotNone(self.lib.item('g1'))            # games are kept
        self.assertNotIn('m:couch', self.saved()['tabOrder'])
        self.assertFalse(self.lib.delete_mosaic('_home'))

    def test_deleting_a_folder_takes_it_out_of_its_mosaic(self):
        self.assertTrue(self.lib.delete_mosaic('co-op'))
        self.assertEqual([t['id'] for t in self.lib.tiles('m:couch')], ['g1'])

    def test_add_and_remove(self):
        self.assertTrue(self.lib.add_to('couch', 'a1'))
        self.assertTrue(self.lib.add_to('couch', 'a1'))   # no doubles
        self.assertEqual(self.saved()['categories'][1]['entries'].count('a1'), 1)
        self.assertFalse(self.lib.add_to('couch', 'couch'))
        self.assertFalse(self.lib.add_to('couch', 'nothing'))
        self.assertTrue(self.lib.remove_from('couch', 'a1'))
        self.assertFalse(self.lib.remove_from('couch', 'a1'))

    def test_the_rest_of_the_file_is_kept(self):
        self.lib.create_mosaic('X')
        d = self.saved()
        self.assertEqual(d['layoutKey'], '_everyone')
        self.assertIn('kid', d['layouts'])
        self.assertEqual(d['inlays'][0]['id'], 'clock-1')
        self.assertIn('clock-1', d['categories'][0]['entries'])

    def test_launching(self):
        argv, cwd = self.lib.launch_command('g1')
        self.assertEqual(os.path.basename(argv[0]), 'run')
        self.assertEqual(cwd, os.path.dirname(argv[0]))
        self.assertEqual(self.lib.launch_command('g2'), (None, "Can't find run. Is the drive plugged in?"))
        self.assertIsNone(self.lib.launch_command('x1')[0])     # Xbox games keep their gate in the full Ludus
        self.assertIsNone(self.lib.launch_command('nope')[0])
        self.lib.record_play('g1')
        self.assertEqual(self.saved()['recent'][0]['id'], 'g1')

    def test_a_broken_or_missing_file(self):
        with open(self.path, 'w') as f:
            f.write('{ not json')
        lib = library.Library(self.path)
        self.assertEqual(lib.tabs()[:2], [{'id': 'library', 'title': 'Library'}, {'id': 'apps', 'title': 'Apps'}])
        self.assertEqual(lib.tiles('library'), [])

    def test_never_runs_past_a_pin_or_profiles(self):
        self.assertIsNone(library.locked_down({}))
        self.assertIsNone(library.locked_down({'pin': None, 'profiles': []}))
        self.assertIn('PIN', library.locked_down({'pin': {'salt': 'a', 'hash': 'b'}}))
        self.assertIn('profiles', library.locked_down({'profiles': [{'id': 'kid'}]}))


if __name__ == '__main__':
    unittest.main()
