# Supabase DB 스크립트 — data09-06 오더 분석기

이 폴더에는 오더 분석기의 설정을 데이터베이스(Supabase)에 담을 때 쓸 표 구조(`schema.sql`)가 들어 있습니다.
지금 도구는 이 스크립트 없이도 그대로 동작합니다. 앱을 DB 에 연결하는 일은 다음 단계에서 합니다.

## 왜 DB 가 필요한가

지금 도구는 분석 설정, 가져오기 설정, 화면 설정을 브라우저 localStorage 에만 둡니다. 그래서 다음 한계가 있습니다.

- **기준이 PC 마다 갈립니다** — 피크 검색·합산 범위(±Hz), dB 기준값(소음 20 µPa, 진동 1.0197e-7 g), 표시 방식(Amplitude·dB·dBA)이 브라우저마다 따로 남습니다. 다른 PC 나 다른 담당자가 같은 시험 CSV 를 열면 다른 기준으로 계산할 수 있습니다. 같은 기준을 한곳에 두어야 결과를 비교할 수 있습니다.
- **가져오기 설정이 하나만 남습니다** — 지금은 마지막으로 쓴 열 배치 하나만 기억합니다. 시험 장비·내보내기 형식이 여러 가지면 형식이 바뀔 때마다 다시 짝지어야 합니다. DB 에서는 열 제목 묶음(signature)마다 설정을 따로 쌓아 둡니다.

시험 데이터(CSV 원본과 계산 결과)는 표를 두지 않았습니다. 도구가 저장하지 않고, 제품 사양이 드러나는 자료라 회사 밖으로 내보내지 않는 것이 기획서의 전제이기 때문입니다.

## 테이블

| 이름 | 용도 | localStorage 대응 |
|---|---|---|
| `analysis_settings` | 분석 설정 — 회전비, 추적 오더, 추적 방식(v34 피크·대역 최대·대역 RSS), 피크 검색·합산 범위, 오더 반폭, 소음·진동 표시 방식과 dB 기준값, 피크 개수·최소 진폭, 에너지 대역. 사용자당 1행 | `data09-06.settings` |
| `import_config` | 가져오기 설정 — 구분자, 소수점 쉼표 여부, 머리행, 열 배치(long·wide·rpmcols·testlab), 열 매핑, 고정값. 열 제목 묶음마다 1행 | `data09-06.import` |
| `view_prefs` | 화면 설정 — 그래프·컬러맵 높이(px), 즉시 다시 계산 여부. 사용자당 1행 | `data09-06.view` |

필드 이름은 도구의 이름을 snake_case 로 옮겼습니다(`searchHz` → `search_hz`, `lineH` → `line_h`).

## 보안

- 모든 표에 RLS(행 단위 보안)를 켰습니다. 각 행은 만든 사람(`owner_id`)만 보고 고치고 지울 수 있습니다.
- 로그인하지 않은 방문자(anon)는 아무것도 보거나 쓰지 못합니다.
- 이 도구에는 팀·관리자 구분과 기록성(로그) 자료가 없어 관리자 표와 로그 표를 두지 않았습니다.
- 화면의 입력 규칙(회전비·dB 기준값 > 0, 검색·합산 범위 ≥ 0, 대역 방식이면 반폭 > 0 등)을 DB 의 CHECK 제약으로도 걸었습니다.

## 적용 방법

1. [supabase.com](https://supabase.com) 에 가입합니다.
2. **New project** 로 본인 프로젝트를 만듭니다.
3. 왼쪽 메뉴의 **SQL Editor** 를 엽니다.
4. `schema.sql` 내용을 모두 복사해 붙여 넣습니다.
5. **Run** 을 누릅니다.

여러 번 실행해도 안전합니다. 이미 있는 표는 건너뛰고, 정책과 트리거는 지우고 다시 만듭니다.

## 확인 방법

- **Table Editor** 에 표 3개(`analysis_settings`, `import_config`, `view_prefs`)가 보이면 됩니다.
- 표마다 **RLS enabled** 표시가 있는지 확인합니다.
- SQL Editor 에서 아래를 실행해 정책이 표마다 4개(조회·추가·수정·삭제)인지 봅니다.

```sql
select tablename, count(*) from pg_policies where schemaname = 'public' group by tablename;
```

## 앱 연결은 다음 단계입니다

이 스크립트는 표를 준비해 두는 것까지입니다. 도구의 `js/store.js` 를 Supabase 에 읽고 쓰도록 바꾸는 일, 로그인 화면을 붙이는 일은 다음 단계에서 합니다.
그때 저장은 upsert 로 하고, 충돌 기준을 `owner_id`(분석·화면 설정)·`owner_id,signature`(가져오기 설정)로 지정해야 중복 행이 생기지 않습니다.

## 로컬 검증 방법

운영에 올리기 전에 내 PC 의 임시 PostgreSQL 에 실제로 적용해 검사합니다. PostgreSQL 이 설치되어 있어야 합니다(macOS: `brew install postgresql@17`).

```sh
./scripts/sqltest/run.sh
```

임시 데이터베이스를 만들어 `schema.sql` 을 두 번 적용하고, 사용자 A·B 격리, 비로그인 차단, 제약 조건, 함수 권한을 검사한 뒤 지웁니다. 마지막에 「SQL 검증 통과.」가 나오면 됩니다.
`scripts/sqltest/` 의 `*.local.sql` 파일은 검증 전용이라 Supabase SQL Editor 에서 실행하면 스스로 멈춥니다.
