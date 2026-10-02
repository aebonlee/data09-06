// 선택 실행(브라우저 회귀, 2026-10-02 v52): 「분석 실행」 버튼
//  ① 오더 입력 · 단위 · 채널을 바꿔도 버튼을 누르기 전에는 다시 계산하지 않음(그래프 캔버스 getContext 호출 수로 셈) · 「입력이 바뀌었습니다」 표시
//  ② 버튼을 누른 뒤 결과(요약 · 범례 · 기여도 표 · Spectrum Map 최대값 · 그래프 픽셀)가 이전 판(입력마다 바로 계산)과 같음
//  ③ Contribution Analysis 가 오더를 넣기 전에도 보임 · 세 영역 접기 버튼 · 콘솔 오류 0
// 필요: playwright-core 와 크롬. BASE_ROOT = 비교할 이전 판 폴더(예: git archive 로 푼 직전 커밋). 없으면 ② 는 건너뜀.
//   PW_CORE=<node_modules/playwright-core> CHROME=<크롬> BASE_ROOT=<이전 판> node test/browser-run-buttons.mjs
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
try { ({ chromium } = await import(process.env.PW_CORE ? pathToFileURL(path.join(process.env.PW_CORE, 'index.mjs')).href : 'playwright-core')); }
catch { console.log('  skip playwright-core 없음 — 건너뜀'); process.exit(0); }
const A = path.join(ROOT, 'samples/예시데이터_TestlabNeo형식.csv');      // P1 · P2 · Mic (진동 dB 아님)
const B = path.join(ROOT, 'test/fixtures/testlab-closed-rpm.csv');     // 소음 dB 2 · 진동 2
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

// 같은 조작 순서. isNew 이면 각 단계 뒤 「분석 실행」을 누름
const SCENARIOS = [
  { file: A, steps: [['fill', '#multiOrderInput', '30, 36, 42'], ['click', '#selectAllChannels'], ['run', 'order'], ['fill', '#mapOrderOverlayInput', '30, 36'], ['run', 'map']] },
  { file: A, steps: [['fill', '#multiOrderInput', '30, 42'], ['select', '#vibrationAmplitudeMode', 'db'], ['fill', '#multiSearchWidth', '3'], ['run', 'order'], ['fill', '#mapRpmMin', '2100'], ['run', 'map']] },
  { file: B, steps: [['click', '#selectAllChannels'], ['fill', '#multiOrderInput', '36, 39, 45'], ['select', '#noiseAmplitudeMode', 'dba'], ['run', 'order'], ['selectIndex', '#contributionChannelSelect', 1], ['run', 'contribution']] },
  { file: B, steps: [['click', '#selectAllChannels'], ['fill', '#multiOrderInput', '36, 45'], ['fill', '#noiseSourceDbReference', '1e-5'], ['run', 'order'], ['click', '#mapOrderAxisButton'], ['run', 'map']] },
];

async function open(root, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => {
    window.__ctx = {};
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...a) { window.__ctx[this.id] = (window.__ctx[this.id] || 0) + 1; return orig.apply(this, a); };
  });
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  return { page, errors };
}
async function load(page, f) {
  await page.setInputFiles('#fileInput', f);
  await page.waitForFunction(() => !document.getElementById('csvPreview').classList.contains('hidden'), null, { timeout: 10000 });
  await page.click('#confirmCsvAnalysis');
  await page.waitForTimeout(1200); // 분석 직후의 지연 그리기(크기 감시 · 다음 프레임)가 끝날 때까지
  // 이전 판은 기여도가 접힌 <details> 안이라 글자를 읽으려면 펼쳐 둠(계산은 펼침과 상관없음)
  await page.evaluate(() => { const d = document.querySelector('details#orderContributionSection'); if (d) d.open = true; });
  await page.waitForTimeout(300);
}
async function step(page, [kind, sel, val], isNew) {
  if (kind === 'run') { if (isNew) await page.click({ order: '#runOrderAnalysis', contribution: '#runContribution', map: '#runSpectrumMap' }[sel]); }
  // 값 넣기는 화면에 보이지 않아도(이전 판은 「단위 및 dB 기준값 설정」이 접혀 있음) 같은 방식으로: 값 → input · change 이벤트
  else if (kind === 'fill' || kind === 'select' || kind === 'selectIndex') await page.evaluate(([sel, kind, val]) => {
    const el = document.querySelector(sel);
    if (kind === 'selectIndex') el.selectedIndex = val; else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [sel, kind, val]);
  // 누르기도 스크립트로(마우스로 누르면 화면이 굴러가며 그래프 위 마우스 표시를 다시 그림 — 계산이 아니라 그리기라서 셈에서 빼려고)
  else if (kind === 'click') await page.evaluate(sel => document.querySelector(sel).click(), sel);
  await page.waitForTimeout(250);
}
async function snapshot(page) {
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const t = id => (document.getElementById(id)?.innerText || '').replace(/\s+/g, ' ').trim();
    const px = id => { const c = document.getElementById(id); return c ? c.width + 'x' + c.height + ':' + c.toDataURL().length + ':' + c.toDataURL().slice(-64) : ''; };
    return { kpi: t('multiKpis'), legend: t('combinedLegend'), contribSummary: t('contributionSummary'), contribTable: t('contributionTableBody'), contribHead: t('contributionTableHead'),
      axes: ['graphRpmMin','graphRpmMax','graphAmpMin','graphAmpMax','mapRpmMin','mapRpmMax','mapAmpMin','mapAmpMax','mapMinFrequency','mapMaxFrequency','mapMinOrder','mapMaxOrder','mapChannelSelect'].map(id => document.getElementById(id).value).join(' | '),
      mapMax: t('spectrumMapMaxInfo'), mapNote: t('multiMapNote'), orderCanvas: px('combinedOrderCanvas'), mapCanvas: px('multiColorMapCanvas') };
  });
}
const h = o => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 10);

for (const [i, sc] of SCENARIOS.entries()) {
  const { page, errors } = await open(ROOT);
  await load(page, sc.file);
  let n = 0;
  for (const st of sc.steps) {
    if (st[0] === 'run') { n++; continue; }
    const before = await page.evaluate(() => ({ ...window.__ctx }));
    const snapBefore = await snapshot(page);
    await step(page, st, true);
    const after = await page.evaluate(() => ({ ...window.__ctx }));
    const snapAfter = await snapshot(page);
    // 입력만 바꿨을 때: 그래프 · 기여도 · Spectrum Map 캔버스를 다시 그리지 않고, 화면 결과도 그대로
    const redraws = ['combinedOrderCanvas', 'orderContributionCanvas', 'multiColorMapCanvas'].map(id => (after[id] || 0) - (before[id] || 0));
    ok(redraws.every(x => x === 0) && h({ ...snapBefore, axes: 0 }) === h({ ...snapAfter, axes: 0 }), `S${i + 1} ${st[0]} ${st[1]} — 실행 전에는 다시 계산 안 함 (다시 그림 ${redraws.join('/')})`);
    const stale = await page.evaluate(() => ['orderStale', 'contributionStale', 'mapStale'].filter(id => !document.getElementById(id).hidden));
    ok(stale.length > 0, `S${i + 1} 「입력이 바뀌었습니다」 표시: ${stale.join(',')}`);
    // 다음 단계가 run 이면 누름
    const idx = sc.steps.indexOf(st);
    if (sc.steps[idx + 1]?.[0] === 'run') {
      await step(page, sc.steps[idx + 1], true);
      const left = await page.evaluate(() => ['orderStale', 'contributionStale', 'mapStale'].filter(id => !document.getElementById(id).hidden));
      ok(left.length === 0, `S${i + 1} 실행 뒤 표시 사라짐 ${left.join(',')}`);
    }
  }
  const newSnap = await snapshot(page);
  if (process.env.BASE_ROOT) {
    const base = await open(process.env.BASE_ROOT);
    await load(base.page, sc.file);
    for (const st of sc.steps) await step(base.page, st, false);
    const baseSnap = await snapshot(base.page);
    const diff = Object.keys(newSnap).filter(k => newSnap[k] !== baseSnap[k]);
    ok(diff.length === 0, `S${i + 1} 결과가 이전 판과 같음 — ${diff.length ? 'diff: ' + diff.map(k => k + '\n      new=' + newSnap[k].slice(0, 200) + '\n      old=' + baseSnap[k].slice(0, 200)).join('\n    ') : 'KPI「' + newSnap.kpi.slice(0, 70) + '…」 기여도「' + newSnap.contribSummary.slice(0, 60) + '…」'}`);
    ok(base.errors.length === 0, `S${i + 1} 이전 판 콘솔 오류 0 (${base.errors.join(' | ')})`);
    await base.page.close();
  }
  ok(errors.length === 0, `S${i + 1} 콘솔 오류 0 ${errors.join(' | ')}`);
  await page.close();
}

// ③ Contribution Analysis(오더 전) · 접기 버튼
{
  const { page, errors } = await open(ROOT);
  await load(page, A);
  const c = await page.evaluate(() => ({ disp: getComputedStyle(document.getElementById('orderContributionSection')).display, note: document.getElementById('contributionNote').innerText, h2: document.querySelector('#orderContributionSection h2').innerText }));
  ok(c.disp !== 'none' && /오더를 2개 이상/.test(c.note) && /^Contribution Analysis/.test(c.h2), `오더 전 Contribution Analysis 보임 · 안내 「${c.note.slice(0, 40)}…」`);
  const adv = await page.evaluate(() => document.querySelector('.advanced-settings').open);
  ok(adv, '「단위 및 dB 기준값 설정」 기본 펼침');
  for (const [btn, body] of [['#orderAnalysisToggle', 'orderAnalysisBody'], ['#contributionToggle', 'contributionBody'], ['#spectrumMapToggle', 'spectrumMapBody']]) {
    const d0 = await page.evaluate(b => [getComputedStyle(document.getElementById(b)).display, document.querySelector(`[aria-controls="${b}"]`).getAttribute('aria-expanded')], body);
    await page.focus(btn); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    const d1 = await page.evaluate(b => [getComputedStyle(document.getElementById(b)).display, document.querySelector(`[aria-controls="${b}"]`).getAttribute('aria-expanded')], body);
    await page.keyboard.press('Space'); await page.waitForTimeout(250);
    const d2 = await page.evaluate(b => [getComputedStyle(document.getElementById(b)).display, document.querySelector(`[aria-controls="${b}"]`).getAttribute('aria-expanded')], body);
    ok(d0[0] !== 'none' && d0[1] === 'true' && d1[0] === 'none' && d1[1] === 'false' && d2[0] !== 'none' && d2[1] === 'true', `${btn} 키보드로 접기/펼치기 ${d0} → ${d1} → ${d2}`);
  }
  // 접은 채 창 크기 변화 → 펼치기: 오류 없음
  await page.click('#contributionToggle'); await page.setViewportSize({ width: 1100, height: 900 }); await page.waitForTimeout(400); await page.click('#contributionToggle'); await page.waitForTimeout(300);
  ok(errors.length === 0, `접기 · 창 크기 변화 콘솔 오류 0 ${errors.join(' | ')}`);
  await page.close();
}
await browser.close();
console.log(fails ? `\n실패 ${fails}개` : '\n모두 통과');
process.exitCode = fails ? 1 : 0;
