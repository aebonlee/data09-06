/*
 * 화면 — 1. 불러오기 → 2. 열 맞추기 → 3. 분석 설정 → 4. 결과(그래프·컬러맵·표·CSV 저장) + 경고 로그
 * 시험 데이터는 메모리에만 두고, 설정·열 매핑만 이 브라우저에 기억합니다.
 */
(function () {
  'use strict';
  var L = window.OALogic, S = window.OAStore, Sample = window.OASample;
  var $ = function (id) { return document.getElementById(id); };
  var ORDER_COLORS = ['#1f5fa8', '#c62828', '#2e7d32', '#ef6c00', '#6a1b9a', '#00838f', '#5d4037', '#ad1457'];

  var state = {
    fileName: '', isSample: false, text: '', rows: [],
    cfg: null,          // 가져오기 설정
    importLog: [], groups: [], results: [], analysisLog: [],
    settings: Object.assign({}, L.DEFAULT_SETTINGS, S.getSettings() || {}),
    groupIdx: 0, mapAxis: 'hz'
  };

  // ── 도우미 ──
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  var toastTimer;
  function toast(msg, isError) {
    var el = $('toast');
    el.textContent = msg; el.className = 'toast' + (isError ? ' error' : ''); el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3500);
  }
  function fmt(v, d) {
    if (v == null || isNaN(v)) return '-';
    var a = Math.abs(v);
    if (d != null) return Number(v).toFixed(d);
    if (a !== 0 && (a < 0.001 || a >= 1e6)) return Number(v).toExponential(3);
    return String(Math.round(v * 1e5) / 1e5);
  }
  function download(name, text) {
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function baseName() {
    if (state.isSample) return '예시데이터';
    return (state.fileName || '결과').replace(/\.[^.]+$/, '');
  }

  // ── 1. 불러오기 ──
  function loadText(text, name, isSample) {
    state.text = text; state.fileName = name; state.isSample = !!isSample;
    $('sampleBanner').hidden = !isSample;
    var prev = S.getImport();
    var delim = L.detectDelimiter(text);
    var rows = L.parseCsv(text, delim);
    if (!rows.length) { toast('파일에 읽을 수 있는 줄이 없습니다', true); return; }
    var dc = delim === ';' && /\d,\d/.test(text.slice(0, 4000));
    var hr = L.guessHeaderRow(rows, dc);
    var headers = rows[hr];
    var cfg = { delimiter: delim, decimalComma: dc, headerRow: hr, layout: L.guessLayout(headers, dc), mapping: L.guessMapping(headers), fixed: { channel: '', direction: '', unit: '' } };
    // 같은 열 제목의 파일이면 지난번 설정을 그대로 씁니다
    if (!isSample && prev && prev.signature === headers.join('|')) cfg = prev;
    state.cfg = cfg;
    reparse();
    $('fileInfo').hidden = false;
    $('fileInfo').textContent = (isSample ? '예시 데이터' : '파일 「' + name + '」') + ' · ' + state.rows.length + '줄을 읽었습니다. 아래에서 열 배치를 확인하고 「이 설정으로 분석하기」를 누르세요.';
    $('step-map').hidden = false;
    renderMapForm();
    if (isSample) applyMapping(); else $('step-map').scrollIntoView({ behavior: 'smooth' });
  }
  function reparse() { state.rows = L.parseCsv(state.text, state.cfg.delimiter); }

  $('fileInput').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var txt = String(rd.result || '');
      // UTF-8 로 읽어 깨진 글자가 많으면 CP949(EUC-KR)로 다시 읽습니다(엑셀 저장 CSV 대비)
      if ((txt.match(/�/g) || []).length > 3) {
        var rd2 = new FileReader();
        rd2.onload = function () { loadText(String(rd2.result || ''), f.name, false); };
        try { rd2.readAsText(f, 'euc-kr'); return; } catch (err) { /* 그대로 진행 */ }
      }
      loadText(txt, f.name, false);
    };
    rd.onerror = function () { toast('파일을 읽지 못했습니다', true); };
    rd.readAsText(f, 'utf-8');
  });
  $('sampleBtn').addEventListener('click', function () { loadText(Sample.longCsv(), '예시데이터_세로형.csv', true); });

  // ── 2. 열 맞추기 ──
  var layoutSel = $('layout');
  Object.keys(L.LAYOUTS).forEach(function (k) { layoutSel.appendChild(h('option', { value: k }, L.LAYOUTS[k])); });

  function fieldsFor(layout) {
    if (layout === 'long') return ['rpm', 'channel', 'direction', 'unit', 'freq', 'value'];
    if (layout === 'wide') return ['rpm', 'channel', 'direction', 'unit'];
    return ['freq'];
  }
  function renderMapForm() {
    var c = state.cfg;
    $('delimiter').value = c.delimiter;
    $('decimalComma').checked = !!c.decimalComma;
    $('headerRow').value = c.headerRow + 1;
    layoutSel.value = c.layout;
    var headers = state.rows[c.headerRow] || [];
    var box = $('mapFields'); box.textContent = '';
    var required = { rpm: true, freq: true, value: true };
    fieldsFor(c.layout).forEach(function (f) {
      var sel = h('select', { 'data-map': f });
      var must = (c.layout === 'long' && required[f]) || (c.layout === 'wide' && f === 'rpm');
      sel.appendChild(h('option', { value: '-1' }, must ? '(선택하세요)' : '(파일에 없음)'));
      headers.forEach(function (hd, i) { sel.appendChild(h('option', { value: String(i) }, (i + 1) + '열 · ' + (String(hd).trim() || '(제목 없음)'))); });
      var cur = c.mapping[f];
      if (c.layout === 'rpmcols' && f === 'freq' && !(cur >= 0)) cur = 0;
      sel.value = String(cur >= 0 ? cur : -1);
      box.appendChild(h('label', { class: 'field' }, h('span', null, L.FIELD_LABEL[f] + ' 열'), sel));
    });
    ['channel', 'direction', 'unit'].forEach(function (f) {
      var inFile = c.layout !== 'rpmcols';
      box.appendChild(h('label', { class: 'field' },
        h('span', null, L.FIELD_LABEL[f] + (inFile ? ' — 파일에 없을 때 쓸 값' : ' (이 파일 전체)')),
        h('input', { 'data-fixed': f, value: c.fixed[f] || '', placeholder: f === 'unit' ? '예: g, m/s², Pa' : '' })));
    });
    renderPreview();
  }
  function readMapForm() {
    var c = state.cfg;
    c.delimiter = $('delimiter').value;
    c.decimalComma = $('decimalComma').checked;
    c.headerRow = Math.max(0, (parseInt($('headerRow').value, 10) || 1) - 1);
    c.layout = layoutSel.value;
    var m = {}; L.FIELDS.forEach(function (f) { m[f] = -1; });
    document.querySelectorAll('[data-map]').forEach(function (s) { m[s.getAttribute('data-map')] = parseInt(s.value, 10); });
    c.mapping = m;
    document.querySelectorAll('[data-fixed]').forEach(function (i) { c.fixed[i.getAttribute('data-fixed')] = i.value.trim(); });
  }
  function renderPreview() {
    var c = state.cfg, t = $('preview'); t.textContent = '';
    var headers = state.rows[c.headerRow] || [];
    var role = {};
    Object.keys(c.mapping).forEach(function (f) { if (c.mapping[f] >= 0 && fieldsFor(c.layout).indexOf(f) >= 0) role[c.mapping[f]] = L.FIELD_LABEL[f]; });
    var cols = Math.min(headers.length, 12);
    var tr = h('tr');
    for (var i = 0; i < cols; i++) tr.appendChild(h('th', null, String(headers[i]), role[i] ? h('small', null, '→ ' + role[i]) : null));
    if (headers.length > cols) tr.appendChild(h('th', null, '… 외 ' + (headers.length - cols) + '열'));
    t.appendChild(h('thead', null, tr));
    var tb = h('tbody');
    state.rows.slice(c.headerRow + 1, c.headerRow + 6).forEach(function (r) {
      var row = h('tr');
      for (var j = 0; j < cols; j++) row.appendChild(h('td', null, r[j] == null ? '' : String(r[j])));
      if (headers.length > cols) row.appendChild(h('td', null, ''));
      tb.appendChild(row);
    });
    t.appendChild(tb);
  }
  ['delimiter', 'headerRow', 'decimalComma'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      readMapForm();
      if (id === 'delimiter') reparse();
      var headers = state.rows[state.cfg.headerRow] || [];
      state.cfg.mapping = L.guessMapping(headers);
      renderMapForm();
    });
  });
  layoutSel.addEventListener('change', function () { readMapForm(); renderMapForm(); });
  $('mapFields').addEventListener('change', function () { readMapForm(); renderPreview(); });
  $('applyMapBtn').addEventListener('click', function () { readMapForm(); applyMapping(); });

  function applyMapping() {
    var c = state.cfg;
    var res = L.normalize(state.rows, c);
    state.importLog = res.log;
    state.groups = res.groups;
    if (!state.isSample) { c.signature = (state.rows[c.headerRow] || []).join('|'); S.setImport(c); }
    if (!res.groups.length) {
      $('step-results').hidden = true; $('step-settings').hidden = true;
      renderLog();
      toast('계산할 수 있는 데이터가 없습니다 — 경고 로그를 확인하세요', true);
      $('step-log').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    state.groupIdx = 0;
    var gs = $('groupSelect'); gs.textContent = '';
    res.groups.forEach(function (g, i) {
      gs.appendChild(h('option', { value: String(i) }, g.channel + ' · ' + g.direction + (g.unit ? ' (' + g.unit + ')' : '') + ' — ' + g.spectra.length + '개 RPM'));
    });
    $('step-settings').hidden = false;
    $('step-results').hidden = false;
    fillSettings();
    analyze();
    toast(res.groups.length + '개 채널·방향, 경고 ' + res.log.filter(function (x) { return x.level !== '정보'; }).length + '건');
  }

  // ── 3. 분석 설정 ──
  var sf = $('settingsForm');
  function fillSettings() {
    Object.keys(L.DEFAULT_SETTINGS).forEach(function (k) { if (sf.elements[k]) sf.elements[k].value = state.settings[k]; });
  }
  function readSettings() {
    var s = {};
    Object.keys(L.DEFAULT_SETTINGS).forEach(function (k) { if (sf.elements[k]) s[k] = sf.elements[k].value; });
    if (!L.parseOrders(s.orders).length) { toast('추적할 오더를 하나 이상 적어 주세요 (예: 1, 2)', true); return null; }
    if (!(Number(s.halfWidth) > 0)) { toast('오더 대역 반폭은 0보다 커야 합니다', true); return null; }
    if (!(Number(s.ratio) > 0)) { toast('회전비는 0보다 커야 합니다', true); return null; }
    return s;
  }
  sf.addEventListener('submit', function (e) {
    e.preventDefault();
    var s = readSettings(); if (!s) return;
    state.settings = s; S.setSettings(s); analyze(); toast('다시 계산했습니다');
  });
  $('resetSettingsBtn').addEventListener('click', function () {
    state.settings = Object.assign({}, L.DEFAULT_SETTINGS); S.setSettings(state.settings); fillSettings(); analyze();
  });

  function analyze() {
    state.results = L.analyzeAll(state.groups, state.settings);
    state.analysisLog = [];
    state.results.forEach(function (r) { state.analysisLog = state.analysisLog.concat(r.log); });
    renderResults();
    renderLog();
  }

  // ── 4. 결과 ──
  $('groupSelect').addEventListener('change', function (e) { state.groupIdx = parseInt(e.target.value, 10) || 0; renderResults(); });
  function current() { return state.results[state.groupIdx]; }

  function renderResults() {
    var res = current(); if (!res) return;
    var g = res.group, sp = g.spectra;
    var fmin = Infinity, fmax = -Infinity;
    sp.forEach(function (s) { fmin = Math.min(fmin, s.freqs[0]); fmax = Math.max(fmax, s.freqs[s.freqs.length - 1]); });
    var box = $('summary'); box.textContent = '';
    [['RPM 범위', fmt(sp[0].rpm) + ' ~ ' + fmt(sp[sp.length - 1].rpm) + ' (' + sp.length + '개)'],
     ['주파수 범위', fmt(fmin) + ' ~ ' + fmt(fmax) + ' Hz'],
     ['단위', g.unit || '(미지정)'],
     ['에너지 합산 대역', res.band]].forEach(function (kv) {
      box.appendChild(h('dl', { class: 'stat' }, h('dt', null, kv[0]), h('dd', null, kv[1])));
    });
    drawLine(res);
    drawMap(res);
    renderTables(res);
  }

  // 오더별 RPM-진폭 선 그래프 (SVG)
  var lineGeom = null;
  function niceMax(v) { if (!(v > 0)) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))); var n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function drawLine(res) {
    var svg = $('lineChart');
    var W = 800, H = 360, m = { l: 64, r: 16, t: 14, b: 44 };
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var NS = 'http://www.w3.org/2000/svg';
    function s(tag, a, txt) { var el = document.createElementNS(NS, tag); Object.keys(a).forEach(function (k) { el.setAttribute(k, a[k]); }); if (txt != null) el.textContent = txt; svg.appendChild(el); return el; }
    var rpms = res.group.spectra.map(function (x) { return x.rpm; });
    var r0 = rpms[0], r1 = rpms[rpms.length - 1]; if (r1 === r0) r1 = r0 + 1;
    var ymax = 0;
    res.tracks.forEach(function (t) { t.points.forEach(function (p) { if (p.amp != null && p.amp > ymax) ymax = p.amp; }); });
    ymax = niceMax(ymax);
    var X = function (r) { return m.l + (r - r0) / (r1 - r0) * (W - m.l - m.r); };
    var Y = function (a) { return H - m.b - a / ymax * (H - m.t - m.b); };
    for (var i = 0; i <= 4; i++) {
      var yv = ymax * i / 4;
      s('line', { x1: m.l, x2: W - m.r, y1: Y(yv), y2: Y(yv), stroke: '#e3e8ee' });
      s('text', { x: m.l - 6, y: Y(yv) + 4, 'text-anchor': 'end', 'font-size': 12, fill: '#56616f' }, fmt(yv));
    }
    for (var j = 0; j <= 5; j++) {
      var xv = r0 + (r1 - r0) * j / 5;
      s('text', { x: X(xv), y: H - m.b + 18, 'text-anchor': 'middle', 'font-size': 12, fill: '#56616f' }, String(Math.round(xv)));
    }
    s('text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 13, fill: '#1b2430' }, 'RPM');
    s('text', { x: 14, y: m.t + (H - m.t - m.b) / 2, 'text-anchor': 'middle', 'font-size': 13, fill: '#1b2430', transform: 'rotate(-90 14 ' + (m.t + (H - m.t - m.b) / 2) + ')' }, '진폭' + (res.group.unit ? ' (' + res.group.unit + ')' : ''));
    s('line', { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, stroke: '#8a95a3' });
    s('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: '#8a95a3' });
    var pts = [];
    var legend = $('lineLegend'); legend.textContent = '';
    res.tracks.forEach(function (t, k) {
      var color = ORDER_COLORS[k % ORDER_COLORS.length];
      var d = '', pen = false;
      t.points.forEach(function (p) {
        if (p.amp == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(p.rpm).toFixed(1) + ' ' + Y(p.amp).toFixed(1) + ' ';
        pen = true;
        pts.push({ x: X(p.rpm), y: Y(p.amp), p: p, order: t.order, color: color });
      });
      if (d) s('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 2.2 });
      t.points.forEach(function (p) { if (p.amp != null) s('circle', { cx: X(p.rpm), cy: Y(p.amp), r: 2.6, fill: color }); });
      legend.appendChild(h('span', null, h('i', { style: 'background:' + color }), t.order + '차' + (t.max ? ' (최대 ' + fmt(t.max.amp) + ' @ ' + fmt(t.max.rpm) + ' RPM)' : ' (범위 밖)')));
    });
    var hi = s('circle', { r: 6, fill: 'none', stroke: '#1b2430', 'stroke-width': 2, visibility: 'hidden' });
    lineGeom = { W: W, H: H, pts: pts, hi: hi, res: res };
  }
  function lineHover(ev) {
    if (!lineGeom || !lineGeom.pts.length) return;
    var svg = $('lineChart'), rect = svg.getBoundingClientRect();
    var sx = lineGeom.W / rect.width, sy = lineGeom.H / rect.height;
    var x = (ev.clientX - rect.left) * sx, y = (ev.clientY - rect.top) * sy;
    var best = null, bd = Infinity;
    lineGeom.pts.forEach(function (q) { var d = Math.pow(q.x - x, 2) + Math.pow(q.y - y, 2); if (d < bd) { bd = d; best = q; } });
    if (!best || bd > Math.pow(40 * sx, 2)) { hideTip('lineTip'); lineGeom.hi.setAttribute('visibility', 'hidden'); return; }
    lineGeom.hi.setAttribute('cx', best.x); lineGeom.hi.setAttribute('cy', best.y); lineGeom.hi.setAttribute('visibility', 'visible');
    var p = best.p, u = lineGeom.res.group.unit;
    showTip('lineTip', $('lineWrap'), best.x / sx, best.y / sy,
      [best.order + '차 오더', 'RPM ' + fmt(p.rpm), '진폭 ' + fmt(p.amp) + (u ? ' ' + u : ''), '대역 최대 주파수 ' + fmt(p.freq, 2) + ' Hz', '대역 최대 오더 ' + fmt(p.order, 3)]);
  }
  $('lineChart').addEventListener('pointermove', lineHover);
  $('lineChart').addEventListener('pointerdown', lineHover);
  $('lineChart').addEventListener('pointerleave', function () { hideTip('lineTip'); if (lineGeom) lineGeom.hi.setAttribute('visibility', 'hidden'); });

  function showTip(id, wrap, x, y, lines) {
    var tip = $(id); tip.textContent = '';
    lines.forEach(function (l, i) { if (i) tip.appendChild(h('br')); tip.appendChild(document.createTextNode(l)); });
    tip.hidden = false;
    var ww = wrap.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = x + 12; if (left + tw > ww) left = Math.max(0, x - tw - 12);
    var top = y - th - 10; if (top < 0) top = y + 14;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  function hideTip(id) { $(id).hidden = true; }

  // 스펙트럼 컬러맵 (canvas) — x: 주파수 또는 오더, y: RPM
  var mapGeom = null;
  function drawMap(res) {
    var cv = $('colorMap'), wrap = $('mapWrap');
    var cssW = wrap.clientWidth, cssH = cv.clientHeight || 380;
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    var m = { l: 58, r: 10, t: 8, b: 40 };
    var pw = cssW - m.l - m.r, ph = cssH - m.t - m.b;
    var sp = res.group.spectra, ratio = res.ratio, axis = state.mapAxis;
    var xOf = function (s, i) { return axis === 'order' ? L.toOrder(s.freqs[i], s.rpm, ratio) : s.freqs[i]; };
    var x0 = Infinity, x1 = -Infinity;
    sp.forEach(function (s) { x0 = Math.min(x0, xOf(s, 0)); x1 = Math.max(x1, xOf(s, s.freqs.length - 1)); });
    if (x1 === x0) x1 = x0 + 1;
    var r0 = sp[0].rpm, r1 = sp[sp.length - 1].rpm;
    var range = L.ampRange(sp);
    var X = function (v) { return m.l + (v - x0) / (x1 - x0) * pw; };
    var rEdges = sp.map(function (s, k) {
      var lo = k ? (sp[k - 1].rpm + s.rpm) / 2 : s.rpm - (sp.length > 1 ? (sp[1].rpm - s.rpm) / 2 : 1);
      var hi = k < sp.length - 1 ? (s.rpm + sp[k + 1].rpm) / 2 : s.rpm + (sp.length > 1 ? (s.rpm - sp[k - 1].rpm) / 2 : 1);
      return [lo, hi];
    });
    var R0 = rEdges[0][0], R1 = rEdges[rEdges.length - 1][1];
    var Y = function (r) { return m.t + ph - (r - R0) / (R1 - R0) * ph; };
    sp.forEach(function (s, k) {
      var yTop = Y(rEdges[k][1]), yBot = Y(rEdges[k][0]);
      for (var i = 0; i < s.freqs.length; i++) {
        var xc = xOf(s, i);
        var xl = i ? (xOf(s, i - 1) + xc) / 2 : xc - (s.freqs.length > 1 ? (xOf(s, 1) - xc) / 2 : 0.5);
        var xr = i < s.freqs.length - 1 ? (xc + xOf(s, i + 1)) / 2 : xc + (s.freqs.length > 1 ? (xc - xOf(s, i - 1)) / 2 : 0.5);
        var c = L.colorAt((s.amps[i] - range.min) / (range.max - range.min));
        ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
        // 칸 경계를 정수 픽셀에 맞춰 칸 사이 틈(반투명 선)이 생기지 않게 합니다
        var a = Math.floor(Math.max(m.l, X(xl))), b = Math.ceil(Math.min(m.l + pw, X(xr)));
        if (b > a) ctx.fillRect(a, Math.floor(yTop), b - a, Math.ceil(yBot) - Math.floor(yTop));
      }
    });
    var peakPts = [];
    if ($('showPeaks').checked) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4;
      res.peaks.forEach(function (row, k) {
        row.peaks.forEach(function (p) {
          var px = X(axis === 'order' ? p.order : p.freq), py = Y(sp[k].rpm);
          peakPts.push({ x: px, y: py, rpm: row.rpm, p: p });
          ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.stroke();
        });
      });
    }
    // 축
    ctx.fillStyle = '#56616f'; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
    var ticks = cssW < 480 ? 4 : 6;
    for (var j = 0; j <= ticks; j++) { var xv = x0 + (x1 - x0) * j / ticks; ctx.fillText(fmt(xv, axis === 'order' ? 1 : 0), X(xv), m.t + ph + 16); }
    ctx.fillStyle = '#1b2430';
    ctx.fillText(axis === 'order' ? '오더' : '주파수 (Hz)', m.l + pw / 2, cssH - 6);
    ctx.textAlign = 'right'; ctx.fillStyle = '#56616f';
    for (var q = 0; q <= 4; q++) { var rv = r0 + (r1 - r0) * q / 4; ctx.fillText(String(Math.round(rv)), m.l - 6, Y(rv) + 4); }
    ctx.save(); ctx.translate(12, m.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = '#1b2430'; ctx.fillText('RPM', 0, 0); ctx.restore();
    mapGeom = { m: m, pw: pw, ph: ph, x0: x0, x1: x1, R0: R0, R1: R1, sp: sp, res: res, axis: axis, peakPts: peakPts };
    // 색 막대
    var sc = $('mapScale'); sc.textContent = '';
    var stops = []; for (var t = 0; t <= 10; t++) { var cc = L.colorAt(t / 10); stops.push('rgb(' + cc.join(',') + ') ' + (t * 10) + '%'); }
    sc.appendChild(h('span', null, fmt(range.min)));
    sc.appendChild(h('span', { class: 'bar', style: 'background:linear-gradient(90deg,' + stops.join(',') + ')' }));
    sc.appendChild(h('span', null, fmt(range.max) + (res.group.unit ? ' ' + res.group.unit : '') + ' (선형)'));
  }
  function mapHover(ev) {
    if (!mapGeom) return;
    var g = mapGeom, rect = $('colorMap').getBoundingClientRect();
    var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    if (x < g.m.l || x > g.m.l + g.pw || y < g.m.t || y > g.m.t + g.ph) { hideTip('mapTip'); return; }
    var u = g.res.group.unit ? ' ' + g.res.group.unit : '';
    var near = null, nd = 64;
    g.peakPts.forEach(function (q) { var d = Math.pow(q.x - x, 2) + Math.pow(q.y - y, 2); if (d < nd) { nd = d; near = q; } });
    if (near) {
      showTip('mapTip', $('mapWrap'), x, y, ['피크 ' + near.p.rank + '위', 'RPM ' + fmt(near.rpm), '주파수 ' + fmt(near.p.freq, 2) + ' Hz', '오더 ' + fmt(near.p.order, 3), '진폭 ' + fmt(near.p.amp) + u]);
      return;
    }
    var rpm = g.R0 + (g.m.t + g.ph - y) / g.ph * (g.R1 - g.R0);
    var k = L.nearestIndex(g.sp.map(function (s) { return s.rpm; }), rpm);
    var s = g.sp[k];
    var xv = g.x0 + (x - g.m.l) / g.pw * (g.x1 - g.x0);
    var f = g.axis === 'order' ? L.toFreq(xv, s.rpm, g.res.ratio) : xv;
    var i = L.nearestIndex(s.freqs, f);
    showTip('mapTip', $('mapWrap'), x, y, ['RPM ' + fmt(s.rpm), '주파수 ' + fmt(s.freqs[i], 2) + ' Hz', '오더 ' + fmt(L.toOrder(s.freqs[i], s.rpm, g.res.ratio), 3), '진폭 ' + fmt(s.amps[i]) + u]);
  }
  $('colorMap').addEventListener('pointermove', mapHover);
  $('colorMap').addEventListener('pointerdown', mapHover);
  $('colorMap').addEventListener('pointerleave', function () { hideTip('mapTip'); });
  function setAxis(a) {
    state.mapAxis = a;
    $('axisHz').setAttribute('aria-pressed', String(a === 'hz'));
    $('axisOrder').setAttribute('aria-pressed', String(a === 'order'));
    if (current()) drawMap(current());
  }
  $('axisHz').addEventListener('click', function () { setAxis('hz'); });
  $('axisOrder').addEventListener('click', function () { setAxis('order'); });
  $('showPeaks').addEventListener('change', function () { if (current()) drawMap(current()); });
  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (current()) drawMap(current()); }, 150); });

  function table(el, rows, numCols) {
    el.textContent = '';
    el.appendChild(h('thead', null, h('tr', null, rows[0].map(function (c) { return h('th', null, String(c)); }))));
    var tb = h('tbody');
    rows.slice(1).forEach(function (r) {
      tb.appendChild(h('tr', null, r.map(function (c, i) { return h('td', { class: numCols && numCols[i] ? 'num' : null }, c === '' || c == null ? '-' : String(c)); })));
    });
    el.appendChild(tb);
  }
  function renderTables(res) {
    var om = L.orderMaxRows([res]).map(function (r) { return r.slice(3); });
    table($('orderMaxTable'), om, { 0: 1, 1: 1, 2: 1, 3: 1 });
    var rows = [['RPM', '피크(주파수 Hz / 오더 / 진폭)', '에너지 합산(RSS)']];
    res.peaks.forEach(function (r, k) {
      rows.push([r.rpm, r.peaks.map(function (p) { return p.rank + '위 ' + fmt(p.freq, 1) + ' Hz / ' + fmt(p.order, 2) + ' / ' + fmt(p.amp); }).join('  ·  ') || '-', fmt(res.energy[k].energy)]);
    });
    table($('peakTable'), rows, { 0: 1, 2: 1 });
  }

  // ── 저장 ──
  document.querySelectorAll('[data-save]').forEach(function (b) {
    b.addEventListener('click', function () {
      var kind = b.getAttribute('data-save');
      if (kind !== 'log' && !state.results.length) { toast('먼저 데이터를 불러와 분석하세요', true); return; }
      var rows, suffix;
      if (kind === 'track') { rows = L.trackRows(state.results); suffix = '오더추적'; }
      else if (kind === 'ordermax') { rows = L.orderMaxRows(state.results); suffix = '오더별최대'; }
      else if (kind === 'peaks') { rows = L.peakRows(state.results); suffix = '피크목록'; }
      else if (kind === 'energy') { rows = L.energyRows(state.results); suffix = '에너지합산'; }
      else { rows = L.logRows(allLog()); suffix = '경고로그'; }
      download(baseName() + '_' + suffix + '.csv', L.toCsv(rows));
    });
  });

  // ── 경고 로그 ──
  function allLog() { return state.importLog.concat(state.analysisLog); }
  function renderLog() {
    var log = allLog();
    var cnt = { '오류': 0, '경고': 0, '정보': 0 };
    log.forEach(function (x) { cnt[x.level] = (cnt[x.level] || 0) + 1; });
    $('logSummary').textContent = log.length
      ? '오류 ' + cnt['오류'] + '건 · 경고 ' + cnt['경고'] + '건 · 정보 ' + cnt['정보'] + '건. 「원본 줄」은 파일의 줄 번호입니다(빈 줄 제외).'
      : '경고 없이 읽었습니다.';
    var t = $('logTable'); t.textContent = '';
    if (!log.length) return;
    t.appendChild(h('thead', null, h('tr', null, h('th', null, '구분'), h('th', null, '원본 줄'), h('th', null, '내용'))));
    var tb = h('tbody');
    log.slice(0, 500).forEach(function (x) {
      tb.appendChild(h('tr', null, h('td', { class: 'lv-' + x.level }, x.level), h('td', { class: 'num' }, x.line ? String(x.line) : '-'), h('td', null, x.message)));
    });
    if (log.length > 500) tb.appendChild(h('tr', null, h('td', { colspan: '3' }, '… 외 ' + (log.length - 500) + '건 — 「경고 로그 CSV」로 모두 저장할 수 있습니다')));
    t.appendChild(tb);
  }

  if (!S.available()) toast('이 브라우저에서는 설정을 기억할 수 없어, 창을 닫으면 설정이 처음 값으로 돌아갑니다', true);
})();
