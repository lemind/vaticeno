-- A verdict that was wrong is corrected by a new record, never by editing the old one: the original
-- resolution stays frozen and both are shown, which is the honest shape (001 FR-035, owner decision
-- 2026-10-12, after a 3-0 win was published as a MISS).
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL UNIQUE,
	"from_outcome" text NOT NULL,
	"to_outcome" text NOT NULL,
	"reason" text NOT NULL,
	"deciding_evidence_id" uuid,
	"decided_by" text NOT NULL,
	"posted_tweet_id" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "corrections_from_check" CHECK ("corrections"."from_outcome" in ('hit', 'miss', 'void')),
	CONSTRAINT "corrections_to_check" CHECK ("corrections"."to_outcome" in ('hit', 'miss', 'void')),
	CONSTRAINT "corrections_changes_check" CHECK ("corrections"."from_outcome" <> "corrections"."to_outcome"),
	CONSTRAINT "corrections_decided_by_check" CHECK ("corrections"."decided_by" in ('evidence', 'arbiter', 'human'))
);
--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_deciding_evidence_id_evidences_id_fk" FOREIGN KEY ("deciding_evidence_id") REFERENCES "public"."evidences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- One correction per claim, and it is never edited either: a second thought is a human decision, not a row update.
CREATE FUNCTION corrections_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'correction for claim % cannot be changed', OLD.claim_id USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER corrections_frozen BEFORE UPDATE OF claim_id, from_outcome, to_outcome OR DELETE ON "corrections"
  FOR EACH ROW EXECUTE FUNCTION corrections_frozen();
--> statement-breakpoint
ALTER TABLE "corrections" ENABLE ROW LEVEL SECURITY;
