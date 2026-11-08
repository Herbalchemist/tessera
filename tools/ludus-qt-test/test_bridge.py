# SPDX-License-Identifier: GPL-3.0-or-later
# Ludus (Qt) runs the full Ludus's own main process through backend/bridge.js. These check that it
# starts, sends the page its view, and answers the same requests the full Ludus's page makes.
import json
import os
import select
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
LAUNCHER = os.path.join(ROOT, 'system_files', 'usr', 'lib', 'tessera', 'launcher')
BRIDGE = os.path.join(ROOT, 'system_files', 'usr', 'lib', 'tessera', 'ludus-qt', 'backend', 'bridge.js')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


@unittest.skipUnless(shutil.which('node'), 'needs node')
class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        data = os.path.join(self.tmp, 'data')
        subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), 'sample.py'), data], check=True)
        ours, theirs = socket.socketpair()
        env = dict(os.environ, HOME=os.path.join(self.tmp, 'home'), TESSERA_DATA_DIR=data, TESSERA_LAUNCHER_DIR=LAUNCHER,
                   XDG_STATE_HOME=os.path.join(self.tmp, 'state'), XDG_CONFIG_HOME=os.path.join(self.tmp, 'cfg'),
                   XDG_CACHE_HOME=os.path.join(self.tmp, 'cache'), TESSERA_BRIDGE_FD=str(theirs.fileno()))
        os.makedirs(env['HOME'])
        self.child = subprocess.Popen(['node', BRIDGE], env=env, pass_fds=(theirs.fileno(),), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        theirs.close()
        self.sock, self.buf, self.msgs, self.n = ours, b'', [], 0

    def tearDown(self):
        self.sock.close()
        try:
            self.child.wait(5)
        except subprocess.TimeoutExpired:
            self.child.kill()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def pump(self, until, t=10):
        end = time.time() + t
        while time.time() < end:
            found = next((m for m in self.msgs if until(m)), None)
            if found:
                return found
            r, _, _ = select.select([self.sock], [], [], 0.2)
            if r:
                d = self.sock.recv(1 << 20)
                if not d:
                    break
                self.buf += d
                while b'\n' in self.buf:
                    line, self.buf = self.buf.split(b'\n', 1)
                    self.msgs.append(json.loads(line))
        self.fail('no answer; got ' + json.dumps(self.msgs)[:500])

    def ask(self, ch, *args):
        self.n += 1
        n = self.n
        self.sock.sendall((json.dumps({'id': n, 'ch': ch, 'args': list(args)}) + '\n').encode())
        return self.pump(lambda m: m.get('id') == n)

    def test_view_and_library_changes(self):
        init = self.pump(lambda m: m.get('event') == 'init')['data']
        self.assertIn('m:couch', init['tabOrder'])
        self.assertEqual(init['folders']['couch']['title'], 'Couch co-op')
        self.assertEqual(len(init['tabs']['library'][0]['tiles']), 9)
        self.assertGreater(len(init['prefs']['theme']['settings']), 40)      # every theme setting comes along
        r = self.ask('library', 'newCategory', {'title': 'Party'})['result']
        self.assertTrue(r['ok'])
        self.assertIn('m:' + r['id'], r['view']['tabOrder'])
        r = self.ask('library', 'addEntry', {'catId': r['id'], 'ref': 'g1'})['result']
        self.assertTrue(r['ok'])
        r = self.ask('library', 'deleteCategory', {'id': 'couch'})['result']
        self.assertTrue(r['ok'])
        self.assertNotIn('couch', r['view']['folders'])
        self.assertEqual(len(r['view']['tabs']['library'][0]['tiles']), 9)   # games are kept

    def test_the_rest_of_the_main_process_answers(self):
        self.pump(lambda m: m.get('event') == 'init')
        self.assertIn('profiles', self.ask('profiles', 'list')['result'])
        self.assertIn('roots', self.ask('settings', 'get')['result'])
        self.assertFalse(self.ask('nothing')['ok'])

    def test_launching_a_game(self):
        self.pump(lambda m: m.get('event') == 'init')
        self.ask('launch', 'g0')
        self.pump(lambda m: m.get('window') == 'hide')                       # the screen steps aside
        self.pump(lambda m: m.get('window') == 'show')                       # and comes back when it ends


if __name__ == '__main__':
    unittest.main()
