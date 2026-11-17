/* Camera + on-device OCR, triggered by the usher's "scan" button (no continuous auto-scan).
   Reads Western (0-9, Tesseract) and Arabic-Indic (٠-٩, ar-digits.js) digits. Frames and recognised text never leave the browser: no fetch/upload, no storage, no logging.
   Tesseract.js runs in its own Web Worker (UI never blocks); the engine is loaded lazily after first paint.
   REAR camera only: the front camera is never used. */
(function () {
  'use strict';
  var P = window.OcrParse, Pre = window.OcrPre;
  var OCR_DIR = '/ocr/t7.0.0/';
  var OUT_W = 960, OUT_H = 320;       // viewfinder aspect 3:1; a single high-quality read is worth the extra pixels
  var ATTEMPTS = 4;                   // frames per button press (different preprocessing), best read wins
  var RES = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  var FRONT = /front|user|facetime|selfie|أمام/i;
  var BACK = /back|rear|environment|خلف/i;
  var NOT_MAIN = /ultra|wide|tele|macro|depth/i;

  window.Scanner = function (o) {
    // o: { video, boxEl, onStatus(kind, text), onTorch(supported), onBusy(bool), onResult(read|null, rawText) }
    var s = { stream: null, worker: null, canvas: document.createElement('canvas'), torchOn: false, track: null,
      loading: null, failed: false, busy: false, workers: [] };
    s.canvas.width = OUT_W; s.canvas.height = OUT_H;
    var ctx = s.canvas.getContext('2d', { willReadFrequently: true });
    function status(kind, text) { o.onStatus(kind, text || ''); }

    // ---------- OCR engine (lazy) ----------
    function loadScript(src) {
      return new Promise(function (res, rej) {
        var el = document.createElement('script');
        el.src = src; el.onload = res; el.onerror = function () { rej(new Error('load ' + src)); };
        document.head.appendChild(el);
      });
    }
    // Western digits (0-9): Tesseract `eng`, digits-only whitelist. Arabic-Indic digits (٠-٩): Tesseract's `ara` model cannot read
    // them, so ar-digits.js (a tiny on-device classifier) reads them from the same binarised strip. Both run on-device.
    function loadArModel() {
      return fetch('/js/ar-digits-model.json').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) { if (m && window.ArDigits) window.ArDigits.setModel(m); }).catch(function () {});
    }
    function loadEngine() {
      if (s.loading) return s.loading;
      status('loading', 'جارٍ تجهيز القارئ…');
      s.loading = Promise.all([loadArModel(), loadScript(OCR_DIR + 'tesseract.min.js').then(function () {
        return window.Tesseract.createWorker('eng', 1, {
          workerPath: OCR_DIR + 'worker.min.js', corePath: OCR_DIR, langPath: OCR_DIR + 'lang', gzip: true,
          workerBlobURL: false, cacheMethod: 'none', // the service worker caches these files
        });
      }).then(function (w) {
        return w.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7', user_defined_dpi: '300' })
          .then(function () { s.workers = [w]; });
      })]).then(function () { status('ready', ''); })
        .catch(function () { s.failed = true; status('error', 'تعذّر تشغيل قارئ الأرقام — اكتب الرقم أدناه'); });
      return s.loading;
    }

    // ---------- camera: rear only ----------
    function gum(video) { return navigator.mediaDevices.getUserMedia({ audio: false, video: video }); }
    function settings(st) { return st.getVideoTracks()[0].getSettings() || {}; }
    function isFront(st) { var t = st.getVideoTracks()[0]; return settings(st).facingMode === 'user' || FRONT.test(t.label || ''); }
    function stop(st) { st.getTracks().forEach(function (t) { t.stop(); }); }

    function openBackCamera() {
      return gum(Object.assign({ facingMode: { exact: 'environment' } }, RES))
        .catch(function () { return gum(Object.assign({ facingMode: { ideal: 'environment' } }, RES)); })
        .then(function (st) {
          var facing = settings(st).facingMode;
          if (facing === 'environment' || (!facing && !isFront(st))) return st;
          // wrong/unknown camera: labels are readable now -> choose a rear camera by name (main lens first)
          return navigator.mediaDevices.enumerateDevices().then(function (list) {
            var cams = list.filter(function (d) { return d.kind === 'videoinput' && BACK.test(d.label) && !FRONT.test(d.label); });
            var pick = cams.filter(function (d) { return !NOT_MAIN.test(d.label); })[0] || cams[0];
            stop(st);
            if (!pick) throw new Error('no rear camera');
            return gum(Object.assign({ deviceId: { exact: pick.deviceId } }, RES)).then(function (st2) {
              if (isFront(st2)) { stop(st2); throw new Error('front camera'); }
              return st2;
            });
          });
        });
    }
    function startCamera() {
      if (s.stream) return Promise.resolve();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status('camera', 'الكاميرا غير متاحة'); return Promise.reject(); }
      return openBackCamera().then(function (st) {
        s.stream = st; o.video.srcObject = st; s.track = st.getVideoTracks()[0];
        var caps = (s.track.getCapabilities && s.track.getCapabilities()) || {};
        o.onTorch(!!caps.torch);
        if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) s.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
        return o.video.play();
      }).catch(function (e) {
        status('camera', e && /rear|front/.test(e.message || '') ? 'لم يتم العثور على الكاميرا الخلفية — اكتب الرقم أدناه' : 'تعذّر تشغيل الكاميرا — اسمح بالوصول للكاميرا أو اكتب الرقم أدناه');
        throw e;
      });
    }
    function stopCamera() {
      if (s.stream) stop(s.stream);
      s.stream = null; s.track = null; s.torchOn = false; o.video.srcObject = null;
    }

    // ---------- one button press = a few frames, best read wins ----------
    // variant 0/2: Otsu black-on-white; 1: contrast-stretched grayscale (Tesseract binarises it itself); 3: Otsu on a tighter centre crop
    function grab(variant) {
      var v = o.video;
      if (!v.videoWidth || v.readyState < 2) return null;
      var box = o.boxEl.getBoundingClientRect();
      var c = Pre.coverCrop(v.videoWidth, v.videoHeight, box.width / box.height);
      if (variant === 3) { var k = 0.7; c = { sx: c.sx + c.sw * (1 - k) / 2, sy: c.sy + c.sh * (1 - k) / 2, sw: c.sw * k, sh: c.sh * k }; }
      ctx.drawImage(v, c.sx, c.sy, c.sw, c.sh, 0, 0, OUT_W, OUT_H);
      var img = ctx.getImageData(0, 0, OUT_W, OUT_H);
      var px = variant === 1 ? Pre.stretch(Pre.toGray(img.data, OUT_W, OUT_H)) : Pre.process(img.data, OUT_W, OUT_H);
      for (var i = 0, j = 0; i < px.length; i++, j += 4) { img.data[j] = img.data[j + 1] = img.data[j + 2] = px[i]; img.data[j + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      return s.canvas;
    }
    function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function scanOnce() {
      if (s.busy) return;
      if (s.failed) { status('error', 'تعذّر تشغيل قارئ الأرقام — اكتب الرقم أدناه'); return; }
      s.busy = true; o.onBusy(true);
      var ready = s.workers.length ? Promise.resolve() : loadEngine();
      ready.then(function () {
        if (!s.workers.length) return;
        status('reading', 'جارٍ القراءة…');
        var votes = {}, raws = [], seq = Promise.resolve();
        for (var a = 0; a < ATTEMPTS; a++) (function (a) {
          seq = seq.then(function () {
            var cv = grab(a % 4);
            if (!cv) return pause(150);
            function vote(read, conf) {
              var k = read.n + '|' + read.suf, v = votes[k] || (votes[k] = { read: read, count: 0, conf: 0 });
              v.count++; v.conf = Math.max(v.conf, conf);
            }
            // Arabic-Indic digits first (cheap, needs a binary frame); if the strip is clearly Arabic-Indic, Tesseract `eng` would only
            // produce garbage on it, so skip it for this frame.
            if (a % 4 !== 1 && window.ArDigits) {
              var px = ctx.getImageData(0, 0, OUT_W, OUT_H).data, bin = new Uint8Array(OUT_W * OUT_H);
              for (var i = 0, j = 0; i < bin.length; i++, j += 4) bin[i] = px[j];
              var ar = window.ArDigits.read(bin, OUT_W, OUT_H);
              if (ar.script === 'arabic') {
                raws.push(ar.digits);
                var arRead = P.extract(ar.digits);
                if (arRead) vote(arRead, ar.conf * 100);
                return pause(60);
              }
            }
            return Promise.all(s.workers.map(function (w) { return w.recognize(cv).catch(function () { return null; }); })).then(function (rs) {
              rs.forEach(function (r) {
                if (!r) return;
                var txt = (r.data.text || '').trim(); if (txt) raws.push(txt);
                var read = P.extract(txt);
                if (read) vote(read, r.data.confidence);
              });
            }).then(function () { return pause(120); });
          });
        })(a);
        return seq.then(function () {
          var best = null;
          Object.keys(votes).forEach(function (k) { var v = votes[k]; if (!best || v.count > best.count || (v.count === best.count && (v.conf > best.conf || (v.conf === best.conf && String(v.read.n).length > String(best.read.n).length)))) best = v; });
          status('ready', '');
          o.onResult(best ? { n: best.read.n, suf: best.read.suf } : null, raws.join(' | '));
        });
      }).catch(function () { status('error', 'تعذّرت القراءة — اكتب الرقم أدناه'); })
        .then(function () { s.busy = false; o.onBusy(false); });
    }

    document.addEventListener('visibilitychange', function () { if (document.hidden) stopCamera(); else if (s.started) startCamera().catch(function () {}); });

    return {
      start: function () { s.started = true; startCamera().catch(function () {}); loadEngine(); },
      scan: scanOnce,
      toggleTorch: function () {
        if (!s.track) return Promise.resolve(false);
        var want = !s.torchOn;
        return s.track.applyConstraints({ advanced: [{ torch: want }] }).then(function () { s.torchOn = want; return want; }, function () { return s.torchOn; });
      },
      focusTap: function () {
        if (!s.track || !s.track.getCapabilities) return;
        var caps = s.track.getCapabilities();
        if (caps.focusMode && caps.focusMode.indexOf('single-shot') >= 0) s.track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] }).catch(function () {});
      },
    };
  };
})();
