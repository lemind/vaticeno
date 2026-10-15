-- One row per locked price-feed claim, from its open authorization to its settlement: the whole interface
-- between the Node service and the settlement worker (003 FR-027, data-model → settlement_outbox).
CREATE TABLE "settlement_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"claim_hash" text,
	"open_authorization" text,
	"authorized_until" timestamptz,
	"outcome" text,
	"state" text DEFAULT 'open' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"tx_references" text[] DEFAULT '{}' NOT NULL,
	"last_error" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"sent_at" timestamptz,
	CONSTRAINT "settlement_outbox_claim_id_unique" UNIQUE("claim_id"),
	CONSTRAINT "settlement_outbox_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "claims"("id"),
	CONSTRAINT "settlement_outbox_outcome_check" CHECK ("outcome" is null or "outcome" in ('hit', 'miss', 'void')),
	CONSTRAINT "settlement_outbox_state_check" CHECK ("state" in ('open', 'pending', 'held', 'sent', 'no_stake', 'failed')),
	-- `open` means no verdict yet; every later state has one.
	CONSTRAINT "settlement_outbox_outcome_state_check" CHECK (("state" = 'open') = ("outcome" is null)),
	CONSTRAINT "settlement_outbox_authorization_pair_check" CHECK (("open_authorization" is null) = ("authorized_until" is null)),
	CONSTRAINT "settlement_outbox_attempts_check" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "settlement_outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Once set, an outcome never changes: a wrong verdict is voided on-chain inside the window, not rewritten here.
CREATE FUNCTION settlement_outbox_outcome_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.outcome IS NOT NULL AND NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    RAISE EXCEPTION 'settlement_outbox.outcome is frozen once set (claim %)', OLD.claim_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "settlement_outbox_outcome_frozen" BEFORE UPDATE ON "settlement_outbox"
  FOR EACH ROW EXECUTE FUNCTION settlement_outbox_outcome_frozen();
--> statement-breakpoint
-- The worker's role. Created without a login here so the migration applies on a fresh local database; the
-- password is set by hand when Stage 2 ships and never reaches git, like status_ro.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'settle_rw') THEN
    CREATE ROLE settle_rw NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO settle_rw;--> statement-breakpoint
-- It reads the claim and its verdict to build every transaction itself (FR-028a), and nothing else.
GRANT SELECT ON "claims", "resolutions", "settlement_outbox" TO settle_rw;--> statement-breakpoint
-- It writes back only what it did. The outcome and the claim are Node's, so no grant reaches them.
GRANT UPDATE ("claim_hash", "open_authorization", "authorized_until", "state", "attempts", "tx_references", "last_error", "sent_at") ON "settlement_outbox" TO settle_rw;--> statement-breakpoint
CREATE POLICY "claims_settle_rw_select" ON "claims" FOR SELECT TO settle_rw USING (true);--> statement-breakpoint
CREATE POLICY "resolutions_settle_rw_select" ON "resolutions" FOR SELECT TO settle_rw USING (true);--> statement-breakpoint
CREATE POLICY "settlement_outbox_settle_rw_select" ON "settlement_outbox" FOR SELECT TO settle_rw USING (true);--> statement-breakpoint
CREATE POLICY "settlement_outbox_settle_rw_update" ON "settlement_outbox" FOR UPDATE TO settle_rw USING (true) WITH CHECK (true);--> statement-breakpoint
-- The worker's heartbeat, written even with an empty queue (FR-020a): one job_state row, its own, so the
-- status page shows it late like any other job. It may write that row and no other.
INSERT INTO "job_state" ("job", "stale_after_seconds") VALUES ('settle', 180) ON CONFLICT ("job") DO NOTHING;--> statement-breakpoint
GRANT SELECT ON "job_state" TO settle_rw;--> statement-breakpoint
GRANT UPDATE ("last_started_at", "last_finished_at", "last_ok_at", "last_outcome", "last_error_tag", "consecutive_failures") ON "job_state" TO settle_rw;--> statement-breakpoint
CREATE POLICY "job_state_settle_rw_select" ON "job_state" FOR SELECT TO settle_rw USING ("job" = 'settle');--> statement-breakpoint
CREATE POLICY "job_state_settle_rw_update" ON "job_state" FOR UPDATE TO settle_rw USING ("job" = 'settle') WITH CHECK ("job" = 'settle');--> statement-breakpoint
-- The status page shows the queue (FR-029).
GRANT SELECT ON "settlement_outbox" TO status_ro;--> statement-breakpoint
CREATE POLICY "settlement_outbox_status_ro_select" ON "settlement_outbox" FOR SELECT TO status_ro USING (true);

-- Down: DROP POLICY on settlement_outbox (three), claims_settle_rw_select, resolutions_settle_rw_select and the
-- two on job_state; DELETE FROM job_state WHERE job = 'settle'; REVOKE ALL ON job_state FROM settle_rw;
-- REVOKE ALL ON claims, resolutions FROM settle_rw; DROP TABLE "settlement_outbox";
-- DROP FUNCTION settlement_outbox_outcome_frozen(); DROP ROLE settle_rw.
