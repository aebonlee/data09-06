// 실행: node test/logic.test.mjs   (의존성 없음)
// 기대값은 손으로 계산한 값입니다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + ' ≠ ' + b);

// ── CSV 읽기 ──
test('CSV — 따옴표·쉼표·빈 줄', () => {
  const rows = L.parseCsv('﻿a,b\r\n"x,1","say ""hi"""\n\n3,4\n');
  assert.deepEqual(rows, [['a', 'b'], ['x,1', 'say "hi"'], ['3', '4']]);
});
test('구분자 짐작 — 세미콜론·탭', () => {
  assert.equal(L.detectDelimiter('RPM;Freq;Val\n1000;4,0;0,1\n1100;8,0;0,2'), ';');
  assert.equal(L.detectDelimiter('RPM\tFreq\n1000\t4\n'), '\t');
  assert.equal(L.detectDelimiter('RPM,Freq\n1000,4\n'), ',');
});
test('숫자 읽기 — 소수점 쉼표, 지수, 잘못된 값', () => {
  assert.equal(L.parseNumber('1,25', true), 1.25);
  assert.equal(L.parseNumber('1.250,5', true), 1250.5);
  assert.equal(L.parseNumber('2.5e-3'), 0.0025);
  assert.ok(isNaN(L.parseNumber('')));
  assert.ok(isNaN(L.parseNumber('12abc')));
});
test('열 제목 숫자 — "125 Hz", "[Hz]" 허용, 글자 제목은 NaN', () => {
  assert.equal(L.headerNumber('125 Hz'), 125);
  assert.equal(L.headerNumber('62.5 [Hz]'), 62.5);
  assert.equal(L.headerNumber('1000 rpm'), 1000);
  assert.ok(isNaN(L.headerNumber('Channel')));
  assert.ok(isNaN(L.headerNumber('3 dB')));
});
test('머리행 짐작 — Testlab 머리 정보 줄 건너뛰기', () => {
  const rows = [['Project', 'demo'], ['Section', 'run-up'], ['RPM', 'Frequency', 'Response'], ['1000', '4', '0.1'], ['1000', '8', '0.2']];
  assert.equal(L.guessHeaderRow(rows), 2);
});
test('열 매핑 짐작', () => {
  const m = L.guessMapping(['RPM', 'Channel', 'Direction', 'Unit', 'Frequency (Hz)', 'Response']);
  assert.deepEqual(m, { rpm: 0, channel: 1, direction: 2, unit: 3, freq: 4, value: 5 });
  const k = L.guessMapping(['회전수', '채널', '방향', '단위', '주파수', '진폭']);
  assert.deepEqual(k, { rpm: 0, channel: 1, direction: 2, unit: 3, freq: 4, value: 5 });
});
test('배치 짐작', () => {
  assert.equal(L.guessLayout(['RPM', 'Channel', 'Frequency', 'Response']), 'long');
  assert.equal(L.guessLayout(['RPM', 'Channel', '4', '8', '12']), 'wide');
  assert.equal(L.guessLayout(['Frequency', '1000', '1100', '1200']), 'rpmcols');
});

// ── 오더 ──
test('오더 = 주파수 × 60 / RPM (회전비 반영)', () => {
  assert.equal(L.toOrder(100, 3000), 2);        // 100*60/3000
  assert.equal(L.toOrder(100, 3000, 2), 1);     // 회전비 2 → 1차
  assert.equal(L.toFreq(2, 3000), 100);
});
test('오더 목록 읽기', () => {
  assert.deepEqual(L.parseOrders('4, 1 2; 2 -1 0 abc 0.5'), [0.5, 1, 2, 4]);
});

// 손 계산용 작은 스펙트럼: RPM 600 → 1차 = 10 Hz
const sp600 = { rpm: 600, freqs: [5, 8, 10, 12, 20, 30], amps: [1, 3, 4, 2, 5, 0.5] };
// 오더: 0.5, 0.8, 1.0, 1.2, 2.0, 3.0
test('오더 추적 — 대역 최대값', () => {
  const [p] = L.trackOrder([sp600], 1, 0.25, 'max', 1);   // 0.75~1.25 → 8,10,12 Hz
  assert.equal(p.amp, 4); assert.equal(p.freq, 10); assert.equal(p.bins, 3); assert.equal(p.order, 1);
});
test('오더 추적 — 대역 RSS', () => {
  const [p] = L.trackOrder([sp600], 1, 0.25, 'rss', 1);   // √(9+16+4)=√29
  close(p.amp, Math.sqrt(29));
});
test('오더 추적 — 대역 안에 칸이 없으면 null', () => {
  const [p] = L.trackOrder([sp600], 2.5, 0.2, 'max', 1);
  assert.equal(p.amp, null); assert.equal(p.bins, 0);
});
test('피크 — 국소 최대값, 큰 순, 개수·최소값', () => {
  // 국소 최대: 10Hz(4), 20Hz(5). 끝 칸 30Hz(0.5)는 왼쪽 5보다 작아 제외
  const p = L.findPeaks(sp600.freqs, sp600.amps, 0, 0);
  assert.deepEqual(p.map(x => x.freq), [20, 10]);
  assert.deepEqual(L.findPeaks(sp600.freqs, sp600.amps, 1, 0).map(x => x.amp), [5]);
  assert.deepEqual(L.findPeaks(sp600.freqs, sp600.amps, 0, 4.5).map(x => x.freq), [20]);
  assert.deepEqual(L.findPeaks([1, 2, 3], [2, 2, 2], 0, 0), []); // 평평하면 피크 없음
});
test('에너지 합산 — Hz 대역·오더 대역·전체', () => {
  close(L.bandEnergy(sp600, 'hz', 8, 12).energy, Math.sqrt(29));
  close(L.bandEnergy(sp600, 'order', 1.9, '', 1).energy, Math.sqrt(25 + 0.25)); // 2.0·3.0 오더
  close(L.bandEnergy(sp600, 'hz', '', '').energy, Math.sqrt(1 + 9 + 16 + 4 + 25 + 0.25));
  assert.equal(L.bandEnergy(sp600, 'hz', 100, 200).energy, null);
  close(L.rss([3, 4]), 5);
});
test('대역 이름', () => {
  assert.equal(L.bandLabel({ energyAxis: 'hz', energyLo: '', energyHi: '' }), '전체 대역');
  assert.equal(L.bandLabel({ energyAxis: 'order', energyLo: '0.5', energyHi: '' }), '0.5~끝 오더');
});

// ── 표준화·형식 검사 ──
const LONG = [
  ['RPM', 'Channel', 'Direction', 'Unit', 'Frequency', 'Response'],
  ['600', 'CH1', 'X', 'g', '10', '4'],
  ['600', 'CH1', 'X', 'g', '5', '1'],
  ['600', 'CH1', 'X', 'g', '10', '9'],     // 중복 주파수 → 경고, 처음 값(4) 유지
  ['1200', 'CH1', 'X', 'g', '20', '2'],
  ['', 'CH1', 'X', 'g', '20', '2'],        // RPM 빈칸 → 건너뜀
  ['0', 'CH1', 'X', 'g', '20', '2'],       // RPM 0 → 건너뜀
  ['600', 'CH1', 'Y', 'm/s2', '10', '7'],
  ['600', 'CH1', 'Y', 'g', '20', '8']      // 같은 그룹 안 단위 다름 → 경고
];
const MAP = { rpm: 0, channel: 1, direction: 2, unit: 3, freq: 4, value: 5 };
test('세로형 표준화 — 그룹·RPM 정렬·주파수 정렬', () => {
  const r = L.normalize(LONG, { headerRow: 0, layout: 'long', mapping: MAP });
  assert.equal(r.groups.length, 2);
  const x = r.groups[0];
  assert.equal(x.key, 'CH1|X');
  assert.deepEqual(x.spectra.map(s => s.rpm), [600, 1200]);
  assert.deepEqual(x.spectra[0].freqs, [5, 10]);
  assert.deepEqual(x.spectra[0].amps, [1, 4]);
  assert.equal(r.stats.skipped, 2);
  assert.equal(r.stats.dataRows, 8);
});
test('세로형 형식 검사 — 경고 4건(중복·빈칸·RPM 0·단위), 원본 줄 번호', () => {
  const r = L.normalize(LONG, { headerRow: 0, layout: 'long', mapping: MAP });
  assert.equal(r.log.length, 4);
  assert.deepEqual(r.log.map(x => x.line), [4, 6, 7, 9]);
  assert.ok(r.log[0].message.includes('중복'));
  assert.ok(r.log[3].message.includes('단위'));
});
test('세로형 — 필수 열 미지정이면 오류', () => {
  const r = L.normalize(LONG, { headerRow: 0, layout: 'long', mapping: { rpm: 0, freq: -1, value: 5 } });
  assert.equal(r.groups.length, 0);
  assert.equal(r.log[0].level, '오류');
});
test('채널·방향 열이 없으면 고정값 사용', () => {
  const rows = [['RPM', 'Hz', 'Amp'], ['600', '10', '1']];
  const r = L.normalize(rows, { layout: 'long', mapping: { rpm: 0, freq: 1, value: 2, channel: -1, direction: -1, unit: -1 }, fixed: { channel: 'A', direction: 'Z', unit: 'g' } });
  assert.equal(r.groups[0].channel, 'A'); assert.equal(r.groups[0].direction, 'Z'); assert.equal(r.groups[0].unit, 'g');
});
test('가로형 표준화 — 숫자 제목 열이 주파수, 빈 칸 경고', () => {
  const rows = [['RPM', 'Ch', '5 Hz', '10 Hz', 'Note'], ['600', 'A', '1', '4', 'x'], ['1200', 'A', '', '2', ''], ['600', 'A', '9', '9', '']];
  const r = L.normalize(rows, { layout: 'wide', mapping: { rpm: 0, channel: 1 } });
  const g = r.groups[0];
  assert.deepEqual(g.spectra.map(s => s.rpm), [600, 1200]);
  assert.deepEqual(g.spectra[0].amps, [1, 4]);
  assert.deepEqual(g.spectra[1].freqs, [10]);
  const msgs = r.log.map(x => x.level + ':' + x.line);
  assert.deepEqual(msgs, ['정보:1', '경고:3', '경고:4']); // Note 열 제외, 빈 칸, RPM 중복
});
test('가로형(열=RPM) 표준화', () => {
  const rows = [['Frequency', '600', '1200'], ['10', '4', '1'], ['20', '5', '8']];
  const r = L.normalize(rows, { layout: 'rpmcols', mapping: { freq: 0 }, fixed: { channel: 'CH1', direction: 'X' } });
  const g = r.groups[0];
  assert.equal(g.key, 'CH1|X');
  assert.deepEqual(g.spectra[1], { rpm: 1200, freqs: [10, 20], amps: [1, 8] });
  close(L.trackOrder(g.spectra, 1, 0.1, 'max')[1].amp, 8); // 1200 RPM 1차 = 20 Hz
});
test('소수점 쉼표 + 세미콜론 파일', () => {
  const text = 'RPM;Frequency;Response\n600;10,0;0,5\n';
  const rows = L.parseCsv(text, L.detectDelimiter(text));
  const r = L.normalize(rows, { layout: 'long', mapping: { rpm: 0, freq: 1, value: 2 }, decimalComma: true });
  assert.deepEqual(r.groups[0].spectra[0].amps, [0.5]);
});

// ── 분석·CSV ──
test('그룹 분석 — 오더 최대, 피크 오더, 에너지, 대역 밖 경고', () => {
  const g = { channel: 'A', direction: 'X', unit: 'g', spectra: [sp600] };
  const res = L.analyzeGroup(g, { orders: '1, 5', halfWidth: 0.25, trackMethod: 'max', peakTopN: 2, peakMin: 0, energyAxis: 'hz', energyLo: 8, energyHi: 12, ratio: 1 });
  assert.equal(res.tracks[0].max.amp, 4);
  assert.equal(res.tracks[1].max, null);
  assert.deepEqual(res.peaks[0].peaks.map(p => [p.rank, p.freq, p.order]), [[1, 20, 2], [2, 10, 1]]);
  close(res.energy[0].energy, Math.sqrt(29));
  assert.equal(res.log.length, 1); // 5차 오더(50 Hz)는 측정 범위 밖
});
test('결과 CSV — 머리행·따옴표·반올림', () => {
  const g = { channel: 'A,1', direction: 'X', unit: 'g', spectra: [sp600] };
  const results = L.analyzeAll([g], { orders: '1', halfWidth: 0.25, trackMethod: 'rss', peakTopN: 1, energyAxis: 'hz' });
  const csv = L.toCsv(L.trackRows(results));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], '채널,방향,단위,오더,RPM,진폭,대역 최대 주파수(Hz),대역 최대 오더,대역 칸 수,방식');
  assert.equal(lines[1], '"A,1",X,g,1,600,5.385165,10,1,3,대역 에너지(RSS)'); // √29 = 5.3851648…
  assert.equal(L.peakRows(results).length, 2);
  assert.deepEqual(L.orderMaxRows(results)[1], ['A,1', 'X', 'g', 1, 5.385165, 600, 10]);
  assert.equal(L.energyRows(results)[1][4], '전체 대역');
  assert.deepEqual(L.logRows([{ level: '경고', line: 3, message: 'm' }]), [['구분', '원본 줄', '내용'], ['경고', 3, 'm']]);
});
test('색 막대·가장 가까운 칸', () => {
  assert.deepEqual(L.colorAt(0), [68, 1, 84]);
  assert.deepEqual(L.colorAt(1), [253, 231, 37]);
  assert.deepEqual(L.colorAt(0.5), [33, 145, 140]);
  assert.deepEqual(L.colorAt(2), [253, 231, 37]);
  assert.equal(L.nearestIndex([4, 8, 12], 9.9), 1);
  assert.equal(L.nearestIndex([4, 8, 12], 10.1), 2);
});

// ── 예시 데이터가 도구에서 기대대로 읽히는지 ──
test('예시(세로형) — 6그룹·31 RPM·경고 2건, 3000 RPM 2차 = 100 Hz 최대', () => {
  const text = Sample.longCsv();
  const rows = L.parseCsv(text, L.detectDelimiter(text));
  const hr = L.guessHeaderRow(rows);
  const cfg = { headerRow: hr, layout: L.guessLayout(rows[hr]), mapping: L.guessMapping(rows[hr]) };
  assert.equal(cfg.layout, 'long');
  const r = L.normalize(rows, cfg);
  assert.equal(r.groups.length, 6);
  assert.equal(r.groups[0].spectra.length, 31);
  assert.equal(r.log.length, 2);
  const res = L.analyzeGroup(r.groups[0], { orders: '2', halfWidth: 0.25 });
  const p3000 = res.tracks[0].points.find(p => p.rpm === 3000);
  assert.equal(p3000.freq, 100);
});
test('예시(가로형·열=RPM) — 배치 짐작과 읽기', () => {
  for (const [fn, layout, groups] of [['wideCsv', 'wide', 6], ['rpmColsCsv', 'rpmcols', 1]]) {
    const text = Sample[fn]();
    const rows = L.parseCsv(text, L.detectDelimiter(text));
    const hr = L.guessHeaderRow(rows);
    assert.equal(L.guessLayout(rows[hr]), layout);
    const r = L.normalize(rows, { headerRow: hr, layout, mapping: L.guessMapping(rows[hr]) });
    assert.equal(r.groups.length, groups, fn);
    assert.equal(r.groups[0].spectra.length, 31, fn);
  }
});

console.log(process.exitCode ? '\n실패가 있습니다' : '\n' + passed + '개 모두 통과');
