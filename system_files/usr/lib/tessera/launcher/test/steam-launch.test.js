// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { appArgs, shortcutArgs } = require('../steam-launch');

test('native Steam apps launch quietly through applaunch', () => {
  assert.deepEqual(appArgs('730'), ['-silent', '-applaunch', '730']);
  assert.deepEqual(appArgs(123), ['-silent', '-applaunch', '123']);
});

test('Steam shortcuts launch quietly through their rungameid URI', () => {
  assert.deepEqual(shortcutArgs('9223372036854775808'), ['-silent', 'steam://rungameid/9223372036854775808']);
});

test('invalid Steam identifiers never become launch arguments', () => {
  for (const value of ['', '730;rm -rf /', '-1', null, undefined, '7.3']) {
    assert.deepEqual(appArgs(value), []);
    assert.deepEqual(shortcutArgs(value), []);
  }
});
