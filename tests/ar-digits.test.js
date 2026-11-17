const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs'); // dev dependency (already used by ocr:eval)
const Pre = require('../public/js/ocr-preprocess.js');
const Ar = require('../public/js/ar-digits.js');

Ar.setModel(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ar-digits-model.json'), 'utf8')));
const dir = path.join(__dirname, 'fixtures', 'ar-digits');
const readFixture = name => {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, name + '.png')));
  return Ar.read(Pre.process(png.data, png.width, png.height), png.width, png.height); // same preprocessing as the browser
};

test('model is present and well-formed', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ar-digits-model.json'), 'utf8'));
  assert.equal(m.classes, 11); assert.equal(m.W1.length, m.gh * m.gw + 4); assert.equal(m.W1[0].length, m.hid); assert.equal(m.W2.length, m.hid);
});
test('reads Arabic-Indic numbers rendered in several fonts', () => {
  for (const [name, want] of [['2367_arial', '2367'], ['1402_tahoma', '1402'], ['72983_arialbold', '72983'], ['5821_times', '5821']]) {
    const r = readFixture(name);
    assert.equal(r.script, 'arabic', name);
    assert.equal(r.digits, want, name);
  }
});
test('known weak spot: an unusual font must never be read as a WRONG Arabic number (it may be rejected instead)', () => {
  const r = readFixture('4560_georgia'); // measured ~90% per-glyph accuracy on unseen fonts, so some fonts are rejected
  assert.ok(r.script === 'other' || r.digits === '4560');
});
test('Western digit lines are NOT claimed as Arabic (left to Tesseract eng)', () => {
  for (const name of ['western_2367_arial', 'western_5821_times', 'western_4560_tahoma']) assert.equal(readFixture(name).script, 'other', name);
});
test('blank and noise-only strips read nothing', () => {
  const w = 200, h = 60, blank = new Uint8Array(w * h).fill(255);
  assert.deepEqual(Ar.read(blank, w, h), { script: 'other', digits: '', conf: 0, glyphs: 0 });
  const speck = new Uint8Array(w * h).fill(255); speck[30 * w + 30] = 0;
  assert.equal(Ar.read(speck, w, h).script, 'other');
});
test('connected components and box resize behave', () => {
  const w = 10, h = 6, img = new Uint8Array(w * h).fill(255);
  for (let x = 1; x < 4; x++) img[2 * w + x] = 0; img[3 * w + 7] = 0;
  const { comps } = Ar.components(img, w, h);
  assert.equal(comps.length, 2); assert.equal(comps[0].area, 3);
  const r = Ar.boxResize(new Float32Array([1, 1, 1, 1]), 2, 2, 2, 2);
  assert.deepEqual(Array.from(r), [1, 1, 1, 1]);
});
