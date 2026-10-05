-- The verdict reply on X (owner decision 2026-10-04): when it was attempted and its post id. Not a contract field.
ALTER TABLE "claims" ADD COLUMN "verdict_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "verdict_reply_tweet_id" text;