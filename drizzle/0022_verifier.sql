-- The local verifier's shadow answers and a person's check of outcomes (003 Stage 3, data-model → verifier_shadow,
-- outcome_confirmations, resolutions additions). Shadow rows decide nothing; dropping them changes no verdict.
CREATE TABLE "verifier_shadow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"resolution_id" uuid,
	"model" text NOT NULL,
	"would_finalise" boolean NOT NULL,
	"would_outcome" text,
	"min_confidence" real,
	"paid_outcome" text,
	"error_tag" text,
	"latency_ms" integer,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "verifier_shadow_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "claims"("id"),
	CONSTRAINT "verifier_shadow_resolution_id_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "resolutions"("id"),
	CONSTRAINT "verifier_shadow_would_outcome_check" CHECK ("would_outcome" is null or "would_outcome" in ('hit', 'miss')),
	CONSTRAINT "verifier_shadow_paid_outcome_check" CHECK ("paid_outcome" is null or "paid_outcome" in ('hit', 'miss', 'void')),
	CONSTRAINT "verifier_shadow_min_confidence_check" CHECK ("min_confidence" is null or "min_confidence" between 0 and 1),
	-- Escalating is the only answer without an outcome; a finalising answer always names one.
	CONSTRAINT "verifier_shadow_outcome_when_finalising_check" CHECK ("would_finalise" = ("would_outcome" is not null))
);
--> statement-breakpoint
CREATE INDEX "verifier_shadow_claim_idx" ON "verifier_shadow" ("claim_id", "created_at");
--> statement-breakpoint
-- Append-only, as evidences are: the record of what the model said is never rewritten (data-model).
CREATE TRIGGER verifier_shadow_insert_only BEFORE UPDATE OR DELETE ON "verifier_shadow"
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TABLE "outcome_confirmations" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"event_key" text NOT NULL,
	"confirmed_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "outcome_confirmations_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "claims"("id"),
	CONSTRAINT "outcome_confirmations_outcome_check" CHECK ("outcome" in ('hit', 'miss', 'void'))
);
--> statement-breakpoint
-- Set only when the fast path finalised a verdict; null in both is today's behaviour (data-model).
ALTER TABLE "resolutions" ADD COLUMN "verifier" text;
--> statement-breakpoint
ALTER TABLE "resolutions" ADD COLUMN "verifier_confidence" real;
--> statement-breakpoint
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_verifier_confidence_check"
  CHECK ("verifier_confidence" is null or "verifier_confidence" between 0 and 1);
--> statement-breakpoint
-- Node writes as the owner, which bypasses RLS; the status page reads both new tables (data-model → Access).
ALTER TABLE "verifier_shadow" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outcome_confirmations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON "verifier_shadow" TO status_ro;
--> statement-breakpoint
CREATE POLICY "verifier_shadow_status_ro_select" ON "verifier_shadow" FOR SELECT TO status_ro USING (true);
--> statement-breakpoint
GRANT SELECT ON "outcome_confirmations" TO status_ro;
--> statement-breakpoint
CREATE POLICY "outcome_confirmations_status_ro_select" ON "outcome_confirmations" FOR SELECT TO status_ro USING (true);

-- Down: DROP TABLE "verifier_shadow"; DROP TABLE "outcome_confirmations";
-- ALTER TABLE "resolutions" DROP CONSTRAINT "resolutions_verifier_confidence_check";
-- ALTER TABLE "resolutions" DROP COLUMN "verifier_confidence"; ALTER TABLE "resolutions" DROP COLUMN "verifier";
