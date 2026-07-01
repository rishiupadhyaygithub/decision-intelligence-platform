-- 0004_rls_memory_evals.sql — close the RLS gap flagged by the linter/advisor.
-- memory + eval_runs were left exposed to the anon role. Enable RLS with the same
-- owner-via-decision pattern as the other child tables (0003). Backend jobs that
-- write these use the service-role key and bypass RLS.

alter table memory enable row level security;
alter table eval_runs enable row level security;

drop policy if exists memory_own on memory;
create policy memory_own on memory for all to authenticated
  using (exists (select 1 from decisions d where d.id = memory.decision_id and d.user_id = auth.uid()))
  with check (exists (select 1 from decisions d where d.id = memory.decision_id and d.user_id = auth.uid()));

drop policy if exists eval_runs_own on eval_runs;
create policy eval_runs_own on eval_runs for all to authenticated
  using (exists (select 1 from decisions d where d.id = eval_runs.decision_id and d.user_id = auth.uid()))
  with check (exists (select 1 from decisions d where d.id = eval_runs.decision_id and d.user_id = auth.uid()));
