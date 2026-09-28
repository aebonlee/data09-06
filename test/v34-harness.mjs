// 제출자 분석기 v34(docs/source/order_analysis_v34.html)의 계산 함수를 그대로 꺼내 Node 에서 돌립니다.
// 우리 도구의 계산을 제출자 분석기와 같은 입력으로 맞대 보기 위한 것입니다(화면 코드는 쓰지 않음).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const V34_PATH = path.join(HERE, '..', 'docs', 'source', 'order_analysis_v34.html');

const NAMES = ['parseCsv', 'safeMin', 'safeMax', 'analyzeStructure', 'noiseDbToPa', 'buildNormalizedModel', 'getMeta', 'normalizeMetaKey',
  'isFiniteNumber', 'toNumber', 'median', 'mode', 'uniqueSorted', 'nearlyEqual', 'round', 'addCheck', 'formatNumber',
  'normalizeAmplitudeUnit', 'isDbScaleUnit', 'isDbaUnit', 'amplitudeUnit', 'aWeighting', 'convertAmplitude', 'detectedAmplitudeUnit',
  'getChannelTypeSettings', 'calculateOrderRows', 'orderAmplitudeToLinear', 'buildRssSumSeries', 'parseOrders'];

// 이름으로 function 선언 하나를 중괄호 수를 세어 잘라냅니다
function extract(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('v34 에서 함수를 찾지 못함: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('중괄호가 맞지 않음: ' + name);
}

// settings: v34 입력 칸 id → 값 (예: { noiseAmplitudeMode: 'db', noiseSourceDbReference: 2e-5, … })
export function loadV34(settings = {}) {
  const html = fs.readFileSync(V34_PATH, 'utf8');
  const body = NAMES.map(n => extract(html, n)).join('\n');
  const ids = Object.assign({
    noiseAmplitudeMode: 'db', noiseSourceDbReference: 2e-5, noiseOrderDbReference: 2e-5,
    vibrationAmplitudeMode: 'linear', vibrationSourceDbReference: 1.0197e-7, vibrationOrderDbReference: 1.0197e-7
  }, settings);
  const factory = new Function('ids', `
    const $ = id => (id in ids ? { value: String(ids[id]) } : null);
    let currentReport = null;
    ${body}
    return { parseCsv, analyzeStructure, calculateOrderRows, buildRssSumSeries, convertAmplitude, aWeighting,
      setReport: r => { currentReport = r; } };
  `);
  return factory(ids);
}

// 파일 하나를 v34 로 읽기 → report (normalized.channels 에 채널별 spectraByRpm)
export function v34Read(v, text, fileName) {
  const rows = v.parseCsv(text.replace(/^﻿/, ''));
  const report = v.analyzeStructure(rows, { name: fileName, size: text.length }, 'UTF-8');
  v.setReport(report);
  return report;
}
