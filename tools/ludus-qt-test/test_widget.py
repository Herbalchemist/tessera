# SPDX-License-Identifier: GPL-3.0-or-later
# Add-on widgets (ludus.py): the policy that goes on the top of their page, since a custom scheme can't send headers.
import ast
import os
import unittest

SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'system_files', 'usr', 'lib', 'tessera', 'ludus-qt', 'ludus.py'), encoding='utf-8').read()
_fn = next(n for n in ast.parse(SRC).body if isinstance(n, ast.FunctionDef) and n.name == 'inject_csp')
ns = {}
exec(compile(ast.Module([_fn], []), 'inject_csp', 'exec'), ns)
inject_csp = ns['inject_csp']


class InjectCsp(unittest.TestCase):
    def test_the_policy_comes_first(self):
        out = inject_csp(b'<script>x</script>', "default-src 'none'; connect-src 'none'")
        self.assertTrue(out.startswith(b'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src \'none\'">'))
        self.assertTrue(out.endswith(b'<script>x</script>'))

    def test_quotes_cannot_leave_the_attribute(self):
        out = inject_csp(b'x', 'a"><script>b</script>')
        self.assertNotIn(b'"><script>', out)

    def test_nothing_to_add(self):
        self.assertEqual(inject_csp(b'x', ''), b'x')


if __name__ == '__main__':
    unittest.main()
