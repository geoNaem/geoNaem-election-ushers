/* Camera + on-device OCR. Frames and recognised text never leave the browser: no fetch/upload, no storage, no logging.
   Tesseract.js runs in its own Web Worker (UI never blocks); the engine is loaded lazily after first paint. */
(function () {
  'use strict';
  var P = window.OcrParse, Pre = window.OcrPre;
  var OCR_DIR = '/ocr/t7.0.0/';
  var OUT_W = 640, OUT_H = 213;       // viewfinder aspect 3:1, upscaled/downscaled to a size Tesseract likes
  var LOOP_MS = 250;                  // pause between frames => ~3-4 reads/s when the device keeps up
  var SLOW_MS = 2500;                 // average recognise time above this => warn the usher

  window.Scanner = function (o) {
    // o: { video, boxEl, onRead(read), onStatus(kind, text), onTorch(supported) }
    var s = { stream: null, worker: null, canvas: document.createElement('canvas'), paused: true, running: false, loop: 0,
      consensus: P.createConsensus(), times: [], torchOn: false, track: null, loading: null, failed: false };
    s.canvas.width = OUT_W; s.canvas.height = OUT_H;
    var ctx = s.canvas.getContext('2d', { willReadFrequently: true });

    function status(kind, text) { o.onStatus(kind, text || ''); }

    function loadScript(src) {
      return new Promise(function (res, rej) {
        var el = document.createElement('script');
        el.src = src; el.onload = res; el.onerror = function () { rej(new Error('load ' + src)); };
        document.head.appendChild(el);
      });
    }
    function loadEngine() {
      if (s.loading) return s.loading;
      status('loading', 'جارٍ تجهيز القارئ…');
      s.loading = loadScript(OCR_DIR + 'tesseract.min.js').then(function () {
        return window.Tesseract.createWorker('eng', 1, {
          workerPath: OCR_DIR + 'worker.min.js', corePath: OCR_DIR, langPath: OCR_DIR + 'lang', gzip: true,
          workerBlobURL: false, cacheMethod: 'none', // the service worker caches these files
        });
      }).then(function (w) {
        return w.setParameters({
          tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7', // single text line
          user_defined_dpi: '300',
        }).then(function () { s.worker = w; status('ready', ''); });
      }).catch(function () { s.failed = true; status('error', 'تعذّر تشغيل قارئ الأرقام — اكتب الرقم أدناه'); });
      return s.loading;
    }

    function startCamera() {
      if (s.stream) return Promise.resolve();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { status('camera', 'الكاميرا غير متاحة'); return Promise.reject(); }
      return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
        .then(function (st) {
          s.stream = st; o.video.srcObject = st;
          s.track = st.getVideoTracks()[0];
          var caps = (s.track.getCapabilities && s.track.getCapabilities()) || {};
          o.onTorch(!!caps.torch);
          if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) s.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
          return o.video.play();
        }).catch(function (e) { status('camera', 'تعذّر تشغيل الكاميرا — اسمح بالوصول للكاميرا أو اكتب الرقم أدناه'); throw e; });
    }
    function stopCamera() {
      if (s.stream) s.stream.getTracks().forEach(function (t) { t.stop(); });
      s.stream = null; s.track = null; s.torchOn = false; o.video.srcObject = null;
    }

    function grab() {
      var v = o.video;
      if (!v.videoWidth || v.readyState < 2) return null;
      var box = o.boxEl.getBoundingClientRect();
      var c = Pre.coverCrop(v.videoWidth, v.videoHeight, box.width / box.height);
      ctx.drawImage(v, c.sx, c.sy, c.sw, c.sh, 0, 0, OUT_W, OUT_H);
      var img = ctx.getImageData(0, 0, OUT_W, OUT_H);
      var bin = Pre.process(img.data, OUT_W, OUT_H);
      for (var i = 0, j = 0; i < bin.length; i++, j += 4) { img.data[j] = img.data[j + 1] = img.data[j + 2] = bin[i]; img.data[j + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      return s.canvas;
    }

    function tick() {
      s.loop = 0;
      if (s.paused || document.hidden || !s.worker) return;
      var cv = grab();
      if (!cv) { s.loop = setTimeout(tick, LOOP_MS); return; }
      var t0 = performance.now();
      s.worker.recognize(cv).then(function (r) {
        s.times.push(performance.now() - t0); if (s.times.length > 8) s.times.shift();
        if (s.times.length >= 4) {
          var avg = s.times.reduce(function (a, b) { return a + b; }, 0) / s.times.length;
          status(avg > SLOW_MS ? 'slow' : 'ready', avg > SLOW_MS ? 'القارئ بطيء على هذا الجهاز — يمكنك كتابة الرقم أدناه' : '');
        }
        if (s.paused) return;
        var read = P.extract(r.data.text);
        var ok = s.consensus.push(read, r.data.confidence);
        if (ok) { o.onRead(ok); return; }
      }).catch(function () {}).then(function () {
        if (!s.paused && !s.loop) s.loop = setTimeout(tick, LOOP_MS);
      });
    }

    function onVis() {
      if (document.hidden) { api.pause(); stopCamera(); }
      else if (s.running && !s.resumeBlocked) { api.resume(); }
    }
    document.addEventListener('visibilitychange', onVis);

    var api = {
      start: function () {
        s.running = true;
        startCamera().then(function () { return loadEngine(); }).then(function () { if (!s.failed) api.resume(); }).catch(function () {});
      },
      pause: function () { s.paused = true; clearTimeout(s.loop); s.loop = 0; s.consensus.reset(); },
      resume: function () {
        s.resumeBlocked = false; s.consensus.reset();
        startCamera().then(function () { if (s.worker) { s.paused = false; if (!s.loop) s.loop = setTimeout(tick, LOOP_MS); } }).catch(function () {});
      },
      hold: function () { s.resumeBlocked = true; api.pause(); }, // a result is on screen
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
    return api;
  };
})();
