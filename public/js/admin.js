(function () {
  'use strict';
  var MAX = 100;
  var $ = function (id) { return document.getElementById(id); };
  var state = { blocks: [], sel: 0, dirty: false };

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
    var opts = { method: method, headers: { 'X-Requested-With': 'admin' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || r.status); e.status = r.status; throw e; } return j; });
    });
  }

  // ----- model helpers -----
  function owners() { var m = {}; state.blocks.forEach(function (b, i) { b.committees.forEach(function (c) { m[c] = i; }); }); return m; }
  function markDirty() { state.dirty = true; setSave('dirty', 'تعديلات غير محفوظة'); }
  function setSave(cls, text) { var s = $('saveState'); s.className = 'save-state ' + cls; s.textContent = text; }
  function assign(committee, idx) {
    state.blocks.forEach(function (b) { b.committees = b.committees.filter(function (c) { return c !== committee; }); });
    if (idx !== null) state.blocks[idx].committees.push(committee);
  }
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

  // ----- render -----
  function render() {
    var own = owners(), sel = state.sel;
    // summary
    var assigned = Object.keys(own).length;
    $('summary').textContent = assigned + ' من ' + MAX + ' لجنة موزعة · ' + (MAX - assigned) + ' غير موزعة';
    // blocks list
    var list = $('blockList'); list.textContent = '';
    if (!state.blocks.length) list.appendChild(el('p', { class: 'empty', text: 'لا توجد بلوكات بعد. أضف أول بلوك ثم وزّع اللجان عليه.' }));
    state.blocks.forEach(function (b, i) {
      var card = el('div', { class: 'block-card' + (i === sel ? ' sel' : ''), onclick: function () { state.sel = i; render(); } });
      var nameIn = el('input', { class: 'name', type: 'text', maxlength: '40', 'aria-label': 'اسم البلوك', value: b.name,
        oninput: function (e) { b.name = e.target.value; markDirty(); }, onfocus: function () { if (state.sel !== i) { state.sel = i; renderGrid(); } } });
      var noteIn = el('input', { type: 'text', maxlength: '120', 'aria-label': 'وصف المكان', placeholder: 'وصف المكان (اختياري) مثل: بجوار المسبح', value: b.note,
        oninput: function (e) { b.note = e.target.value; markDirty(); }, onfocus: function () { if (state.sel !== i) { state.sel = i; renderGrid(); } } });
      card.appendChild(el('div', { class: 'block-head' }, [el('span', { class: 'swatch c' + (i % 8), text: String(i + 1) }), nameIn]));
      card.appendChild(noteIn);
      card.appendChild(el('div', { class: 'block-meta' }, [
        el('span', { text: b.committees.length + ' لجنة' }),
        el('button', { type: 'button', text: 'حذف البلوك', onclick: function (e) { e.stopPropagation(); if (confirm('حذف "' + b.name + '"؟')) { state.blocks.splice(i, 1); state.sel = Math.max(0, Math.min(state.sel, state.blocks.length - 1)); markDirty(); render(); } } }),
      ]));
      list.appendChild(card);
    });
    renderGrid();
  }
  function renderGrid() {
    var own = owners(), sel = state.sel, g = $('grid'); g.textContent = '';
    var hasSel = state.blocks.length > 0;
    $('selHint').textContent = hasSel ? 'البلوك المحدد: ' + (state.blocks[sel].name || '—') : 'أضف بلوكًا أولًا';
    document.querySelectorAll('.block-card').forEach(function (c, i) { c.classList.toggle('sel', i === sel); });
    for (var n = 1; n <= MAX; n++) (function (n) {
      var o = own[n];
      var cls = 'chip ' + (o === undefined ? 'un' : 'c' + (o % 8)) + (o === sel && hasSel ? ' on-sel' : '');
      var b = el('button', { type: 'button', class: cls, 'aria-label': 'لجنة ' + n + (o === undefined ? ' غير موزعة' : ' في ' + (state.blocks[o].name || 'بلوك ' + (o + 1))),
        onclick: function () { if (!hasSel) return; assign(n, own[n] === sel ? null : sel); markDirty(); render(); } }, [el('span', { text: String(n) })]);
      if (o !== undefined) b.appendChild(el('small', { text: 'ب' + (o + 1) }));
      g.appendChild(b);
    })(n);
  }

  // ----- actions -----
  function addBlock() {
    var n = state.blocks.length + 1;
    state.blocks.push({ name: 'بلوك ' + n, note: '', committees: [] });
    state.sel = state.blocks.length - 1; markDirty(); render();
  }
  function save() {
    if (state.blocks.some(function (b) { return !b.name.trim(); })) { setSave('bad', 'اكتب اسمًا لكل بلوك'); return; }
    setSave('', 'جارٍ الحفظ…');
    api('PUT', '/api/admin/blocks', { blocks: state.blocks.map(function (b) { return { name: b.name.trim(), note: b.note.trim(), committees: b.committees }; }) })
      .then(function (r) { load(r); state.dirty = false; setSave('ok', 'تم الحفظ'); render(); })
      .catch(function (e) { if (e.status === 401) { showLogin(); } else setSave('bad', 'تعذّر الحفظ: ' + e.message); });
  }
  function load(data) {
    state.blocks = data.blocks.map(function (b) { return { name: b.name, note: b.note || '', committees: b.committees.slice() }; });
    if (state.sel >= state.blocks.length) state.sel = 0;
  }
  function showLogin() { $('editorView').hidden = true; $('loginView').hidden = false; $('pin').value = ''; $('pin').focus(); }
  function showEditor() {
    $('loginView').hidden = true; $('editorView').hidden = false;
    fetch('/api/blocks', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { load(d); setSave('', ''); render(); });
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
    $('addBlock').addEventListener('click', addBlock);
    $('clearBlock').addEventListener('click', function () { if (state.blocks[state.sel]) { state.blocks[state.sel].committees = []; markDirty(); render(); } });
    $('rangeForm').addEventListener('submit', function (e) {
      e.preventDefault(); if (!state.blocks.length) return;
      parseRanges($('rangeIn').value).forEach(function (c) { assign(c, state.sel); });
      $('rangeIn').value = ''; markDirty(); render();
    });
    window.addEventListener('beforeunload', function (e) { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
    api('GET', '/api/admin/session').then(function (s) { if (s.authed) showEditor(); else showLogin(); }).catch(showLogin);
  });
})();
