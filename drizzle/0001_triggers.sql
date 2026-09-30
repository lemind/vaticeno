-- Invariants the database enforces (data-model.md "Triggers"). Code refuses the same things earlier
-- for clearer errors; these triggers are the authority.

-- (a) Exactly one author position per claim.
CREATE UNIQUE INDEX "positions_one_author_idx" ON "positions" ("claim_id") WHERE "is_author";
--> statement-breakpoint

-- (b) The contract is frozen once the claim is locked (constitution I) or has ended without a lock.
CREATE FUNCTION claims_contract_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('locked', 'resolving', 'resolved', 'void', 'expired', 'rejected') AND (
       NEW.contract IS DISTINCT FROM OLD.contract
    OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
    OR NEW.resolution_method IS DISTINCT FROM OLD.resolution_method
    OR NEW.lock_at IS DISTINCT FROM OLD.lock_at
    OR NEW.locked_source_version IS DISTINCT FROM OLD.locked_source_version
    OR NEW.locked_source_hash IS DISTINCT FROM OLD.locked_source_hash
  ) THEN
    RAISE EXCEPTION 'claim % is %: contract fields cannot change', OLD.slug, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER claims_contract_frozen BEFORE UPDATE ON "claims"
  FOR EACH ROW EXECUTE FUNCTION claims_contract_frozen();
--> statement-breakpoint

-- (c) Only the Lifecycle transitions exist; terminal states never change.
-- Must stay identical to src/lifecycle/transitions.ts (tests/integration/db.test.ts checks every pair).
CREATE FUNCTION claims_status_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (
       (OLD.status = 'parsing'    AND NEW.status IN ('draft', 'needs_info', 'rejected'))
    OR (OLD.status = 'needs_info' AND NEW.status IN ('draft', 'needs_info', 'expired'))
    OR (OLD.status = 'draft'      AND NEW.status IN ('draft', 'locked', 'expired'))
    OR (OLD.status = 'locked'     AND NEW.status IN ('resolving'))
    OR (OLD.status = 'resolving'  AND NEW.status IN ('resolving', 'resolved', 'void'))
  ) THEN
    RAISE EXCEPTION 'claim %: transition % -> % is not allowed', OLD.slug, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER claims_status_transition BEFORE UPDATE OF status ON "claims"
  FOR EACH ROW EXECUTE FUNCTION claims_status_transition();
--> statement-breakpoint

-- (e) A claim is born parsing, draft, needs_info or rejected — never locked or resolved.
CREATE FUNCTION claims_insert_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('parsing', 'draft', 'needs_info', 'rejected') THEN
    RAISE EXCEPTION 'a claim cannot be created with status %', NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER claims_insert_status BEFORE INSERT ON "claims"
  FOR EACH ROW EXECUTE FUNCTION claims_insert_status();
--> statement-breakpoint

-- (d) Positions and evidences are insert-only.
CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are insert-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER positions_insert_only BEFORE UPDATE OR DELETE ON "positions"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER evidences_insert_only BEFORE UPDATE OR DELETE ON "evidences"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint

-- (f) A final resolution never changes (correcting one is deferred, spec FR-026).
CREATE FUNCTION resolutions_final_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.review_status = 'final' THEN
    RAISE EXCEPTION 'resolution for claim % is final', OLD.claim_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER resolutions_final_frozen BEFORE UPDATE OR DELETE ON "resolutions"
  FOR EACH ROW EXECUTE FUNCTION resolutions_final_frozen();
--> statement-breakpoint

-- (g) The deciding evidence must belong to the same claim.
CREATE FUNCTION resolutions_evidence_same_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deciding_evidence_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM evidences WHERE id = NEW.deciding_evidence_id AND claim_id = NEW.claim_id
  ) THEN
    RAISE EXCEPTION 'deciding evidence % does not belong to claim %', NEW.deciding_evidence_id, NEW.claim_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER resolutions_evidence_same_claim BEFORE INSERT OR UPDATE ON "resolutions"
  FOR EACH ROW EXECUTE FUNCTION resolutions_evidence_same_claim();
