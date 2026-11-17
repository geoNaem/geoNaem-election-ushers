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

  // ---------- result screen ----------
  function showResult(n, suf) {
    state.cur = { n: n, suf: suf };
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

    $('home').hidden = true;
    view.hidden = false;
    $('nextBtn').focus();
    if (navigator.vibrate) navigator.vibrate(found ? 60 : [80, 60, 80]);
  }
  function backToHome() {
    $('result').hidden = true;
    $('home').hidden = false;
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
    var c = state.cur;
    $('result').hidden = true; $('home').hidden = false;
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
    window.addEventListener('online', refreshBlocks);
    window.addEventListener('offline', function () { setSync(false); });
    // load the OCR engine only after first paint
    (window.requestAnimationFrame || setTimeout)(function () { setTimeout(startScan, 0); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
