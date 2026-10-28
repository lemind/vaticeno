-- Stage 4: each network is its own market (003 FR-036d, data-model → settlement_outbox, network_health). One
-- outbox row per claim per network; every existing row is Base Sepolia's, where v1 is live.
ALTER TABLE "settlement_outbox" ADD COLUMN "network" text NOT NULL DEFAULT '84532';
--> statement-breakpoint
-- The default only names the existing rows: from here on Node names the network of every row it writes.
ALTER TABLE "settlement_outbox" ALTER COLUMN "network" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "settlement_outbox" ADD CONSTRAINT "settlement_outbox_network_check" CHECK ("network" ~ '^[0-9]+$');
--> statement-breakpoint
ALTER TABLE "settlement_outbox" DROP CONSTRAINT "settlement_outbox_claim_id_unique";
--> statement-breakpoint
ALTER TABLE "settlement_outbox" ADD CONSTRAINT "settlement_outbox_claim_network_unique" UNIQUE ("claim_id", "network");
--> statement-breakpoint
-- Written by each network's worker every pass, read by the status page, which never calls a chain (FR-022c).
CREATE TABLE "network_health" (
	"network" text PRIMARY KEY NOT NULL,
	"oracle_gas_wei" numeric NOT NULL,
	"escrow_usdc" numeric NOT NULL,
	"owed_usdc" numeric NOT NULL,
	"backlog" integer NOT NULL,
	"oldest_backlog_at" timestamptz,
	"last_settled_at" timestamptz,
	"read_at" timestamptz NOT NULL,
	CONSTRAINT "network_health_network_check" CHECK ("network" ~ '^[0-9]+$'),
	CONSTRAINT "network_health_backlog_check" CHECK ("backlog" >= 0)
);
--> statement-breakpoint
ALTER TABLE "network_health" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "network_health" TO settle_rw;--> statement-breakpoint
CREATE POLICY "network_health_settle_rw_select" ON "network_health" FOR SELECT TO settle_rw USING (true);--> statement-breakpoint
CREATE POLICY "network_health_settle_rw_insert" ON "network_health" FOR INSERT TO settle_rw WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "network_health_settle_rw_update" ON "network_health" FOR UPDATE TO settle_rw USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT ON "network_health" TO status_ro;--> statement-breakpoint
CREATE POLICY "network_health_status_ro_select" ON "network_health" FOR SELECT TO status_ro USING (true);
--> statement-breakpoint
-- One heartbeat per network's worker, `settle-<chain id>`. A worker registers its own row on start, so a
-- network is added by starting its worker, never by another migration; it may touch only `settle-` rows.
UPDATE "job_state" SET "job" = 'settle-84532' WHERE "job" = 'settle';--> statement-breakpoint
DROP POLICY "job_state_settle_rw_select" ON "job_state";--> statement-breakpoint
DROP POLICY "job_state_settle_rw_update" ON "job_state";--> statement-breakpoint
GRANT INSERT ("job", "stale_after_seconds") ON "job_state" TO settle_rw;--> statement-breakpoint
CREATE POLICY "job_state_settle_rw_select" ON "job_state" FOR SELECT TO settle_rw USING ("job" LIKE 'settle-%');--> statement-breakpoint
CREATE POLICY "job_state_settle_rw_insert" ON "job_state" FOR INSERT TO settle_rw WITH CHECK ("job" LIKE 'settle-%');--> statement-breakpoint
CREATE POLICY "job_state_settle_rw_update" ON "job_state" FOR UPDATE TO settle_rw USING ("job" LIKE 'settle-%') WITH CHECK ("job" LIKE 'settle-%');

-- Down: DROP the three job_state_settle_rw policies and REVOKE INSERT ON job_state FROM settle_rw; UPDATE job_state
-- SET job = 'settle' WHERE job = 'settle-84532', DELETE the other `settle-` rows, recreate 0020's two policies with
-- "job" = 'settle'; DROP TABLE network_health; DELETE FROM settlement_outbox WHERE network <> '84532'; DROP the
-- (claim_id, network) unique and the network check, ADD UNIQUE (claim_id); DROP COLUMN network.
