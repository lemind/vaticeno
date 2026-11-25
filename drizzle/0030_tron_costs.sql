-- The settlement worker's TRX on Tron is a recorded spend (spec 007 FR-007): provider `tron`, operation
-- `settle_tx`. The worker may insert those rows and no other; EVM gas is not recorded (ADR 010).
ALTER TABLE "cost_events" DROP CONSTRAINT "cost_events_provider_check";--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_provider_check" CHECK ("provider" in ('gemini', 'google_search', 'coinbase', 'web_fetch', 'x', 'tron'));--> statement-breakpoint
ALTER TABLE "cost_events" DROP CONSTRAINT "cost_events_operation_check";--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_operation_check" CHECK ("operation" in ('normalize', 'search', 'judge', 'arbitrate', 'fetch', 'price', 'feed_read', 'feed_post', 'feed_model', 'thread_read', 'odds', 'settle_tx'));--> statement-breakpoint
GRANT INSERT ("claim_id", "provider", "operation", "units", "usd_cost") ON "cost_events" TO settle_rw;--> statement-breakpoint
CREATE POLICY "cost_events_settle_rw_insert" ON "cost_events" FOR INSERT TO settle_rw WITH CHECK ("provider" = 'tron' AND "operation" = 'settle_tx');
-- Down: DROP POLICY "cost_events_settle_rw_insert" ON "cost_events";
-- REVOKE INSERT ("claim_id", "provider", "operation", "units", "usd_cost") ON "cost_events" FROM settle_rw;
-- DELETE FROM "cost_events" WHERE "provider" = 'tron';
-- ALTER TABLE "cost_events" DROP CONSTRAINT "cost_events_operation_check";
-- ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_operation_check" CHECK ("operation" in ('normalize', 'search', 'judge', 'arbitrate', 'fetch', 'price', 'feed_read', 'feed_post', 'feed_model', 'thread_read', 'odds'));
-- ALTER TABLE "cost_events" DROP CONSTRAINT "cost_events_provider_check";
-- ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_provider_check" CHECK ("provider" in ('gemini', 'google_search', 'coinbase', 'web_fetch', 'x'));
