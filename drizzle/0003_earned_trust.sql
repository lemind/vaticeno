-- Earned trust instead of a fixed site list (constitution 2.0.0, data-model "Trust level" and "sources").
CREATE TABLE "sources" (
	"domain" text PRIMARY KEY NOT NULL,
	"agreed_count" integer NOT NULL,
	"first_agreed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_agreed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_agreed_count_check" CHECK ("sources"."agreed_count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidences" DROP CONSTRAINT "evidences_trust_level_check";--> statement-breakpoint
ALTER TABLE "evidences" ADD COLUMN "trust_reason" text;--> statement-breakpoint
-- Map any existing rows to the new levels; evidences are insert-only, so the guard is lifted for this one statement.
ALTER TABLE "evidences" DISABLE TRIGGER "evidences_insert_only";--> statement-breakpoint
UPDATE "evidences" SET "trust_level" = CASE "trust_level" WHEN 'official' THEN 'primary' WHEN 'trusted' THEN 'established' WHEN 'other' THEN 'weak' ELSE "trust_level" END;--> statement-breakpoint
ALTER TABLE "evidences" ENABLE TRIGGER "evidences_insert_only";--> statement-breakpoint
ALTER TABLE "resolutions" DROP COLUMN "policy_version";--> statement-breakpoint
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_trust_level_check" CHECK ("evidences"."trust_level" in ('primary', 'established', 'weak'));
