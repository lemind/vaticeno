CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"source_tweet_id" text NOT NULL,
	"summon_tweet_id" text NOT NULL,
	"source_version" text NOT NULL,
	"locked_source_version" text,
	"locked_source_hash" text,
	"author_x_user_id" text NOT NULL,
	"contract" jsonb,
	"contract_model_id" text,
	"self_confidence" real,
	"resolution_method" text,
	"deadline_at" timestamp with time zone,
	"status" text NOT NULL,
	"reject_reason" text,
	"unclear" jsonb,
	"amend_count" integer DEFAULT 0 NOT NULL,
	"lock_at" timestamp with time zone,
	"needs_info_since" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_slug_unique" UNIQUE("slug"),
	CONSTRAINT "claims_source_tweet_id_unique" UNIQUE("source_tweet_id"),
	CONSTRAINT "claims_status_check" CHECK ("claims"."status" in ('parsing', 'needs_info', 'draft', 'locked', 'resolving', 'resolved', 'void', 'rejected', 'expired')),
	CONSTRAINT "claims_reject_reason_check" CHECK ("claims"."reject_reason" in ('not_prediction', 'x_rules', 'deadline_too_close', 'deadline_too_far', 'duplicate')),
	CONSTRAINT "claims_resolution_method_check" CHECK ("claims"."resolution_method" in ('price_feed', 'model')),
	CONSTRAINT "claims_amend_count_check" CHECK ("claims"."amend_count" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE "cost_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"usd_cost" numeric(10, 5) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_events_provider_check" CHECK ("cost_events"."provider" in ('gemini', 'google_search', 'coinbase', 'web_fetch')),
	CONSTRAINT "cost_events_operation_check" CHECK ("cost_events"."operation" in ('normalize', 'search', 'judge', 'arbitrate', 'fetch', 'price'))
);
--> statement-breakpoint
CREATE TABLE "evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"source_kind" text NOT NULL,
	"basis" text NOT NULL,
	"source_name" text NOT NULL,
	"trust_level" text NOT NULL,
	"says" text NOT NULL,
	"event_date" date,
	"value" numeric,
	"url" text,
	"content_sha256" text,
	"search_query" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"model_id" text,
	"instruction_version" text,
	"gates" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidences_source_kind_check" CHECK ("evidences"."source_kind" in ('price_feed', 'web')),
	CONSTRAINT "evidences_basis_check" CHECK ("evidences"."basis" in ('record', 'absence')),
	CONSTRAINT "evidences_trust_level_check" CHECK ("evidences"."trust_level" in ('official', 'trusted', 'other')),
	CONSTRAINT "evidences_says_check" CHECK ("evidences"."says" in ('hit', 'miss', 'pending', 'irrelevant', 'entity_gone'))
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"x_user_id" text NOT NULL,
	"stance" text NOT NULL,
	"is_author" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"join_tweet_id" text,
	CONSTRAINT "positions_join_tweet_id_unique" UNIQUE("join_tweet_id"),
	CONSTRAINT "positions_claim_user_unique" UNIQUE("claim_id","x_user_id"),
	CONSTRAINT "positions_stance_check" CHECK ("positions"."stance" in ('agree', 'disagree'))
);
--> statement-breakpoint
CREATE TABLE "resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"outcome" text,
	"decided_by" text,
	"review_status" text NOT NULL,
	"void_reason" text,
	"deciding_evidence_id" uuid,
	"arbiter_model_id" text,
	"policy_version" integer NOT NULL,
	"arbiter_notes" text,
	"human_notes" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resolutions_claim_id_unique" UNIQUE("claim_id"),
	CONSTRAINT "resolutions_outcome_check" CHECK ("resolutions"."outcome" in ('hit', 'miss', 'void')),
	CONSTRAINT "resolutions_decided_by_check" CHECK ("resolutions"."decided_by" in ('evidence', 'arbiter', 'human')),
	CONSTRAINT "resolutions_review_status_check" CHECK ("resolutions"."review_status" in ('final', 'needs_human')),
	CONSTRAINT "resolutions_void_reason_check" CHECK ("resolutions"."void_reason" in ('insufficient_evidence', 'unresolvable')),
	CONSTRAINT "resolutions_hit_miss_evidence_check" CHECK ("resolutions"."outcome" not in ('hit', 'miss') or "resolutions"."deciding_evidence_id" is not null),
	CONSTRAINT "resolutions_void_reason_required_check" CHECK (("resolutions"."outcome" is not distinct from 'void') = ("resolutions"."void_reason" is not null)),
	CONSTRAINT "resolutions_final_complete_check" CHECK ("resolutions"."review_status" <> 'final' or ("resolutions"."outcome" is not null and "resolutions"."decided_by" is not null and "resolutions"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_deciding_evidence_id_evidences_id_fk" FOREIGN KEY ("deciding_evidence_id") REFERENCES "public"."evidences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claims_due_idx" ON "claims" USING btree ("next_check_at") WHERE "claims"."status" in ('locked', 'resolving');--> statement-breakpoint
CREATE INDEX "claims_draft_lock_idx" ON "claims" USING btree ("status","lock_at") WHERE "claims"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "claims_needs_info_idx" ON "claims" USING btree ("status","needs_info_since") WHERE "claims"."status" = 'needs_info';--> statement-breakpoint
CREATE INDEX "claims_author_idx" ON "claims" USING btree ("author_x_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cost_events_claim_idx" ON "cost_events" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "evidences_claim_run_idx" ON "evidences" USING btree ("claim_id","run_at");