-- A receipt is now a plain repost of our own verdict reply (005 FR-014b): like a pool repost, it makes no post of
-- ours, so it has no posted id.
ALTER TABLE "feed_posts" DROP CONSTRAINT "feed_posts_posted_id_check";--> statement-breakpoint
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_posted_id_check" CHECK ("status" <> 'posted' or "kind" in ('repost', 'receipt') or "posted_id" is not null);
-- Down: DELETE FROM "feed_posts" WHERE kind = 'receipt' and status = 'posted' and posted_id is null;
-- ALTER TABLE "feed_posts" DROP CONSTRAINT "feed_posts_posted_id_check";
-- ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_posted_id_check" CHECK ("status" <> 'posted' or "kind" = 'repost' or "posted_id" is not null);
