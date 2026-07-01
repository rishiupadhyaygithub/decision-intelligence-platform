-- 0006: orchestration run-log. Every pipeline stage writes one row here so the
-- dashboard "System health" panel = free monitoring. Service role writes (bypasses
-- RLS); authenticated users may read (so the panel renders).
create table if not exists job_runs (
  id            bigint generated always as identity primary key,
  job           text not null,
  status        text not null default 'running',  -- running | ok | error
  rows_affected integer,
  detail        text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   integer
);

create index if not exists job_runs_started_idx on job_runs (started_at desc);

alter table job_runs enable row level security;

drop policy if exists job_runs_read on job_runs;
create policy job_runs_read on job_runs for select to authenticated using (true);
