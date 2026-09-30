// 실행: node test/all.mjs — 최신 분석기 v51(첫 화면 포함)과 이전 도구(classic/) 테스트를 차례로 돌립니다(의존성 없음)
await import('./analyzer.test.mjs');
await import('./classic.test.mjs');
if (process.exitCode) console.error('\n실패가 있습니다');
