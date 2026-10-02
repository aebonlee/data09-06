// 실행: node test/analyzer.test.mjs   (의존성 없음) — 전체는 node test/all.mjs
// ① 제출자 분석기 v51(js/script.js · css/style.css)이 docs/source 원본과 같은지 — script.js 는 2026-09-30 수정 한 곳만 다름
// ② 페이지 스크립트가 문법상 읽히는지, 분석기가 찾는 화면 요소(id)가 index.html 에 모두 있는지
// ③ 분석기의 순수 함수(원본 그대로 떼어 와서) — parseCsv · parseOrders · aWeighting · median · toNumber
// ④ 첫 화면(히어로) 그림의 계산 — js/hero.js
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const H = require('../js/hero.js');
const HL = H.heroLayout;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

const html = read('index.html');
const script = read('js/script.js');
const heroJs = read('js/hero.js');

// 원본 함수 떼어 오기: 「  function 이름(」부터 중괄호가 닫히는 곳까지
function extract(src, name) {
  const at = src.indexOf('\n  function ' + name + '(');
  assert.ok(at >= 0, name + ' 없음');
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0, i = open, q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) break;
  }
  return src.slice(at + 1, i + 1);
}
function load(names) {
  const body = names.map((n) => extract(script, n)).join('\n') + '\nreturn {' + names.join(',') + '};';
  return new Function(body)();
}

// ① 제출자 코드 그대로
// 제출자가 「에러가 발생한다면 수정 부탁」(2026-09-30)해서 고친 곳은 이 한 줄뿐이다
const FIX_OLD = "    const channelIds=[...document.querySelectorAll('.multi-channel:checked')].map(x=>x.value);\n";
const FIX_NEW = "    // [2026-09-30 수정] 채널 이름이 다른 CSV 를 새로 열면 이전 파일의 채널 체크가 남아 있어, 지금 파일에 없는 채널은 뺍니다.\n"
  + "    const channelIds=[...document.querySelectorAll('.multi-channel:checked')].map(x=>x.value).filter(id=>currentReport.normalized?.channels?.[id]);\n";
// 2026-10-02 v52(「분석 실행」 버튼 · 접기 · Contribution Analysis 빈 상태)로 화면 연결 부분이 바뀌었다.
// 계산 함수는 하나도 바꾸지 않았는지 — 원본의 함수 가운데 아래 목록 말고는 모두 바이트까지 같아야 한다.
const V52_CHANGED = ['getMultiSelection', 'renderMultiWorkspace', 'initializeResizeObservers', 'syncSpectrumMapChannelOptions', 'renderMultiAnalysis', 'renderContributionAnalysis', 'setMapXAxisMode'];
test('js/script.js — 원본 함수는 화면 연결 7곳 말고 모두 원본 그대로 (계산 함수 무수정)', () => {
  const orig = read('docs/source/order_analysis_v51/script.js');
  assert.equal(orig.split(FIX_OLD).length, 2, '원본에서 고칠 줄을 못 찾음');
  assert.ok(script.includes(FIX_NEW), '2026-09-30 수정 한 줄이 남아 있어야 함');
  const names = [...new Set([...orig.matchAll(/\n  function (\w+)\(/g)].map((m) => m[1]))];
  assert.ok(names.length > 100, '함수 수집이 너무 적음 ' + names.length);
  // 지운 것: Raw dB 기준값을 칠 때마다 다시 계산하던 연결 함수 하나(이제 「분석 실행」이 rebuildNoiseNormalizedModel 을 부름)
  const gone = names.filter((n) => !script.includes('\n  function ' + n + '('));
  assert.deepEqual(gone, ['handleNoiseSourceDbReferenceChange']);
  const changed = names.filter((n) => !gone.includes(n) && extract(orig, n) !== extract(script, n));
  assert.deepEqual(changed.sort(), [...V52_CHANGED].sort());
  for (const n of ['calculateOrderRows', 'calculateOverallRows', 'getContributionRows', 'buildRssSumSeries', 'convertAmplitude', 'drawCombinedOrderChart', 'renderMultiColorMap', 'rebuildNoiseNormalizedModel', 'buildNormalizedModel', 'downloadOrderAnalysisXlsx'])
    assert.ok(names.includes(n) && !changed.includes(n), n);
  for (const n of V52_CHANGED.filter((n) => n !== 'getMultiSelection')) assert.match(extract(script, n), /\[2026-10-02 v52\]/, n + ' 에 바꾼 표시가 없음');
});
test('css/style.css = 제출자 원본 style.css (바이트 같음)', () => {
  assert.equal(read('css/style.css'), read('docs/source/order_analysis_v51/style.css'));
});
test('index.html — 히어로 · 머리 태그 · 파일 경로만 바뀌고 나머지 화면은 원본과 같음', () => {
  const orig = read('docs/source/order_analysis_v51/index.html');
  const strip = (s) => s
    .replace(/\n<section class="hero"[\s\S]*?<\/section>\n<\/header>/, '</header>')
    .replace(/<meta name="description"[^>]*>\n\s*/, '')
    .replace(/<link rel="icon"[^>]*>\n\s*/, '')
    .replace('<link rel="stylesheet" href="css/style.css" />\n  <link rel="stylesheet" href="css/hero.css" />\n  <link rel="stylesheet" href="css/panels.css" />', '<link rel="stylesheet" href="style.css" />')
    .replace('<script src="js/script.js"></script>\n<script src="js/hero.js"></script>', '<script src="script.js"></script>');
  // v52: 세 영역 머리(접기 버튼) · 「분석 실행」 줄 · Contribution Analysis 카드(예전 <details>) 를 걷어 내면 원본과 같은 줄만 남는다
  const keep = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
  const origLines = keep(orig), cur = keep(strip(html));
  const added = cur.filter((l) => !origLines.includes(l));
  const removed = origLines.filter((l) => !cur.includes(l));
  const allowedAdd = /collapsible|section-toggle|card-head-actions|run-row|run-button|run-stale|run-help|Contribution Analysis|^<\/div>$|^<div>$|^<div class="toolbar">$|^<\/section>$|^<h2 style="margin:0">Spectrum Map<\/h2>$|advanced-settings" open|선택한 Order 성분의 에너지 기여율|^<button id="downloadOrderAnalysisXlsx"/;
  assert.deepEqual(added.filter((l) => !allowedAdd.test(l)), []);
  const allowedRemove = /^<section class="card" id="(focusedAnalysis|multiColorMapSection)">$|^<h2>Spectrum Map<\/h2>$|^<details class="advanced-settings">$|order-subsection|차수별 기여도 분석|^<\/details>$|^<summary class="order-subsection-summary">$|^<\/summary>$|^<span>차수별 기여도 분석<\/span>$|summary-help|^<h2 style="margin:0">차수별 기여도 분석<\/h2>$|^<button id="downloadOrderAnalysisXlsx"/;
  assert.deepEqual(removed.filter((l) => !allowedRemove.test(l)), []);
  // 원본의 id 는 하나도 빠지지 않음
  const ids = (t) => new Set([...t.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const now = ids(html);
  assert.deepEqual([...ids(orig)].filter((id) => !now.has(id)), []);
});

// ② 문법 · 파일 · 화면 요소
test('페이지 스크립트 문법 (js/script.js · js/hero.js)', () => {
  new vm.Script(script, { filename: 'js/script.js' });
  new vm.Script(heroJs, { filename: 'js/hero.js' });
});
test('index.html 이 부르는 css · js · 예시 CSV 가 모두 있음', () => {
  const refs = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 5, '참조가 너무 적음: ' + refs.join(', '));
  for (const r of refs) assert.ok(existsSync(new URL(r, root)), '없는 파일: ' + r);
});
test('분석기가 찾는 id 가 index.html 에 모두 있음 (히어로를 넣으며 깨뜨리지 않았는지)', () => {
  const ids = new Set([...script.matchAll(/\$\('([A-Za-z0-9_-]+)'\)|getElementById\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1] || m[2]));
  const missingIn = (page) => { const have = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])); return [...ids].filter((id) => !have.has(id)); };
  assert.ok(ids.size > 80, 'id 수집이 너무 적음 ' + ids.size);
  // 원본에도 없던 id(combinedChartControls — 코드에서 없으면 건너뜀)는 그대로 두고, 새로 빠진 것이 없어야 함
  assert.deepEqual(missingIn(html), ['combinedChartControls']);
});
test('id 가 겹치지 않음 (히어로 id 가 분석기 id 와 부딪히지 않음)', () => {
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = all.filter((v, i) => all.indexOf(v) !== i);
  assert.deepEqual(dup, []);
});
test('바깥 주소를 부르지 않음 (파일로 열어도 동작, 서버 전송 없음)', () => {
  for (const [name, src] of [['index.html', html.replace(/xmlns=%22http:\/\/www\.w3\.org\/2000\/svg%22/g, '')], ['js/hero.js', heroJs], ['css/hero.css', read('css/hero.css')]]) {
    assert.doesNotMatch(src, /(src|href)="https?:|fetch\(|XMLHttpRequest|url\(\s*['"]?https?:/, name);
  }
});

// ②-2 회귀: 분석한 뒤 채널 이름이 다른 CSV 를 열면 이전 체크가 남음 → getMultiSelection 이 지금 파일에 없는 채널을 넘기면
//        renderMultiAnalysis 가 channels[id].channelType 에서 죽었다(2026-09-30 재현: 헤드리스 크롬 · 창 크기 변화 때 지연 실행)
test('getMultiSelection — 이전 파일의 채널 체크가 남아도 지금 파일에 있는 채널만 넘김', () => {
  const src = extract(script, 'getMultiSelection');
  const make = (checked) => {
    const vals = { multiOrderInput: '30, 36', multiSearchWidth: '1', multiSumWidth: '1', noiseAmplitudeMode: 'db', noiseSourceDbReference: '2e-5', noiseOrderDbReference: '2e-5', vibrationAmplitudeMode: 'db', vibrationSourceDbReference: '1', vibrationOrderDbReference: '1e-7' };
    const document = { querySelectorAll: () => checked.map((value) => ({ value })) };
    const $ = (id) => ({ value: vals[id] });
    const currentReport = { normalized: { channels: { NoiseA: { channelType: 'noise' }, 'Mount front_X': { channelType: 'vibration' } } } };
    const helpers = extract(script, 'parseOrders') + '\nfunction hasDbInputForType(){return false;}\n';
    return new Function('document', '$', 'currentReport', helpers + src + '\nreturn getMultiSelection();')(document, $, currentReport);
  };
  // 이전 파일(P1_X · Mic)에서 남은 체크 + 새 파일 채널 하나
  assert.deepEqual(make(['P1_X', 'Mic', 'NoiseA']).channelIds, ['NoiseA']);
  // 남은 것이 모두 이전 파일 채널이면 선택 없음(null) — 그래프를 숨기고 죽지 않음
  assert.equal(make(['P1_X', 'Mic']), null);
  assert.deepEqual(make(['NoiseA', 'Mount front_X']).channelIds, ['NoiseA', 'Mount front_X']);
});

// ③ 분석기 순수 함수 (원본 그대로)
const F = load(['parseCsv', 'parseOrders', 'aWeighting', 'median', 'toNumber']);
test('parseCsv — 따옴표 · 쉼표 · 줄바꿈 · CRLF', () => {
  const rows = F.parseCsv('a,"b,1","c ""q"""\r\n1,2,3\n');
  assert.deepEqual(rows[0], ['a', 'b,1', 'c "q"']);
  assert.deepEqual(rows[1], ['1', '2', '3']);
});
test('parseOrders — 쉼표 · 공백 · 중복 · 음수 거르기, 오름차순', () => {
  assert.deepEqual(F.parseOrders('9, 3,1 3;-2 x'), [1, 3, 9]);
  assert.deepEqual(F.parseOrders('2.5 1'), [1, 2.5]);
});
test('aWeighting — 1 kHz ≈ 0 dB, 100 Hz ≈ -19.1 dB, 0 Hz = -∞', () => {
  assert.ok(Math.abs(F.aWeighting(1000)) < 0.01, String(F.aWeighting(1000)));
  assert.ok(Math.abs(F.aWeighting(100) - -19.1) < 0.1, String(F.aWeighting(100)));
  assert.equal(F.aWeighting(0), -Infinity);
});
test('median · toNumber', () => {
  assert.equal(F.median([3, 1, 2]), 2);
  assert.equal(F.median([4, 1, 2, 3]), 2.5);
  assert.equal(F.toNumber('1,234.5'), 1234.5);
  assert.ok(Number.isNaN(F.toNumber('')));
});

// ④ 히어로 그림 계산
test('오더 주파수 = N × RPM ÷ 60', () => {
  assert.equal(H.orderFrequency(2, 3000), 100);
  assert.equal(H.orderFrequency(1, 1800), 30);
});
test('색 띠가 분석기 Spectrum Map 과 같음 (원본 amplitudeColor 와 대조)', () => {
  const { amplitudeColor } = load(['amplitudeColor']);
  for (const t of [0, 0.1, 0.25, 0.5, 0.63, 0.8, 0.95, 1]) {
    const c = H.colorAt(t);
    assert.equal(`rgb(${c[0]},${c[1]},${c[2]})`, amplitudeColor(t), 't=' + t);
  }
});
test('공진을 지날 때 오더가 커짐 — 2차가 48 Hz(1,440 RPM)를 지날 때 가장 큼', () => {
  const at = (r) => H.orderAmplitude(2, r);
  assert.ok(at(1440) > at(1100) * 2 && at(1440) > at(1800) * 2);
  const d = H.dominantOrder(1440);
  assert.equal(d.k, 2);
  assert.ok(Math.abs(d.f - 48) < 1e-9);
});
test('스펙트럼 — 오더 선 위가 선 밖보다 큼, dB 는 색 띠 범위 안', () => {
  const r = 2000, on = H.spectrumAt(r, H.orderFrequency(2, r)), off = H.spectrumAt(r, H.orderFrequency(2, r) + 15);
  assert.ok(on > off * 5, on + ' vs ' + off);
  const t = H.levelOf(H.toDb(on), H.MODEL, true);
  assert.ok(t > 0.5 && t <= 1);
  // 계단(등고선 띠) 값은 levels 개 중 하나
  const lv = H.MODEL.levels - 1;
  for (const db of [-50, -30, -10, 0, 20]) {
    const s = H.levelOf(db, H.MODEL, true);
    assert.ok(Math.abs(s * lv - Math.round(s * lv)) < 1e-9, 'db=' + db);
  }
});
test('RPM 커서 — 범위 안에서 올렸다 내림(위상 0.5 가 꼭대기, 대칭)', () => {
  const m = H.MODEL;
  for (let p = 0; p < 2; p += 0.01) { const r = H.sweepRpm(p); assert.ok(r >= m.rpmMin && r <= m.rpmMax, String(r)); }
  assert.ok(H.sweepRpm(0.5) > H.sweepRpm(0.4) && H.sweepRpm(0.5) > H.sweepRpm(0.6));
  assert.ok(Math.abs(H.sweepRpm(0.3) - H.sweepRpm(0.7)) < 1e-9);
});
test('소음 등고선 띠 — 안쪽일수록 큰 소리(색 위쪽) · 반지름 커짐', () => {
  const g = H.noiseRings(600);
  for (let i = 1; i < g.length; i++) { assert.ok(g[i].r > g[i - 1].r); assert.ok(g[i].t < g[i - 1].t); }
});
test('전동 지게차 그림 — 배기관 없음, 좌석 아래 배터리 · 구동 모터 · 기어박스에 센서, 가상 값 표기', () => {
  const svg = html.slice(html.indexOf('<g id="heroElectric">'), html.indexOf('<!-- ② 엔진식'));
  assert.ok(svg.length > 1000, '전동식 묶음을 못 찾음');
  assert.doesNotMatch(svg, /배기관 -->|엔진/);
  assert.match(svg, /배터리 칸/);
  assert.match(svg, /구동 모터/);
  assert.match(svg, /가속도 센서\(구동 모터 · 기어박스\)/);
  // 센서는 앞(구동) 바퀴 132 와 배터리 칸 196 사이 — 모터 · 기어박스 자리
  const m = svg.match(/<rect id="heroSensor" x="([\d.]+)" y="([\d.]+)"/);
  assert.ok(m && +m[1] > 150 && +m[1] < 196 && +m[2] > 150, '센서 위치 ' + (m && m.slice(1)));
  assert.match(html, /임의로 정한 가상 값/);
});
test('엔진식 지게차 그림 — 배기관 · 엔진 덮개 통풍구 · 라디에이터 그릴 · 엔진 블록 센서, 「전동식」「엔진식」 이름표', () => {
  const eng = html.slice(html.indexOf('<g id="heroEngine"'), html.indexOf('</svg>'));
  assert.ok(eng.length > 1000, '엔진식 묶음을 못 찾음');
  for (const w of ['배기관', '라디에이터 그릴', '엔진 덮개', '엔진 블록', 'hero-smoke', 'id="heroEngineBody"']) assert.ok(eng.includes(w), w);
  assert.doesNotMatch(eng, /배터리/);
  // 엔진식은 전동식 오른쪽(겹치지 않게 380 만큼 옮김), 센서는 엔진 블록(164~198) 위
  assert.match(eng, /<g id="heroEngine" transform="translate\(380 0\)">/);
  const m = eng.match(/<rect id="heroSensorEngine" x="([\d.]+)" y="([\d.]+)"/);
  assert.ok(m && +m[1] >= 164 && +m[1] <= 198 && +m[2] > 150, '엔진 센서 위치 ' + (m && m.slice(1)));
  assert.match(html, /hero-fleet-label-electric">전동식</);
  assert.match(html, /hero-fleet-label-engine">엔진식</);
});
test('히어로 칸 나누기 — 지게차 묶음 비율 720:250 유지 · 선도와 겹치지 않음 · 그림 안', () => {
  for (const [W, H] of [[1272, 403], [1062, 330], [707, 359], [738, 307], [354, 336], [300, 285]]) {
    const g = HL(W, H);
    assert.ok(Math.abs(g.fleet.w / g.fleet.h - 720 / 250) < 1e-9, W + ' 비율');
    assert.ok(g.fleet.x >= 0 && g.fleet.y >= 0 && g.fleet.x + g.fleet.w <= W + 0.5 && g.fleet.y + g.fleet.h <= H + 0.5, W + ' 그림 밖');
    if (g.stacked) assert.ok(g.fleet.y + g.fleet.h < g.plot.top, W + ' 위아래 겹침');
    else assert.ok(g.fleet.x + g.fleet.w < g.plot.left, W + ' 좌우 겹침');
    assert.ok(g.plot.right - g.plot.left > 150 && g.plot.bottom - g.plot.top > 120, W + ' 선도가 너무 작음 ' + JSON.stringify(g.plot));
    assert.equal(g.stacked, W / H < 1.5);
  }
});
test('두 센서 소음 등고선 — 센서 가까이가 안쪽 띠, 멀면 바깥(-1), 엔진식(+2.5 dB)이 더 넓게 퍼짐', () => {
  const src = [{ x: 100, y: 100, gainDb: 0 }, { x: 400, y: 100, gainDb: 2.5 }];
  assert.equal(H.noiseBand(src, 100, 100, 400), 0);
  assert.equal(H.noiseBand(src, 5000, 5000, 400), -1);
  // 같은 거리라면 엔진식 쪽 띠 번호가 같거나 더 작음(더 큰 소리)
  const left = H.noiseBand(src, 100 - 120, 100, 400), right = H.noiseBand(src, 400 + 120, 100, 400);
  assert.ok(right <= left && right >= 0, left + ' / ' + right);
  // 띠 번호는 멀어질수록 커짐(단조)
  let prev = 0;
  for (let d = 0; d < 900; d += 15) { const b = H.noiseBand([src[0]], 100 + d, 100, 400); const v = b < 0 ? 99 : b; assert.ok(v >= prev, 'd=' + d); prev = v; }
});
test('움직임 줄이기 · 탭 숨김 · 화면 밖이면 멈춤', () => {
  assert.match(heroJs, /prefers-reduced-motion: reduce/);
  assert.match(heroJs, /visibilitychange/);
  assert.match(heroJs, /IntersectionObserver/);
});

console.log(`\n${passed}개 통과` + (process.exitCode ? ' — 실패 있음' : ''));
