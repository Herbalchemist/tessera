'use strict';
// "Report a problem": personal details are taken out before the file is written.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// report.js is a main-process part: stand-ins for Electron and the parts it uses.
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'electron') return { ipcMain: { handle() {} }, screen: { getAllDisplays: () => [] } };
  if (this.filename && this.filename.endsWith('report.js') && id.startsWith('./')) return id === './ipc' ? { safe: (f) => f } : {};
  return orig.apply(this, arguments);
};
const { scrub } = require('../main/report');
Module.prototype.require = orig;

test('the account, home folder and computer name are replaced', () => {
  const who = { user: 'aleck', home: '/var/home/aleck', host: 'aleck-pc' };
  const out = scrub('ran /var/home/aleck/.local/bin/x as aleck on aleck-pc (Aleck-PC)', who);
  assert.strictEqual(out, 'ran ~/.local/bin/x as [user] on [computer] ([computer])');
  assert.doesNotMatch(scrub('user aleck logged in', who), /aleck/);
});
test('network and hardware addresses, and e-mail addresses, are replaced', () => {
  const out = scrub('wlan0 a4:5e:60:12:ab:cd got 192.168.1.42 and fe80:0:0:0:1c2:3d4:5e6:7f8, mail me@example.com', { user: 'x1', host: 'h1' });
  assert.doesNotMatch(out, /a4:5e|192\.168|fe80|example\.com/);
  assert.match(out, /\[hardware address\].*\[ip\].*\[ip\].*\[e-mail\]/);
});
test("what isn't personal stays readable", () => {
  const text = 'kernel 7.2.11-ogc4.1.fc44 at 12:34:56, launcher 0.36.0, 127.0.0.1, Vendor=045e Product=0b13';
  assert.strictEqual(scrub(text, { user: 'zed', home: '/home/zed', host: 'box' }), text);
});
