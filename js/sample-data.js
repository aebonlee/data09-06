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

  var api = { CHANNELS: CHANNELS, DIRS: DIRS, RPMS: RPMS, FREQS: FREQS, amp: amp, longCsv: longCsv, wideCsv: wideCsv, rpmColsCsv: rpmColsCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OASample = api;
})(typeof window !== 'undefined' ? window : this);
