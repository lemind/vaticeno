-- Marked before the reply is sent, like a verdict (INIT_SPEC §6.7): a post that may have landed is never
-- sent a second time. Only the id is written afterwards, so a crash in between cannot duplicate it.
ALTER TABLE "corrections" ADD COLUMN "posted_at" timestamptz;
