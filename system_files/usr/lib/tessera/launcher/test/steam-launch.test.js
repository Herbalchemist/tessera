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

const { upgrade } = require('../steam-launch');

test('Steam games saved before quiet launches are upgraded when the library loads', () => {
  assert.deepEqual(upgrade('/usr/bin/steam', ['steam://rungameid/730']), ['-silent', '-applaunch', '730']);
  assert.deepEqual(upgrade('/usr/bin/flatpak', ['run', 'com.valvesoftware.Steam', 'steam://rungameid/730']),
    ['run', 'com.valvesoftware.Steam', '-silent', '-applaunch', '730']);
  // a game added to Steam by hand keeps its 64-bit id and steam:// form, quietly
  assert.deepEqual(upgrade('/usr/bin/steam', ['steam://rungameid/12345678901234567890']), ['-silent', 'steam://rungameid/12345678901234567890']);
});

test('the upgrade leaves everything else alone', () => {
  const same = [
    ['/usr/bin/steam', ['-silent', '-applaunch', '730']], // already quiet
    ['/usr/bin/steam', ['-gamepadui', 'steam://rungameid/730']], // set up differently on purpose
    ['/usr/bin/lutris', ['lutris:rungame/doom']],
    ['/usr/bin/flatpak', ['run', 'com.heroicgameslauncher.hgl', 'steam://rungameid/730']],
    ['/usr/bin/steam', ['steam://rungameid/730;rm']],
  ];
  for (const [file, args] of same) assert.deepEqual(upgrade(file, args), args);
  assert.equal(upgrade('/usr/bin/steam', undefined), undefined);
});
