/* Pure lookup logic: membership number (+ suffix) -> committee number.
   UMD: usable in the browser (window.Lookup) and in Node tests (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lookup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [suffix, label]. '*' = foreign / political / refugee (committee 100, every number)
  var CATEGORIES = [
    ['', 'عاملة'], ['ع', 'عسكري (ع)'], ['د', 'سيدات (د)'], ['ب', 'بورسعيد (ب)'],
    ['بع', 'بورسعيد عسكري (بع)'], ['دب', 'بورسعيد سيدات (دب)'], ['*', 'أجنبي / سياسي / لاجئ'],
  ];

  var AR = '٠١٢٣٤٥٦٧٨٩', FA = '۰۱۲۳۴۵۶۷۸۹';
  function norm(s) {
    return String(s)
      .replace(/[٠-٩]/g, function (d) { return AR.indexOf(d); })
      .replace(/[۰-۹]/g, function (d) { return FA.indexOf(d); })
      .replace(/[‎‏‪-‮⁦-⁩]/g, '')
      .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي');
  }

  // rows: [[suffix, from, to, committee], ...]  ->  index
  function buildIndex(rows) {
    var index = { ranges: {}, foreign: null };
    rows.forEach(function (r) {
      var suf = r[0];
      if (suf === '*') { index.foreign = r[3]; return; }
      (index.ranges[suf] = index.ranges[suf] || []).push([r[1], r[2], r[3]]);
    });
    Object.keys(index.ranges).forEach(function (k) { index.ranges[k].sort(function (a, b) { return a[0] - b[0]; }); });
    return index;
  }

  // -> committee number, or null if the member number is not in the list
  function lookup(index, suffix, n) {
    if (suffix === '*') return index.foreign;
    if (!Number.isInteger(n) || n < 0) return null;
    var rows = index.ranges[suffix] || [];
    var lo = 0, hi = rows.length - 1;
    while (lo <= hi) {
      var m = (lo + hi) >> 1, r = rows[m];
      if (n < r[0]) hi = m - 1; else if (n > r[1]) lo = m + 1; else return r[2];
    }
    return null;
  }

  // Scanned barcode/QR text -> { n, suf } or null. Accepts "12345", "822 ع", "ع822", Arabic digits.
  function parseScan(raw) {
    var t = norm(raw), m;
    m = t.match(/(\d+)\s*(بع|دب|ع|د|ب)(?![ء-ي])/);
    if (m) return { n: parseInt(m[1], 10), suf: m[2] };
    m = t.match(/(بع|دب|ع|د|ب)\s*(\d+)/);
    if (m) return { n: parseInt(m[2], 10), suf: m[1] };
    m = t.match(/\d+/);
    if (m) return { n: parseInt(m[0], 10), suf: '' };
    return null;
  }

  function categoryLabel(suf) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i][0] === suf) return CATEGORIES[i][1];
    return '';
  }

  return { CATEGORIES: CATEGORIES, norm: norm, buildIndex: buildIndex, lookup: lookup, parseScan: parseScan, categoryLabel: categoryLabel };
});
