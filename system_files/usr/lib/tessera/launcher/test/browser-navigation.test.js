// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateHttpUrl, isHttpUrl } = require('../browser-navigation');

test('accepts HTTP and HTTPS browser destinations only', () => {
  assert.deepEqual(validateHttpUrl('https://example.com/path?q=1'), {
    ok: true,
    url: 'https://example.com/path?q=1',
  });
  assert.equal(isHttpUrl('http://example.com/'), true);
  assert.equal(isHttpUrl('https://example.com/'), true);
});

test('rejects missing, malformed, and non-web browser destinations', () => {
  assert.deepEqual(validateHttpUrl(''), { ok: false, error: 'No address given.' });
  assert.deepEqual(validateHttpUrl('not a URL'), { ok: false, error: 'That web address is invalid.' });
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hello', 'ftp://example.com/']) {
    assert.deepEqual(validateHttpUrl(url), { ok: false, error: 'Only web addresses are allowed.' });
  }
});
