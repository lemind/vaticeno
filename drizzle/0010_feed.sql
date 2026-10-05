-- Own-feed posts (spec 002, constitution VI 2.4.0): the owner's queue of originals, and one row per feed
-- post, inserted BEFORE the post goes out so a slot and a source post can never be used twice.
CREATE TABLE "feed_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"cap_group" text GENERATED ALWAYS AS (case when kind in ('repost', 'quote') then 'pool' else kind end) STORED,
	"status" text DEFAULT 'reserved' NOT NULL,
	"day" date NOT NULL,
	"slot" integer,
	"source_post_id" text,
	"account_id" text,
	"queue_item_id" uuid,
	"posted_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_posts_slot_unique" UNIQUE("cap_group","day","slot"),
	CONSTRAINT "feed_posts_kind_check" CHECK ("feed_posts"."kind" in ('repost', 'quote', 'original', 'receipt')),
	CONSTRAINT "feed_posts_status_check" CHECK ("feed_posts"."status" in ('reserved', 'posted', 'failed')),
	CONSTRAINT "feed_posts_slot_check" CHECK (("feed_posts"."status" = 'failed') = ("feed_posts"."slot" is null) and ("feed_posts"."slot" is null or "feed_posts"."slot" >= 1)),
	CONSTRAINT "feed_posts_posted_id_check" CHECK ("feed_posts"."status" <> 'posted' or "feed_posts"."kind" = 'repost' or "feed_posts"."posted_id" is not null),
	CONSTRAINT "feed_posts_pool_check" CHECK ("feed_posts"."kind" not in ('repost', 'quote') or ("feed_posts"."account_id" is not null and "feed_posts"."source_post_id" is not null)),
	CONSTRAINT "feed_posts_original_check" CHECK ("feed_posts"."kind" <> 'original' or "feed_posts"."queue_item_id" is not null),
	CONSTRAINT "feed_posts_receipt_check" CHECK ("feed_posts"."kind" <> 'receipt' or "feed_posts"."source_post_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "feed_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_queue_position_unique" UNIQUE("position")
);
--> statement-breakpoint
ALTER TABLE "cost_events" DROP CONSTRAINT "cost_events_provider_check";--> statement-breakpoint
ALTER TABLE "cost_events" DROP CONSTRAINT "cost_events_operation_check";--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_queue_item_id_feed_queue_id_fk" FOREIGN KEY ("queue_item_id") REFERENCES "public"."feed_queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_posts_source_key" ON "feed_posts" USING btree ("source_post_id") WHERE source_post_id is not null;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_provider_check" CHECK ("cost_events"."provider" in ('gemini', 'google_search', 'coinbase', 'web_fetch', 'x'));--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_operation_check" CHECK ("cost_events"."operation" in ('normalize', 'search', 'judge', 'arbitrate', 'fetch', 'price', 'feed_read', 'feed_post', 'feed_model'));--> statement-breakpoint
-- RLS on with no policies, like every table (drizzle/0002_rls.sql).
ALTER TABLE "feed_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feed_posts" ENABLE ROW LEVEL SECURITY;
