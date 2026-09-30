-- Authors who sent STOP (constitution IV): never replied to again. RLS on, no policies, like every table.
CREATE TABLE "opt_outs" (
	"x_user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opt_outs" ENABLE ROW LEVEL SECURITY;
