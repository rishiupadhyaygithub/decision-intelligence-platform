-- 0010_noop_sequence_gap.sql
-- Intentional no-op.
--
-- The migration sequence jumped 0009 -> 0011 during the Phase 4.5 work; no 0010
-- file was ever authored or committed (verified: `git log --all --diff-filter=A
-- -- supabase/migrations/0010*` returns nothing). Nothing is missing from the
-- schema — the numbering simply skipped.
--
-- Renaming 0011 to close the gap is NOT safe: 0011-0014 are already recorded in
-- supabase_migrations.schema_migrations on the linked project, and renaming an
-- applied migration makes the CLI treat it as new and re-run it. 0014 in
-- particular starts with `ALTER TABLE decision_facts DROP CONSTRAINT ... CASCADE`,
-- which is destructive on a second run.
--
-- So the gap is closed with a placeholder instead. This file is safe to apply in
-- any order and safe to re-run.

do $$
begin
  raise notice '0010 is an intentional no-op placeholder (sequence gap, no schema change).';
end $$;
