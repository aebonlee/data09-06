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
  assert.deepEqual(g.spectra[1], { rpm: 1200, freqs: [10, 20], amps: [1, 8], scale: 'linear' });
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
test('결과 CSV — 머리행·따옴표·반올림 (v34 Order Analysis 열)', () => {
  const g = { channel: 'A,1', direction: 'X', unit: 'g', channelType: 'vibration', spectra: [sp600] };
  const results = L.analyzeAll([g], { orders: '1', searchHz: 2, sumHz: 2, peakTopN: 1, energyAxis: 'hz' });
  const lines = L.toCsv(L.trackRows(results)).trim().split('\r\n');
  assert.ok(lines[0].startsWith('채널,방향,종류,단위,오더,RPM,1X 주파수(Hz),이론 오더 주파수(Hz),검출 피크 주파수(Hz)'));
  // 600 RPM → 1X 10 Hz. 검색 8~12 Hz 최대 = 10 Hz(4). 합산 8~12 Hz = √(9+16+4) = √29 = 5.3851648…
  assert.equal(lines[1], '"A,1",X,진동,g,1,600,10,10,10,0,8,12,8,12,3,4,5.385165,5.385165,g,일치,피크 검색 ± 합산 RSS(v34)');
  assert.equal(L.peakRows(results).length, 2);
  assert.deepEqual(L.orderMaxRows(results)[1], ['A,1', 'X', 'g', 1, 5.385165, 600, 10, 5.385165, 'g']);
  assert.equal(L.energyRows(results)[1][4], '전체 대역');
  assert.deepEqual(L.logRows([{ level: '경고', line: 3, message: 'm' }]), [['구분', '원본 줄', '내용'], ['경고', 3, 'm']]);
  const band = L.analyzeAll([g], { orders: '1', halfWidth: 0.25, trackMethod: 'rss' });
  assert.equal(L.trackRows(band)[1][16], 5.385165);  // 오더 대역 RSS(이전 방식)도 그대로 계산
  assert.equal(L.trackRows(band)[1][20], '오더 대역 RSS');
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

// ── 2026-09-28 2차: 제출자 분석기 v34·실제 Testlab Neo 파일 ──
import fs from 'node:fs';
import { loadV34, v34Read, V34_PATH } from './v34-harness.mjs';
const SRC = new URL('../docs/source/', import.meta.url);
const REAL = ['sim)130B-X 36,45order.csv', 'sim)30B-X 39order.csv'];
const readSrc = f => fs.readFileSync(new URL(encodeURIComponent(f).replace(/%2C/g, ','), SRC), 'utf8');
const readTl = text => { const rows = L.parseCsv(text, L.detectDelimiter(text)); return { rows, n: L.normalize(rows, { layout: 'testlab' }) }; };

test('CSV 줄 번호 — 빈 줄·「,,,,」 줄을 빼도 원본 줄 번호 유지, 천 단위 쉼표', () => {
  const rows = L.parseCsv('a,b\n,,\n\n"1,234.5",2\n');
  assert.deepEqual(rows, [['a', 'b'], ['1,234.5', '2']]);
  assert.deepEqual(rows.lineNo, [1, 4]);
  assert.equal(L.parseNumber('1,234.5'), 1234.5);
  assert.ok(isNaN(L.parseNumber('1,25')));          // 소수점 쉼표는 유럽식 설정에서만
  assert.equal(L.parseNumber('7.05E-05'), 7.05e-5); // 실제 파일의 지수 표기
});
test('Testlab 판별·RPM 이름·척도·종류', () => {
  assert.ok(L.isTestlab([['Curve 1', ''], ['x']]));
  assert.ok(L.isTestlab([['Title'], ['Standard\\All\\DOF id', 'A:+X']]));
  assert.ok(!L.isTestlab([['RPM', 'Frequency', 'Response']]));
  assert.equal(L.rpmFromName('rpm  2000'), 2000);
  assert.equal(L.rpmFromName('closed (397.00s-399.00s)RPM2000_Report to Excel'), 2000);
  assert.equal(L.rpmFromName('run 2450 hot'), 2450);
  assert.equal(L.rpmFromName('closed'), null);
  assert.equal(L.unitScale('Log (RMS)'), 'linear');
  assert.equal(L.unitScale('dB'), 'db');
  assert.equal(L.unitScale('dB(A)'), 'dba');
  assert.equal(L.channelTypeOf('Pa', 'linear'), 'noise');
  assert.equal(L.channelTypeOf('g', 'linear'), 'vibration');
  assert.equal(L.channelTypeOf('', 'db'), 'noise');
});
test('실제 파일 130B-X — 진동 4위치 × 5 RPM, 1000~2000 Hz, 데이터 64줄부터', () => {
  const { rows, n } = readTl(readSrc(REAL[0]));
  assert.ok(L.isTestlab(rows));
  assert.deepEqual(n.groups.map(g => g.key), ['LL|X|vibration', 'LR|X|vibration', 'UL|X|vibration', 'UR|X|vibration']);
  for (const g of n.groups) {
    assert.equal(g.unit, 'g'); assert.equal(g.channelType, 'vibration'); assert.equal(g.scale, 'linear');
    assert.deepEqual(g.spectra.map(s => s.rpm), [2000, 2100, 2200, 2300, 2400]);
    assert.equal(g.spectra[0].freqs.length, 1001);
    assert.equal(g.spectra[0].freqs[0], 1000); assert.equal(g.spectra[0].freqs[1000], 2000);
  }
  assert.equal(n.groups[0].spectra[0].amps[0], 0.00047429);            // 64줄 LL rpm 2000
  assert.equal(n.groups[1].spectra[1].amps[4], 7.05e-5);               // 68줄 「7.05E-05」 (LR, rpm 2100)
  assert.deepEqual(n.log.map(x => x.level), ['정보']);
  assert.equal(n.log[0].line, 64);
});
test('실제 파일 30B-X — 소음 2(dB 원본) + 진동 4 × 10 RPM, dB → Pa 변환', () => {
  const { n } = readTl(readSrc(REAL[1]));
  assert.deepEqual(n.groups.map(g => g.channel + '|' + g.direction), ['out|', 'Pump|', 'FLH botton|X', 'FLH up|X', 'RLH bottom|X', 'RLH up|X']);
  const out = n.groups[0];
  assert.equal(out.channelType, 'noise'); assert.equal(out.unit, 'Pa'); assert.equal(out.scale, 'db');
  assert.equal(out.spectra.length, 10);
  assert.equal(out.spectra[0].amps[0], 12.65266507);                    // 66줄, 원본 dB
  const lin = L.linearize(n.groups, {}).groups[0];
  close(lin.spectra[0].amps[0], 2e-5 * Math.pow(10, 12.65266507 / 20), 1e-15);
  assert.equal(lin.sourceScale, 'db');
  assert.equal(L.linearize(n.groups, {}).groups[2], n.groups[2]);       // 선형 진동 채널은 그대로
  assert.deepEqual(n.log.map(x => x.level), ['정보']);
});
test('Testlab 옛 배치 — Curve별 X/Y 반복 열, 빠진 RPM·읽지 못한 RPM 경고', () => {
  const rows = L.parseCsv([
    'Curve 1,,Curve 2,,Curve 3,',   // 옛 배치는 Curve 마다 X 열에 머리 정보 이름, Y 열에 값
    'Standard\\All\\Dataset name,RPM1000,Standard\\All\\Dataset name,RPM1000,Standard\\All\\Dataset name,idle',
    'Standard\\All\\DOF id,A:+X,Standard\\All\\DOF id,B:+Y,Standard\\All\\DOF id,A:+X',
    'Standard\\All\\Y axis unit,g,Standard\\All\\Y axis unit,g,Standard\\All\\Y axis unit,g', 'Hz,g,Hz,g,Hz,g',
    '10,1,10,2,10,3', '20,4,20,5,20,6'].join('\n'));
  const n = L.normalize(rows, { layout: 'testlab' });
  assert.deepEqual(n.groups.map(g => g.key), ['A|X|vibration', 'B|Y|vibration']);
  assert.deepEqual(n.groups[1].spectra[0], { rpm: 1000, freqs: [10, 20], amps: [2, 5], scale: 'linear' });
  assert.ok(n.log.some(x => x.message.includes('Curve 3') && x.message.includes('RPM')));
});
test('합성 예시(Testlab 형식) — 실제 파일과 같은 배치로 읽힘, 200 KB 미만', () => {
  const text = Sample.testlabCsv();
  assert.ok(Buffer.byteLength(text) < 200 * 1024);
  const { rows, n } = readTl(text);
  assert.ok(L.isTestlab(rows));
  assert.deepEqual(n.groups.map(g => g.key), ['Mic||noise', 'P1|X|vibration', 'P2|X|vibration']);
  assert.equal(n.groups[0].scale, 'db');
  assert.equal(n.groups[1].spectra.length, 5);
  assert.equal(n.log[0].line, 32);  // 「Curve 1」 제목부터 센 실제 데이터 시작 줄
});

// 손 계산: sp600 (1X = 10 Hz), 주파수 5·8·10·12·20·30, 진폭 1·3·4·2·5·0.5
test('오더 추적 v34 방식 — 피크 검색 → 피크 ± 합산 RSS, 0 이면 가장 가까운 칸', () => {
  let [p] = L.trackOrderPeak([sp600], 1, 1, 1, 1);        // 검색 9~11 → 10 Hz, 합산 9~11 → 10 Hz 하나
  assert.equal(p.freq, 10); assert.equal(p.amp, 4); assert.equal(p.bins, 1); assert.ok(p.matched);
  [p] = L.trackOrderPeak([sp600], 1, 2, 2, 1);            // 합산 8~12 → √(9+16+4)
  close(p.amp, Math.sqrt(29)); assert.equal(p.peakAmp, 4); assert.equal(p.sumMin, 8); assert.equal(p.sumMax, 12);
  [p] = L.trackOrderPeak([sp600], 1.9, 2, 0, 1);          // 이론 19 Hz, 검색 17~21 → 20 Hz(5), 편차 +1
  assert.equal(p.freq, 20); assert.equal(p.amp, 5); assert.equal(p.dev, 1); assert.ok(p.matched);
  [p] = L.trackOrderPeak([sp600], 0.95, 0, 0, 1);         // 이론 9.5 Hz, 검색 0 → 가장 가까운 칸(8·10 중 거리 같으면 먼저 = 8? 아니오: 10 이 0.5, 8 은 1.5)
  assert.equal(p.freq, 10);
  [p] = L.trackOrderPeak([sp600], 5, 2, 1, 1);            // 이론 50 Hz — 측정 범위 밖, 창 안에 칸 없음
  assert.equal(p.amp, null); assert.ok(!p.matched);
  [p] = L.trackOrderPeak([sp600], 3.1, 2, 0, 1);          // 이론 31 Hz — 범위 밖이지만 창(29~30)에 30 Hz 가 걸림 → 값은 내되 「불일치」 (v34 와 같음)
  assert.equal(p.amp, 0.5); assert.ok(!p.inRange); assert.ok(!p.matched);
  [p] = L.trackOrderPeak([sp600], 1, 1, 1, 2);            // 회전비 2 → 1X = 20 Hz
  assert.equal(p.freq, 20);
});
test('오더 RSS 합산 — 같은 RPM 에서 오더 진폭 제곱합의 제곱근, 표시 dB', () => {
  const g = { channel: 'M', direction: '', unit: 'Pa', channelType: 'noise', spectra: [sp600] };
  const res = L.analyzeGroup(g, { orders: '1, 2', searchHz: 0, sumHz: 0 });   // 10 Hz(4) · 20 Hz(5)
  close(res.rssSum.points[0].amp, Math.sqrt(41));
  close(res.rssSum.points[0].disp, 20 * Math.log10(Math.sqrt(41) / 2e-5));   // 소음 기본 dB, 20 µPa
  close(res.tracks[1].points[0].disp, 20 * Math.log10(5 / 2e-5));
  assert.equal(res.display.unit, 'dB');
  const one = L.analyzeGroup(g, { orders: '1', searchHz: 0, sumHz: 0 });
  assert.equal(one.rssSum, null);                                           // 오더 1개면 RSS 없음
  const miss = L.analyzeGroup(g, { orders: '1, 9', searchHz: 1, sumHz: 0 }); // 9차(90 Hz)는 값 없음 → 그 RPM 은 RSS 에서 뺌
  assert.equal(miss.rssSum.points.length, 0);
  assert.equal(L.rssRows([res]).length, 2);
});
test('A-가중·표시 변환', () => {
  close(L.aWeighting(1000), 0, 0.01);
  close(L.aWeighting(100), -19.1, 0.05);
  assert.equal(L.aWeighting(0), -Infinity);
  close(L.displayOf(2e-4, 1000, 'db', 2e-5), 20);
  close(L.displayOf(2e-4, 100, 'dba', 2e-5), 20 + L.aWeighting(100));
  assert.equal(L.displayOf(0, 100, 'db', 2e-5), null);
  assert.equal(L.displayOf(0.3, 100, 'linear', 2e-5), 0.3);
});
test('파일 이름에서 관심 오더 짐작', () => {
  assert.equal(L.ordersFromName('sim)130B-X 36,45order.csv'), '36, 45');
  assert.equal(L.ordersFromName('sim)30B-X 39order.csv'), '39');
  assert.equal(L.ordersFromName('pump 2.5 & 5 order.csv'), '2.5, 5');
  assert.equal(L.ordersFromName('data.csv'), '');
});

// 같은 파일·같은 설정으로 제출자 분석기 v34 와 결과가 같은지 (모든 채널·RPM)
test('v34 와 맞대기 — 실제 파일 2종 + 합성 예시, 단일 오더·RSS 합산·표시값', () => {
  assert.ok(fs.existsSync(V34_PATH));
  const cases = [[REAL[0], [36, 45]], [REAL[1], [30, 39]], ['(합성)', [36, 45]]];
  let compared = 0;
  for (const [file, orders] of cases) {
    const text = file === '(합성)' ? Sample.testlabCsv() : readSrc(file);
    for (const [sw, uw, nMode] of [[1, 1, 'db'], [0, 0, 'linear'], [3, 2, 'dba']]) {
      const v = loadV34({ noiseAmplitudeMode: nMode, vibrationAmplitudeMode: nMode === 'dba' ? 'db' : 'linear' });
      const rep = v34Read(v, text, file);
      const ours = L.linearize(readTl(text).n.groups, {}).groups;
      const settings = { orders: orders.join(','), searchHz: sw, sumHz: uw, noiseMode: nMode, vibMode: nMode === 'dba' ? 'db' : 'linear' };
      assert.equal(ours.length, rep.normalized.channelOrder.length, file);
      for (const g of ours) {
        const id = g.channelType === 'noise' ? g.channel : g.channel + '_' + g.direction;
        const ch = rep.normalized.channels[id];
        assert.ok(ch, file + ' 채널 ' + id);
        const res = L.analyzeGroup(g, settings);
        const cs = settings[g.channelType === 'noise' ? 'noiseMode' : 'vibMode'];
        const ref = g.channelType === 'noise' ? 2e-5 : 1.0197e-7;
        orders.forEach((o, k) => {
          const theirs = v.calculateOrderRows(ch, o, sw, uw, sw);
          const mine = res.tracks[k].points;
          assert.equal(mine.length, theirs.length);
          theirs.forEach((t, i) => {
            const m = mine[i];
            assert.equal(m.rpm, t.rpm);
            assert.equal(m.matched, t.matched, `${file} ${id} ${o}차 ${t.rpm}`);
            if (!Number.isFinite(t.orderAmplitude)) { assert.equal(m.amp, null); return; }
            assert.equal(m.freq, t.peakFrequency, `${file} ${id} ${o}차 ${t.rpm} 피크 주파수 sw=${sw} uw=${uw} ${nMode}`);
            assert.equal(m.bins, t.summedPointCount);
            close(m.amp, t.orderAmplitude, Math.abs(t.orderAmplitude) * 1e-9);
            const td = v.convertAmplitude(t.orderAmplitude, t.peakFrequency, cs, ref, t.sourceUnit, ref);
            close(m.disp, td, 1e-7);
            compared++;
          });
        });
        const sel = { searchWidth: sw, sumWidth: uw, settings: {
          noise: { mode: nMode, sourceDbReference: 2e-5, orderDbReference: 2e-5 },
          vibration: { mode: settings.vibMode, sourceDbReference: 1.0197e-7, orderDbReference: 1.0197e-7 } } };
        const tr = v.buildRssSumSeries(ch, id, orders, sel, '#000');
        const mr = res.rssSum.points;
        assert.deepEqual(mr.map(p => p.rpm), tr.rows.map(r => r.rpm), file + ' ' + id + ' RSS RPM');
        tr.rows.forEach((r, i) => { close(mr[i].amp, r.orderAmplitude, r.orderAmplitude * 1e-9); close(mr[i].disp, r.displayAmplitude, 1e-7); compared++; });
      }
    }
  }
  assert.ok(compared > 500, '비교 수 ' + compared);
});

console.log(process.exitCode ? '\n실패가 있습니다' : '\n' + passed + '개 모두 통과');
