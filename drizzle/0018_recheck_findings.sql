-- One row per claim, not per recheck run (003 data-model): the weekly recheck looks back seven days, so
-- a verdict it disagrees with must outlive that window or Monday's finding is gone by the next (FR-007a).
CREATE TABLE "recheck_findings" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"found_at" timestamptz NOT NULL,
	"last_seen_at" timestamptz NOT NULL,
	"published_outcome" text NOT NULL,
	"recheck_outcome" text,
	"kind" text NOT NULL,
	"cleared_at" timestamptz,
	CONSTRAINT "recheck_findings_published_check" CHECK ("recheck_findings"."published_outcome" in ('hit', 'miss', 'void')),
	CONSTRAINT "recheck_findings_recheck_check" CHECK ("recheck_findings"."recheck_outcome" is null or "recheck_findings"."recheck_outcome" in ('hit', 'miss', 'void')),
	CONSTRAINT "recheck_findings_kind_check" CHECK ("recheck_findings"."kind" in ('differs', 'unsettled')),
	-- `differs` names the outcome it differs from; `unsettled` means today's rules settle nothing.
	CONSTRAINT "recheck_findings_differs_check" CHECK (("recheck_findings"."kind" = 'differs') = ("recheck_findings"."recheck_outcome" is not null))
);
--> statement-breakpoint
ALTER TABLE "recheck_findings" ADD CONSTRAINT "recheck_findings_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recheck_findings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON "recheck_findings" TO status_ro;--> statement-breakpoint
CREATE POLICY "recheck_findings_status_ro_select" ON "recheck_findings" FOR SELECT TO status_ro USING (true);

-- Down: DROP POLICY "recheck_findings_status_ro_select" ON "recheck_findings"; DROP TABLE "recheck_findings";
