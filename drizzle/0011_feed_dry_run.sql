-- A dry-run pick is recorded so the week-long rehearsal honours "never the same account twice in a row"
-- and "never the same post twice" (spec 002 FR-005/FR-007), but it holds no slot of the day's cap.
ALTER TABLE "feed_posts" DROP CONSTRAINT "feed_posts_status_check";--> statement-breakpoint
ALTER TABLE "feed_posts" DROP CONSTRAINT "feed_posts_slot_check";--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_status_check" CHECK ("feed_posts"."status" in ('reserved', 'posted', 'failed', 'dry_run'));--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_slot_check" CHECK (("feed_posts"."status" in ('failed', 'dry_run')) = ("feed_posts"."slot" is null) and ("feed_posts"."slot" is null or "feed_posts"."slot" >= 1));