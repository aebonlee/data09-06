// 선택 실행(브라우저 회귀): 첫 CSV 분석 → 채널 이름이 다른 둘째 CSV 열기 → 창 크기 변화 → 다시 분석, 콘솔 오류 0 이어야 함
// 필요: playwright-core 와 크롬. 없으면 건너뜁니다.
//   PW_CORE=<node_modules/playwright-core 경로> CHROME=<크롬 실행 파일> node test/browser-second-csv.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
try { ({ chromium } = await import(process.env.PW_CORE ? pathToFileURL(path.join(process.env.PW_CORE, 'index.mjs')).href : 'playwright-core')); }
catch { console.log('  skip playwright-core 없음 — 건너뜀'); process.exit(0); }
const A = path.join(ROOT, 'samples/예시데이터_TestlabNeo형식.csv');           // P1 · P2 · Mic
const B = path.join(ROOT, 'test/fixtures/testlab-closed-rpm.csv');          // NoiseA · NoiseB · Mount front · Mount rear
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
async function load(f) {
  await page.setInputFiles('#fileInput', f);
  await page.waitForFunction(() => !document.getElementById('csvPreview').classList.contains('hidden'), null, { timeout: 10000 });
}
await load(A);
await page.click('#confirmCsvAnalysis');
await page.waitForTimeout(800);
await page.fill('#multiOrderInput', '30, 36, 42');
await page.dispatchEvent('#multiOrderInput', 'input');
await page.click('#selectAllChannels');
await page.waitForTimeout(500);
const s1 = await page.evaluate(() => document.getElementById('multiKpis').innerText.replace(/\s+/g, ' '));
console.log('1st KPI:', s1.slice(0, 160));
await load(B);
await page.waitForTimeout(600);
await page.setViewportSize({ width: 1200, height: 900 }); // 창 크기 변화(지연 실행 renderMultiAnalysis 유발)
await page.waitForTimeout(600);
await page.click('#confirmCsvAnalysis');
await page.waitForTimeout(800);
await page.click('#selectAllChannels');
await page.waitForTimeout(500);
const s2 = await page.evaluate(() => ({ kpi: document.getElementById('multiKpis').innerText.replace(/\s+/g, ' '), ch: [...document.querySelectorAll('.multi-channel')].map(x => x.value) }));
console.log('2nd KPI:', s2.kpi.slice(0, 160));
console.log('2nd channels:', s2.ch.join(','));
console.log('errors:', errors.length); errors.forEach(e => console.log(e));
await browser.close();
process.exitCode = errors.length ? 1 : 0;
