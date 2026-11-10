# SPDX-License-Identifier: GPL-3.0-or-later
# Install Tessera and Recover run the full Ludus's own step code in the bridge (backend/flowhost.js).
# These run that with a made-up main process and check what the screen is asked and what is called.
import json
import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')


def drive(scenario):
    r = subprocess.run(['node', os.path.join(HERE, 'flowhost_driver.js'), ROOT, scenario], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


@unittest.skipUnless(shutil.which('node'), 'needs node')
class FlowHostTest(unittest.TestCase):
    def test_the_welcome_comes_first_with_the_three_choices(self):
        out = drive('install')
        first = [e for e in out['events'] if e['kind'] == 'pick'][0]
        self.assertEqual(first['title'], 'Welcome to Tessera')
        self.assertEqual([i['label'] for i in first['items']], ['Install Tessera', 'Try it first', 'Recover'])
        self.assertTrue(first['welcome'])
        self.assertTrue(first['items'][0]['ok'])

    def test_install_asks_the_helper_about_the_computer(self):
        out = drive('install')
        self.assertIn(['installer', 'probe'], out['calls'])
        self.assertEqual(out['events'][-1]['kind'], 'end')

    def test_recover_asks_for_the_password_and_repairs(self):
        out = drive('recover')
        titles = [e['title'] for e in out['events'] if e['kind'] in ('pick', 'ask')]
        self.assertIn('Password for alex', titles)
        self.assertIn(['recovery', 'fix', 'boot'], out['calls'])
        done = [e for e in out['events'] if e['kind'] == 'pick' and e['title'] == 'Done'][0]
        self.assertIn('Rewrote the menu', done['body'])


if __name__ == '__main__':
    unittest.main()
