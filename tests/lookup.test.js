const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../public/js/lookup.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/committees.json'), 'utf8'));
const index = L.buildIndex(data.rows);

test('every range boundary and midpoint maps to its committee', () => {
  for (const [suf, from, to, c] of data.rows) {
    if (suf === '*') continue;
    for (const n of [from, to, Math.floor((from + to) / 2)]) assert.equal(L.lookup(index, suf, n), c, `${suf}${n}`);
  }
});
test('known values from the PDF', () => {
  assert.equal(L.lookup(index, '', 1), 1);
  assert.equal(L.lookup(index, '', 1402), 2);
  assert.equal(L.lookup(index, '', 2367), 3);
  assert.equal(L.lookup(index, '', 72983), 84);
  assert.equal(L.lookup(index, 'ع', 822), 85);
  assert.equal(L.lookup(index, 'ع', 823), 86);
  assert.equal(L.lookup(index, 'د', 5491), 96);
  assert.equal(L.lookup(index, 'ب', 2638), 99);
  assert.equal(L.lookup(index, 'بع', 127), 99);
  assert.equal(L.lookup(index, 'دب', 139), 99);
  assert.equal(L.lookup(index, '*', 0), 100);
});
test('numbers outside the list return null', () => {
  assert.equal(L.lookup(index, '', 72984), null);
  assert.equal(L.lookup(index, '', 0), null);
  assert.equal(L.lookup(index, 'دب', 140), null);
  assert.equal(L.lookup(index, 'ع', NaN), null);
});
test('all 100 committees are reachable', () => {
  assert.deepEqual([...new Set(data.rows.map(r => r[3]))].sort((a, b) => a - b), Array.from({ length: 100 }, (_, i) => i + 1));
});
test('parseScan handles digits, suffixes and Arabic-Indic numerals', () => {
  assert.deepEqual(L.parseScan('12345'), { n: 12345, suf: '' });
  assert.deepEqual(L.parseScan('١٢٣٤٥'), { n: 12345, suf: '' });
  assert.deepEqual(L.parseScan('822 ع'), { n: 822, suf: 'ع' });
  assert.deepEqual(L.parseScan('٨٢٢ع'), { n: 822, suf: 'ع' });
  assert.deepEqual(L.parseScan('د 1540'), { n: 1540, suf: 'د' });
  assert.deepEqual(L.parseScan('5بع'), { n: 5, suf: 'بع' });
  assert.deepEqual(L.parseScan('5 دب'), { n: 5, suf: 'دب' });
  assert.equal(L.parseScan('abc'), null);
});
