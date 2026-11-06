-- The X handle as a display cache, never identity (INIT_SPEC §3, §16 GET /u/:id): refreshed from the users
-- the mentions read already returns, so it costs no extra read. Handles change and can be reassigned.
CREATE TABLE "x_handles" (
	"x_user_id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"seen_at" timestamptz NOT NULL,
	CONSTRAINT "x_handles_handle_check" CHECK ("handle" ~ '^[A-Za-z0-9_]{1,15}$')
);
--> statement-breakpoint
ALTER TABLE "x_handles" ENABLE ROW LEVEL SECURITY;
