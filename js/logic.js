/*
 * 소음진동 오더 분석 도구 — 순수 로직 모듈 (화면·저장소와 무관)
 * 브라우저에서는 window.OALogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 로컬 파일(file://)로 열었을 때
 * 브라우저가 module 스크립트를 막기 때문입니다.
 *
 * 용어
 *   스펙트럼 행(row)  : 한 RPM 에서 잰 주파수축 응답 { rpm, freqs[], amps[] }
 *   그룹(group)       : 채널·방향이 같은 스펙트럼 행 묶음
 *   오더              : 주파수(Hz) × 60 / (RPM × 회전비)   — 회전비 기본 1 (기획서 10장 5번 확인 필요)
 */
(function (root) {
  'use strict';

  // ── 입력 배치(레이아웃) ─────────────────────────────────────
  // Testlab Neo 내보내기(제출자 실제 파일, 2026-09-28 수령)는 자동으로 알아보고, 다른 모양의 CSV 는 세 배치 중에서 고릅니다.
  var LAYOUTS = {
    testlab: 'Testlab Neo 내보내기 — 머리 정보 블록 + Curve별 진폭 열 (열 지정 필요 없음)',
    long: '세로형 — 한 행에 RPM·채널·방향·단위·주파수·응답',
    wide: '가로형 — 한 행이 한 RPM, 주파수가 열 제목',
    rpmcols: '가로형(열=RPM) — 한 행이 한 주파수, RPM 이 열 제목'
  };
  var FIELDS = ['rpm', 'channel', 'direction', 'unit', 'freq', 'value'];
  var FIELD_LABEL = { rpm: 'RPM', channel: '채널', direction: '방향', unit: '단위', freq: '주파수(Hz)', value: '응답(진폭)' };
  // 열 제목으로 짐작할 때 쓰는 낱말 (소문자·공백 제거 후 포함 여부)
  var FIELD_HINTS = {
    rpm: ['rpm', 'speed', '회전수', 'tacho'],
    channel: ['channel', 'chan', 'ch', '채널', 'point', 'node'],
    direction: ['direction', 'dir', '방향', 'axis'],
    unit: ['unit', '단위'],
    freq: ['frequency', 'freq', 'hz', '주파수'],
    value: ['response', 'amplitude', 'amp', 'value', '응답', '진폭', 'magnitude', 'level']
  };

  var DEFAULT_SETTINGS = {
    ratio: 1,             // 기준축 회전비(기어비). 1 = 입력 RPM 축 그대로 (v34 에는 없음 — 1 이면 v34 와 같음)
    orders: '1, 2, 4',    // 추적할 오더 (예시값 — 파일 이름에 「36,45order」 가 있으면 그 오더로 바꿔 줍니다)
    trackMethod: 'peak',  // 'peak' v34 방식(피크 검색 → 피크 ± 합산 범위 RSS) | 'max' 오더 대역 최대값 | 'rss' 오더 대역 RSS
    searchHz: 1,          // 피크 검색 범위(±Hz) — v34 기본값
    sumHz: 1,             // 피크 중심 합산 범위(±Hz) — v34 기본값
    halfWidth: 0.25,      // 오더 대역 반폭(±오더) — 'max'·'rss' 방식에서만 씀
    noiseMode: 'db',      // 소음 표시: 'linear' | 'db' | 'dba'  (v34 기본 dB)
    noiseRef: 2e-5,       // 소음 dB 기준값(Pa) — 20 µPa
    noiseSrcRef: 2e-5,    // 원본이 dB 일 때 선형(Pa)으로 되돌리는 기준값
    vibMode: 'linear',    // 진동 표시 (v34 기본 Amplitude)
    vibRef: 1.0197e-7,    // 진동 dB 기준값(g) — 1 µm/s²
    vibSrcRef: 1.0197e-7, // 원본이 dB 일 때 선형(g)으로 되돌리는 기준값
    peakTopN: 3,          // RPM 별 피크 개수
    peakMin: 0,           // 피크 최소 진폭(이하 제외)
    energyAxis: 'hz',     // 'hz' | 'order'
    energyLo: '',         // 빈칸 = 처음부터
    energyHi: ''          // 빈칸 = 끝까지
  };

  // ── CSV 읽기 ────────────────────────────────────────────────
  function stripBom(s) { return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; }

  function detectDelimiter(text) {
    var lines = stripBom(text).split(/\r?\n/).filter(function (l) { return l.trim(); }).slice(0, 20);
    var best = ',', bestScore = -1;
    [',', ';', '\t'].forEach(function (d) {
      var counts = lines.map(function (l) { return splitLine(l, d).length; });
      if (!counts.length) return;
      // 가장 흔한 칸 수 × 그 칸 수가 나온 줄 수 — 칸이 1개뿐이면 0점
      var freq = {};
      counts.forEach(function (c) { freq[c] = (freq[c] || 0) + 1; });
      var mode = Object.keys(freq).reduce(function (a, b) { return freq[a] >= freq[b] ? a : b; });
      var score = Number(mode) > 1 ? freq[mode] * Number(mode) : 0;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function splitLine(line, d) { return parseCsv(line, d)[0] || []; }

  // 따옴표("")·따옴표 안 줄바꿈을 처리하는 CSV 파서
  function parseCsv(text, delimiter) {
    text = stripBom(String(text || ''));
    var d = delimiter || ',';
    var rows = [], starts = [], row = [], cell = '', q = false;
    var line = 1, rowStart = 1;   // 파일의 실제 줄 번호(빈 줄 포함)
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else { if (c === '\n') line++; cell += c; }
      } else if (c === '"' && cell === '') q = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); starts.push(rowStart); row = []; cell = '';
        line++; rowStart = line;
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); starts.push(rowStart); }
    // 값이 하나도 없는 줄(빈 줄, 「,,,,」 만 있는 줄)은 뺍니다. 뺀 뒤에도 원본 줄 번호를 lineNo 로 남깁니다.
    var out = [], lineNo = [];
    rows.forEach(function (r, k) {
      if (r.some(function (x) { return String(x).trim() !== ''; })) { out.push(r); lineNo.push(starts[k]); }
    });
    Object.defineProperty(out, 'lineNo', { value: lineNo, enumerable: false });
    return out;
  }

  // 숫자 읽기. decimalComma=true 면 "1,25" → 1.25 (유럽식 내보내기 대비)
  function parseNumber(s, decimalComma) {
    if (typeof s === 'number') return isFinite(s) ? s : NaN;
    var t = String(s == null ? '' : s).trim();
    if (!t) return NaN;
    if (decimalComma) t = t.replace(/\./g, '').replace(',', '.');
    // 천 단위 쉼표(따옴표로 감싼 "1,234.5") — 세 자리 묶음일 때만 쉼표를 뺍니다
    else if (/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?([eE][+-]?\d+)?$/.test(t)) t = t.replace(/,/g, '');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return NaN;
    return Number(t);
  }

  // 열 제목에서 숫자 읽기: "125", "125 Hz", "125.0 [Hz]", "1000rpm" → 숫자
  function headerNumber(s, decimalComma) {
    var t = String(s == null ? '' : s).trim();
    var m = decimalComma ? t.match(/^[+-]?\d+(,\d+)?/) : t.match(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
    if (!m) return NaN;
    var rest = t.slice(m[0].length).replace(/[\s\[\]()]/g, '').toLowerCase();
    if (rest && !/^(hz|rpm|1\/min)$/.test(rest)) return NaN;
    return parseNumber(m[0], decimalComma);
  }

  // 머리행 짐작: 바로 아래 줄들이 대부분 숫자인 첫 줄 (Testlab 머리 정보 줄을 건너뛰기 위함)
  function guessHeaderRow(rows, decimalComma) {
    function numShare(r) {
      if (!r || !r.length) return 0;
      var n = r.filter(function (x) { return !isNaN(parseNumber(x, decimalComma)); }).length;
      return n / r.length;
    }
    for (var i = 0; i < Math.min(rows.length - 1, 50); i++) {
      if (rows[i].length < 2) continue;
      if (numShare(rows[i]) < 0.5 && numShare(rows[i + 1]) >= 0.5 && rows[i + 1].length >= rows[i].length - 1) return i;
    }
    return 0;
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/[\s_\-.()\[\]]/g, ''); }

  // 열 제목으로 매핑 짐작. 반환: { rpm: 열번호 | -1, ... }
  function guessMapping(headers) {
    var m = {}, used = {};
    FIELDS.forEach(function (f) { m[f] = -1; });
    // 더 구체적인 것부터: rpm, freq, direction, unit, channel, value
    ['rpm', 'freq', 'direction', 'unit', 'channel', 'value'].forEach(function (f) {
      for (var i = 0; i < headers.length; i++) {
        if (used[i]) continue;
        var h = norm(headers[i]);
        if (!h) continue;
        var hit = FIELD_HINTS[f].some(function (k) {
          return f === 'channel' && k === 'ch' ? /^ch\d*$/.test(h) || h === 'ch' : h.indexOf(k) >= 0;
        });
        if (hit) { m[f] = i; used[i] = true; break; }
      }
    });
    return m;
  }

  // 배치 짐작: RPM 열이 있고 숫자 제목 열이 많으면 wide, 첫 열 외 제목이 대부분 숫자면 rpmcols, 아니면 long
  function guessLayout(headers, decimalComma) {
    var numeric = headers.filter(function (h) { return !isNaN(headerNumber(h, decimalComma)); }).length;
    var m = guessMapping(headers);
    if (numeric >= 3 && m.rpm >= 0) return 'wide';
    if (numeric >= 3 && numeric >= headers.length - 1) return 'rpmcols';
    return 'long';
  }

  // ── Testlab Neo 내보내기 (제출자 실제 파일·분석기 v34 기준) ─────────────
  // 실제 파일 모양 (docs/source/sim)130B-X 36,45order.csv):
  //   1줄  Curve 1,,,,          ← 제목
  //   ...  Standard\All\Dataset name, rpm  2000, rpm  2000, …   ← 머리 정보 블록(열마다 Curve 하나)
  //        Standard\All\DOF id, LL:+X, LR:+X, …                ← 위치:방향
  //        Standard\All\Y axis unit, g, g, Pa, …               ← 물리 단위
  //   빈 줄 / 단위 줄(Hz,g,g,…) / 표시 척도 줄(Linear,Log (RMS),dB,…)
  //   데이터  1000,0.00047,0.00018,…   ← 0열 공통 주파수(Hz), 1열부터 Curve별 진폭
  // v34 는 「Curve 1,,Curve 2,,…」 처럼 Curve마다 X/Y 두 열을 반복하는 옛 배치도 읽습니다 — 같이 지원합니다.
  function metaKey(v) {
    return String(v == null ? '' : v).trim().replace(/\\{2,}/g, '\\').toLowerCase().replace(/^standard\\all\\/, '');
  }
  function isTestlab(rows) {
    if (!rows || !rows.length) return false;
    if (/^curve\s+\d+$/i.test(String(rows[0][0] || '').trim())) return true;
    for (var i = 0; i < Math.min(rows.length, 120); i++) {
      if (/^standard\\+all\\+/i.test(String(rows[i][0] || '').trim())) return true;
    }
    return false;
  }
  // 척도 글자 → 'db' | 'dba' | 'linear'.  "Log (RMS)" 는 화면 표시 방식일 뿐 값은 선형입니다(v34 와 같음)
  function unitScale(t) {
    var u = String(t || '').trim().toLowerCase().replace(/\s+/g, '');
    if (u === 'dba' || u === 'db(a)') return 'dba';
    if (u === 'db') return 'db';
    return 'linear';
  }
  // 소음 = 물리 단위 Pa 이거나 원본이 dB 척도 (v34 규칙)
  function channelTypeOf(unit, scale) {
    return String(unit || '').trim().toLowerCase() === 'pa' || scale === 'db' || scale === 'dba' ? 'noise' : 'vibration';
  }
  // 이름에서 RPM 읽기 — v34 와 같은 규칙: 「RPM2000」「rpm  2000」 먼저, 없으면 3~6자리 숫자
  function rpmFromName(s) {
    var t = String(s || '');
    var m = t.match(/RPM\s*[_-]?\s*(\d{2,6})/i) || t.match(/(?:^|[^0-9])(\d{3,6})(?:[^0-9]|$)/);
    return m ? Number(m[1]) : null;
  }
  // Testlab 구조 읽기 (데이터 값은 읽지 않음) → { format, dataStart, curves:[…], log }
  function parseTestlab(rows, decimalComma) {
    var dc = !!decimalComma, log = [];
    var lineOf = function (i) { return rows.lineNo ? rows.lineNo[i] : i + 1; };
    var isNum = function (v) { return !isNaN(parseNumber(v, dc)); };
    var maxCols = 0; rows.forEach(function (r) { if (r.length > maxCols) maxCols = r.length; });
    var head = rows[0] || [], pairs = [];
    for (var c = 0; c < head.length; c += 2) {
      var mm = String(head[c] || '').trim().match(/^curve\s+(\d+)$/i);
      if (mm) pairs.push({ curveNo: Number(mm[1]), xCol: c, yCol: c + 1 });
    }
    var shared = pairs.length <= 1 && maxCols > 2, dataStart = -1, i;
    if (shared) {
      for (i = 1; i < rows.length; i++) {
        if (isNum(rows[i][0]) && rows[i].slice(1).some(isNum)) { dataStart = i; break; }
      }
      if (dataStart < 0) return { error: '주파수(0열)와 진폭이 함께 숫자로 시작하는 데이터 줄을 찾지 못했습니다', log: log };
      var seen = {}, found = 0;
      for (i = dataStart; i < rows.length && found < maxCols - 1; i++) {
        for (c = 1; c < rows[i].length; c++) if (!seen[c] && isNum(rows[i][c])) { seen[c] = true; found++; }
      }
      pairs = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; }).map(function (col) { return { curveNo: col, xCol: 0, yCol: col }; });
    } else {
      if (!pairs.length) return { error: '첫 줄에서 「Curve n」 열을 찾지 못했습니다', log: log };
      for (i = 1; i < rows.length; i++) {
        if (pairs.every(function (p) { return isNum(rows[i][p.xCol]) && isNum(rows[i][p.yCol]); })) { dataStart = i; break; }
      }
      if (dataStart < 0) return { error: '모든 Curve 가 숫자로 시작하는 데이터 줄을 찾지 못했습니다', log: log };
    }
    if (!pairs.length) return { error: '숫자 진폭 열이 없습니다', log: log };
    var scaleRow = rows[dataStart - 1] || [];
    var curves = pairs.map(function (p) {
      var meta = {};
      for (var r = 1; r < dataStart; r++) {
        var k = metaKey(rows[r][shared ? 0 : p.xCol]);
        var v = String(rows[r][p.yCol] == null ? '' : rows[r][p.yCol]).trim();
        if (k && v !== '' && !(k in meta)) meta[k] = v;
      }
      var get = function () { for (var a = 0; a < arguments.length; a++) { var v = meta[metaKey(arguments[a])]; if (v) return v; } return ''; };
      var runName = get('Dataset name', 'Dataset', 'Run name', 'Original run');
      var dof = get('DOF id');
      // 「LL:+X」 → 위치 LL, 방향 X.  콜론이 있을 때만 끝 글자를 방향으로 봅니다(「Box」 같은 이름을 자르지 않도록)
      var dm = dof.match(/:\s*[+-]?\s*([XYZ])\s*$/i);
      var point = dm ? dof.slice(0, dof.lastIndexOf(':')).trim() : (dof || get('Point id'));
      var dirRaw = dm ? dm[1] : get('Point direction absolute', 'Point direction');
      var dir = String(dirRaw).replace(/[^XYZxyz]/g, '').toUpperCase().slice(0, 1);
      var unit = get('Y axis unit');
      var scale = unitScale(scaleRow[p.yCol]);
      var type = channelTypeOf(unit, scale);
      return {
        curveNo: p.curveNo, xCol: p.xCol, yCol: p.yCol, runName: runName, rpm: rpmFromName(runName),
        point: point, direction: type === 'noise' ? '' : dir, channelType: type,
        unit: unit || (type === 'noise' ? 'Pa' : ''), scale: scale, scaleText: String(scaleRow[p.yCol] || '').trim(),
        xUnit: get('X axis unit'), label: get('label'), line: lineOf(0)
      };
    });
    return { format: shared ? 'shared' : 'paired', dataStart: dataStart, dataLine: lineOf(dataStart), curves: curves, log: log };
  }

  // ── 표준화: 원본 행 → 그룹별 스펙트럼 ─────────────────────────
  // cfg = { headerRow, layout, mapping, fixed: {channel, direction, unit}, decimalComma }
  // 반환 { groups: [...], log: [{level, line, message}], stats }
  function normalize(rows, cfg) {
    var log = [];
    var dc = !!cfg.decimalComma;
    var hr = cfg.headerRow || 0;
    var headers = rows[hr] || [];
    var map = cfg.mapping || {};
    var fixed = cfg.fixed || {};
    var groups = {}, order = [];
    var stats = { dataRows: 0, skipped: 0 };
    function warn(line, msg, level) { log.push({ level: level || '경고', line: line, message: msg }); }
    function col(r, f) { var i = map[f]; return i == null || i < 0 ? null : r[i]; }
    function label(r, f) {
      var v = col(r, f);
      v = v == null ? '' : String(v).trim();
      if (!v) v = String(fixed[f] || '').trim();
      return v;
    }
    function group(ch, dir, unit, line) {
      var key = ch + '|' + dir;
      var g = groups[key];
      if (!g) {
        g = groups[key] = { key: key, channel: ch, direction: dir, unit: unit, byRpm: {}, rpms: [] };
        order.push(key);
      } else if (unit && g.unit && unit !== g.unit && !g._unitWarned) {
        warn(line, '채널 ' + ch + ' · 방향 ' + dir + ' 안에서 단위가 다릅니다 (' + g.unit + ' / ' + unit + ') — 처음 단위로 표시합니다');
        g._unitWarned = true;
      }
      if (!g.unit && unit) g.unit = unit;
      return g;
    }
    function spectrum(g, rpm) {
      var k = String(rpm);
      if (!g.byRpm[k]) { g.byRpm[k] = { rpm: rpm, bins: {} }; g.rpms.push(rpm); }
      return g.byRpm[k];
    }
    function addBin(sp, f, a, line) {
      var k = String(f);
      if (k in sp.bins) { warn(line, 'RPM ' + sp.rpm + ' 의 주파수 ' + f + ' Hz 가 중복됩니다 — 처음 값만 씁니다'); return; }
      sp.bins[k] = a;
    }

    if (cfg.layout === 'long') {
      ['rpm', 'freq', 'value'].forEach(function (f) {
        if (!(map[f] >= 0)) warn(hr + 1, FIELD_LABEL[f] + ' 열이 지정되지 않았습니다', '오류');
      });
      if (log.length) return { groups: [], log: log, stats: stats };
      for (var i = hr + 1; i < rows.length; i++) {
        var r = rows[i], line = i + 1;
        stats.dataRows++;
        var rpm = parseNumber(col(r, 'rpm'), dc), f = parseNumber(col(r, 'freq'), dc), a = parseNumber(col(r, 'value'), dc);
        if (isNaN(rpm) || isNaN(f) || isNaN(a)) {
          var miss = [];
          if (isNaN(rpm)) miss.push('RPM'); if (isNaN(f)) miss.push('주파수'); if (isNaN(a)) miss.push('응답');
          warn(line, miss.join('·') + ' 값이 비었거나 숫자가 아닙니다 — 이 행을 건너뜁니다');
          stats.skipped++; continue;
        }
        if (rpm <= 0) { warn(line, 'RPM 이 0 이하(' + rpm + ')라 오더를 계산할 수 없습니다 — 이 행을 건너뜁니다'); stats.skipped++; continue; }
        if (f < 0) { warn(line, '주파수가 음수(' + f + ')입니다 — 이 행을 건너뜁니다'); stats.skipped++; continue; }
        if (a < 0) warn(line, '응답이 음수(' + a + ')입니다 — 선형 진폭이 아니라면 단위를 확인하세요');
        var g = group(label(r, 'channel') || '(채널 없음)', label(r, 'direction') || '(방향 없음)', label(r, 'unit'), line);
        addBin(spectrum(g, rpm), f, a, line);
      }
    } else if (cfg.layout === 'wide') {
      if (!(map.rpm >= 0)) { warn(hr + 1, 'RPM 열이 지정되지 않았습니다', '오류'); return { groups: [], log: log, stats: stats }; }
      var metaCols = {};
      ['rpm', 'channel', 'direction', 'unit'].forEach(function (f) { if (map[f] >= 0) metaCols[map[f]] = true; });
      var fcols = [];
      headers.forEach(function (h, ci) {
        if (metaCols[ci]) return;
        var fv = headerNumber(h, dc);
        if (!isNaN(fv)) fcols.push({ ci: ci, f: fv });
        else if (String(h).trim()) warn(hr + 1, '열 「' + h + '」 의 제목이 주파수 숫자가 아니라 계산에서 뺍니다', '정보');
      });
      if (!fcols.length) { warn(hr + 1, '주파수 숫자로 된 열 제목이 없습니다 — 배치를 확인하세요', '오류'); return { groups: [], log: log, stats: stats }; }
      for (var j = hr + 1; j < rows.length; j++) {
        var rw = rows[j], ln = j + 1;
        stats.dataRows++;
        var rp = parseNumber(col(rw, 'rpm'), dc);
        if (isNaN(rp)) { warn(ln, 'RPM 값이 비었거나 숫자가 아닙니다 — 이 행을 건너뜁니다'); stats.skipped++; continue; }
        if (rp <= 0) { warn(ln, 'RPM 이 0 이하(' + rp + ')라 오더를 계산할 수 없습니다 — 이 행을 건너뜁니다'); stats.skipped++; continue; }
        var gw = group(label(rw, 'channel') || '(채널 없음)', label(rw, 'direction') || '(방향 없음)', label(rw, 'unit'), ln);
        if (gw.byRpm[String(rp)]) { warn(ln, 'RPM ' + rp + ' 행이 중복됩니다 — 처음 행만 씁니다'); stats.skipped++; continue; }
        var sp = spectrum(gw, rp), bad = 0;
        fcols.forEach(function (fc) {
          var av = parseNumber(rw[fc.ci], dc);
          if (isNaN(av)) { bad++; return; }
          if (fc.f < 0) return;
          addBin(sp, fc.f, av, ln);
        });
        if (bad) warn(ln, 'RPM ' + rp + ' 행에 비었거나 숫자가 아닌 응답 칸이 ' + bad + '개 있습니다 — 그 칸만 뺍니다');
      }
    } else if (cfg.layout === 'rpmcols') {
      var fcol = map.freq >= 0 ? map.freq : 0;
      var rcols = [];
      headers.forEach(function (h, ci) {
        if (ci === fcol) return;
        var rv = headerNumber(h, dc);
        if (isNaN(rv)) { if (String(h).trim()) warn(hr + 1, '열 「' + h + '」 의 제목이 RPM 숫자가 아니라 계산에서 뺍니다', '정보'); return; }
        if (rv <= 0) { warn(hr + 1, '열 「' + h + '」 의 RPM 이 0 이하라 오더를 계산할 수 없습니다 — 이 열을 뺍니다'); return; }
        rcols.push({ ci: ci, rpm: rv });
      });
      if (!rcols.length) { warn(hr + 1, 'RPM 숫자로 된 열 제목이 없습니다 — 배치를 확인하세요', '오류'); return { groups: [], log: log, stats: stats }; }
      var gr = group(String(fixed.channel || '').trim() || '(채널 없음)', String(fixed.direction || '').trim() || '(방향 없음)', String(fixed.unit || '').trim(), hr + 1);
      for (var k = hr + 1; k < rows.length; k++) {
        var rr = rows[k], lk = k + 1;
        stats.dataRows++;
        var fq = parseNumber(rr[fcol], dc);
        if (isNaN(fq) || fq < 0) { warn(lk, '주파수 값이 비었거나 올바르지 않습니다 — 이 행을 건너뜁니다'); stats.skipped++; continue; }
        var bd = 0;
        rcols.forEach(function (rc) {
          var v = parseNumber(rr[rc.ci], dc);
          if (isNaN(v)) { bd++; return; }
          addBin(spectrum(gr, rc.rpm), fq, v, lk);
        });
        if (bd) warn(lk, '주파수 ' + fq + ' Hz 행에 비었거나 숫자가 아닌 칸이 ' + bd + '개 있습니다 — 그 칸만 뺍니다');
      }
    } else if (cfg.layout === 'testlab') {
      return normalizeTestlab(rows, dc, log, stats);
    } else {
      warn(0, '알 수 없는 배치입니다: ' + cfg.layout, '오류');
    }

    var out = order.map(function (key) {
      var g = groups[key];
      var list = g.rpms.slice().sort(function (a, b) { return a - b; }).map(function (rpm) {
        var sp = g.byRpm[String(rpm)];
        var fs = Object.keys(sp.bins).map(Number).sort(function (a, b) { return a - b; });
        return { rpm: rpm, freqs: fs, amps: fs.map(function (f) { return sp.bins[String(f)]; }) };
      }).filter(function (s) { return s.freqs.length; });
      var sc = unitScale(g.unit);
      list.forEach(function (sp) { sp.scale = sc; });
      return { key: key, channel: g.channel, direction: g.direction, unit: g.unit || '', channelType: channelTypeOf(g.unit, sc), scale: sc, spectra: list };
    }).filter(function (g) { return g.spectra.length; });
    if (!out.length && !log.some(function (x) { return x.level === '오류'; })) warn(0, '계산할 수 있는 데이터가 없습니다', '오류');
    stats.groups = out.length;
    stats.spectra = out.reduce(function (s, g) { return s + g.spectra.length; }, 0);
    return { groups: out, log: log, stats: stats };
  }

  // Testlab Neo 내보내기 → 그룹(위치·방향)별 스펙트럼.  경고는 v34 의 구조 검증 항목을 따릅니다.
  function normalizeTestlab(rows, dc, log, stats) {
    function warn(line, msg, level) { log.push({ level: level || '경고', line: line, message: msg }); }
    var tl = parseTestlab(rows, dc);
    if (tl.error) { warn(1, tl.error + ' — Testlab Neo 내보내기가 아니면 배치를 바꾸세요', '오류'); return { groups: [], log: log, stats: stats }; }
    var lineOf = function (i) { return rows.lineNo ? rows.lineNo[i] : i + 1; };
    var groups = {}, order = [], allRpms = {};
    stats.dataRows = rows.length - tl.dataStart;
    tl.curves.forEach(function (cv) {
      var name = 'Curve ' + cv.curveNo + '(' + (cv.yCol + 1) + '열' + (cv.point ? ' · ' + cv.point : '') + ')';
      if (!(cv.rpm > 0)) { warn(1, name + ': 이름 「' + (cv.runName || '없음') + '」 에서 RPM 을 읽지 못해 이 Curve 를 뺍니다'); stats.skipped++; return; }
      if (!cv.point) warn(1, name + ': 위치(DOF id·Point id)를 읽지 못해 「(위치 없음)」 으로 묶습니다');
      if (cv.channelType === 'vibration' && !cv.direction) warn(1, name + ': 진동 채널인데 방향(X·Y·Z)을 읽지 못했습니다');
      if (cv.xUnit && cv.xUnit.trim().toLowerCase() !== 'hz') warn(1, name + ': X축 단위가 Hz 가 아닙니다(' + cv.xUnit + ') — 주파수(Hz)로 보고 계산합니다');
      var freqs = [], amps = [], bad = 0, firstBad = 0, sorted = true;
      for (var r = tl.dataStart; r < rows.length; r++) {
        var row = rows[r], x = parseNumber(row[cv.xCol], dc), y = parseNumber(row[cv.yCol], dc);
        if (isNaN(x) || isNaN(y) || x < 0) {
          if (String(row[cv.yCol] == null ? '' : row[cv.yCol]).trim() !== '') { bad++; if (!firstBad) firstBad = lineOf(r); }
          continue;
        }
        if (freqs.length && x <= freqs[freqs.length - 1]) sorted = false;
        freqs.push(x); amps.push(y);
      }
      if (bad) warn(firstBad, name + ': 숫자로 읽을 수 없는 값이 ' + bad + '칸 있어 그 칸만 뺍니다(첫 위치 ' + firstBad + '줄)');
      if (!sorted) {
        var idx = freqs.map(function (_, k) { return k; }).sort(function (a, b) { return freqs[a] - freqs[b]; });
        var f2 = [], a2 = [];
        idx.forEach(function (k) { if (f2.length && freqs[k] === f2[f2.length - 1]) return; f2.push(freqs[k]); a2.push(amps[k]); });
        warn(tl.dataLine, name + ': 주파수가 오름차순이 아니거나 중복돼 정렬했습니다(중복은 처음 값만)');
        freqs = f2; amps = a2;
      }
      if (!freqs.length) { warn(tl.dataLine, name + ': 숫자 스펙트럼 데이터가 없습니다', '오류'); stats.skipped++; return; }
      var ch = cv.point || '(위치 없음)', key = ch + '|' + cv.direction + '|' + cv.channelType;
      var g = groups[key];
      if (!g) { g = groups[key] = { key: key, channel: ch, direction: cv.direction, unit: cv.unit, channelType: cv.channelType, byRpm: {} }; order.push(key); }
      else if (cv.unit && g.unit && cv.unit !== g.unit && !g._unitWarned) { warn(1, groupLabel(g) + ' 안에서 단위가 다릅니다(' + g.unit + ' / ' + cv.unit + ') — 처음 단위로 표시합니다'); g._unitWarned = true; }
      if (g.byRpm[cv.rpm]) { warn(1, groupLabel(g) + ' · ' + cv.rpm + ' RPM Curve 가 또 있습니다(' + name + ') — 처음 것만 씁니다'); stats.skipped++; return; }
      g.byRpm[cv.rpm] = { rpm: cv.rpm, freqs: freqs, amps: amps, scale: cv.scale };
      allRpms[cv.rpm] = true;
    });
    var rpmList = Object.keys(allRpms).map(Number).sort(function (a, b) { return a - b; });
    var out = order.map(function (key) {
      var g = groups[key];
      var missing = rpmList.filter(function (r) { return !g.byRpm[r]; });
      if (missing.length) warn(1, groupLabel(g) + ': ' + missing.join(', ') + ' RPM Curve 가 없습니다');
      var spectra = Object.keys(g.byRpm).map(Number).sort(function (a, b) { return a - b; }).map(function (r) { return g.byRpm[r]; });
      var scales = {}; spectra.forEach(function (sp) { scales[sp.scale] = true; });
      return { key: key, channel: g.channel, direction: g.direction, unit: g.unit, channelType: g.channelType, scale: Object.keys(scales).join('/'), spectra: spectra };
    });
    // 소음을 먼저, 그다음 위치 이름 순 (v34 채널 순서와 같게)
    out.sort(function (a, b) { return (a.channelType === 'noise' ? 0 : 1) - (b.channelType === 'noise' ? 0 : 1) || (a.channel + a.direction).localeCompare(b.channel + b.direction); });
    if (!out.length) warn(0, '계산할 수 있는 데이터가 없습니다', '오류');
    else log.unshift({ level: '정보', line: tl.dataLine, message: 'Testlab Neo 내보내기로 읽었습니다 — Curve ' + tl.curves.length + '개(' + (tl.format === 'shared' ? '공통 주파수 축' : 'Curve별 X/Y 열') + '), 데이터 시작 ' + tl.dataLine + '줄, 위치·방향 ' + out.length + '개, RPM ' + rpmList.length + '개' });
    stats.groups = out.length;
    stats.spectra = out.reduce(function (s, g) { return s + g.spectra.length; }, 0);
    return { groups: out, log: log, stats: stats };
  }
  function groupLabel(g) {
    return g.channel + (g.direction ? ' · ' + g.direction : '') + (g.channelType === 'noise' ? ' [소음]' : g.channelType === 'vibration' ? ' [진동]' : '');
  }

  // ── 계산 ───────────────────────────────────────────────────
  function toOrder(freq, rpm, ratio) { return freq * 60 / (rpm * (ratio || 1)); }
  function toFreq(order, rpm, ratio) { return order * rpm * (ratio || 1) / 60; }

  // "1, 2, 4.5" → [1, 2, 4.5]  (0 이하·중복 제외, 오름차순)
  function parseOrders(s) {
    var seen = {}, out = [];
    String(s || '').split(/[,\s;]+/).forEach(function (t) {
      var n = parseNumber(t);
      if (!isNaN(n) && n > 0 && !seen[n]) { seen[n] = true; out.push(n); }
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function rss(values) {
    var s = 0;
    for (var i = 0; i < values.length; i++) s += values[i] * values[i];
    return Math.sqrt(s);
  }

  // 한 그룹에서 지정 오더의 RPM 별 진폭
  // 반환 [{ rpm, amp, freq, order, bins }]  — 대역 안에 주파수 칸이 없으면 amp=null
  function trackOrder(spectra, order, halfWidth, method, ratio) {
    return spectra.map(function (sp) {
      var lo = order - halfWidth, hi = order + halfWidth;
      var vals = [], bestI = -1;
      for (var i = 0; i < sp.freqs.length; i++) {
        var o = toOrder(sp.freqs[i], sp.rpm, ratio);
        if (o < lo || o > hi) continue;
        vals.push(sp.amps[i]);
        if (bestI < 0 || sp.amps[i] > sp.amps[bestI]) bestI = i;
      }
      if (!vals.length) return { rpm: sp.rpm, amp: null, freq: null, order: null, bins: 0 };
      return {
        rpm: sp.rpm,
        amp: method === 'rss' ? rss(vals) : sp.amps[bestI],
        freq: sp.freqs[bestI],
        order: toOrder(sp.freqs[bestI], sp.rpm, ratio),
        bins: vals.length
      };
    });
  }

  // ── 단위·dB (제출자 분석기 v34 와 같은 식) ────────────────────────
  // A-가중(IEC 61672) — v34 aWeighting 과 같은 식. f ≤ 0 이면 -Infinity
  function aWeighting(f) {
    if (!(f > 0)) return -Infinity;
    var f2 = f * f;
    var ra = (12194 * 12194 * f2 * f2) / ((f2 + 20.6 * 20.6) * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) * (f2 + 12194 * 12194));
    return 20 * Math.log10(ra) + 2.0;
  }
  // 그룹 종류(소음·진동)에 맞는 표시 설정
  function typeSettings(g, s) {
    var noise = g && g.channelType === 'noise';
    return {
      mode: noise ? s.noiseMode : s.vibMode,
      ref: Number(noise ? s.noiseRef : s.vibRef),
      srcRef: Number(noise ? s.noiseSrcRef : s.vibSrcRef)
    };
  }
  // 선형 진폭 → 표시값.  linear 그대로 / dB = 20·log10(a/기준) / dBA = dB + A(f)
  function displayOf(a, f, mode, ref) {
    if (a == null || !isFinite(a)) return null;
    if (mode !== 'db' && mode !== 'dba') return a;
    if (!(a > 0) || !(ref > 0)) return null;
    var db = 20 * Math.log10(a / ref);
    if (mode === 'dba') { var w = aWeighting(f); return isFinite(w) ? db + w : null; }
    return db;
  }
  function unitLabel(mode, unit) { return mode === 'db' ? 'dB' : mode === 'dba' ? 'dBA' : (unit || ''); }
  // 원본이 dB·dBA 인 스펙트럼을 선형 진폭으로 바꿉니다: 진폭 = 기준 × 10^(dB/20), dBA 는 A-가중을 먼저 뺍니다.
  // v34 는 소음 dB 를 Pa 로 바꿔 두고, 진동 dB 는 합산할 때 에너지(10^(dB/10))로 더한 뒤 되돌립니다 — 결과는 같습니다.
  function linearize(groups, settings) {
    var s = Object.assign({}, DEFAULT_SETTINGS, settings || {}), log = [];
    var out = groups.map(function (g) {
      if (!g.spectra.some(function (sp) { return sp.scale === 'db' || sp.scale === 'dba'; })) return g;
      var ts = typeSettings(g, s);
      if (!(ts.srcRef > 0)) { log.push({ level: '오류', line: '', message: groupLabel(g) + ': 원본 dB 기준값이 0보다 커야 선형으로 바꿀 수 있습니다' }); return Object.assign({}, g, { spectra: [] }); }
      var spectra = g.spectra.map(function (sp) {
        if (sp.scale !== 'db' && sp.scale !== 'dba') return sp;
        var fs = [], as = [];
        for (var i = 0; i < sp.freqs.length; i++) {
          var db = sp.scale === 'dba' ? sp.amps[i] - aWeighting(sp.freqs[i]) : sp.amps[i];
          var a = ts.srcRef * Math.pow(10, db / 20);
          if (isFinite(a) && a >= 0) { fs.push(sp.freqs[i]); as.push(a); }
        }
        return { rpm: sp.rpm, freqs: fs, amps: as, scale: 'linear', source: sp.scale };
      });
      var unit = g.unit && unitScale(g.unit) === 'linear' ? g.unit : (g.channelType === 'noise' ? 'Pa' : '');
      return Object.assign({}, g, { spectra: spectra, unit: unit, sourceScale: g.scale, sourceRef: ts.srcRef });
    });
    return { groups: out, log: log };
  }

  // 오더 추적 — 제출자 분석기 v34 방식 (calculateOrderRows 와 같은 계산)
  //  1) 이론 주파수 = 오더 × RPM × 회전비 / 60
  //  2) 이론 주파수 ± 검색 범위(Hz) 안에서 진폭이 가장 큰 칸 = 검출 피크 (검색 범위 0 이면 가장 가까운 칸)
  //  3) 검출 피크 ± 합산 범위(Hz) 안 칸들의 제곱합의 제곱근 = 오더 진폭 (합산 범위 0 이면 피크 칸 하나)
  //  판정 「일치」 = 이론 주파수가 측정 범위 안이고 피크를 찾음
  function trackOrderPeak(spectra, order, searchHz, sumHz, ratio) {
    var sw = Number(searchHz), uw = Number(sumHz);
    return spectra.map(function (sp) {
      var fs = sp.freqs, as = sp.amps, n = fs.length;
      var f1 = sp.rpm * (ratio || 1) / 60, target = order * f1;
      var fmin = fs[0], fmax = fs[n - 1];
      var sMin = Math.max(fmin, target - sw), sMax = Math.min(fmax, target + sw);
      var pi = -1, pa = -Infinity, i;
      if (sw === 0) {
        var nd = Infinity;
        for (i = 0; i < n; i++) { var d = Math.abs(fs[i] - target); if (d < nd) { nd = d; pi = i; pa = as[i]; } }
      } else {
        for (i = 0; i < n; i++) if (fs[i] >= sMin && fs[i] <= sMax && as[i] > pa) { pa = as[i]; pi = i; }
      }
      var inRange = target >= fmin && target <= fmax;
      if (pi < 0) return { rpm: sp.rpm, f1: f1, target: target, searchMin: sMin, searchMax: sMax, amp: null, peakAmp: null, freq: null, order: null, bins: 0, sumMin: null, sumMax: null, dev: null, inRange: inRange, matched: false };
      var pf = fs[pi], lo = Math.max(fmin, pf - uw), hi = Math.min(fmax, pf + uw), ss = 0, cnt = 0;
      if (uw === 0) { ss = pa * pa; cnt = 1; }
      else for (i = 0; i < n; i++) if (fs[i] >= lo && fs[i] <= hi) { ss += as[i] * as[i]; cnt++; }
      var dev = pf - target;
      return {
        rpm: sp.rpm, f1: f1, target: target, searchMin: sMin, searchMax: sMax,
        amp: Math.sqrt(ss), peakAmp: pa, freq: pf, order: pf / f1, bins: cnt, sumMin: lo, sumMax: hi, dev: dev,
        inRange: inRange, matched: inRange && Math.abs(dev) <= sw + 1e-12
      };
    });
  }

  // 오더 RSS 합산 (v34 buildRssSumSeries) — 같은 RPM 에서 각 오더 진폭의 제곱합의 제곱근.
  // 구성 오더 중 하나라도 값이 없으면 그 RPM 은 뺍니다. dBA 는 오더마다 검출 피크 주파수에서 A-가중한 뒤 합산합니다.
  function rssOrders(tracks, ts) {
    if (tracks.length < 2) return null;
    var pts = [];
    tracks[0].points.forEach(function (_, i) {
      var comps = tracks.map(function (t) { return t.points[i]; });
      if (comps.some(function (p) { return p.amp == null || !isFinite(p.amp); })) return;
      var lin = Math.sqrt(comps.reduce(function (s, p) { return s + p.amp * p.amp; }, 0));
      var disp;
      if (ts.mode === 'dba') {
        var w = Math.sqrt(comps.reduce(function (s, p) { var k = Math.pow(10, aWeighting(p.freq) / 20); return s + Math.pow(p.amp * k, 2); }, 0));
        disp = w > 0 && ts.ref > 0 ? 20 * Math.log10(w / ts.ref) : null;
      } else disp = displayOf(lin, null, ts.mode, ts.ref);
      pts.push({ rpm: comps[0].rpm, amp: lin, disp: disp, comps: comps, matched: comps.every(function (p) { return p.matched; }) });
    });
    return { orders: tracks.map(function (t) { return t.order; }), points: pts };
  }

  // 파일 이름에서 관심 오더 짐작: 「130B-X 36,45order.csv」 → "36, 45"  (제출자 파일 이름 관례)
  function ordersFromName(name) {
    var m = String(name || '').match(/(\d+(?:\.\d+)?(?:\s*[,&+]\s*\d+(?:\.\d+)?)*)\s*(?:order|차)/i);
    return m ? parseOrders(m[1].replace(/[&+]/g, ',')).join(', ') : '';
  }

  // 국소 최대값 피크: 양옆보다 크거나 같고, 적어도 한쪽보다 큼. 끝 칸은 한쪽 이웃만 봅니다.
  function findPeaks(freqs, amps, topN, minAmp) {
    var peaks = [];
    for (var i = 0; i < amps.length; i++) {
      var a = amps[i];
      if (!(a > (minAmp || 0))) continue;
      var hasL = i > 0, hasR = i < amps.length - 1;
      var l = hasL ? amps[i - 1] : null, r = hasR ? amps[i + 1] : null;
      var isPeak;
      if (hasL && hasR) isPeak = a >= l && a >= r && (a > l || a > r);
      else if (hasL) isPeak = a > l;          // 끝 칸: 이웃 하나보다 커야 함
      else if (hasR) isPeak = a > r;
      else isPeak = true;
      if (isPeak) peaks.push({ i: i, freq: freqs[i], amp: a });
    }
    peaks.sort(function (x, y) { return y.amp - x.amp || x.freq - y.freq; });
    return topN > 0 ? peaks.slice(0, topN) : peaks;
  }

  // 대역 에너지 합산(제곱합의 제곱근, 가정). axis 'hz' 면 주파수, 'order' 면 오더 기준 대역.
  // lo/hi 가 빈칸·NaN 이면 그쪽 끝 제한 없음
  function bandEnergy(sp, axis, lo, hi, ratio) {
    var L = isNaN(parseNumber(lo)) ? -Infinity : parseNumber(lo);
    var H = isNaN(parseNumber(hi)) ? Infinity : parseNumber(hi);
    var vals = [];
    for (var i = 0; i < sp.freqs.length; i++) {
      var x = axis === 'order' ? toOrder(sp.freqs[i], sp.rpm, ratio) : sp.freqs[i];
      if (x >= L && x <= H) vals.push(sp.amps[i]);
    }
    return { energy: vals.length ? rss(vals) : null, bins: vals.length };
  }

  // 주파수 간격(중앙값) — 피크 검색 범위가 간격보다 좁으면 칸을 못 찾으므로 확인용
  function freqStep(groups) {
    var d = [];
    groups.forEach(function (g) { var f = g.spectra[0] && g.spectra[0].freqs; if (f) for (var i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]); });
    if (!d.length) return null;
    d.sort(function (a, b) { return a - b; });
    return d[Math.floor(d.length / 2)];
  }
  function bandLabel(s) {
    var lo = String(s.energyLo == null ? '' : s.energyLo).trim(), hi = String(s.energyHi == null ? '' : s.energyHi).trim();
    var unit = s.energyAxis === 'order' ? '오더' : 'Hz';
    if (!lo && !hi) return '전체 대역';
    return (lo || '처음') + '~' + (hi || '끝') + ' ' + unit;
  }

  // 한 그룹 전체 분석 → 화면·CSV 공통 결과
  function analyzeGroup(g, settings) {
    var s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    var ratio = Number(s.ratio) > 0 ? Number(s.ratio) : 1;
    var hw = Number(s.halfWidth) > 0 ? Number(s.halfWidth) : DEFAULT_SETTINGS.halfWidth;
    var method = s.trackMethod === 'max' || s.trackMethod === 'rss' ? s.trackMethod : 'peak';
    var sw = Number(s.searchHz) >= 0 ? Number(s.searchHz) : DEFAULT_SETTINGS.searchHz;
    var uw = Number(s.sumHz) >= 0 ? Number(s.sumHz) : DEFAULT_SETTINGS.sumHz;
    var ts = typeSettings(g, s);
    var orders = parseOrders(s.orders);
    var log = [], name = groupLabel(g);
    var tracks = orders.map(function (o) {
      var pts = method === 'peak' ? trackOrderPeak(g.spectra, o, sw, uw, ratio) : trackOrder(g.spectra, o, hw, method, ratio);
      pts.forEach(function (p) {
        if (method !== 'peak') p.matched = p.amp != null;
        p.disp = displayOf(p.amp, p.freq, ts.mode, ts.ref);
      });
      if (method === 'peak') {
        var out = pts.filter(function (p) { return !p.inRange; }).length;
        var none = pts.filter(function (p) { return p.inRange && p.amp == null; }).length;
        if (out) log.push({ level: '경고', line: '', message: name + ' — ' + o + '차 오더: ' + out + '개 RPM 에서 이론 주파수(오더 × RPM / 60)가 측정 주파수 범위 밖이라 「불일치」 입니다' });
        if (none) log.push({ level: '경고', line: '', message: name + ' — ' + o + '차 오더: ' + none + '개 RPM 에서 피크 검색 범위(±' + sw + ' Hz) 안에 주파수 칸이 없습니다 — 검색 범위를 주파수 간격의 절반 이상으로 넓히세요' });
      } else {
        var empty = pts.filter(function (p) { return p.amp == null; }).length;
        if (empty) log.push({ level: '경고', line: '', message: name + ' — ' + o + '차 오더: ' + empty + '개 RPM 에서 대역(±' + hw + ') 안에 주파수 칸이 없습니다(측정 범위 밖이거나 대역이 좁음)' });
      }
      var best = null;
      pts.forEach(function (p) { if (p.disp != null && (!best || p.disp > best.disp)) best = p; });
      return { order: o, points: pts, max: best };
    });
    var rssSum = rssOrders(tracks, ts);
    var topN = Math.max(0, Math.floor(Number(s.peakTopN) || 0));
    var minA = Number(s.peakMin) || 0;
    var peaks = g.spectra.map(function (sp) {
      return { rpm: sp.rpm, peaks: findPeaks(sp.freqs, sp.amps, topN, minA).map(function (p, k) {
        return { rank: k + 1, freq: p.freq, order: toOrder(p.freq, sp.rpm, ratio), amp: p.amp, i: p.i };
      }) };
    });
    var energy = g.spectra.map(function (sp) {
      var e = bandEnergy(sp, s.energyAxis, s.energyLo, s.energyHi, ratio);
      return { rpm: sp.rpm, energy: e.energy, bins: e.bins };
    });
    var emptyE = energy.filter(function (e) { return e.energy == null; }).length;
    if (emptyE) log.push({ level: '경고', line: '', message: g.channel + ' · ' + g.direction + ' — 에너지 합산 대역(' + bandLabel(s) + ')에 주파수 칸이 없는 RPM 이 ' + emptyE + '개 있습니다' });
    return {
      group: g, ratio: ratio, halfWidth: hw, method: method, searchHz: sw, sumHz: uw, orders: orders, tracks: tracks, rssSum: rssSum,
      peaks: peaks, energy: energy, log: log, band: bandLabel(s),
      display: { mode: ts.mode, ref: ts.ref, unit: unitLabel(ts.mode, g.unit) }
    };
  }

  // 컬러맵 범위
  function ampRange(spectra) {
    var lo = Infinity, hi = -Infinity;
    spectra.forEach(function (sp) { sp.amps.forEach(function (a) { if (a < lo) lo = a; if (a > hi) hi = a; }); });
    if (lo === Infinity) return { min: 0, max: 1 };
    if (hi === lo) hi = lo + 1;
    return { min: lo, max: hi };
  }

  // 색 막대 (viridis 근사 5점 보간). t: 0~1 → [r,g,b]
  var STOPS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  function colorAt(t) {
    if (!(t > 0)) t = 0; if (t > 1) t = 1;
    var x = t * (STOPS.length - 1), i = Math.min(Math.floor(x), STOPS.length - 2), f = x - i;
    return [0, 1, 2].map(function (c) { return Math.round(STOPS[i][c] + (STOPS[i + 1][c] - STOPS[i][c]) * f); });
  }

  // 가장 가까운 값의 위치 (정렬된 배열)
  function nearestIndex(sorted, v) {
    if (!sorted.length) return -1;
    var lo = 0, hi = sorted.length - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m; else hi = m; }
    return Math.abs(sorted[lo] - v) <= Math.abs(sorted[hi] - v) ? lo : hi;
  }

  // ── 결과 표·CSV ─────────────────────────────────────────────
  function round(v, d) { if (v == null || isNaN(v)) return ''; var p = Math.pow(10, d == null ? 6 : d); return Math.round(v * p) / p; }

  var METHOD_LABEL = { peak: '피크 검색 ± 합산 RSS(v34)', max: '오더 대역 최대값', rss: '오더 대역 RSS' };
  // 오더 추적 CSV — v34 「Order Analysis」 시트와 같은 열 + 단위·방식
  function trackRows(results) {
    var out = [['채널', '방향', '종류', '단위', '오더', 'RPM', '1X 주파수(Hz)', '이론 오더 주파수(Hz)', '검출 피크 주파수(Hz)', '주파수 편차(Hz)',
      '피크 검색 하한(Hz)', '피크 검색 상한(Hz)', '합산 하한(Hz)', '합산 상한(Hz)', '합산 칸 수', '단일 피크 진폭', '오더 합산 진폭', '표시 진폭', '표시 단위', '판정', '방식']];
    results.forEach(function (res) {
      var g = res.group;
      res.tracks.forEach(function (t) {
        t.points.forEach(function (p) {
          var f1 = g.spectra.length ? p.rpm * res.ratio / 60 : '';
          out.push([g.channel, g.direction, typeLabel(g), g.unit, t.order, p.rpm, round(f1, 4), round(t.order * f1, 4), round(p.freq, 4), round(p.dev, 4),
            round(p.searchMin, 4), round(p.searchMax, 4), round(p.sumMin, 4), round(p.sumMax, 4), p.bins, round(p.peakAmp), round(p.amp), round(p.disp), res.display.unit,
            p.matched ? '일치' : '불일치', METHOD_LABEL[res.method]]);
        });
      });
    });
    return out;
  }
  // 오더 RSS 합산 CSV — v34 「Order RSS Sum」 시트
  function rssRows(results) {
    var out = [['채널', '방향', '종류', '단위', '합산 오더', 'RPM', '구성 오더별 표시 진폭', 'RSS 합산(선형)', '표시 진폭', '표시 단위', '판정']];
    results.forEach(function (res) {
      if (!res.rssSum) return;
      var g = res.group;
      res.rssSum.points.forEach(function (p) {
        var comps = p.comps.map(function (c, k) { return res.rssSum.orders[k] + '차=' + (c.disp == null ? '-' : round(c.disp, 4)); }).join(' | ');
        out.push([g.channel, g.direction, typeLabel(g), g.unit, res.rssSum.orders.join(' + '), p.rpm, comps, round(p.amp), round(p.disp), res.display.unit, p.matched ? '모두 일치' : '일부 불일치']);
      });
    });
    return out;
  }
  function typeLabel(g) { return g.channelType === 'noise' ? '소음' : '진동'; }
  function peakRows(results) {
    var out = [['채널', '방향', '단위', 'RPM', '순위', '주파수(Hz)', '오더', '진폭']];
    results.forEach(function (res) {
      res.peaks.forEach(function (r) {
        r.peaks.forEach(function (p) { out.push([res.group.channel, res.group.direction, res.group.unit, r.rpm, p.rank, round(p.freq, 4), round(p.order, 4), round(p.amp)]); });
      });
    });
    return out;
  }
  function orderMaxRows(results) {
    var out = [['채널', '방향', '단위', '오더', '최대 진폭', '최대일 때 RPM', '최대일 때 주파수(Hz)', '최대 표시 진폭', '표시 단위']];
    results.forEach(function (res) {
      res.tracks.forEach(function (t) {
        out.push([res.group.channel, res.group.direction, res.group.unit, t.order, t.max ? round(t.max.amp) : '', t.max ? t.max.rpm : '', t.max ? round(t.max.freq, 4) : '', t.max ? round(t.max.disp) : '', res.display.unit]);
      });
      if (res.rssSum) {
        var best = null;
        res.rssSum.points.forEach(function (p) { if (p.disp != null && (!best || p.disp > best.disp)) best = p; });
        out.push([res.group.channel, res.group.direction, res.group.unit, 'RSS(' + res.rssSum.orders.join('+') + ')', best ? round(best.amp) : '', best ? best.rpm : '', '', best ? round(best.disp) : '', res.display.unit]);
      }
    });
    return out;
  }
  function energyRows(results) {
    var out = [['채널', '방향', '단위', 'RPM', '대역', '에너지 합산(RSS)', '대역 칸 수']];
    results.forEach(function (res) {
      res.energy.forEach(function (e) { out.push([res.group.channel, res.group.direction, res.group.unit, e.rpm, res.band, round(e.energy), e.bins]); });
    });
    return out;
  }
  function logRows(log) {
    var out = [['구분', '원본 줄', '내용']];
    log.forEach(function (x) { out.push([x.level, x.line === 0 ? '' : x.line, x.message]); });
    return out;
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }

  function analyzeAll(groups, settings) {
    return groups.map(function (g) { return analyzeGroup(g, settings); });
  }

  var api = {
    LAYOUTS: LAYOUTS, FIELDS: FIELDS, FIELD_LABEL: FIELD_LABEL, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    detectDelimiter: detectDelimiter, parseCsv: parseCsv, parseNumber: parseNumber, headerNumber: headerNumber,
    guessHeaderRow: guessHeaderRow, guessMapping: guessMapping, guessLayout: guessLayout, normalize: normalize,
    toOrder: toOrder, toFreq: toFreq, parseOrders: parseOrders, rss: rss, trackOrder: trackOrder,
    findPeaks: findPeaks, bandEnergy: bandEnergy, bandLabel: bandLabel, analyzeGroup: analyzeGroup, analyzeAll: analyzeAll,
    ampRange: ampRange, colorAt: colorAt, nearestIndex: nearestIndex, round: round,
    isTestlab: isTestlab, parseTestlab: parseTestlab, unitScale: unitScale, channelTypeOf: channelTypeOf, rpmFromName: rpmFromName, groupLabel: groupLabel,
    aWeighting: aWeighting, typeSettings: typeSettings, displayOf: displayOf, unitLabel: unitLabel, linearize: linearize,
    trackOrderPeak: trackOrderPeak, freqStep: freqStep, rssOrders: rssOrders, ordersFromName: ordersFromName, METHOD_LABEL: METHOD_LABEL,
    trackRows: trackRows, rssRows: rssRows, peakRows: peakRows, orderMaxRows: orderMaxRows, energyRows: energyRows, logRows: logRows, toCsv: toCsv
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OALogic = api;
})(typeof window !== 'undefined' ? window : this);
