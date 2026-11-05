-- A market is a network and its token (003 FR-036d, owner 2026-11-05): the chain id for USDC, `<chain id>-usdt` for
-- Tether's USDT0 beside it on the same network. Existing rows keep their plain chain id.
ALTER TABLE "settlement_outbox" DROP CONSTRAINT "settlement_outbox_network_check";--> statement-breakpoint
ALTER TABLE "settlement_outbox" ADD CONSTRAINT "settlement_outbox_network_check" CHECK ("network" ~ '^[0-9]+(-usdt)?$');--> statement-breakpoint
ALTER TABLE "network_health" DROP CONSTRAINT "network_health_network_check";--> statement-breakpoint
ALTER TABLE "network_health" ADD CONSTRAINT "network_health_network_check" CHECK ("network" ~ '^[0-9]+(-usdt)?$');
-- Down (only with no -usdt row left): the same two checks back to '^[0-9]+$'.
