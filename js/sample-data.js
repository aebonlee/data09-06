/*
 * 예시 데이터 생성기 — 전부 가상 데이터입니다(실제 시험 결과 아님).
 * 엔진 런업(1000~4000 RPM, 100 RPM 간격)을 흉내 내어 1·2·4차 오더 성분과
 * 120 Hz 부근 공진, 약한 바닥 잡음을 섞은 주파수축 스펙트럼을 만듭니다.
 * 열 제목(RPM, Channel …)과 단위(g)는 가정이며 Testlab Neo 실제 내보내기와 다를 수 있습니다.
 * 형식 검사·경고 로그를 보여 주려고 세로형·가로형에 일부러 불량 행 2개를 넣습니다.
 */
(function (root) {
  'use strict';
  var CHANNELS = ['CH01', 'CH02'];
  var DIRS = ['X', 'Y', 'Z'];
  var UNIT = 'g';
  var RPMS = []; for (var r = 1000; r <= 4000; r += 100) RPMS.push(r);
  var FREQS = []; for (var f = 4; f <= 400; f += 4) FREQS.push(f);
  // 오더별 기준 진폭 (가상)
  var ORDER_AMPS = [{ o: 1, a: 0.020 }, { o: 2, a: 0.050 }, { o: 4, a: 0.015 }];

  // 결정적 의사난수 (매번 같은 예시가 나오도록)
  function noise(seed) { var x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); }

  function amp(ch, dir, rpm, freq) {
    var chF = ch === 0 ? 1 : 0.6, dirF = [1, 0.7, 1.3][dir];
    var load = Math.pow(rpm / 4000, 2);
    var res = 1 + 3 * Math.exp(-Math.pow((freq - 120) / 15, 2)); // 120 Hz 공진 (가상)
    var s = 0;
    ORDER_AMPS.forEach(function (oa) {
      var fo = oa.o * rpm / 60;
      s += oa.a * load * Math.exp(-Math.pow((freq - fo) / 3, 2));
    });
    var n = 0.0005 * (1 + noise(ch * 1e6 + dir * 1e5 + rpm * 10 + freq));
    return Math.round((s * res * chF * dirF + n) * 1e6) / 1e6;
  }

  function csv(rows) { return rows.map(function (r) { return r.join(','); }).join('\r\n') + '\r\n'; }

  // 세로형: RPM,Channel,Direction,Unit,Frequency (Hz),Response
  function longCsv() {
    var rows = [['RPM', 'Channel', 'Direction', 'Unit', 'Frequency (Hz)', 'Response']];
    CHANNELS.forEach(function (ch, ci) {
      DIRS.forEach(function (d, di) {
        RPMS.forEach(function (rpm) {
          FREQS.forEach(function (f) { rows.push([rpm, ch, d, UNIT, f, amp(ci, di, rpm, f)]); });
        });
      });
    });
    // 일부러 넣은 불량 행 (형식 검사 시연용)
    rows.splice(5, 0, [1000, 'CH01', 'X', UNIT, 20, '']);
    rows.push([0, 'CH02', 'Z', UNIT, 100, 0.01]);
    return csv(rows);
  }

  // 가로형: RPM,Channel,Direction,Unit,4,8,...,400
  function wideCsv() {
    var rows = [['RPM', 'Channel', 'Direction', 'Unit'].concat(FREQS)];
    CHANNELS.forEach(function (ch, ci) {
      DIRS.forEach(function (d, di) {
        RPMS.forEach(function (rpm) {
          rows.push([rpm, ch, d, UNIT].concat(FREQS.map(function (f) { return amp(ci, di, rpm, f); })));
        });
      });
    });
    rows[3][10] = '';                       // 빈 칸 하나
    rows.push(['', 'CH02', 'Z', UNIT].concat(FREQS.map(function () { return 0; }))); // RPM 빈 행
    return csv(rows);
  }

  // 가로형(열=RPM): Frequency (Hz),1000,1100,...  — CH01 · X 한 개 채널만
  function rpmColsCsv() {
    var rows = [['Frequency (Hz)'].concat(RPMS)];
    FREQS.forEach(function (f) { rows.push([f].concat(RPMS.map(function (rpm) { return amp(0, 0, rpm, f); }))); });
    return csv(rows);
  }


  // Testlab Neo 내보내기 모양 (가상 값) — 제출자 실제 파일(docs/source/sim)130B-X 36,45order.csv)과 같은 배치:
  //  「Curve 1」 제목 → 빈 줄 → MS Logging → Standard\All\… 머리 정보(열마다 Curve 하나) → 빈 줄 → 단위 줄 → 척도 줄
  //  → 0열 공통 주파수(Hz) + Curve별 진폭, 끝에 「,,,,」 만 있는 줄.  소음 채널은 원본이 dB(기준 20 µPa)입니다.
  //  실제 파일은 200 KB 가 넘어 리포 samples/ 에는 이 가상 파일을 둡니다(가상 펌프 36·45차 성분).
  var TL_RPMS = [2000, 2100, 2200, 2300, 2400];
  var TL_CH = [
    { dof: 'P1:+X', point: 'P1', unit: 'g', q: 'Acceleration', scale: 'Log (RMS)', sens: '101.5 mV/g', grp: 'Vibration', k: 1 },
    { dof: 'P2:+X', point: 'P2', unit: 'g', q: 'Acceleration', scale: 'Log (RMS)', sens: '96.3 mV/g', grp: 'Vibration', k: 0.5 },
    { dof: 'Mic', point: 'Mic', unit: 'Pa', q: 'Pressure', scale: 'dB', sens: '50.9 mV/Pa', grp: 'Acoustic', k: 1 }
  ];
  var TL_F0 = 1000, TL_F1 = 1800;
  function tlAmpG(ci, rpm, f) {
    var load = Math.pow(rpm / 2400, 2), s = 0;
    [{ o: 36, a: 0.03 }, { o: 45, a: 0.012 }].forEach(function (oa) { s += oa.a * load * Math.exp(-Math.pow((f - oa.o * rpm / 60) / 1.2, 2)); });
    return s * TL_CH[ci].k + 0.00008 * (1 + noise(ci * 1e6 + rpm * 10 + f));
  }
  function tlNum(v) {
    // 실제 파일처럼 작은 값은 「7.05E-05」, 나머지는 소수 9자리 이내
    if (v !== 0 && Math.abs(v) < 1e-4) { var e = v.toExponential(2).toUpperCase().split('E'); var ex = Number(e[1]); return e[0] + 'E' + (ex < 0 ? '-' : '+') + String(Math.abs(ex)).padStart(2, '0'); }
    return String(Math.round(v * 1e9) / 1e9);
  }
  function testlabCsv() {
    var curves = [];
    TL_RPMS.forEach(function (rpm) { TL_CH.forEach(function (c, ci) { curves.push({ rpm: rpm, c: c, ci: ci }); }); });
    var n = curves.length;
    function meta(key, fn) { return ['Standard\\All\\' + key].concat(curves.map(fn)); }
    function same(key, v) { return meta(key, function () { return v; }); }
    var blank = [''].concat(curves.map(function () { return ''; }));
    var rows = [['Curve 1'].concat(curves.map(function () { return ''; })), blank, ['MS Logging'].concat(curves.map(function () { return ''; })),
      meta('Actual sensitivity', function (x) { return x.c.sens; }),
      same('Average type', 'Energy average'),
      same('Bandwidth', '10240 Hz'),
      meta('Channelgroup', function (x) { return x.c.grp; }),
      same('Creator', 'Input'),
      meta('DOF id', function (x) { return x.c.dof; }),
      meta('Dataset name', function (x) { return 'rpm  ' + x.rpm; }),
      same('Domain', 'TestLab'),
      same('Frequency resolution', '1 Hz'),
      same('Function class', 'AutoPower'),
      same('Number of lines', '10241'),
      meta('Original run', function (x) { return 'rpm  ' + (x.rpm + 2); }),
      meta('Point direction', function (x) { return x.c.unit === 'Pa' ? 'None' : ' +X'; }),
      meta('Point direction absolute', function (x) { return x.c.unit === 'Pa' ? 'None' : 'X'; }),
      meta('Point id', function (x) { return x.c.point; }),
      same('Spectrum format', 'linear'),
      same('Spectrum scaling', 'RMS'),
      same('Window type', 'Hanning'),
      same('X axis', '0-10240 Hz'),
      same('X axis increment', '1 Hz'),
      same('X axis quantity', 'Frequency'),
      same('X axis unit', 'Hz'),
      meta('Y axis quantity', function (x) { return x.c.q; }),
      meta('Y axis unit', function (x) { return x.c.unit; }),
      meta('label', function (x) { return 'AutoPower ' + x.c.dof; }),
      blank,
      ['Hz'].concat(curves.map(function (x) { return x.c.unit; })),
      ['Linear'].concat(curves.map(function (x) { return x.c.scale; }))];
    for (var f = TL_F0; f <= TL_F1; f++) {
      rows.push([f].concat(curves.map(function (x) {
        if (x.c.unit === 'Pa') { var pa = 0.9 * tlAmpG(0, x.rpm, f) + 0.0004; return String(Math.round(20 * Math.log10(pa / 2e-5) * 1e8) / 1e8); }
        return tlNum(Math.round(tlAmpG(x.ci, x.rpm, f) * 1e9) / 1e9);
      })));
    }
    rows.push(blank, blank);
    return '﻿' + csv(rows);
  }
  var api = { CHANNELS: CHANNELS, DIRS: DIRS, RPMS: RPMS, FREQS: FREQS, amp: amp, longCsv: longCsv, wideCsv: wideCsv, rpmColsCsv: rpmColsCsv, testlabCsv: testlabCsv, TL_RPMS: TL_RPMS, TL_CH: TL_CH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OASample = api;
})(typeof window !== 'undefined' ? window : this);
