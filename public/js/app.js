(function () {
  'use strict';
  var L = window.Lookup;
  var $ = function (id) { return document.getElementById(id); };

  var state = { index: null, blockOf: {}, cat: '', scanner: null, cur: null };

  // ---------- data: committees (from the PDF) + blocks (from admin) ----------
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage full/blocked */ } }
  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }

  function applyCommittees(data) {
    if (data && Array.isArray(data.rows)) state.index = L.buildIndex(data.rows);
  }
  function applyBlocks(data) {
    var map = {};
    if (data && Array.isArray(data.blocks)) {
      data.blocks.forEach(function (b) { b.committees.forEach(function (c) { map[c] = { name: b.name, note: b.note }; }); });
    }
    state.blockOf = map;
  }
  function setSync(ok) {
    var el = $('sync');
    el.textContent = ok ? 'محدّث' : 'غير متصل — آخر نسخة محفوظة';
    el.className = 'sync ' + (ok ? 'on' : 'off');
  }
  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function refreshBlocks() {
    return fetchJson('/api/blocks').then(function (d) { save('blocks', d); applyBlocks(d); setSync(true); })
      .catch(function () { setSync(false); });
  }
  function refreshCommittees() {
    return fetchJson('/data/committees.json').then(function (d) { save('committees', d); applyCommittees(d); }).catch(function () {});
  }

  // ---------- "people served" tracking ----------
  // A lookup is reported to the server (type + number only; the server derives the committee). It is sent when the usher moves on
  // (التالي) or after a few seconds on the result, so a corrected type/number is not counted twice. Offline lookups are queued.
  var SERVE_DELAY_MS = 4000, QKEY = 'servedQueue';
  var pending = null, flushing = false;
  function enqueueServe(n, suf) {
    var q = load(QKEY) || [];
    q.push({ n: suf === '*' ? null : n, suf: suf, t: Date.now() });
    if (q.length > 500) q.shift();
    save(QKEY, q); flushServed();
  }
  function flushServed() {
    if (flushing) return;
    var q = load(QKEY) || [];
    if (!q.length) return;
    flushing = true;
    var it = q[0];
    fetch('/api/serve', { method: 'POST', headers: { 'X-Requested-With': 'usher', 'Content-Type': 'application/json' },
      body: JSON.stringify({ n: it.n, suf: it.suf, ago: Math.max(0, Math.round((Date.now() - it.t) / 1000)) }) })
      .then(function (r) {
        flushing = false;
        if (r.ok || (r.status >= 400 && r.status < 500)) { var cur = load(QKEY) || []; cur.shift(); save(QKEY, cur); flushServed(); } // 4xx = unfixable, drop it
      }).catch(function () { flushing = false; }); // offline / server error: keep it, retry later
  }
  function schedulePending(n, suf) {
    cancelPending();
    if (suf !== '*' && !(n >= 1)) return;
    pending = { n: n, suf: suf, timer: setTimeout(flushPending, SERVE_DELAY_MS) };
  }
  function cancelPending() { if (pending) { clearTimeout(pending.timer); pending = null; } }
  function flushPending() { if (!pending) return; var p = pending; cancelPending(); enqueueServe(p.n, p.suf); }

  // ---------- result screen ----------
  function showResult(n, suf) {
    state.cur = { n: n, suf: suf };
    schedulePending(n, suf);
    var committee = state.index ? L.lookup(state.index, suf, n) : null;
    var found = committee !== null;
    var view = $('result');
    view.className = 'result ' + (found ? 'ok' : 'bad');
    $('resPill').textContent = found ? 'موجود' : 'غير موجود';
    $('resNum').textContent = found ? String(committee) : '؟';
    $('resTitle').textContent = found ? 'رقم اللجنة' : 'الرقم غير موجود في الكشف';

    var isForeign = suf === '*';
    $('resMember').textContent = isForeign ? '—' : String(n);
    renderChips($('resCats'), suf, function (s) { showResult(n, s); });

    var blockRow = $('blockRow');
    blockRow.hidden = !found;
    if (found) {
      var b = state.blockOf[committee];
      $('resBlock').textContent = b ? b.name : 'لم يُحدَّد المكان بعد';
      $('resBlock').className = b ? 'val' : 'val muted';
      $('resBlockNote').textContent = b && b.note ? b.note : '';
      $('resBlockNote').hidden = !(b && b.note);
    }
    $('resHelp').hidden = found;

    $('home').hidden = true; $('top').hidden = true;
    view.hidden = false;
    $('nextBtn').focus();
    if (navigator.vibrate) navigator.vibrate(found ? 60 : [80, 60, 80]);
  }
  function backToHome() {
    flushPending();
    $('result').hidden = true;
    $('home').hidden = false; $('top').hidden = false;
    $('num').value = '';
    setCat('');
  }

  // ---------- manual entry ----------
  // chips: one builder for the main form and the result screen
  function renderChips(box, current, onPick) {
    box.textContent = '';
    L.CATEGORIES.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = c[1]; b.dataset.s = c[0];
      b.setAttribute('aria-pressed', c[0] === current ? 'true' : 'false');
      b.addEventListener('click', function () { onPick(c[0]); });
      box.appendChild(b);
    });
  }
  function setCat(c) { state.cat = c; renderChips($('cats'), c, setCat); }
  function buildChips() { setCat(''); }
  function onSubmit(e) {
    e.preventDefault();
    var digits = L.norm($('num').value).replace(/\D/g, '');
    if (!digits && state.cat !== '*') { $('num').focus(); return; }
    showResult(parseInt(digits || '0', 10), state.cat);
  }

  // ---------- number scanner (on-device OCR; see scanner.js) ----------
  // The scan button reads the number once and fills the manual box; the usher can edit it, then taps "اعرف اللجنة".
  function onResult(r, raw) {
    var msg = $('ocrMsg');
    if (!r) {
      msg.className = 'ocr-msg error';
      msg.textContent = 'لم أتعرّف على رقم — قرّب الكارت وثبّت الكاميرا ثم أعد المحاولة' + (raw ? ' (قرأتُ: ' + raw.slice(0, 40) + ')' : '');
      msg.hidden = false;
      return;
    }
    msg.hidden = true;
    $('num').value = String(r.n);
    setCat(r.suf || '');
    $('num').focus(); $('num').select();
    if (navigator.vibrate) navigator.vibrate(40);
  }
  function setBusy(b) {
    var btn = $('scanBtn');
    btn.disabled = b; btn.textContent = b ? 'جارٍ القراءة…' : 'امسح الرقم';
  }
  function onStatus(kind, text) {
    var hint = $('readerHint'), msg = $('ocrMsg');
    var inFrame = kind === 'loading' || kind === 'camera';
    hint.hidden = !inFrame; hint.textContent = inFrame ? text : '';
    msg.hidden = inFrame || !text; msg.textContent = inFrame ? '' : text;
    msg.className = 'ocr-msg ' + kind;
  }
  function editNumber() {
    cancelPending();
    var c = state.cur;
    $('result').hidden = true; $('home').hidden = false; $('top').hidden = false;
    $('num').value = c && c.n ? String(c.n) : '';
    setCat(c ? c.suf : '');
    $('num').focus(); $('num').select();
  }
  function startScan() {
    if (!window.Scanner || !window.OcrParse) return;
    state.scanner = window.Scanner({ video: $('reader'), boxEl: document.querySelector('.scan-frame'), onResult: onResult, onBusy: setBusy, onStatus: onStatus,
      onTorch: function (ok) { $('torchBtn').hidden = !ok; } });
    state.scanner.start();
  }

  // ---------- boot ----------
  function boot() {
    buildChips();
    $('lookupForm').addEventListener('submit', onSubmit);
    $('nextBtn').addEventListener('click', backToHome);
    $('editBtn').addEventListener('click', editNumber);
    $('scanBtn').addEventListener('click', function () { if (state.scanner) state.scanner.scan(); });
    $('torchBtn').addEventListener('click', function () {
      state.scanner.toggleTorch().then(function (on) { $('torchBtn').setAttribute('aria-pressed', on ? 'true' : 'false'); });
    });
    document.querySelector('.scan-frame').addEventListener('click', function () { if (state.scanner) state.scanner.focusTap(); });
    // instant start from cache, then refresh from the network
    applyCommittees(load('committees')); applyBlocks(load('blocks'));
    refreshCommittees(); refreshBlocks();
    setInterval(refreshBlocks, 30000);
    window.addEventListener('online', function () { refreshBlocks(); flushServed(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) flushPending(); else flushServed(); });
    window.addEventListener('pagehide', flushPending);
    setInterval(flushServed, 20000);
    flushServed();
    window.addEventListener('offline', function () { setSync(false); });
    // load the OCR engine only after first paint
    var started = false, go = function () { if (!started) { started = true; startScan(); } };
    if (window.requestAnimationFrame) window.requestAnimationFrame(function () { setTimeout(go, 0); });
    setTimeout(go, 600); // fallback: rAF never fires in a background tab
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
