'use strict';
const test = require('node:test');
const assert = require('node:assert');
const g = require('../gpu-match');

const card = (vendor, device, cls = '030000') => ({ vendor, device, cls });

test('NVIDIA generations by device id', () => {
  assert.strictEqual(g.nvidiaGeneration('1c81'), 'legacy'); // GTX 1050
  assert.strictEqual(g.nvidiaGeneration('1380'), 'legacy'); // GTX 750 Ti (Maxwell)
  assert.strictEqual(g.nvidiaGeneration('1db1'), 'legacy'); // Titan V (Volta)
  assert.strictEqual(g.nvidiaGeneration('1e04'), 'open');   // RTX 2080 Ti (Turing)
  assert.strictEqual(g.nvidiaGeneration('2184'), 'open');   // GTX 1660 (Turing)
  assert.strictEqual(g.nvidiaGeneration('2684'), 'open');   // RTX 4090
  assert.strictEqual(g.nvidiaGeneration('1187'), 'unsupported'); // GTX 760 (Kepler)
});

test('which build a machine needs', () => {
  assert.strictEqual(g.needFor([card('1002', '73bf')]).variant, 'standard');
  assert.strictEqual(g.needFor([card('8086', '9a49')]).variant, 'standard');
  assert.strictEqual(g.needFor([card('10de', '1c81')]).variant, 'nvidia');
  assert.strictEqual(g.needFor([card('10de', '2684')]).variant, 'nvidia-open');
  // a laptop: Intel plus an RTX "3D controller"
  assert.strictEqual(g.needFor([card('8086', '9a49'), card('10de', '25a2', '030200')]).variant, 'nvidia-open');
  // an old card next to a new one: the classic driver covers both
  assert.strictEqual(g.needFor([card('10de', '1c81'), card('10de', '2684')]).variant, 'nvidia');
  assert.deepStrictEqual(g.needFor([card('10de', '1187')]), { variant: 'standard', why: 'nvidia-too-old' });
  assert.strictEqual(g.needFor([]).variant, null);
  // non-display devices are ignored (an NVIDIA audio function, say)
  assert.strictEqual(g.needFor([card('1002', '73bf'), card('10de', '10f0', '040300')]).variant, 'standard');
});

test('image references keep registry, owner and tag', () => {
  assert.strictEqual(g.variantOfRef('ghcr.io/herbalchemist/tessera:latest'), 'standard');
  assert.strictEqual(g.variantOfRef('ghcr.io/herbalchemist/tessera-nvidia:latest'), 'nvidia');
  assert.strictEqual(g.variantOfRef('ghcr.io/herbalchemist/tessera-nvidia-open:latest'), 'nvidia-open');
  assert.strictEqual(g.refFor('ghcr.io/herbalchemist/tessera:latest', 'nvidia-open'), 'ghcr.io/herbalchemist/tessera-nvidia-open:latest');
  assert.strictEqual(g.refFor('ghcr.io/herbalchemist/tessera-nvidia-open:stable', 'standard'), 'ghcr.io/herbalchemist/tessera:stable');
  assert.strictEqual(g.refFor('ghcr.io/someone/my-spin-nvidia:latest', 'nvidia-open'), 'ghcr.io/someone/my-spin-nvidia-open:latest');
  assert.strictEqual(g.refFor('ghcr.io/x/tessera@sha256:' + 'a'.repeat(64), 'nvidia'), 'ghcr.io/x/tessera-nvidia:latest');
  assert.strictEqual(g.refFor('ghcr.io/x/tessera:latest', 'bogus'), null);
});

test('match: a swapped card is spotted', () => {
  const m = g.match([card('1002', '73bf')], 'ghcr.io/herbalchemist/tessera-nvidia:latest');
  assert.strictEqual(m.mismatch, true);
  assert.strictEqual(m.need, 'standard');
  assert.strictEqual(m.target, 'ghcr.io/herbalchemist/tessera:latest');
  assert.strictEqual(g.match([card('10de', '1c81')], 'ghcr.io/herbalchemist/tessera-nvidia:latest').mismatch, false);
  assert.strictEqual(g.match([], 'ghcr.io/herbalchemist/tessera:latest').mismatch, false); // unknown: never nag
});
