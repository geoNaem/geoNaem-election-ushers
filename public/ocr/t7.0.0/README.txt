Vendored, pinned, self-hosted OCR engine (no CDN). Do not edit.
- tesseract.min.js, worker.min.js : tesseract.js 7.0.0 (Apache-2.0)  -> tesseract.js.LICENSE.txt
- tesseract-core-*lstm.wasm.js    : tesseract.js-core 7.0.0 (Apache-2.0) -> tesseract-core.LICENSE.txt
- lang/eng.traineddata.gz         : @tesseract.js-data/eng 1.0.0, tessdata_best_int (Apache-2.0)
Update: npm i the same packages in a scratch dir, copy the files, bump OCR_VERSION in public/sw.js.
