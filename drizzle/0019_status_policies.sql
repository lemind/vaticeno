-- The status service reads as `status_ro`, which does not bypass row-level security: RLS is on with no
-- policies (0002_rls.sql), so a grant alone reads zero rows from every table (003 FR-003, data-model
-- → Access). One SELECT policy per table the page reads. `job_state` and `recheck_findings` carry their
-- own in 0017 and 0018; `wallet_links` is never granted.
GRANT SELECT ON "claims" TO status_ro;--> statement-breakpoint
CREATE POLICY "claims_status_ro_select" ON "claims" FOR SELECT TO status_ro USING (true);--> statement-breakpoint
GRANT SELECT ON "resolutions" TO status_ro;--> statement-breakpoint
CREATE POLICY "resolutions_status_ro_select" ON "resolutions" FOR SELECT TO status_ro USING (true);--> statement-breakpoint
GRANT SELECT ON "cost_events" TO status_ro;--> statement-breakpoint
CREATE POLICY "cost_events_status_ro_select" ON "cost_events" FOR SELECT TO status_ro USING (true);--> statement-breakpoint
GRANT SELECT ON "feed_posts" TO status_ro;--> statement-breakpoint
CREATE POLICY "feed_posts_status_ro_select" ON "feed_posts" FOR SELECT TO status_ro USING (true);--> statement-breakpoint
-- Nothing else: no INSERT, UPDATE or DELETE policy for this role on any table, now or later (FR-003).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM status_ro;

-- Down: DROP POLICY "claims_status_ro_select" ON "claims"; and the same for resolutions, cost_events
-- and feed_posts; then REVOKE SELECT ON those four tables FROM status_ro.
