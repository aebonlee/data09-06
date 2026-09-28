-- ============================================================================
-- 로컬 검증 전용 — data09-06 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 흉내: set role authenticated + request.jwt.claim.sub 에 uuid 를 넣으면
--  스텁의 auth.uid() 가 그 값을 돌려줍니다. anon 은 set role anon.
-- ============================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 문장이 지정한 SQLSTATE 로 실패하는지 본다. (이름이 _assert 로 시작해 권한 검사에서 빠진다)
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is not distinct from p_state then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 %)', p_label, p_state, coalesce(v_state, '성공함');
  end if;
end;
$fn$;

-- 영향받은 행 수를 돌려준다 (RLS 로 가려진 UPDATE/DELETE 는 0 행)
create or replace function public._assert_rows(p_sql text, p_expected int, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  if v_n = p_expected then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 % 행, 실제 % 행)', p_label, p_expected, v_n;
  end if;
end;
$fn$;

do $t$ begin raise notice '[프로젝트] 재실행 안전 · 정책 수'; end $t$;

-- 두 번 적용한 뒤에도 정책이 표마다 정확히 4개(중복 생성 없음)
do $t$
declare v_bad text;
begin
  select string_agg(c.relname || '=' || n, ', ') into v_bad from (
    select c.relname, count(p.oid) as n
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
     where s.nspname = 'public' and c.relkind = 'r'
     group by c.relname) c
   where n <> 4;
  perform public._assert(v_bad is null, '두 번 적용 후 표마다 정책 4개 (발견: ' || coalesce(v_bad, '없음') || ')');
  perform public._assert_eq(
    (select count(*) from pg_trigger where tgname like '%\_updated\_at' and not tgisinternal),
    3::bigint, '두 번 적용 후 updated_at 트리거 3개');
end $t$;

do $t$ begin raise notice '[프로젝트] 함수 권한(proacl)'; end $t$;

do $t$
declare v_acl text;
begin
  select array_to_string(proacl, ',') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and proname = 'set_updated_at';
  perform public._assert(v_acl is not null and v_acl not like '=X/%' and v_acl not like '%,=X/%',
    'set_updated_at: PUBLIC EXECUTE 없음 (' || coalesce(v_acl, 'null') || ')');
  perform public._assert(v_acl not like '%anon=%', 'set_updated_at: anon EXECUTE 없음');
  perform public._assert(v_acl like '%authenticated=X%', 'set_updated_at: authenticated EXECUTE 있음');
end $t$;

-- ----------------------------------------------------------------------------
-- 사용자 A 가 설정을 저장한다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 사용자 A — 자기 설정 쓰기·읽기'; end $t$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

do $t$
begin
  insert into public.analysis_settings (orders) values ('36, 45')
    on conflict (owner_id) do update set orders = excluded.orders;
  insert into public.analysis_settings (orders, track_method) values ('39', 'max')
    on conflict (owner_id) do update set orders = excluded.orders, track_method = excluded.track_method;
  perform public._assert_eq((select orders from public.analysis_settings), '39'::text,
    'analysis_settings upsert(onConflict owner_id)가 한 행을 덮어쓴다');
  perform public._assert_eq((select search_hz from public.analysis_settings), 1::numeric,
    '기본값이 앱 DEFAULT_SETTINGS 와 같다 (search_hz = 1)');

  insert into public.import_config (signature, delimiter, header_row, layout, mapping)
    values ('RPM|Hz|CH1', ',', 0, 'wide', '{"rpm":0,"freq":1}');
  insert into public.import_config (signature, delimiter, header_row, layout)
    values ('rpm|freq|value', E'\t', 2, 'long');
  insert into public.import_config (signature, delimiter, header_row, layout, mapping)
    values ('RPM|Hz|CH1', ';', 1, 'wide', '{"rpm":0}')
    on conflict (owner_id, signature) do update set delimiter = excluded.delimiter, header_row = excluded.header_row;
  perform public._assert_eq((select count(*) from public.import_config), 2::bigint,
    '같은 열 제목(signature)은 upsert 로 한 행만 남는다');

  insert into public.view_prefs (line_h, map_h, live) values (380, 500, false);
  perform public._assert_eq((select owner_id from public.view_prefs),
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'owner_id 가 auth.uid() 로 채워진다');
end $t$;

-- 트리거는 now()(트랜잭션 시작 시각)를 쓰므로 INSERT 와 다른 문장에서 고쳐야 차이가 난다
update public.view_prefs set line_h = 420;
do $t$ begin
  perform public._assert((select updated_at > created_at from public.view_prefs), 'UPDATE 하면 updated_at 이 갱신된다');
end $t$;

-- ----------------------------------------------------------------------------
-- 사용자 B 는 A 의 설정을 못 본다 · 못 고친다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 사용자 B — A 와 격리'; end $t$;

set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';

do $t$
declare t text;
begin
  foreach t in array array['analysis_settings','import_config','view_prefs']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'B 에게 A 의 ' || t || ' 가 안 보인다');
    perform public._assert_rows(format('update public.%I set updated_at = now()', t), 0, 'B 는 A 의 ' || t || ' 를 못 고친다');
    perform public._assert_rows(format('delete from public.%I', t), 0, 'B 는 A 의 ' || t || ' 를 못 지운다');
  end loop;
  perform public._assert_raises(
    $q$insert into public.analysis_settings (owner_id) values ('aaaaaaaa-0000-0000-0000-000000000001')$q$,
    '42501', 'B 가 owner_id 를 A 로 속여 넣으면 RLS 가 막는다');
  -- B 는 자기 행을 따로 가진다 (A 와 같은 signature 여도 충돌하지 않는다)
  insert into public.import_config (signature, delimiter, layout) values ('RPM|Hz|CH1', ',', 'wide');
  perform public._assert_eq((select count(*) from public.import_config), 1::bigint,
    'B 는 A 와 같은 열 제목으로 자기 설정을 따로 저장한다');
end $t$;

-- ----------------------------------------------------------------------------
-- anon(비로그인)은 아무것도 못 보고 못 쓴다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] anon — 읽기·쓰기 불가'; end $t$;

set role anon;
set request.jwt.claim.sub = '';
do $t$
declare t text;
begin
  foreach t in array array['analysis_settings','import_config','view_prefs']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'anon 에게 ' || t || ' 가 안 보인다');
  end loop;
  perform public._assert_raises($q$insert into public.analysis_settings (orders) values ('1')$q$,
    '42501', 'anon 은 analysis_settings 에 쓰지 못한다');
  perform public._assert_raises($q$insert into public.import_config (signature, delimiter, layout) values ('x', ',', 'long')$q$,
    '42501', 'anon 은 import_config 에 쓰지 못한다');
  perform public._assert_raises($q$insert into public.view_prefs (live) values (true)$q$,
    '42501', 'anon 은 view_prefs 에 쓰지 못한다');
  perform public._assert_raises('select public.set_updated_at()', '42501', 'anon 은 set_updated_at 을 실행하지 못한다');
end $t$;
reset role;

-- ----------------------------------------------------------------------------
-- CHECK · UNIQUE (postgres 로 — RLS 와 무관하게 제약만 본다)
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] CHECK · UNIQUE 제약'; end $t$;

do $t$
declare a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  perform public._assert_raises(format('insert into public.analysis_settings (owner_id) values (%L)', a),
    '23505', '분석 설정은 사용자당 1행');
  perform public._assert_raises(format('insert into public.view_prefs (owner_id) values (%L)', a),
    '23505', '화면 설정은 사용자당 1행');
  perform public._assert_raises(format('insert into public.import_config (owner_id, signature, delimiter, layout) values (%L, %L, %L, %L)', a, 'RPM|Hz|CH1', ',', 'wide'),
    '23505', '같은 사용자·같은 열 제목(signature)은 UNIQUE 가 막는다');
  perform public._assert_raises(format('insert into public.analysis_settings (owner_id, track_method) values (%L, %L)', gen_random_uuid(), 'guess'),
    '23514', '추적 방식은 peak/max/rss 만');
  perform public._assert_raises(format('insert into public.analysis_settings (owner_id, ratio) values (%L, 0)', gen_random_uuid()),
    '23514', '회전비 0 은 CHECK 가 막는다');
  perform public._assert_raises(format('insert into public.analysis_settings (owner_id, noise_ref) values (%L, 0)', gen_random_uuid()),
    '23514', 'dB 기준값 0 은 CHECK 가 막는다');
  perform public._assert_raises(format('insert into public.analysis_settings (owner_id, search_hz) values (%L, -1)', gen_random_uuid()),
    '23514', '피크 검색 범위 음수는 CHECK 가 막는다');
  perform public._assert_raises(format('insert into public.analysis_settings (owner_id, track_method, half_width) values (%L, %L, 0)', gen_random_uuid(), 'rss'),
    '23514', '대역 방식(rss)에서 반폭 0 은 CHECK 가 막는다');
  perform public._assert_raises(format('insert into public.analysis_settings (owner_id, track_method, half_width) values (%L, %L, 0)', gen_random_uuid(), 'peak'),
    null, 'v34 방식(peak)에서는 반폭 0 도 허용 (앱 validateSettings 와 같음)');
  perform public._assert_raises(format('insert into public.analysis_settings (owner_id, energy_lo, energy_hi) values (%L, 2000, 1000)', gen_random_uuid()),
    '23514', '에너지 대역 하한 ≥ 상한은 CHECK 가 막는다');
  perform public._assert_raises(format('insert into public.analysis_settings (owner_id, orders) values (%L, %L)', gen_random_uuid(), '  '),
    '23514', '빈 오더 목록은 CHECK 가 막는다');
  perform public._assert_raises(format('insert into public.analysis_settings (owner_id, noise_mode) values (%L, %L)', gen_random_uuid(), 'rms'),
    '23514', '소음 표시는 linear/db/dba 만');
  perform public._assert_raises(format('insert into public.import_config (owner_id, signature, delimiter, layout) values (%L, %L, %L, %L)', a, 'z', '|', 'long'),
    '23514', '구분자는 쉼표·세미콜론·탭만');
  perform public._assert_raises(format('insert into public.import_config (owner_id, signature, delimiter, layout) values (%L, %L, %L, %L)', a, 'z', ',', 'matrix'),
    '23514', '열 배치는 long/wide/rpmcols/testlab 만');
  perform public._assert_raises(format('insert into public.import_config (owner_id, signature, delimiter, layout, mapping) values (%L, %L, %L, %L, %L)', a, 'z', ',', 'long', '[1,2]'),
    '23514', '열 매핑은 JSON 객체여야 한다');
  perform public._assert_raises(format('insert into public.view_prefs (owner_id, line_h) values (%L, 5000)', gen_random_uuid()),
    '23514', '그래프 높이는 앱 범위(240~900px) 안');
end $t$;

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
