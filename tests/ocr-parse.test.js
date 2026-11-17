const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/js/ocr-parse.js');
const Pre = require('../public/js/ocr-preprocess.js');

test('normalises Arabic-Indic and Persian digits', () => {
  assert.deepEqual(P.extract('٢٣٦٧'), { n: 2367, suf: '', text: '2367' });
  assert.equal(P.extract('۱۴۰۲').n, 1402);
});
test('fixes letter/digit confusions only inside digit tokens', () => {
  assert.equal(P.extract('2З67'.replace('З', '3')).n, 2367);
  assert.equal(P.extract('23O7').n, 2307);
  assert.equal(P.extract('l402').n, 1402);
  assert.equal(P.extract('5B21').n, 5821);
  assert.equal(P.clean('SOB 12'), 'SOB 12');           // word stays a word
  assert.equal(P.extract('SOB'), null);
});
test('extracts the suffix when it is printed next to the number', () => {
  assert.deepEqual(P.extract('822 ع'), { n: 822, suf: 'ع', text: '822 ع' });
  assert.equal(P.extract('ع 822').suf, 'ع');
  assert.equal(P.extract('127 بع').suf, 'بع');
  assert.equal(P.extract('139 دب').suf, 'دب');
  assert.equal(P.extract('2367').suf, '');
});
test('implausible reads are rejected', () => {
  assert.equal(P.extract('0'), null);
  assert.equal(P.extract('000'), null);
  assert.equal(P.extract('1234567'), null);            // > 6 digits (e.g. a national id fragment)
  assert.equal(P.extract(''), null);
  assert.equal(P.extract(null), null);
  assert.equal(P.extract('abc ---'), null);
  assert.equal(P.extract('12345678901234 2367').n, 2367); // skips the long run, takes the plausible one
});
test('consensus: needs N identical consecutive frames', () => {
  const c = P.createConsensus({ frames: 3 });
  const r = n => ({ n, suf: '' });
  assert.equal(c.push(r(2367), 50, 0), null);
  assert.equal(c.push(r(2367), 50, 1), null);
  assert.deepEqual(c.push(r(2367), 50, 2), { n: 2367, suf: '' });
});
test('consensus: a different or missing frame resets the run', () => {
  const c = P.createConsensus({ frames: 3 });
  const r = (n, suf = '') => ({ n, suf });
  c.push(r(2367), 50, 0); c.push(r(2368), 50, 1); c.push(r(2367), 50, 2);
  assert.equal(c.push(r(2367), 50, 3), null);          // only 2 in a row
  c.push(null, 0, 4);
  assert.equal(c.push(r(2367), 50, 5), null);
  assert.equal(c.push(r(5, 'ع'), 50, 6), null);
  assert.equal(c.push(r(5, ''), 50, 7), null);        // same number, different suffix = different read
});
test('consensus: very high confidence accepts a single frame', () => {
  const c = P.createConsensus({ frames: 3, highConfidence: 97 });
  assert.equal(c.push({ n: 9, suf: '' }, 96, 0), null);
  assert.deepEqual(c.push({ n: 8, suf: '' }, 98, 1), { n: 8, suf: '' });
});
test('consensus: same number is ignored for 3 s after a result', () => {
  const c = P.createConsensus({ frames: 1 });
  const r = { n: 77, suf: '' };
  assert.ok(c.push(r, 10, 0));
  assert.equal(c.push(r, 10, 1000), null);
  assert.equal(c.push(r, 10, 2999), null);
  assert.ok(c.push(r, 10, 3001));
  assert.ok(c.push({ n: 78, suf: '' }, 10, 3002));    // a different number is not blocked
});
test('preprocess: dark text on a light card ends up black on white; coverCrop keeps aspect', () => {
  const w = 40, h = 10, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const x = i % w, v = x >= 15 && x < 20 ? 30 : 200 + (x % 5); rgba.set([v, v, v, 255], i * 4); }
  const bin = Pre.process(rgba, w, h);
  assert.equal(bin[0], 255); assert.equal(bin[16], 0);
  const c = Pre.coverCrop(1280, 720, 3);
  assert.equal(Math.round(c.sw / c.sh * 100), 300); assert.equal(c.sw, 1280);
});
