// 예시 파일 생성: node scripts/make-samples.js   (모두 가상 데이터)
// 앱의 「예시 데이터 불러오기」와 같은 생성기(js/sample-data.js)를 씁니다.
const fs = require('fs');
const path = require('path');
const S = require('../classic/js/sample-data.js');
const L = require('../classic/js/logic.js');
const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const files = { '예시데이터_세로형.csv': S.longCsv(), '예시데이터_가로형.csv': S.wideCsv(), '예시데이터_가로형_열RPM.csv': S.rpmColsCsv(), '예시데이터_TestlabNeo형식.csv': S.testlabCsv() };
for (const [name, text] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, name), text);
  // 다시 읽어 도구가 기대대로 해석하는지 확인
  const back = fs.readFileSync(path.join(out, name), 'utf8');
  const rows = L.parseCsv(back, L.detectDelimiter(back));
  const hr = L.guessHeaderRow(rows);
  const r = L.isTestlab(rows) ? L.normalize(rows, { layout: 'testlab' })
    : L.normalize(rows, { headerRow: hr, layout: L.guessLayout(rows[hr]), mapping: L.guessMapping(rows[hr]) });
  console.log(name, (Buffer.byteLength(back) / 1024).toFixed(0) + 'KB', '그룹 ' + r.groups.length, '경고 ' + r.log.length);
}
