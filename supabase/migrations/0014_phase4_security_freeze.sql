-- 0014_phase4_security_freeze.sql
-- Phase 4.5: Final Security, Authorization, and Failure-Mode Freeze

-- 0. Fix decision_facts to support ON DELETE SET NULL (T6)
ALTER TABLE decision_facts DROP CONSTRAINT IF EXISTS decision_facts_pkey CASCADE;
ALTER TABLE decision_facts DROP CONSTRAINT IF EXISTS decision_facts_fact_id_fkey;

-- We need a surrogate key so fact_id can be null without violating PK constraints
ALTER TABLE decision_facts ADD COLUMN IF NOT EXISTS id bigserial primary key;
ALTER TABLE decision_facts ALTER COLUMN fact_id DROP NOT NULL;

ALTER TABLE decision_facts ADD CONSTRAINT decision_facts_fact_id_fkey FOREIGN KEY (fact_id) REFERENCES facts(id) ON DELETE SET NULL;
ALTER TABLE decision_facts DROP CONSTRAINT IF EXISTS decision_facts_unique_constraint;
ALTER TABLE decision_facts ADD CONSTRAINT decision_facts_unique_constraint UNIQUE (decision_id, claim_type, claim_index, fact_id);

-- 1. Redefine save_decision_lineage to be strictly authorized and state-machine constrained
CREATE OR REPLACE FUNCTION save_decision_lineage(
  p_decision jsonb,
  p_snapshots jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := COALESCE(auth.role(), '');
  v_decision_id text;
  v_existing_owner uuid;
  v_count int;
BEGIN
  -- RAISE NOTICE 'v_uid: %, v_role: %', v_uid, v_role;

  IF v_uid IS NULL AND v_role != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated (uid: %, role: %)', v_uid, v_role;
  END IF;

  -- If service role, allow overriding user_id from payload if provided
  IF v_role = 'service_role' AND p_decision ? 'user_id' THEN
    v_uid := (p_decision->>'user_id')::uuid;
  END IF;

  v_decision_id := p_decision->>'id';
  IF v_decision_id IS NULL THEN
    RAISE EXCEPTION 'decision_id is required';
  END IF;

  -- Verify existence and ownership
  SELECT user_id INTO v_existing_owner FROM decisions WHERE id = v_decision_id;
  
  IF FOUND THEN
    IF v_existing_owner != v_uid THEN
      RAISE EXCEPTION 'Unauthorized: decision belongs to another user';
    END IF;
    
    -- Update existing
    UPDATE decisions SET
      title = p_decision->>'title',
      status = COALESCE(p_decision->>'status', status)
    WHERE id = v_decision_id;
  ELSE
    -- Insert new
    INSERT INTO decisions (
      id, user_id, title, type, urgency, proposer, role, status, problem, whynow, alternatives_text, created_at
    ) VALUES (
      v_decision_id,
      v_uid,
      p_decision->>'title',
      COALESCE(p_decision->>'type', 'Operational'),
      COALESCE(p_decision->>'urgency', 'Medium'),
      p_decision->>'proposer',
      p_decision->>'role',
      COALESCE(p_decision->>'status', 'pending'),
      p_decision->>'problem',
      p_decision->>'whynow',
      p_decision->>'alternatives_text',
      COALESCE((p_decision->>'createdAt')::timestamptz, now())
    );
  END IF;

  -- Insert enrichment (if provided)
  IF p_decision ? 'enrichment' THEN
    INSERT INTO decision_enrichment (
      decision_id, summary, recommendation, confidence, data_health, risk_level, model, grounded
    ) VALUES (
      v_decision_id,
      p_decision->'enrichment'->>'summary',
      p_decision->'enrichment'->>'recommendation',
      (p_decision->'enrichment'->>'confidence')::numeric,
      (p_decision->'enrichment'->>'dataHealth')::numeric,
      p_decision->'enrichment'->>'riskLevel',
      p_decision->'enrichment'->>'model',
      (p_decision->'enrichment'->>'grounded')::boolean
    )
    ON CONFLICT (decision_id) DO NOTHING;
  END IF;

  -- Insert the fact snapshots
  IF jsonb_array_length(p_snapshots) > 0 THEN
    INSERT INTO decision_facts (
      decision_id, claim_index, claim_type, fact_id, fact_snapshot
    )
    SELECT 
      v_decision_id,
      (s->>'claim_index')::int,
      s->>'claim_type',
      s->>'fact_id',
      s->'fact_snapshot'
    FROM jsonb_array_elements(p_snapshots) AS s
    ON CONFLICT (decision_id, claim_type, claim_index, fact_id) DO NOTHING;
  END IF;

  SELECT count(*) INTO v_count FROM decision_facts WHERE decision_id = v_decision_id;

  RETURN jsonb_build_object(
    'decision_id', v_decision_id,
    'saved', true,
    'snapshots', v_count
  );
END;
$$;

-- Secure execution
REVOKE ALL ON FUNCTION save_decision_lineage(jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION save_decision_lineage(jsonb, jsonb) TO authenticated;

-- 2. Harden decision_facts RLS (Read-only via application, write via RPC)
ALTER TABLE decision_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_facts_own ON decision_facts;
DROP POLICY IF EXISTS decision_facts_select_own ON decision_facts;
-- CREATE new SELECT-only policy
CREATE POLICY decision_facts_select_own ON decision_facts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM decisions d WHERE d.id = decision_id AND d.user_id = auth.uid()));

-- 3. Harden decision_feedback RLS (Observational sink: SELECT and INSERT only)
ALTER TABLE decision_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_feedback_select_own ON decision_feedback;
CREATE POLICY decision_feedback_select_own ON decision_feedback FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM decisions d WHERE d.id = decision_id AND d.user_id = auth.uid()));

DROP POLICY IF EXISTS decision_feedback_insert_own ON decision_feedback;
CREATE POLICY decision_feedback_insert_own ON decision_feedback FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM decisions d WHERE d.id = decision_id AND d.user_id = auth.uid()));

-- (No UPDATE or DELETE policies intentionally created)
