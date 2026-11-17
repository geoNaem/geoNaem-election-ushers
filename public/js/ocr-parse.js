/* Pure OCR-text -> membership number logic + consensus. UMD (browser: window.OcrParse, Node: require).
   Depends on lookup.js (digit normalisation + suffix parsing); never touches the DOM or the network. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lookup.js'));
  else root.OcrParse = factory(root.Lookup);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  var MAX_DIGITS = 6;          // largest real number is 5 digits (72983); 6 leaves slack for a bad-lighting extra digit
  var CONSENSUS_FRAMES = 3;    // same number+suffix in N consecutive frames
  var HIGH_CONFIDENCE = 97;    // ...or a single frame at/above this Tesseract confidence (0-100). UNVERIFIED: tune on real cards.
  var COOLDOWN_MS = 3000;      // same read ignored after a result

  // Letters Tesseract commonly returns instead of digits, only fixed INSIDE tokens that are mostly digits.
  var CONFUSIONS = { O: '0', o: '0', Q: '0', I: '1', l: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2', z: '2' };

  function fixToken(tok) {
    if (!/^[0-9OoQIl|SsBZz]+$/.test(tok)) return tok;
    var digits = (tok.match(/[0-9]/g) || []).length;
    if (digits < 1 || digits * 2 < tok.length) return tok; // words like "SOB" stay untouched
    return tok.replace(/[OoQIl|SsBZz]/g, function (c) { return CONFUSIONS[c]; });
  }

  // raw OCR text -> text with Arabic-Indic digits normalised and confusions fixed in digit tokens
  function clean(raw) {
    var t = L.norm(String(raw == null ? '' : raw)).replace(/[\r\n\t]+/g, ' ');
    return t.split(/\s+/).map(fixToken).join(' ').trim();
  }

  // -> { n, suf, text } or null. Takes the first plausible digit run (1..MAX_DIGITS digits, not zero).
  function extract(raw) {
    var t = clean(raw);
    var re = /\d+/g, m;
    while ((m = re.exec(t))) {
      var tok = m[0];
      if (tok.length > MAX_DIGITS) continue;
      var n = parseInt(tok, 10);
      if (!(n > 0)) continue;
      var win = t.slice(Math.max(0, m.index - 3), m.index + tok.length + 4);
      var p = L.parseScan(win);
      var suf = p && p.n === n ? p.suf : '';
      return { n: n, suf: suf, text: t };
    }
    return null;
  }

  function keyOf(r) { return r.n + '|' + r.suf; }

  // Accepts a read only when it is stable. push(read|null, confidence, now) -> accepted read or null.
  function createConsensus(opts) {
    opts = opts || {};
    var need = opts.frames || CONSENSUS_FRAMES;
    var hi = opts.highConfidence == null ? HIGH_CONFIDENCE : opts.highConfidence;
    var cool = opts.cooldownMs == null ? COOLDOWN_MS : opts.cooldownMs;
    var last = null, run = 0, doneKey = null, doneAt = -Infinity;
    return {
      push: function (read, confidence, now) {
        now = now == null ? Date.now() : now;
        if (!read) { last = null; run = 0; return null; }
        var k = keyOf(read);
        if (k === last) run++; else { last = k; run = 1; }
        if (k === doneKey && now - doneAt < cool) return null; // just reported this one
        if (run >= need || (confidence >= hi && run >= 1)) {
          doneKey = k; doneAt = now; last = null; run = 0;
          return { n: read.n, suf: read.suf };
        }
        return null;
      },
      reset: function () { last = null; run = 0; },
    };
  }

  return { MAX_DIGITS: MAX_DIGITS, CONSENSUS_FRAMES: CONSENSUS_FRAMES, HIGH_CONFIDENCE: HIGH_CONFIDENCE, COOLDOWN_MS: COOLDOWN_MS,
    clean: clean, extract: extract, createConsensus: createConsensus };
});
