-- Whether any stake on the claim was matched, read from the chain by the network's worker once its deadline has
-- passed and no stake can be added (003 FR-027): Node pays for a second read of the verdict only when one was.
ALTER TABLE "settlement_outbox" ADD COLUMN "matched" boolean;--> statement-breakpoint
GRANT UPDATE ("matched") ON "settlement_outbox" TO settle_rw;
-- Down: REVOKE UPDATE ("matched") ON "settlement_outbox" FROM settle_rw; ALTER TABLE "settlement_outbox" DROP COLUMN "matched";
