'use strict';
// Accuracy harness: same preprocessing + OCR + parse as the browser, over tests/fixtures/cards/*.{jpg,jpeg,png}.
// Label = file name: "2367.jpg", "822_ع.png", "2367-2.jpg" (anything after "-" is ignored). Each photo should be framed like the
// usher viewfinder (the centre 3:1 strip is used). Dev-only; never runs on the server.
const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('tesseract.js');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const Pre = require('../public/js/ocr-preprocess.js');
const P = require('../public/js/ocr-parse.js');

const dir = path.join(__dirname, '..', 'tests', 'fixtures', 'cards');
const W = 640, H = 213;
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f)).sort() : [];
if (!files.length) { console.log('No images in tests/fixtures/cards/ -> accuracy UNVERIFIED (0 samples).'); process.exit(0); }

function decode(file) {
  const buf = fs.readFileSync(path.join(dir, file));
  return /\.png$/i.test(file) ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true });
}
function cropResize(img) {
  const c = Pre.coverCrop(img.width, img.height, W / H), out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(img.width - 1, Math.floor(c.sx + (x + 0.5) * c.sw / W)), sy = Math.min(img.height - 1, Math.floor(c.sy + (y + 0.5) * c.sh / H));
    const s = (sy * img.width + sx) * 4, d = (y * W + x) * 4;
    out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = 255;
  }
  return out;
}
(async () => {
  const worker = await createWorker('eng', 1, { langPath: path.join(__dirname, '..', 'public', 'ocr', 't7.0.0', 'lang'), gzip: true, cacheMethod: 'none' });
  await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
  let ok = 0; const fails = []; const times = [];
  for (const f of files) {
    const [numPart, sufPart = ''] = path.basename(f, path.extname(f)).split('-')[0].split('_');
    const want = { n: parseInt(numPart, 10), suf: sufPart };
    const rgba = cropResize(decode(f)), bin = Pre.process(rgba, W, H);
    const out = Buffer.alloc(W * H * 4);
    for (let i = 0; i < bin.length; i++) out.fill(bin[i], i * 4, i * 4 + 3), out[i * 4 + 3] = 255;
    const png = PNG.sync.write({ width: W, height: H, data: out });
    const t = Date.now(); const r = await worker.recognize(png); times.push(Date.now() - t);
    const got = P.extract(r.data.text);
    const good = got && got.n === want.n && (got.suf === want.suf || (want.suf === '' && got.suf === ''));
    if (good) ok++; else fails.push(`${f}: wanted ${want.n}${want.suf} got ${got ? got.n + got.suf : 'nothing'} (raw "${r.data.text.trim()}", conf ${Math.round(r.data.confidence)})`);
  }
  await worker.terminate();
  const rate = ok / files.length;
  console.log(`exact match ${ok}/${files.length} = ${(rate * 100).toFixed(1)}%  avg ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} ms/frame`);
  fails.forEach(l => console.log('FAIL', l));
  console.log(files.length < 20 ? `UNVERIFIED: only ${files.length} samples (need >= 20)` : rate >= 0.95 ? 'PASS (>= 95%)' : 'BELOW 95% TARGET');
})();
