-- The queue on a calendar (005 FR-008, FR-008a): a day to go out on, an event post's source and when it was last
-- checked (never posted), and the mark set when a dated post's day passed unposted.
ALTER TABLE "feed_queue" ADD COLUMN "post_on" date;--> statement-breakpoint
ALTER TABLE "feed_queue" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "feed_queue" ADD COLUMN "checked_on" date;--> statement-breakpoint
ALTER TABLE "feed_queue" ADD COLUMN "missed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feed_queue" ADD CONSTRAINT "feed_queue_source_check" CHECK ("source_url" is null or ("source_url" like 'https://%' and "post_on" is not null and "checked_on" is not null));--> statement-breakpoint
-- New kinds (005 FR-009, FR-012, FR-019): the digest, the record and the bot's event post. All own posts share
-- one slot a day: they join the `original` cap group.
ALTER TABLE "feed_posts" DROP CONSTRAINT "feed_posts_kind_check";--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_kind_check" CHECK ("kind" in ('repost', 'quote', 'original', 'receipt', 'digest', 'record', 'event'));--> statement-breakpoint
ALTER TABLE "feed_posts" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "feed_posts" DROP CONSTRAINT "feed_posts_slot_unique";--> statement-breakpoint
ALTER TABLE "feed_posts" DROP COLUMN "cap_group";--> statement-breakpoint
ALTER TABLE "feed_posts" ADD COLUMN "cap_group" text GENERATED ALWAYS AS (case when kind in ('repost', 'quote') then 'pool' when kind in ('original', 'digest', 'record', 'event') then 'original' else kind end) STORED;--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_slot_unique" UNIQUE("cap_group","day","slot");
-- Down: ALTER TABLE "feed_posts" DROP CONSTRAINT "feed_posts_slot_unique"; ALTER TABLE "feed_posts" DROP COLUMN "cap_group";
-- ALTER TABLE "feed_posts" ADD COLUMN "cap_group" text GENERATED ALWAYS AS (case when kind in ('repost', 'quote') then 'pool' else kind end) STORED;
-- ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_slot_unique" UNIQUE("cap_group","day","slot"); ALTER TABLE "feed_posts" DROP COLUMN "payload";
-- DELETE FROM "feed_posts" WHERE kind in ('digest', 'record', 'event'); ALTER TABLE "feed_posts" DROP CONSTRAINT "feed_posts_kind_check";
-- ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_kind_check" CHECK ("kind" in ('repost', 'quote', 'original', 'receipt'));
-- ALTER TABLE "feed_queue" DROP CONSTRAINT "feed_queue_source_check"; ALTER TABLE "feed_queue" DROP COLUMN "missed_at";
-- ALTER TABLE "feed_queue" DROP COLUMN "checked_on"; ALTER TABLE "feed_queue" DROP COLUMN "source_url"; ALTER TABLE "feed_queue" DROP COLUMN "post_on";
