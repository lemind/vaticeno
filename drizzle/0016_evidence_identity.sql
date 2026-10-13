-- What each page said about which event it reports, and whether code found it to be the contract's event
-- (004 FR-001, FR-011). Stored so a later rule change can be re-examined over evidence already gathered.
ALTER TABLE "evidences" ADD COLUMN "event_identity" jsonb;--> statement-breakpoint
ALTER TABLE "evidences" ADD COLUMN "event_match" text;--> statement-breakpoint
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_event_match_check"
  CHECK ("evidences"."event_match" is null or "evidences"."event_match" in ('yes', 'no', 'unknown', 'not_applicable'));
