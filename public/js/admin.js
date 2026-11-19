(function () {
  'use strict';
  var MAX = 100;
  var SIDES = { right: 'الجانب الأيمن', left: 'الجانب الأيسر' };   // fixed names: also what ushers see as the committee's place
  var $ = function (id) { return document.getElementById(id); };
  var state = { sides: { right: { note: '', committees: [] }, left: { note: '', committees: [] } }, dirty: false, legacy: false, tab: 'places', timer: 0 };

  function el(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') e.className = props[k]; else if (k === 'text') e.textContent = props[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), props[k]); else e.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function api(method, url, body) {
    var opts = { method: method, headers: { 'X-Requested-With': 'admin' }, credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || r.status); e.status = r.status; throw e; } return j; });
    });
  }

  // ================= PLACES (left / right) =================
  function sideOf(c) { if (state.sides.left.committees.indexOf(c) >= 0) return 'left'; if (state.sides.right.committees.indexOf(c) >= 0) return 'right'; return null; }
  function assign(c, side) {
    ['left', 'right'].forEach(function (k) { state.sides[k].committees = state.sides[k].committees.filter(function (x) { return x !== c; }); });
    if (side) state.sides[side].committees.push(c);
  }
  function markDirty() { state.dirty = true; setSave('dirty', 'تعديلات غير محفوظة'); }
  function setSave(cls, text) { var s = $('saveState'); s.className = 'save-state ' + cls; s.textContent = text; }
  function parseRanges(text) {
    var out = [];
    String(text).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).split(/[,،\s]+/).forEach(function (part) {
      var m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return;
      var a = +m[1], b = m[2] ? +m[2] : a; if (a > b) { var t = a; a = b; b = t; }
      for (var n = a; n <= b && n <= MAX; n++) if (n >= 1) out.push(n);
    });
    return out;
  }

  function renderPlaces() {
    var l = state.sides.left.committees.length, r = state.sides.right.committees.length;
    $('cntRight').textContent = r + ' لجنة'; $('cntLeft').textContent = l + ' لجنة';
    $('summary').textContent = state.tab === 'places'
      ? 'يمين: ' + r + ' · يسار: ' + l + ' · غير موزعة: ' + (MAX - l - r) + (state.legacy ? ' · تنبيه: توجد إعدادات قديمة (بلوكات) وسيتم استبدالها عند الحفظ' : '')
      : 'متابعة من تمت خدمتهم';
    var g = $('grid'); g.textContent = '';
    for (var n = 1; n <= MAX; n++) (function (n) {
      var s = sideOf(n);
      var label = 'لجنة ' + n + (s ? ' على ' + SIDES[s] : ' غير موزعة');
      var b = el('button', { type: 'button', class: 'chip ' + (s === 'left' ? 'cl' : s === 'right' ? 'cr' : 'un'), 'aria-label': label,
        onclick: function () { assign(n, s === null ? 'left' : s === 'left' ? 'right' : null); markDirty(); renderPlaces(); } }, [el('span', { text: String(n) })]);
      if (s) b.appendChild(el('small', { text: s === 'left' ? 'س' : 'ي' }));
      g.appendChild(b);
    })(n);
  }

  function save() {
    setSave('', 'جارٍ الحفظ…');
    var blocks = ['left', 'right'].map(function (k) { return { name: SIDES[k], note: state.sides[k].note.trim(), committees: state.sides[k].committees.slice().sort(function (a, b) { return a - b; }) }; });
    api('PUT', '/api/admin/blocks', { blocks: blocks })
      .then(function (r) { load(r); state.dirty = false; setSave('ok', 'تم الحفظ'); renderPlaces(); })
      .catch(function (e) { if (e.status === 401) showLogin(); else setSave('bad', 'تعذّر الحفظ: ' + e.message); });
  }
  // Server blocks -> the two fixed sides. Anything else (blocks from the old design) is ignored and replaced on the next save.
  function load(data) {
    var matched = 0;
    ['left', 'right'].forEach(function (k) {
      var b = (data.blocks || []).filter(function (x) { return x.name === SIDES[k]; })[0];
      state.sides[k] = b ? { note: b.note || '', committees: b.committees.slice() } : { note: '', committees: [] };
      if (b) matched++;
    });
    state.legacy = (data.blocks || []).length > matched;
    $('noteRight').value = state.sides.right.note; $('noteLeft').value = state.sides.left.note;
  }

  // ================= TRACKING =================
  var timeFmt = null;
  var fmtTime = function (iso) {   // Cairo time, Latin digits, e.g. 19/11/2026 23:15:29
    try {
      timeFmt = timeFmt || new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      return timeFmt.format(new Date(iso)).replace(',', '');
    } catch (e) { return String(iso); }
  };
  var fmtInt = function (n) { return Number(n).toLocaleString('en-US'); };
  function pct(a, b) { return b ? (a * 100 / b) : 0; }
  function fmtPct(p) { return (p === 0 ? '0' : p < 0.01 ? p.toFixed(4) : p < 1 ? p.toFixed(2) : p.toFixed(1)) + '%'; }

  function renderTrack(d) {
    $('stServed').textContent = fmtInt(d.served); $('stTotal').textContent = fmtInt(d.totalIds);
    $('stPct').textContent = fmtPct(d.percent); $('stNotFound').textContent = fmtInt(d.notFound); $('stForeign').textContent = fmtInt(d.foreign);
    $('stBar').style.width = Math.min(100, d.percent) + '%';
    document.querySelector('.bar-track').setAttribute('aria-valuenow', String(Math.round(d.percent * 10) / 10));
    var tb = document.querySelector('#typeTbl tbody'); tb.textContent = '';
    d.bySuffix.forEach(function (x) {
      tb.appendChild(el('tr', {}, [el('td', { text: x.label }), el('td', { class: 'num', text: fmtInt(x.served) }), el('td', { class: 'num', text: fmtInt(x.total) }), el('td', { class: 'num', text: fmtPct(pct(x.served, x.total)) })]));
    });
    var eb = document.querySelector('#entriesTbl tbody'); eb.textContent = '';
    d.entries.forEach(function (e, i) {
      var tr = el('tr', { class: e.committee === null ? 'nf' : '' }, [
        el('td', { class: 'num', text: String(d.entriesTotal - i) }), el('td', { class: 'num', dir: 'ltr', text: fmtTime(e.at) }),
        el('td', { class: 'num', text: e.suf === '*' ? '—' : String(e.n) }), el('td', { text: e.label }),
        el('td', { class: 'num', text: e.committee === null ? 'غير موجود' : String(e.committee) })]);
      eb.appendChild(tr);
    });
    $('noEntries').hidden = d.entries.length > 0;
    $('entriesNote').textContent = d.entriesTotal > d.entries.length ? '— آخر ' + d.entries.length + ' من ' + fmtInt(d.entriesTotal) + ' إدخال' : '— ' + fmtInt(d.entriesTotal) + ' إدخال';
    state.entriesTotal = d.entriesTotal;
  }
  function refreshTrack() {
    $('trackState').className = 'save-state'; $('trackState').textContent = 'جارٍ التحديث…';
    return api('GET', '/api/admin/served?limit=200').then(function (d) {
      renderTrack(d); $('trackState').className = 'save-state ok'; $('trackState').textContent = 'آخر تحديث: ' + fmtTime(new Date().toISOString());
    }).catch(function (e) { if (e.status === 401) showLogin(); else { $('trackState').className = 'save-state bad'; $('trackState').textContent = 'تعذّر التحديث'; } });
  }
  function startPolling() { stopPolling(); state.timer = setInterval(function () { if (!document.hidden && state.tab === 'track' && $('confirmBox').hidden) refreshTrack(); }, 15000); }
  function stopPolling() { if (state.timer) clearInterval(state.timer); state.timer = 0; }

  function askClear() {
    $('confirmText').textContent = 'سيتم حذف جميع السجلات' + (state.entriesTotal ? ' (' + fmtInt(state.entriesTotal) + ')' : '') + ' وكأن أي رقم لم يتم إدخاله، ولا يمكن التراجع عن ذلك.';
    $('confirmBox').hidden = false; $('confirmNo').focus();
  }
  function doClear() {
    $('confirmYes').disabled = true;
    api('DELETE', '/api/admin/served', {}).then(function () { $('confirmBox').hidden = true; return refreshTrack(); })
      .catch(function (e) { if (e.status === 401) showLogin(); else { $('trackState').className = 'save-state bad'; $('trackState').textContent = 'تعذّر المسح'; } })
      .then(function () { $('confirmYes').disabled = false; });
  }

  // ================= tabs / views =================
  function setTab(tab) {
    state.tab = tab;
    $('tabPlaces').setAttribute('aria-selected', String(tab === 'places')); $('tabTrack').setAttribute('aria-selected', String(tab === 'track'));
    $('placesView').hidden = tab !== 'places'; $('trackView').hidden = tab !== 'track';
    $('saveBtn').hidden = tab !== 'places'; $('saveState').hidden = tab !== 'places';
    if (tab === 'track') { refreshTrack(); startPolling(); } else stopPolling();
    renderPlaces();
  }
  function showLogin() { stopPolling(); $('editorView').hidden = true; $('loginView').hidden = false; $('pin').value = ''; $('pin').focus(); }
  function showEditor() {
    $('loginView').hidden = true; $('editorView').hidden = false;
    fetch('/api/blocks', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { load(d); setSave('', ''); setTab('places'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault(); $('loginErr').hidden = true;
      api('POST', '/api/admin/login', { pin: $('pin').value }).then(showEditor).catch(function (err) {
        $('loginErr').textContent = err.status === 429 ? 'محاولات كثيرة، حاول لاحقًا' : 'الرقم السري غير صحيح'; $('loginErr').hidden = false;
      });
    });
    $('logoutBtn').addEventListener('click', function () { api('POST', '/api/admin/logout', {}).finally(showLogin); });
    $('saveBtn').addEventListener('click', save);
    $('tabPlaces').addEventListener('click', function () { setTab('places'); });
    $('tabTrack').addEventListener('click', function () { setTab('track'); });
    $('refreshBtn').addEventListener('click', refreshTrack);
    $('clearAllBtn').addEventListener('click', askClear);
    $('confirmNo').addEventListener('click', function () { $('confirmBox').hidden = true; });
    $('confirmYes').addEventListener('click', doClear);

    ['right', 'left'].forEach(function (k) {
      var cap = k === 'right' ? 'Right' : 'Left';
      $('note' + cap).addEventListener('input', function (e) { state.sides[k].note = e.target.value; markDirty(); });
      $('form' + cap).addEventListener('submit', function (e) {
        e.preventDefault(); parseRanges($('range' + cap).value).forEach(function (c) { assign(c, k); });
        $('range' + cap).value = ''; markDirty(); renderPlaces();
      });
      $('clear' + cap).addEventListener('click', function () { state.sides[k].committees = []; markDirty(); renderPlaces(); });
    });
    $('splitForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var at = parseInt(String($('splitAt').value).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }), 10);
      if (!(at >= 1 && at <= MAX)) return;
      for (var c = 1; c <= MAX; c++) assign(c, c <= at ? 'left' : 'right');
      markDirty(); renderPlaces();
    });
    window.addEventListener('beforeunload', function (e) { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
    api('GET', '/api/admin/session').then(function (s) { if (s.authed) showEditor(); else showLogin(); }).catch(showLogin);
  });
})();
