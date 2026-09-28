-- ============================================================================
-- data09-06 — 오더 분석기 (Testlab Neo 주파수 스펙트럼 → 오더 추적)
-- Supabase(PostgreSQL) 스키마 + RLS
--
--  무엇인가 : 지금 브라우저 localStorage 에 두는 설정 3종을 DB 로 옮길 때 쓸 표 구조입니다.
--             앱 연결은 다음 단계입니다.
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  본인 프로젝트에 올리는 것을 전제로 하므로 표 이름에 접두사를 붙이지 않았습니다.
--  회사 Supabase 주소·키는 이 파일 어디에도 없습니다.
--
--  표 목록
--    analysis_settings  분석 설정 (사용자당 1행)       ← localStorage 'data09-06.settings'
--    import_config      가져오기 설정 (열 제목별 1행)   ← localStorage 'data09-06.import'
--    view_prefs         화면 설정 (사용자당 1행)       ← localStorage 'data09-06.view'
--
--  시험 데이터(CSV 원본·계산 결과)는 표를 두지 않았습니다. 도구가 저장하지 않고,
--  제품 사양이 드러나는 자료라 회사 밖으로 내보내지 않는 것이 기획서의 전제입니다.
--
--  보안
--    모든 표 RLS 켬. 행은 만든 사람(owner_id = auth.uid())만 보고 고칩니다.
--    팀·관리자 역할과 기록성(로그) 자료가 없어 관리자 표·로그 표를 두지 않았습니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 분석 설정 — js/logic.js DEFAULT_SETTINGS 의 필드를 그대로 옮겼습니다.
create table if not exists public.analysis_settings (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  ratio           numeric not null default 1 check (ratio > 0),          -- 기준축 회전비
  orders          text not null default '1, 2, 4'                         -- 추적할 오더(쉼표 구분)
                  check (length(btrim(orders)) > 0),
  track_method    text not null default 'peak'
                  check (track_method in ('peak', 'max', 'rss')),
  search_hz       numeric not null default 1 check (search_hz >= 0),     -- 피크 검색 범위(±Hz)
  sum_hz          numeric not null default 1 check (sum_hz >= 0),        -- 피크 중심 합산 범위(±Hz)
  half_width      numeric not null default 0.25 check (half_width >= 0), -- 오더 대역 반폭(±오더)
  noise_mode      text not null default 'db'  check (noise_mode in ('linear', 'db', 'dba')),
  noise_ref       numeric not null default 2e-5 check (noise_ref > 0),   -- 소음 dB 기준(Pa)
  noise_src_ref   numeric not null default 2e-5 check (noise_src_ref > 0),
  vib_mode        text not null default 'linear' check (vib_mode in ('linear', 'db', 'dba')),
  vib_ref         numeric not null default 1.0197e-7 check (vib_ref > 0), -- 진동 dB 기준(g)
  vib_src_ref     numeric not null default 1.0197e-7 check (vib_src_ref > 0),
  peak_top_n      int not null default 3 check (peak_top_n >= 0),        -- RPM 별 피크 개수
  peak_min        numeric not null default 0,                            -- 피크 최소 진폭(이하 제외)
  energy_axis     text not null default 'hz' check (energy_axis in ('hz', 'order')),
  energy_lo       numeric,                                               -- 비우면 처음부터
  energy_hi       numeric,                                               -- 비우면 끝까지
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- ⚠ 프런트에서 upsert 할 때 onConflict: 'owner_id' 를 지정할 것
  constraint analysis_settings_owner_key unique (owner_id),
  -- 화면(validateSettings)과 같은 규칙: 대역 방식(max·rss)이면 반폭 > 0
  constraint analysis_settings_half_width check (track_method = 'peak' or half_width > 0),
  constraint analysis_settings_energy_range
    check (energy_lo is null or energy_hi is null or energy_lo < energy_hi)
);

-- 가져오기 설정 — 구분자·머리행·열 배치·열 매핑·고정값.
-- 앱은 「같은 열 제목(signature)의 파일이면 지난번 설정을 그대로」 씁니다.
-- 그래서 열 제목 묶음(signature)을 자연 키로 둡니다.
create table if not exists public.import_config (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  signature       text not null,                                  -- 머리행 열 제목을 '|' 로 이은 것
  delimiter       text not null check (delimiter in (',', ';', E'\t')),
  decimal_comma   boolean not null default false,                 -- 소수점이 쉼표인가(1,5)
  header_row      int not null default 0 check (header_row >= 0),
  layout          text not null check (layout in ('long', 'wide', 'rpmcols', 'testlab')),
  mapping         jsonb not null default '{}'::jsonb              -- {rpm, freq, channel, direction, unit, value: 열 번호}
                  check (jsonb_typeof(mapping) = 'object'),
  fixed           jsonb not null default '{}'::jsonb              -- {channel, direction, unit} 고정값
                  check (jsonb_typeof(fixed) = 'object'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'owner_id,signature'
  constraint import_config_owner_signature_key unique (owner_id, signature)
);

-- 화면 설정 — 그래프 높이(px)·즉시 다시 계산
create table if not exists public.view_prefs (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  line_h          int check (line_h is null or line_h between 240 and 900),  -- 앱 CHART_HEIGHT 범위
  map_h           int check (map_h is null or map_h between 240 and 900),
  live            boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint view_prefs_owner_key unique (owner_id)
);

-- ----------------------------------------------------------------------------
-- 2. 함수 · 트리거 (search_path 고정)
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['analysis_settings','import_config','view_prefs']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS — 본인 행만
-- ----------------------------------------------------------------------------

alter table public.analysis_settings enable row level security;
alter table public.import_config     enable row level security;
alter table public.view_prefs        enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['analysis_settings','import_config','view_prefs']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())', t || '_delete', t);
  end loop;
end;
$rls$;

-- ----------------------------------------------------------------------------
-- 4. 함수 실행 권한
--
--  GRANT 만으로는 제한되지 않습니다. PostgreSQL 이 PUBLIC 에, Supabase 가
--  ALTER DEFAULT PRIVILEGES 로 anon 에 EXECUTE 를 미리 붙이므로 둘 다 끊습니다.
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon;
-- 트리거 전용 함수는 authenticated 를 남깁니다(트리거 발화 시 호출자 권한 검사 대비).
grant execute on function public.set_updated_at() to authenticated;

-- ----------------------------------------------------------------------------
-- 끝.
-- ----------------------------------------------------------------------------
