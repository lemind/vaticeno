-- One link reply per claim, and one refusal per reason (003 FR-038, data-model → wager_replies). The row is
-- written before the reply is sent; a conflict on the unique key means it was already spent.
CREATE TABLE "wager_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mention_id" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "wager_replies_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "claims"("id"),
	CONSTRAINT "wager_replies_claim_kind_unique" UNIQUE("claim_id", "kind"),
	CONSTRAINT "wager_replies_kind_check" CHECK ("kind" in ('link', 'not_locked', 'not_price', 'closed'))
);
--> statement-breakpoint
-- The daily cap counts today's link rows.
CREATE INDEX "wager_replies_link_day_idx" ON "wager_replies" ("created_at") WHERE "kind" = 'link';
--> statement-breakpoint
-- Node is the only reader and writes as the owner, which bypasses RLS; no other role gets a policy.
ALTER TABLE "wager_replies" ENABLE ROW LEVEL SECURITY;

-- Down: DROP TABLE "wager_replies";
