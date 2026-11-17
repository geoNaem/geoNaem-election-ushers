/* Pure image preprocessing on typed arrays (no DOM). UMD: browser window.OcrPre, Node require (eval harness).
   rgba -> grayscale -> contrast stretch -> Otsu threshold -> dark text on white. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OcrPre = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function toGray(rgba, w, h) {
    var g = new Uint8ClampedArray(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
    return g;
  }

  // Stretch the 2nd..98th percentile to 0..255 (helps dim light / low contrast).
  function stretch(g) {
    var hist = new Uint32Array(256), i;
    for (i = 0; i < g.length; i++) hist[g[i]]++;
    var lo = 0, hi = 255, acc = 0, cut = g.length * 0.02;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > cut) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > cut) { hi = i; break; } }
    if (hi - lo < 20) return g; // flat frame: nothing to stretch
    var scale = 255 / (hi - lo);
    for (i = 0; i < g.length; i++) g[i] = (g[i] - lo) * scale;
    return g;
  }

  function otsu(g) {
    var hist = new Uint32Array(256), i, total = g.length, sum = 0;
    for (i = 0; i < total; i++) hist[g[i]]++;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var wB = 0, sumB = 0, best = 0, thr = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      var d = sumB / wB - (sum - sumB) / wF, v = wB * wF * d * d;
      if (v > best) { best = v; thr = i; }
    }
    return thr;
  }

  // In place. Returns the binary image (0 / 255), text dark on white (inverted if the dark class is the majority).
  function binarize(g) {
    var thr = otsu(g), dark = 0, i;
    for (i = 0; i < g.length; i++) { if (g[i] > thr) g[i] = 255; else { g[i] = 0; dark++; } }
    if (dark > g.length / 2) for (i = 0; i < g.length; i++) g[i] = 255 - g[i];
    return g;
  }

  function process(rgba, w, h) { return binarize(stretch(toGray(rgba, w, h))); }

  // Source rect that is visible in a box of aspect `boxAspect` when a w x h video is shown with object-fit: cover.
  function coverCrop(vw, vh, boxAspect) {
    var va = vw / vh, cw, ch;
    if (va > boxAspect) { ch = vh; cw = vh * boxAspect; } else { cw = vw; ch = vw / boxAspect; }
    return { sx: (vw - cw) / 2, sy: (vh - ch) / 2, sw: cw, sh: ch };
  }

  return { toGray: toGray, stretch: stretch, otsu: otsu, binarize: binarize, process: process, coverCrop: coverCrop };
});
