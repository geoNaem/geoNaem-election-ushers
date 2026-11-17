/* Arabic-Indic digit reader (٠-٩ / ۰-۹) for printed numbers. Tesseract's `ara` model cannot read isolated digits, so this is a
   tiny on-device classifier: connected components -> normalised glyph bitmap -> 1-hidden-layer network (ar-digits-model.json,
   trained by scripts/train_ar_digits.py on synthetic renders in many fonts). Pure logic, no DOM. UMD: window.ArDigits / require.
   Input: binary image (Uint8 0 = ink / 255 = paper, ink = dark text, e.g. from OcrPre.process). Never touches the network. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArDigits = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_REL_H = 0.12;       // components shorter than this fraction of the tallest are specks (a real dot ٠ is taller)
  var MIN_AREA = 12;
  var MIN_P = 0.7;            // a glyph counts as a digit only at this softmax probability
  var model = null;

  function setModel(m) { model = m; }

  // 8-connected components of ink pixels (value 0). Returns [{x0,y0,x1,y1,area,labels?}] plus the label map.
  function components(img, w, h) {
    var lab = new Int32Array(w * h), comps = [], stack = [], n = 0, i, x, y;
    for (i = 0; i < w * h; i++) {
      if (img[i] !== 0 || lab[i]) continue;
      n++; var c = { id: n, x0: w, y0: h, x1: -1, y1: -1, area: 0 };
      stack.push(i); lab[i] = n;
      while (stack.length) {
        var p = stack.pop(); x = p % w; y = (p / w) | 0; c.area++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var q = ny * w + nx;
          if (img[q] === 0 && !lab[q]) { lab[q] = n; stack.push(q); }
        }
      }
      comps.push(c);
    }
    return { comps: comps, lab: lab };
  }

  // Box-filter resize of a tight glyph mask (identical formula to scripts/train_ar_digits.py)
  function boxResize(mask, h, w, th, tw) {
    var ii = new Float64Array((h + 1) * (w + 1)), y, x;
    for (y = 0; y < h; y++) { var row = 0; for (x = 0; x < w; x++) { row += mask[y * w + x]; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row; } }
    var out = new Float32Array(th * tw);
    for (var i = 0; i < th; i++) {
      var r0 = Math.floor(i * h / th), r1 = Math.max(r0 + 1, Math.ceil((i + 1) * h / th));
      for (var j = 0; j < tw; j++) {
        var c0 = Math.floor(j * w / tw), c1 = Math.max(c0 + 1, Math.ceil((j + 1) * w / tw));
        out[i * tw + j] = (ii[r1 * (w + 1) + c1] - ii[r0 * (w + 1) + c1] - ii[r1 * (w + 1) + c0] + ii[r0 * (w + 1) + c0]) / ((r1 - r0) * (c1 - c0));
      }
    }
    return out;
  }

  function glyphFeatures(c, lab, w, href, lineTop) {
    var gw = c.x1 - c.x0 + 1, gh = c.y1 - c.y0 + 1, mask = new Float32Array(gw * gh);
    for (var y = 0; y < gh; y++) for (var x = 0; x < gw; x++) mask[y * gw + x] = lab[(c.y0 + y) * w + c.x0 + x] === c.id ? 1 : 0;
    var bmp = boxResize(mask, gh, gw, model.gh, model.gw), cy = c.y0 + gh / 2;
    var f = new Float32Array(model.gh * model.gw + 4);
    f.set(bmp);
    var k = model.gh * model.gw;
    f[k] = Math.min(gw / gh, 3) / 3;
    f[k + 1] = Math.min(gh / href, 1);
    f[k + 2] = Math.min(gw / href, 1.5);
    f[k + 3] = Math.min(Math.max((cy - lineTop) / href, 0), 1.5) / 1.5;
    return f;
  }

  function classify(f) {
    var H = model.hid, C = model.classes, d = f.length, h = new Float32Array(H), z = new Float32Array(C), i, j;
    for (j = 0; j < H; j++) h[j] = model.b1[j];
    for (i = 0; i < d; i++) { var v = f[i]; if (!v) continue; var row = model.W1[i]; for (j = 0; j < H; j++) h[j] += v * row[j]; }
    for (j = 0; j < H; j++) if (h[j] < 0) h[j] = 0;
    for (j = 0; j < C; j++) z[j] = model.b2[j];
    for (i = 0; i < H; i++) { var hv = h[i]; if (!hv) continue; var r2 = model.W2[i]; for (j = 0; j < C; j++) z[j] += hv * r2[j]; }
    var m = -Infinity; for (j = 0; j < C; j++) if (z[j] > m) m = z[j];
    var s = 0; for (j = 0; j < C; j++) { z[j] = Math.exp(z[j] - m); s += z[j]; }
    var best = 0; for (j = 0; j < C; j++) { z[j] /= s; if (z[j] > z[best]) best = j; }
    return { cls: best, p: z[best] };
  }

  /* read(img, w, h) -> { script: 'arabic'|'other', digits: '2367', conf, glyphs: n }.
     script = 'arabic' only when the line is mostly confident Arabic-Indic digit glyphs (>= 2 of them, and they outnumber everything
     else by 2:1; one non-digit glyph is tolerated for a printed suffix letter). Western-digit lines classify as 'other'. */
  function read(img, w, h) {
    if (!model) return { script: 'other', digits: '', conf: 0, glyphs: 0 };
    var cc = components(img, w, h), comps = cc.comps, hmax = 0, i;
    comps.forEach(function (c) { c.h = c.y1 - c.y0 + 1; c.w = c.x1 - c.x0 + 1; if (c.h > hmax) hmax = c.h; });
    // glyphs touching the frame edge are card borders / crops, not digits
    comps = comps.filter(function (c) { return c.area >= MIN_AREA && c.h >= MIN_REL_H * hmax && c.x0 > 0 && c.y0 > 0 && c.x1 < w - 1 && c.y1 < h - 1; });
    if (!comps.length) return { script: 'other', digits: '', conf: 0, glyphs: 0 };
    var href = 0, top = h; comps.forEach(function (c) { if (c.h > href) href = c.h; if (c.y0 < top) top = c.y0; });
    comps.sort(function (a, b) { return a.x0 - b.x0; }); // digits of a number run left to right
    var digits = '', pSum = 0, nDig = 0, nOther = 0;
    for (i = 0; i < comps.length; i++) {
      var r = classify(glyphFeatures(comps[i], cc.lab, w, href, top));
      if (r.cls < 10 && r.p >= MIN_P) { digits += String(r.cls); pSum += r.p; nDig++; } else nOther++;
    }
    var isAr = nDig >= 2 && nDig >= 2 * nOther;
    return { script: isAr ? 'arabic' : 'other', digits: isAr ? digits : '', conf: nDig ? pSum / nDig : 0, glyphs: comps.length };
  }

  return { setModel: setModel, read: read, components: components, boxResize: boxResize, classify: classify };
});
