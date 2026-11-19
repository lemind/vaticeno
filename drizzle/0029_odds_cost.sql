-- The odds command's search is its own spend (spec 006 FR-007): recorded as `odds`, so the cost per reply can be read.
ALTER TABLE "cost_events" DROP CONSTRAINT "cost_events_operation_check";--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_operation_check" CHECK ("operation" in ('normalize', 'search', 'judge', 'arbitrate', 'fetch', 'price', 'feed_read', 'feed_post', 'feed_model', 'thread_read', 'odds'));
-- Down: UPDATE "cost_events" SET "operation" = 'search' WHERE "operation" = 'odds';
-- ALTER TABLE "cost_events" DROP CONSTRAINT "cost_events_operation_check";
-- ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_operation_check" CHECK ("operation" in ('normalize', 'search', 'judge', 'arbitrate', 'fetch', 'price', 'feed_read', 'feed_post', 'feed_model', 'thread_read'));
