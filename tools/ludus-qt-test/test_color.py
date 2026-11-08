# SPDX-License-Identifier: GPL-3.0-or-later
# The Qt screens' color code is the full Ludus's, word for word (gen_color.py), and it runs.
import os
import shutil
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_color  # noqa: E402


class ColorTest(unittest.TestCase):
    def test_same_as_the_full_ludus(self):
        with open(gen_color.OUT, encoding='utf-8') as f:
            self.assertEqual(f.read(), gen_color.generate(), 'look.js changed: run tools/ludus-qt-test/gen_color.py')

    @unittest.skipUnless(shutil.which('node'), 'needs node')
    def test_it_runs(self):
        js = open(gen_color.OUT).read().replace('.pragma library', '')
        out = subprocess.run(['node', '-e', js + '\nconsole.log(onColor("#ffffff"), onColor("#000000"), JSON.stringify(nextPastel("dark")))'],
                             capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(out[:2], ['#10151c', '#ffffff'])
        self.assertRegex(out[2], r'"glow":"#[0-9a-f]{6}"')


if __name__ == '__main__':
    unittest.main()
