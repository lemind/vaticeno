-- Reading posts on X to understand a mention costs money and was never recorded (owner question
-- 2026-10-07). `thread_read` is that spend: posts read to give the normalizer the context a prediction
-- was made in. It is NOT a feed operation, so it never counts against the feed's daily cap.
ALTER TABLE "cost_events" DROP CONSTRAINT "cost_events_operation_check";--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_operation_check" CHECK ("operation" in ('normalize', 'search', 'judge', 'arbitrate', 'fetch', 'price', 'feed_read', 'feed_post', 'feed_model', 'thread_read'));
