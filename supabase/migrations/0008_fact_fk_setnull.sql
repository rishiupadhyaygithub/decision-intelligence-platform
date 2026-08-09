-- 0008 — fix daily pipeline failure.
-- compute.mjs deletes facts not in the fresh compute set. FKs from
-- decision_facts.fact_id and risks.fact_id had no ON DELETE clause (= RESTRICT),
-- so the delete blocked and the whole pipeline stage errored once any decision
-- had cited a fact.
--
-- decision_facts.fact_id is part of the compound PK, so SET NULL would break
-- the PK — use CASCADE (dropping the citation row is correct: no fact => no
-- citation).
-- risks.fact_id is nullable + not part of PK, so SET NULL preserves the risk
-- text with a broken citation pointer.

alter table decision_facts
  drop constraint if exists decision_facts_fact_id_fkey,
  add  constraint decision_facts_fact_id_fkey
       foreign key (fact_id) references facts(id) on delete cascade;

alter table risks
  drop constraint if exists risks_fact_id_fkey,
  add  constraint risks_fact_id_fkey
       foreign key (fact_id) references facts(id) on delete set null;
