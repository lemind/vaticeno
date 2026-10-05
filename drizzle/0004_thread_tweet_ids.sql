-- Post ids in a claim's thread (bot replies, fixes), ids only (FR-029): a reply to any of them is a fix (FR-010).
ALTER TABLE "claims" ADD COLUMN "thread_tweet_ids" text[] DEFAULT '{}' NOT NULL;