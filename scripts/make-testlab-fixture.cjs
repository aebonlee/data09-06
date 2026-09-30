// 실행: node scripts/make-testlab-fixture.cjs > test/fixtures/testlab-closed-rpm.csv   (가상 값 — 실제 시험 자료 아님)
// 가상 Testlab 내보내기 — 「closed (…)RPM2000_Report to Excel」 이름·소음 dB 2채널·진동 2위치(여러 낱말 이름)·끝 「,,,,」 줄
const RPMS = [2000, 2100, 2200, 2300];
const CH = [
  { dof: 'NoiseA', unit: 'Pa', scale: 'dB', q: 'Pressure', dir: 'None', pt: 'NoiseA' },
  { dof: 'NoiseB', unit: 'Pa', scale: 'dB', q: 'Pressure', dir: 'None', pt: 'NoiseB' },
  { dof: 'Mount front:+X', unit: 'g', scale: 'Log (RMS)', q: 'Acceleration', dir: ' +X', pt: 'Mount front' },
  { dof: 'Mount rear:+X', unit: 'g', scale: 'Log (RMS)', q: 'Acceleration', dir: ' +X', pt: 'Mount rear' },
];
const curves = []; RPMS.forEach((rpm, ri) => CH.forEach((c, ci) => curves.push({ rpm, ri, c, ci })));
const row = (h, f) => [h, ...curves.map(f)].join(',');
const blank = ',' .repeat(curves.length);
const L = [row('Curve 1', () => ''), blank, row('MS Logging', () => ''),
  row('Standard\\All\\DOF id', x => x.c.dof),
  row('Standard\\All\\Dataset name', x => `closed (${(100 + x.ri * 2).toFixed(2)}s-${(102 + x.ri * 2).toFixed(2)}s)RPM${x.rpm}_Report to Excel`),
  row('Standard\\All\\Point direction', x => x.c.dir),
  row('Standard\\All\\Point id', x => x.c.pt),
  row('Standard\\All\\Y axis quantity', x => x.c.q),
  row('Standard\\All\\Y axis unit', x => x.c.unit),
  blank, row('Hz', x => x.c.unit), row('Linear', x => x.c.scale)];
// 가상 값: 39차 봉우리 + 바닥. 진동은 선형 g, 소음은 dB(기준 20 µPa)
const amp = (x, f) => { const c = 39 * x.rpm / 60; return 0.004 * (1 + x.ri * 0.3) * Math.exp(-(((f - c) / 1.5) ** 2)) * (x.ci === 3 ? 0.5 : 1) + 0.00006 * (1 + ((f * 7 + x.ci * 13 + x.ri * 3) % 10) / 10); };
const fmt = v => v < 1e-4 ? v.toExponential(2).toUpperCase().replace(/E-(\d)$/, 'E-0$1') : String(Math.round(v * 1e9) / 1e9);
for (let f = 1280; f <= 1520; f++) L.push(row(String(f), x => x.c.unit === 'Pa' ? String(Math.round(20 * Math.log10((amp(x, f) * 0.8 + 0.0003) / 2e-5) * 1e6) / 1e6) : fmt(amp(x, f))));
for (let i = 0; i < 5; i++) L.push(blank);
process.stdout.write('﻿' + L.join('\r\n') + '\r\n');
