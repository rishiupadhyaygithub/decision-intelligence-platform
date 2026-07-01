-- 0003_rls.sql — row-level security + per-user decision ownership

alter table decisions add column if not exists user_id uuid references auth.users(id);

create index if not exists decisions_user_id_idx on decisions (user_id);

-- Reference / synthetic data: authenticated read-only
alter table sku enable row level security;
alter table sales enable row level security;
alter table inventory enable row level security;
alter table competitor_signal enable row level security;
alter table facts enable row level security;

drop policy if exists sku_select_auth on sku;
create policy sku_select_auth on sku for select to authenticated using (true);

drop policy if exists sales_select_auth on sales;
create policy sales_select_auth on sales for select to authenticated using (true);

drop policy if exists inventory_select_auth on inventory;
create policy inventory_select_auth on inventory for select to authenticated using (true);

drop policy if exists competitor_signal_select_auth on competitor_signal;
create policy competitor_signal_select_auth on competitor_signal for select to authenticated using (true);

drop policy if exists facts_select_auth on facts;
create policy facts_select_auth on facts for select to authenticated using (true);

-- Decisions: owner-only
alter table decisions enable row level security;

drop policy if exists decisions_select_own on decisions;
create policy decisions_select_own on decisions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists decisions_insert_own on decisions;
create policy decisions_insert_own on decisions for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists decisions_update_own on decisions;
create policy decisions_update_own on decisions for update to authenticated
  using (user_id = auth.uid());

-- Child tables: access via owning decision
alter table decision_enrichment enable row level security;
alter table decision_facts enable row level security;
alter table risks enable row level security;
alter table alternatives enable row level security;
alter table reviewers enable row level security;
alter table audit_log enable row level security;
alter table outcomes enable row level security;

drop policy if exists decision_enrichment_own on decision_enrichment;
create policy decision_enrichment_own on decision_enrichment for all to authenticated
  using (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()))
  with check (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()));

drop policy if exists decision_facts_own on decision_facts;
create policy decision_facts_own on decision_facts for all to authenticated
  using (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()))
  with check (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()));

drop policy if exists risks_own on risks;
create policy risks_own on risks for all to authenticated
  using (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()))
  with check (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()));

drop policy if exists alternatives_own on alternatives;
create policy alternatives_own on alternatives for all to authenticated
  using (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()))
  with check (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()));

drop policy if exists reviewers_own on reviewers;
create policy reviewers_own on reviewers for all to authenticated
  using (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()))
  with check (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()));

drop policy if exists audit_log_own on audit_log;
create policy audit_log_own on audit_log for all to authenticated
  using (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()))
  with check (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()));

drop policy if exists outcomes_own on outcomes;
create policy outcomes_own on outcomes for all to authenticated
  using (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()))
  with check (exists (select 1 from decisions d where d.id = decision_id and d.user_id = auth.uid()));

-- Facts readable via join from decision_facts (for detail page)
drop policy if exists facts_via_decision on facts;
create policy facts_via_decision on facts for select to authenticated
  using (
    exists (
      select 1 from decision_facts df
      join decisions d on d.id = df.decision_id
      where df.fact_id = facts.id and d.user_id = auth.uid()
    )
  );

-- Transactional save (atomic multi-table insert)
create or replace function save_decision_bundle(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id text := payload->>'id';
  v_analysis jsonb := payload->'analysis';
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_id is null or v_analysis is null then
    raise exception 'invalid payload';
  end if;
  if coalesce((v_analysis->>'grounded')::boolean, false) is not true then
    raise exception 'analysis must be grounded';
  end if;
  if coalesce((v_analysis->'validation'->>'ok')::boolean, false) is not true then
    raise exception 'analysis failed validation';
  end if;

  insert into decisions (id, title, type, urgency, proposer, role, status, problem, whynow, user_id)
  values (
    v_id,
    payload->>'title',
    payload->>'type',
    payload->>'urgency',
    payload->>'proposer',
    coalesce(payload->>'role', 'member'),
    'pending',
    payload->>'problem',
    nullif(payload->>'whynow', ''),
    v_uid
  );

  insert into decision_enrichment (
    decision_id, summary, recommendation, confidence, data_health, risk_level, model, grounded
  ) values (
    v_id,
    v_analysis->>'summary',
    v_analysis->>'recommendation',
    (v_analysis->>'confidence')::numeric,
    (v_analysis->>'data_health_score')::numeric,
    coalesce(v_analysis->'top_risks'->0->>'severity', 'medium'),
    coalesce(v_analysis->>'model', 'gemini-2.0-flash'),
    true
  );

  insert into risks (decision_id, risk, severity, fact_id)
  select v_id, r->>'risk', r->>'severity', nullif(r->>'fact_id', '')
  from jsonb_array_elements(coalesce(v_analysis->'top_risks', '[]'::jsonb)) r;

  insert into alternatives (decision_id, option, tradeoff)
  select v_id, a->>'option', a->>'tradeoff'
  from jsonb_array_elements(coalesce(v_analysis->'alternatives', '[]'::jsonb)) a;

  insert into decision_facts (decision_id, fact_id)
  select v_id, f->>'id'
  from jsonb_array_elements(coalesce(v_analysis->'facts_used', '[]'::jsonb)) f
  where f->>'id' is not null;

  insert into audit_log (decision_id, type, actor, detail, hash) values
    (v_id, 'proposed', payload->>'proposer', 'Decision proposed',
     encode(sha256((v_id || 'proposed')::bytea), 'hex')),
    (v_id, 'ai', 'AI Engine',
     'Grounded enrichment · ' || jsonb_array_length(coalesce(v_analysis->'facts_used', '[]'::jsonb)) || ' facts cited',
     encode(sha256((v_id || 'ai')::bytea), 'hex'));

  return v_id;
end;
$$;

revoke all on function save_decision_bundle(jsonb) from public;
grant execute on function save_decision_bundle(jsonb) to authenticated;
