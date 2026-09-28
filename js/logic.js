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
  // 실제 Testlab Neo 내보내기 배치가 확인되지 않아(기획서 10장 3번) 세 가지를 고를 수 있게 합니다.
  var LAYOUTS = {
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
    ratio: 1,             // 기준축 회전비(기어비). 1 = 입력 RPM 축 그대로
    orders: '1, 2, 4',    // 추적할 오더 (예시값 — 사용자가 바꿉니다)
    halfWidth: 0.25,      // 오더 대역 반폭(±) (가정)
    trackMethod: 'max',   // 'max' 대역 최대값 | 'rss' 대역 제곱합의 제곱근
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
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === '') q = true;
      else if (c === d) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }

  // 숫자 읽기. decimalComma=true 면 "1,25" → 1.25 (유럽식 내보내기 대비)
  function parseNumber(s, decimalComma) {
    if (typeof s === 'number') return isFinite(s) ? s : NaN;
    var t = String(s == null ? '' : s).trim();
    if (!t) return NaN;
    if (decimalComma) t = t.replace(/\./g, '').replace(',', '.');
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
      return { key: key, channel: g.channel, direction: g.direction, unit: g.unit || '', spectra: list };
    }).filter(function (g) { return g.spectra.length; });
    if (!out.length && !log.some(function (x) { return x.level === '오류'; })) warn(0, '계산할 수 있는 데이터가 없습니다', '오류');
    stats.groups = out.length;
    stats.spectra = out.reduce(function (s, g) { return s + g.spectra.length; }, 0);
    return { groups: out, log: log, stats: stats };
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
    var orders = parseOrders(s.orders);
    var log = [];
    var tracks = orders.map(function (o) {
      var pts = trackOrder(g.spectra, o, hw, s.trackMethod, ratio);
      var empty = pts.filter(function (p) { return p.amp == null; }).length;
      if (empty) log.push({ level: '경고', line: '', message: g.channel + ' · ' + g.direction + ' — ' + o + '차 오더: ' + empty + '개 RPM 에서 대역(±' + hw + ') 안에 주파수 칸이 없습니다(측정 범위 밖이거나 대역이 좁음)' });
      var best = null;
      pts.forEach(function (p) { if (p.amp != null && (!best || p.amp > best.amp)) best = p; });
      return { order: o, points: pts, max: best };
    });
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
    return { group: g, ratio: ratio, halfWidth: hw, orders: orders, tracks: tracks, peaks: peaks, energy: energy, log: log, band: bandLabel(s) };
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

  function trackRows(results) {
    var out = [['채널', '방향', '단위', '오더', 'RPM', '진폭', '대역 최대 주파수(Hz)', '대역 최대 오더', '대역 칸 수', '방식']];
    results.forEach(function (res) {
      res.tracks.forEach(function (t) {
        t.points.forEach(function (p) {
          out.push([res.group.channel, res.group.direction, res.group.unit, t.order, p.rpm, round(p.amp), round(p.freq, 4), round(p.order, 4), p.bins, res.method === 'rss' ? '대역 에너지(RSS)' : '대역 최대값']);
        });
      });
    });
    return out;
  }
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
    var out = [['채널', '방향', '단위', '오더', '최대 진폭', '최대일 때 RPM', '최대일 때 주파수(Hz)']];
    results.forEach(function (res) {
      res.tracks.forEach(function (t) {
        out.push([res.group.channel, res.group.direction, res.group.unit, t.order, t.max ? round(t.max.amp) : '', t.max ? t.max.rpm : '', t.max ? round(t.max.freq, 4) : '']);
      });
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
    return groups.map(function (g) { var r = analyzeGroup(g, settings); r.method = (settings && settings.trackMethod) || DEFAULT_SETTINGS.trackMethod; return r; });
  }

  var api = {
    LAYOUTS: LAYOUTS, FIELDS: FIELDS, FIELD_LABEL: FIELD_LABEL, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    detectDelimiter: detectDelimiter, parseCsv: parseCsv, parseNumber: parseNumber, headerNumber: headerNumber,
    guessHeaderRow: guessHeaderRow, guessMapping: guessMapping, guessLayout: guessLayout, normalize: normalize,
    toOrder: toOrder, toFreq: toFreq, parseOrders: parseOrders, rss: rss, trackOrder: trackOrder,
    findPeaks: findPeaks, bandEnergy: bandEnergy, bandLabel: bandLabel, analyzeGroup: analyzeGroup, analyzeAll: analyzeAll,
    ampRange: ampRange, colorAt: colorAt, nearestIndex: nearestIndex, round: round,
    trackRows: trackRows, peakRows: peakRows, orderMaxRows: orderMaxRows, energyRows: energyRows, logRows: logRows, toCsv: toCsv
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OALogic = api;
})(typeof window !== 'undefined' ? window : this);
