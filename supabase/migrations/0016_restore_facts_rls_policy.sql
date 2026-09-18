-- 0016_restore_facts_rls_policy.sql
-- P0 repair: authenticated users can currently read ZERO rows from `facts`.
--
-- 0003 enables RLS on facts (line 12) and grants exactly one SELECT policy to the
-- authenticated role — facts_via_decision — whose USING clause reads from
-- decision_facts:
--
--     using (exists (select 1 from decision_facts df
--                    join decisions d on d.id = df.decision_id
--                    where df.fact_id = facts.id and d.user_id = auth.uid()))
--
-- 0013 then ran `DROP TABLE IF EXISTS decision_facts CASCADE`. CASCADE drops
-- objects that depend on the dropped table, and a policy whose expression
-- references it is such a dependent. facts_via_decision went with it, and nothing
-- since has recreated it. RLS enabled with no permissive policy denies everything,
-- so every authenticated read of facts now returns an empty set.
--
-- Service-role callers (API routes, the pipeline) bypass RLS and were unaffected,
-- which is why this stayed invisible — the failing path is the user session used
-- by server components, e.g. the embedded facts(...) join on the decision detail
-- page, which silently rendered every citation as having no live fact.
--
-- Recreating the policy verbatim. Idempotent and safe to re-run.
--
-- NOTE for future migrations: dropping decision_facts with CASCADE will take this
-- policy again. If that table is ever rebuilt, re-run this file afterwards.

drop policy if exists facts_via_decision on facts;

create policy facts_via_decision on facts for select to authenticated
  using (
    exists (
      select 1
      from decision_facts df
      join decisions d on d.id = df.decision_id
      where df.fact_id = facts.id
        and d.user_id = auth.uid()
    )
  );
