/*
 * 화면 — 1. 불러오기 → 2. 열 맞추기 → 3. 분석 설정 → 4. 결과(그래프·컬러맵·표·CSV 저장) + 경고 로그
 * 시험 데이터는 메모리에만 두고, 설정·열 매핑만 이 브라우저에 기억합니다.
 */
(function () {
  'use strict';
  var L = window.OALogic, S = window.OAStore, Sample = window.OASample;
  var $ = function (id) { return document.getElementById(id); };
  var ORDER_COLORS = ['#1f5fa8', '#c62828', '#2e7d32', '#ef6c00', '#6a1b9a', '#00838f', '#5d4037', '#ad1457'];

  // 1차 배포(2026-09-28 오전)에 기억해 둔 설정에는 v34 방식이 없어 「대역 최대값」 이 남아 있습니다 — 그때 값이면 방식만 새 기본값(v34)으로 돌립니다
  function savedSettings() {
    var sv = S.getSettings() || {};
    if (!('searchHz' in sv)) delete sv.trackMethod;
    return sv;
  }
  var state = {
    fileName: '', isSample: false, text: '', rows: [],
    cfg: null,          // 가져오기 설정
    importLog: [], groups: [], results: [], analysisLog: [],
    settings: Object.assign({}, L.DEFAULT_SETTINGS, savedSettings()),
    groupIdx: 0, mapAxis: 'hz', extra: {}
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
    var testlab = L.isTestlab(rows);
    var cfg = { delimiter: delim, decimalComma: dc, headerRow: testlab ? 0 : hr, layout: testlab ? 'testlab' : L.guessLayout(headers, dc), mapping: L.guessMapping(testlab ? [] : headers), fixed: { channel: '', direction: '', unit: '' } };
    // 같은 열 제목의 파일이면 지난번 설정을 그대로 씁니다 (Testlab 내보내기는 머리 정보로 읽으므로 제외)
    if (!testlab && !isSample && prev && prev.signature === headers.join('|')) cfg = prev;
    // 파일 이름의 「36,45order」 를 추적 오더로 제안합니다 (제출자 파일 이름 관례)
    var sug = isSample ? (testlab ? '36, 45' : '1, 2, 4') : L.ordersFromName(name);
    state.suggestedOrders = sug;
    if (sug) state.settings.orders = sug;
    state.cfg = cfg;
    reparse();
    $('fileInfo').hidden = false;
    $('fileInfo').textContent = (isSample ? '예시 데이터' : '파일 「' + name + '」') + ' · 값이 있는 줄 ' + state.rows.length + '개를 읽었습니다. ' +
      (testlab ? 'Testlab Neo 내보내기로 알아봤습니다 — 아래 Curve 목록을 확인하고 「이 설정으로 분석하기」를 누르세요.' : '아래에서 열 배치를 확인하고 「이 설정으로 분석하기」를 누르세요.') +
      (sug && !isSample ? ' 파일 이름에서 추적 오더 ' + sug + ' 을(를) 가져왔습니다.' : '');
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
  $('sampleTlBtn').addEventListener('click', function () { loadText(Sample.testlabCsv(), '예시데이터_TestlabNeo형식.csv', true); });

  // ── 2. 열 맞추기 ──
  var layoutSel = $('layout');
  Object.keys(L.LAYOUTS).forEach(function (k) { layoutSel.appendChild(h('option', { value: k }, L.LAYOUTS[k])); });

  function fieldsFor(layout) {
    if (layout === 'long') return ['rpm', 'channel', 'direction', 'unit', 'freq', 'value'];
    if (layout === 'wide') return ['rpm', 'channel', 'direction', 'unit'];
    if (layout === 'testlab') return [];
    return ['freq'];
  }
  function renderMapForm() {
    var c = state.cfg;
    $('delimiter').value = c.delimiter;
    $('decimalComma').checked = !!c.decimalComma;
    $('headerRow').value = c.headerRow + 1;
    layoutSel.value = c.layout;
    $('headerRow').disabled = c.layout === 'testlab';
    var headers = state.rows[c.headerRow] || [];
    var box = $('mapFields'); box.textContent = '';
    if (c.layout === 'testlab') { renderTestlabPreview(box); return; }
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
  // Testlab 내보내기: 열 지정 대신 알아본 Curve 목록을 보여 줍니다
  function renderTestlabPreview(box) {
    var t = $('preview'); t.textContent = '';
    $('previewTitle').textContent = '알아본 Curve (열마다 하나)';
    var tl = L.parseTestlab(state.rows, state.cfg.decimalComma);
    if (tl.error) { box.appendChild(h('p', { class: 'note span-all' }, '이 파일은 Testlab Neo 형식으로 읽을 수 없습니다: ' + tl.error)); return; }
    box.appendChild(h('p', { class: 'note span-all' }, 'Curve ' + tl.curves.length + '개 · ' + (tl.format === 'shared' ? '0열 공통 주파수 + Curve별 진폭 열' : 'Curve별 X/Y 열') +
      ' · 데이터 시작 ' + tl.dataLine + '줄. RPM 은 Dataset name, 위치·방향은 DOF id, 단위는 Y axis unit, 원본 척도(dB 여부)는 데이터 바로 위 줄에서 읽습니다.'));
    t.appendChild(h('thead', null, h('tr', null, ['열', 'Dataset name', 'RPM', '위치', '방향', '종류', '단위', '원본 척도'].map(function (x) { return h('th', null, x); }))));
    var tb = h('tbody');
    tl.curves.slice(0, 12).forEach(function (cv) {
      tb.appendChild(h('tr', null, [cv.yCol + 1, cv.runName || '-', cv.rpm == null ? '(못 읽음)' : cv.rpm, cv.point || '-', cv.direction || '-',
        cv.channelType === 'noise' ? '소음' : '진동', cv.unit || '-', (cv.scaleText || '-') + (cv.scale !== 'linear' ? ' → 선형 변환' : '')].map(function (x) { return h('td', null, String(x)); })));
    });
    if (tl.curves.length > 12) tb.appendChild(h('tr', null, h('td', { colspan: '8' }, '… 외 ' + (tl.curves.length - 12) + '개')));
    t.appendChild(tb);
  }
  function renderPreview() {
    var c = state.cfg, t = $('preview'); t.textContent = '';
    $('previewTitle').textContent = '미리 보기 (머리행부터 6줄)';
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
      if (id === 'delimiter' && state.cfg.layout === 'testlab' && !L.isTestlab(state.rows)) state.cfg.layout = L.guessLayout(headers, state.cfg.decimalComma);
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
    // 주파수 간격이 피크 검색 범위(±)의 두 배보다 넓으면 검색 창 안에 칸이 없어 값이 비므로 간격의 절반으로 넓힙니다
    if (state.autoSearchFrom != null) { state.settings.searchHz = state.autoSearchFrom; state.autoSearchFrom = null; }  // 앞 파일에서 넓힌 값은 되돌림
    var step = L.freqStep(res.groups);
    if (step && Number(state.settings.searchHz) < step / 2) {
      state.autoSearchFrom = state.settings.searchHz;
      res.log.push({ level: '정보', line: '', message: '주파수 간격 ' + step + ' Hz 가 피크 검색 범위 ±' + state.settings.searchHz + ' Hz 보다 넓어 검색 범위를 ±' + step / 2 + ' Hz 로 넓혔습니다(분석 설정에서 바꿀 수 있음)' });
      state.settings.searchHz = step / 2;
    }
    if (!state.isSample) { c.signature = (state.rows[c.headerRow] || []).join('|'); S.setImport(c); }
    if (!res.groups.length) {
      $('step-results').hidden = true; $('step-settings').hidden = true;
      renderLog();
      toast('계산할 수 있는 데이터가 없습니다 — 경고 로그를 확인하세요', true);
      $('step-log').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    state.groupIdx = 0; state.extra = {};
    var gs = $('groupSelect'); gs.textContent = '';
    res.groups.forEach(function (g, i) {
      gs.appendChild(h('option', { value: String(i) }, L.groupLabel(g) + (g.unit ? ' (' + g.unit + (g.scale === 'db' || g.scale === 'dba' ? ', 원본 ' + g.scale : '') + ')' : '') + ' — ' + g.spectra.length + '개 RPM'));
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
    if (s.trackMethod !== 'peak' && !(Number(s.halfWidth) > 0)) { toast('오더 대역 반폭은 0보다 커야 합니다', true); return null; }
    if (!(Number(s.ratio) > 0)) { toast('회전비는 0보다 커야 합니다', true); return null; }
    if (!(s.searchHz !== '' && Number(s.searchHz) >= 0) || !(s.sumHz !== '' && Number(s.sumHz) >= 0)) { toast('피크 검색·합산 범위는 0 이상이어야 합니다', true); return null; }
    if (!['noiseRef', 'noiseSrcRef', 'vibRef', 'vibSrcRef'].every(function (k) { return Number(s[k]) > 0; })) { toast('dB 기준값은 0보다 커야 합니다', true); return null; }
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
    var lz = L.linearize(state.groups, state.settings);   // 원본이 dB 인 채널 → 선형 진폭
    state.results = L.analyzeAll(lz.groups, state.settings);
    state.analysisLog = lz.log.slice();
    state.results.forEach(function (r) { state.analysisLog = state.analysisLog.concat(r.log); });
    renderResults();
    renderLog();
  }

  // ── 4. 결과 ──
  $('groupSelect').addEventListener('change', function (e) {
    state.groupIdx = parseInt(e.target.value, 10) || 0;
    delete state.extra[state.groupIdx];
    ['mapLo', 'mapHi', 'mapCMin', 'mapCMax'].forEach(function (id) { $(id).value = ''; });
    renderResults();
  });
  function current() { return state.results[state.groupIdx]; }

  function renderResults() {
    var res = current(); if (!res) return;
    var g = res.group, sp = g.spectra;
    var fmin = Infinity, fmax = -Infinity;
    sp.forEach(function (s) { fmin = Math.min(fmin, s.freqs[0]); fmax = Math.max(fmax, s.freqs[s.freqs.length - 1]); });
    var box = $('summary'); box.textContent = '';
    var src = g.sourceScale ? '원본 ' + g.sourceScale + ' → ' + g.unit + ' (기준 ' + g.sourceRef + ')' : (g.unit || '(미지정)');
    var disp = res.display.mode === 'linear' ? '선형 ' + (g.unit || '') : res.display.unit + ' (기준 ' + res.display.ref + ')';
    [['RPM 범위', fmt(sp[0].rpm) + ' ~ ' + fmt(sp[sp.length - 1].rpm) + ' (' + sp.length + '개)'],
     ['주파수 범위', fmt(fmin) + ' ~ ' + fmt(fmax) + ' Hz'],
     ['단위 · 원본', (g.channelType === 'noise' ? '소음 · ' : '진동 · ') + src],
     ['그래프 표시', disp],
     ['오더 계산', L.METHOD_LABEL[res.method] + (res.method === 'peak' ? ' · 검색 ±' + res.searchHz + ' Hz · 합산 ±' + res.sumHz + ' Hz' : ' · ±' + res.halfWidth + ' 오더')],
     ['에너지 합산 대역', res.band]].forEach(function (kv) {
      box.appendChild(h('dl', { class: 'stat' }, h('dt', null, kv[0]), h('dd', null, kv[1])));
    });
    renderOverlayList();
    drawLine(lineResults());
    drawMap(res);
    renderTables(res);
  }

  // 그래프에 함께 그릴 채널: 지금 채널 + 고른 채널 (v34 는 채널을 여러 개 골라 한 그래프에 겹칩니다)
  function lineResults() {
    return state.results.filter(function (r, i) { return i === state.groupIdx || state.extra[i]; });
  }
  function renderOverlayList() {
    var box = $('overlayGroups'); box.textContent = '';
    state.results.forEach(function (r, i) {
      var cb = h('input', { type: 'checkbox', value: String(i) });
      cb.checked = i === state.groupIdx || !!state.extra[i];
      cb.disabled = i === state.groupIdx;
      cb.addEventListener('change', function () { if (cb.checked) state.extra[i] = true; else delete state.extra[i]; drawLine(lineResults()); });
      box.appendChild(h('label', null, cb, L.groupLabel(r.group) + (i === state.groupIdx ? ' (지금 채널)' : '')));
    });
  }

  // 오더별 RPM-진폭 선 그래프 (SVG) — 값은 표시 단위(선형·dB·dBA)
  var lineGeom = null;
  function niceMax(v) { if (!(v > 0)) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))); var n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function drawLine(list) {
    var svg = $('lineChart');
    var W = 800, H = 360, m = { l: 64, r: 16, t: 14, b: 44 };
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var NS = 'http://www.w3.org/2000/svg';
    function s(tag, a, txt) { var el = document.createElementNS(NS, tag); Object.keys(a).forEach(function (k) { el.setAttribute(k, a[k]); }); if (txt != null) el.textContent = txt; svg.appendChild(el); return el; }
    var multi = list.length > 1;
    // 계열 = 채널 × 오더 (+ 오더 RSS 합산)
    var series = [];
    list.forEach(function (res) {
      res.tracks.forEach(function (t) { series.push({ res: res, order: t.order, points: t.points, rss: false }); });
      if (res.rssSum) series.push({ res: res, orders: res.rssSum.orders, points: res.rssSum.points, rss: true });
    });
    var r0 = Infinity, r1 = -Infinity, y0 = Infinity, y1 = -Infinity, allLinear = true, units = {};
    list.forEach(function (res) {
      units[res.display.unit] = true;
      if (res.display.mode !== 'linear') allLinear = false;
      res.group.spectra.forEach(function (x) { r0 = Math.min(r0, x.rpm); r1 = Math.max(r1, x.rpm); });
    });
    series.forEach(function (se) { se.points.forEach(function (p) { if (p.disp != null) { y0 = Math.min(y0, p.disp); y1 = Math.max(y1, p.disp); } }); });
    if (r1 === r0) r1 = r0 + 1;
    var ymin, ymax;
    if (!(y1 >= y0)) { ymin = 0; ymax = 1; }
    else if (allLinear) { ymin = 0; ymax = niceMax(y1); }
    else { var pad = (y1 - y0 || 1) * 0.12; ymin = Math.floor(y0 - pad); ymax = Math.ceil(y1 + pad); }
    var X = function (r) { return m.l + (r - r0) / (r1 - r0) * (W - m.l - m.r); };
    var Y = function (a) { return H - m.b - (a - ymin) / (ymax - ymin) * (H - m.t - m.b); };
    for (var i = 0; i <= 4; i++) {
      var yv = ymin + (ymax - ymin) * i / 4;
      s('line', { x1: m.l, x2: W - m.r, y1: Y(yv), y2: Y(yv), stroke: '#e3e8ee' });
      s('text', { x: m.l - 6, y: Y(yv) + 4, 'text-anchor': 'end', 'font-size': 12, fill: '#56616f' }, fmt(yv));
    }
    for (var j = 0; j <= 5; j++) {
      var xv = r0 + (r1 - r0) * j / 5;
      s('text', { x: X(xv), y: H - m.b + 18, 'text-anchor': 'middle', 'font-size': 12, fill: '#56616f' }, String(Math.round(xv)));
    }
    var uk = Object.keys(units).filter(Boolean);
    s('text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 13, fill: '#1b2430' }, 'RPM');
    s('text', { x: 14, y: m.t + (H - m.t - m.b) / 2, 'text-anchor': 'middle', 'font-size': 13, fill: '#1b2430', transform: 'rotate(-90 14 ' + (m.t + (H - m.t - m.b) / 2) + ')' }, '오더 진폭' + (uk.length === 1 ? ' (' + uk[0] + ')' : uk.length > 1 ? ' (단위 섞임)' : ''));
    s('line', { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, stroke: '#8a95a3' });
    s('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: '#8a95a3' });
    var pts = [];
    var legend = $('lineLegend'); legend.textContent = '';
    series.forEach(function (se, k) {
      var color = ORDER_COLORS[k % ORDER_COLORS.length];
      var name = (multi ? L.groupLabel(se.res.group) + ' · ' : '') + (se.rss ? 'RSS(' + se.orders.join('+') + ')' : se.order + '차');
      var d = '', pen = false, best = null;
      se.points.forEach(function (p) {
        if (p.disp == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(p.rpm).toFixed(1) + ' ' + Y(p.disp).toFixed(1) + ' ';
        pen = true;
        if (!best || p.disp > best.disp) best = p;
        pts.push({ x: X(p.rpm), y: Y(p.disp), p: p, se: se, name: name, color: color });
      });
      if (d) s('path', { d: d, fill: 'none', stroke: color, 'stroke-width': se.rss ? 2.8 : 2.2, 'stroke-dasharray': se.rss ? '7 4' : null });
      se.points.forEach(function (p) {
        if (p.disp == null) return;
        s('circle', { cx: X(p.rpm), cy: Y(p.disp), r: p.matched ? 2.8 : 3.6, fill: p.matched ? color : '#fff', stroke: p.matched ? color : '#c62828', 'stroke-width': p.matched ? 1 : 2 });
      });
      legend.appendChild(h('span', null, h('i', { style: 'background:' + color + (se.rss ? ';height:3px;background:repeating-linear-gradient(90deg,' + color + ' 0 6px,transparent 6px 9px)' : '') }),
        name + (best ? ' (최대 ' + fmt(best.disp) + ' ' + se.res.display.unit + ' @ ' + fmt(best.rpm) + ' RPM)' : ' (값 없음)')));
    });
    var hi = s('circle', { r: 6, fill: 'none', stroke: '#1b2430', 'stroke-width': 2, visibility: 'hidden' });
    lineGeom = { W: W, H: H, pts: pts, hi: hi };
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
    var p = best.p, res = best.se.res, u = ' ' + res.display.unit;
    var lines = [best.name, 'RPM ' + fmt(p.rpm), '진폭 ' + fmt(p.disp) + u];
    if (best.se.rss) {
      p.comps.forEach(function (c, k) { lines.push(best.se.orders[k] + '차 ' + fmt(c.disp) + u + ' @ ' + fmt(c.freq, 1) + ' Hz'); });
    } else if (res.method === 'peak') {
      lines.push('이론 주파수 ' + fmt(p.target, 2) + ' Hz', '검출 피크 ' + fmt(p.freq, 2) + ' Hz (오더 ' + fmt(p.order, 3) + ')', '합산 ' + fmt(p.sumMin, 1) + '~' + fmt(p.sumMax, 1) + ' Hz · ' + p.bins + '칸');
    } else {
      lines.push('대역 최대 주파수 ' + fmt(p.freq, 2) + ' Hz', '대역 최대 오더 ' + fmt(p.order, 3));
    }
    lines.push(p.matched ? '판정 일치' : '판정 불일치 — 이론 주파수가 측정 범위 밖');
    showTip('lineTip', $('lineWrap'), best.x / sx, best.y / sy, lines);
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

  // 스펙트럼 컬러맵 (canvas) — x: 주파수 또는 오더, y: RPM, 색: 표시 단위(선형·dB·dBA)
  var mapGeom = null;
  function numOrNull(id) { var v = $(id).value.trim(); return v === '' || isNaN(Number(v)) ? null : Number(v); }
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
    var sp = res.group.spectra, ratio = res.ratio, axis = state.mapAxis, dsp = res.display;
    var xOf = function (s, i) { return axis === 'order' ? L.toOrder(s.freqs[i], s.rpm, ratio) : s.freqs[i]; };
    var d0 = Infinity, d1 = -Infinity;
    sp.forEach(function (s) { d0 = Math.min(d0, xOf(s, 0)); d1 = Math.max(d1, xOf(s, s.freqs.length - 1)); });
    var lo = numOrNull('mapLo'), hi = numOrNull('mapHi');
    var x0 = lo != null ? lo : d0, x1 = hi != null ? hi : d1;
    if (!(x1 > x0)) { x0 = d0; x1 = d1; }
    if (x1 === x0) x1 = x0 + 1;
    $('mapLo').placeholder = '자동 ' + fmt(d0, axis === 'order' ? 2 : 0); $('mapHi').placeholder = '자동 ' + fmt(d1, axis === 'order' ? 2 : 0);
    // 표시값(dB 등)으로 바꾼 뒤 보이는 범위에서 색 범위를 잡습니다
    var vals = sp.map(function (s) { return s.amps.map(function (a, i) { return L.displayOf(a, s.freqs[i], dsp.mode, dsp.ref); }); });
    var c0 = Infinity, c1 = -Infinity;
    sp.forEach(function (s, k) { for (var i = 0; i < s.freqs.length; i++) { var xv = xOf(s, i), v = vals[k][i]; if (v != null && xv >= x0 && xv <= x1) { if (v < c0) c0 = v; if (v > c1) c1 = v; } } });
    if (!(c1 >= c0)) { c0 = 0; c1 = 1; }
    var cmin = numOrNull('mapCMin'), cmax = numOrNull('mapCMax');
    $('mapCMin').placeholder = '자동 ' + fmt(c0); $('mapCMax').placeholder = '자동 ' + fmt(c1);
    if (cmin != null) c0 = cmin; if (cmax != null) c1 = cmax;
    if (!(c1 > c0)) c1 = c0 + (Math.abs(c0) || 1) * 1e-6;
    var r0 = sp[0].rpm, r1 = sp[sp.length - 1].rpm;
    var X = function (v) { return m.l + (v - x0) / (x1 - x0) * pw; };
    var rEdges = sp.map(function (s, k) {
      var lo2 = k ? (sp[k - 1].rpm + s.rpm) / 2 : s.rpm - (sp.length > 1 ? (sp[1].rpm - s.rpm) / 2 : 1);
      var hi2 = k < sp.length - 1 ? (s.rpm + sp[k + 1].rpm) / 2 : s.rpm + (sp.length > 1 ? (s.rpm - sp[k - 1].rpm) / 2 : 1);
      return [lo2, hi2];
    });
    var R0 = rEdges[0][0], R1 = rEdges[rEdges.length - 1][1];
    var Y = function (r) { return m.t + ph - (r - R0) / (R1 - R0) * ph; };
    ctx.fillStyle = '#eef1f5'; ctx.fillRect(m.l, m.t, pw, ph);
    sp.forEach(function (s, k) {
      var yTop = Y(rEdges[k][1]), yBot = Y(rEdges[k][0]);
      for (var i = 0; i < s.freqs.length; i++) {
        var xc = xOf(s, i), v = vals[k][i];
        if (v == null) continue;
        var xl = i ? (xOf(s, i - 1) + xc) / 2 : xc - (s.freqs.length > 1 ? (xOf(s, 1) - xc) / 2 : 0.5);
        var xr = i < s.freqs.length - 1 ? (xc + xOf(s, i + 1)) / 2 : xc + (s.freqs.length > 1 ? (xc - xOf(s, i - 1)) / 2 : 0.5);
        if (xr < x0 || xl > x1) continue;
        var c = L.colorAt((v - c0) / (c1 - c0));
        ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
        // 칸 경계를 정수 픽셀에 맞춰 칸 사이 틈(반투명 선)이 생기지 않게 합니다
        var a = Math.floor(Math.max(m.l, X(xl))), b = Math.ceil(Math.min(m.l + pw, X(xr)));
        if (b > a) ctx.fillRect(a, Math.floor(yTop), b - a, Math.ceil(yBot) - Math.floor(yTop));
      }
    });
    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
    var peakPts = [];
    if ($('showPeaks').checked) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4;
      res.peaks.forEach(function (row, k) {
        row.peaks.forEach(function (p) {
          var xv = axis === 'order' ? p.order : p.freq;
          if (xv < x0 || xv > x1) return;
          var px = X(xv), py = Y(sp[k].rpm);
          peakPts.push({ x: px, y: py, rpm: row.rpm, p: p });
          ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.stroke();
        });
      });
    }
    // 추적 오더 선 (v34 「오더 성분 표시」): 주파수 축이면 RPM 따라 기울어진 선, 오더 축이면 세로선
    var orderLines = [];
    if ($('showOrders').checked) {
      ctx.setLineDash([5, 4]); ctx.lineWidth = 1.3; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      res.tracks.forEach(function (t) {
        var line = sp.map(function (s) { var xv = axis === 'order' ? t.order : L.toFreq(t.order, s.rpm, ratio); return { x: X(xv), y: Y(s.rpm), xv: xv }; });
        orderLines.push({ order: t.order, pts: line, track: t });
        if (line.every(function (q) { return q.xv < x0 || q.xv > x1; })) return;
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.beginPath();
        line.forEach(function (q, k) { if (k) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
        ctx.stroke();
        var vis = line.filter(function (q) { return q.xv >= x0 && q.xv <= x1; });
        var last = vis[vis.length - 1], label = t.order + 'X';   // 보이는 마지막 점 옆에 이름
        var tx = Math.min(Math.max(last.x + 4, m.l + 2), m.l + pw - ctx.measureText(label).width - 4), ty = Math.max(m.t + 8, last.y);
        ctx.setLineDash([]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(label, tx, ty);
        ctx.fillStyle = '#fff'; ctx.fillText(label, tx, ty); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.3;
      });
      ctx.setLineDash([]);
    }
    ctx.restore();
    // 축
    ctx.fillStyle = '#56616f'; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    var ticks = cssW < 480 ? 4 : 6;
    for (var j = 0; j <= ticks; j++) { var xv = x0 + (x1 - x0) * j / ticks; ctx.textAlign = j === ticks ? 'right' : 'center'; ctx.fillText(fmt(xv, axis === 'order' || x1 - x0 < 10 ? 1 : 0), X(xv), m.t + ph + 16); }
    ctx.fillStyle = '#1b2430'; ctx.textAlign = 'center';
    ctx.fillText(axis === 'order' ? '오더' : '주파수 (Hz)', m.l + pw / 2, cssH - 6);
    ctx.textAlign = 'right'; ctx.fillStyle = '#56616f';
    // RPM 이 12개 이하이면 행마다 이름(v34 와 같음), 많으면 5개 눈금
    var rt = sp.length <= 12 ? sp.map(function (x) { return x.rpm; }) : [0, 1, 2, 3, 4].map(function (q) { return Math.round(r0 + (r1 - r0) * q / 4); });
    rt.forEach(function (rv) { ctx.fillText(String(rv), m.l - 6, Y(rv) + 4); });
    ctx.save(); ctx.translate(12, m.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = '#1b2430'; ctx.fillText('RPM', 0, 0); ctx.restore();
    mapGeom = { m: m, pw: pw, ph: ph, x0: x0, x1: x1, R0: R0, R1: R1, sp: sp, res: res, axis: axis, peakPts: peakPts, orderLines: orderLines, vals: vals };
    // 색 막대
    var sc = $('mapScale'); sc.textContent = '';
    var stops = []; for (var t = 0; t <= 10; t++) { var cc = L.colorAt(t / 10); stops.push('rgb(' + cc.join(',') + ') ' + (t * 10) + '%'); }
    sc.appendChild(h('span', null, fmt(c0)));
    sc.appendChild(h('span', { class: 'bar', style: 'background:linear-gradient(90deg,' + stops.join(',') + ')' }));
    sc.appendChild(h('span', null, fmt(c1) + ' ' + dsp.unit + (dsp.mode === 'linear' ? ' (선형)' : '')));
  }
  function mapHover(ev) {
    if (!mapGeom) return;
    var g = mapGeom, rect = $('colorMap').getBoundingClientRect();
    var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    if (x < g.m.l || x > g.m.l + g.pw || y < g.m.t || y > g.m.t + g.ph) { hideTip('mapTip'); return; }
    var u = ' ' + g.res.display.unit;
    var near = null, nd = 64;
    g.peakPts.forEach(function (q) { var d = Math.pow(q.x - x, 2) + Math.pow(q.y - y, 2); if (d < nd) { nd = d; near = q; } });
    if (near) {
      showTip('mapTip', $('mapWrap'), x, y, ['피크 ' + near.p.rank + '위', 'RPM ' + fmt(near.rpm), '주파수 ' + fmt(near.p.freq, 2) + ' Hz', '오더 ' + fmt(near.p.order, 3), '진폭 ' + fmt(L.displayOf(near.p.amp, near.p.freq, g.res.display.mode, g.res.display.ref)) + u]);
      return;
    }
    var rpm = g.R0 + (g.m.t + g.ph - y) / g.ph * (g.R1 - g.R0);
    var k = L.nearestIndex(g.sp.map(function (s) { return s.rpm; }), rpm);
    var s = g.sp[k];
    // 오더 선 가까이면 그 오더의 검출 피크(v34 툴팁과 같은 항목)
    var ol = null, od = 10;
    g.orderLines.forEach(function (o) { var d = Math.abs(o.pts[k].x - x); if (d < od) { od = d; ol = o; } });
    if (ol) {
      var p = ol.track.points[k];
      showTip('mapTip', $('mapWrap'), x, y, [ol.order + 'X · RPM ' + fmt(s.rpm), '이론 오더 주파수 ' + fmt(L.toFreq(ol.order, s.rpm, g.res.ratio), 2) + ' Hz',
        g.res.method === 'peak' ? '피크 검색 ' + fmt(p.searchMin, 2) + ' ~ ' + fmt(p.searchMax, 2) + ' Hz' : '오더 대역 ±' + g.res.halfWidth,
        '검출 피크 ' + (p.freq == null ? '-' : fmt(p.freq, 2) + ' Hz'), '오더 진폭 ' + fmt(p.disp) + u + (p.matched ? '' : ' (불일치)')]);
      return;
    }
    var xv = g.x0 + (x - g.m.l) / g.pw * (g.x1 - g.x0);
    var f = g.axis === 'order' ? L.toFreq(xv, s.rpm, g.res.ratio) : xv;
    var i = L.nearestIndex(s.freqs, f);
    showTip('mapTip', $('mapWrap'), x, y, ['RPM ' + fmt(s.rpm), '주파수 ' + fmt(s.freqs[i], 2) + ' Hz', '오더 ' + fmt(L.toOrder(s.freqs[i], s.rpm, g.res.ratio), 3), '진폭 ' + fmt(g.vals[k][i]) + u]);
  }
  $('colorMap').addEventListener('pointermove', mapHover);
  $('colorMap').addEventListener('pointerdown', mapHover);
  $('colorMap').addEventListener('pointerleave', function () { hideTip('mapTip'); });
  function setAxis(a) {
    state.mapAxis = a;
    $('axisHz').setAttribute('aria-pressed', String(a === 'hz'));
    $('axisOrder').setAttribute('aria-pressed', String(a === 'order'));
    $('mapLo').value = ''; $('mapHi').value = '';
    $('mapLoLabel').textContent = '가로축 최소 (' + (a === 'order' ? '오더' : 'Hz') + ')';
    $('mapHiLabel').textContent = '가로축 최대 (' + (a === 'order' ? '오더' : 'Hz') + ')';
    if (current()) drawMap(current());
  }
  $('axisHz').addEventListener('click', function () { setAxis('hz'); });
  $('axisOrder').addEventListener('click', function () { setAxis('order'); });
  ['showPeaks', 'showOrders', 'mapLo', 'mapHi', 'mapCMin', 'mapCMax'].forEach(function (id) {
    $(id).addEventListener('change', function () { if (current()) drawMap(current()); });
  });
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
    table($('orderMaxTable'), om, { 1: 1, 2: 1, 3: 1, 4: 1 });
    var rows = [['RPM', '피크(주파수 Hz / 오더 / 선형 진폭)', '에너지 합산(RSS, 선형)']];
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
      else if (kind === 'rss') { rows = L.rssRows(state.results); suffix = '오더RSS합산'; if (rows.length < 2) { toast('오더를 두 개 이상 적어야 RSS 합산이 나옵니다', true); return; } }
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
