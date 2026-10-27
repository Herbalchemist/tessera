'use strict';
// "Official" add-ons: a signature over every file, checked against the project's public key.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const V = require('../addon-verify');

const tmp = [];
test.after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); delete V.PUBLIC_KEYS['qa-test']; });

// A test key stands in for the project's (the real private key never leaves its owner's machine).
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
V.PUBLIC_KEYS['qa-test'] = publicKey.export({ type: 'spki', format: 'pem' });
const sign = (dir, keyId = 'qa-test', key = privateKey) => {
  const sig = crypto.sign(null, Buffer.from(V.computeAddonHash(dir), 'hex'), key).toString('base64');
  fs.writeFileSync(path.join(dir, 'addon.sig'), JSON.stringify({ alg: 'ed25519', keyId, sig }));
};
const shard = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tessera-sig-'));
  tmp.push(d);
  fs.writeFileSync(path.join(d, 'addon.json'), '{"name":"S","entry":"index.js"}');
  fs.mkdirSync(path.join(d, 'lib'));
  fs.writeFileSync(path.join(d, 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(d, 'lib', 'a.js'), 'x');
  return d;
};

test('signed by a known key: Official', () => {
  const d = shard();
  sign(d);
  assert.deepStrictEqual(V.verifyAddon(d), { official: true, reason: 'signed by qa-test' });
});

test('any change to any file, a new file, or a rename breaks it', () => {
  for (const change of [
    (d) => fs.appendFileSync(path.join(d, 'index.js'), ' '),
    (d) => fs.writeFileSync(path.join(d, 'lib', 'b.js'), 'new'),
    (d) => fs.renameSync(path.join(d, 'lib', 'a.js'), path.join(d, 'lib', 'c.js')),
    (d) => fs.rmSync(path.join(d, 'lib', 'a.js')),
  ]) {
    const d = shard();
    sign(d);
    change(d);
    assert.deepStrictEqual(V.verifyAddon(d), { official: false, reason: 'signature does not match these files' });
  }
});

test('unknown key, someone else\'s key, no signature, junk signature: not Official', () => {
  const d = shard();
  sign(d, 'nobody');
  assert.match(V.verifyAddon(d).reason, /unknown key/);
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  sign(d, 'qa-test', other);
  assert.strictEqual(V.verifyAddon(d).official, false);
  fs.rmSync(path.join(d, 'addon.sig'));
  assert.deepStrictEqual(V.verifyAddon(d), { official: false, reason: 'no addon.sig' });
  fs.writeFileSync(path.join(d, 'addon.sig'), '{"alg":"rsa"}');
  assert.match(V.verifyAddon(d).reason, /shape/);
});

test('a link inside is never followed (so it can\'t pull outside files into what is signed)', () => {
  const d = shard();
  sign(d);
  fs.symlinkSync('/etc/hostname', path.join(d, 'lib', 'link'));
  assert.strictEqual(V.verifyAddon(d).official, true, 'the link is ignored, not hashed');
});
