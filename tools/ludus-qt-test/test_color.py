# SPDX-License-Identifier: GPL-3.0-or-later
# The Qt screens' color code (qml/color.js) runs.
import os
import shutil
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
COLOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'system_files', 'usr', 'lib', 'tessera', 'ludus-qt', 'qml', 'color.js')


class ColorTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'needs node')
    def test_it_runs(self):
        js = open(COLOR).read().replace('.pragma library', '')
        out = subprocess.run(['node', '-e', js + '\nconsole.log(onColor("#ffffff"), onColor("#000000"), JSON.stringify(nextPastel("dark")))'],
                             capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(out[:2], ['#10151c', '#ffffff'])
        self.assertRegex(out[2], r'"glow":"#[0-9a-f]{6}"')


if __name__ == '__main__':
    unittest.main()
