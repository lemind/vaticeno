-- One row per scheduled job, not per run (003 data-model): the only job health that existed was the
-- resolver's last run time, in a variable no other process could read (003 FR-001).
CREATE TABLE "job_state" (
	"job" text PRIMARY KEY NOT NULL,
	"last_started_at" timestamptz,
	"last_finished_at" timestamptz,
	"last_ok_at" timestamptz,
	"last_outcome" text,
	"last_error_tag" text,
	"last_locked_at" timestamptz,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"stale_after_seconds" integer NOT NULL,
	CONSTRAINT "job_state_outcome_check" CHECK ("job_state"."last_outcome" is null or "job_state"."last_outcome" in ('ok', 'failed')),
	CONSTRAINT "job_state_stale_after_check" CHECK ("job_state"."stale_after_seconds" > 0)
);
--> statement-breakpoint
ALTER TABLE "job_state" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The status service's role. Created without a login here so the migration applies on a fresh local
-- database; the password is set by hand on Supabase and never reaches git (deploy/status-role.md).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'status_ro') THEN
    CREATE ROLE status_ro NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO status_ro;--> statement-breakpoint
GRANT SELECT ON "job_state" TO status_ro;--> statement-breakpoint
-- A grant alone reads zero rows: RLS is on with no policies, and status_ro does not bypass it.
CREATE POLICY "job_state_status_ro_select" ON "job_state" FOR SELECT TO status_ro USING (true);

-- Down: DROP POLICY "job_state_status_ro_select" ON "job_state"; DROP TABLE "job_state";
-- The role is left in place: it is granted on other tables by later migrations.
