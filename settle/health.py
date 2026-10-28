"""Each network's health, read from its chain and its outbox every pass (003 FR-022c, T385): written to
`network_health` for the status page, which never calls a chain, and raised to the owner through Sentry.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import psycopg
from psycopg.rows import dict_row

from settle.alerts import Alerts
from settle.chain import Escrow

# Owner-set thresholds, overridable in the worker's env file. Not measured yet: UNRECONCILED until the testnet
# runs (T373) show what one settlement costs in gas on each network.
GAS_LOW_WEI = int(os.environ.get("GAS_LOW_WEI", str(2 * 10**15)))  # 0.002 ETH
BACKLOG_MAX_AGE = timedelta(hours=int(os.environ.get("BACKLOG_MAX_AGE_HOURS", "6")))
STUCK_AFTER_ATTEMPTS = 10  # ten passes, about ten minutes


def record_health(conn: psycopg.Connection, escrow: Escrow, now: datetime, alerts: Alerts) -> None:
    """v2 only: v1 has no counters for what it owes. A failed chain read is itself an alert, and the row it
    leaves behind ages, so the status page shows the network unread rather than healthy."""
    if escrow.version != 2:
        return
    network = str(escrow.chain_id)
    queue = _queue(conn, network)
    try:
        held = escrow.holdings()
    except Exception as error:  # noqa: BLE001 — any failure to read the chain is the same alert
        alerts.update(network, {**{name: "" for name in alerts.active}, "rpc_down": str(error)[:200]})
        return
    with conn.cursor() as cur:
        cur.execute("""
            insert into network_health (network, oracle_gas_wei, escrow_usdc, owed_usdc, backlog,
              oldest_backlog_at, last_settled_at, read_at)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (network) do update set oracle_gas_wei = excluded.oracle_gas_wei,
              escrow_usdc = excluded.escrow_usdc, owed_usdc = excluded.owed_usdc, backlog = excluded.backlog,
              oldest_backlog_at = excluded.oldest_backlog_at, last_settled_at = excluded.last_settled_at,
              read_at = excluded.read_at
        """, (network, held.oracle_gas_wei, held.escrow_usdc, held.owed_usdc, queue["backlog"],
              queue["oldest_backlog_at"], queue["last_settled_at"], now))
    alerts.update(network, conditions(held.oracle_gas_wei, held.escrow_usdc, held.owed_usdc, queue, now))


def conditions(gas: int, balance: int, owed: int, queue: dict, now: datetime) -> dict[str, str]:
    """Every alert that holds now. A balance short of what is owed means someone cannot be paid: never normal."""
    found = {}
    if gas < GAS_LOW_WEI:
        found["gas_low"] = f"oracle gas {gas} wei, below {GAS_LOW_WEI}"
    if balance < owed:
        found["underfunded"] = f"escrow holds {balance}, owes {owed}"
    oldest = queue["oldest_backlog_at"]
    if oldest is not None and now - oldest > BACKLOG_MAX_AGE:
        found["backlog_old"] = f"{queue['backlog']} waiting, the oldest since {oldest.isoformat()}"
    if queue["stuck"]:
        found["stuck"] = f"{queue['stuck']} settlement(s) failing for {STUCK_AFTER_ATTEMPTS}+ passes"
    return found


def _queue(conn: psycopg.Connection, network: str) -> dict:
    """The backlog is what waits to settle, aged from its final verdict; stuck is what keeps failing."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("""
            select count(*) filter (where o.state = 'pending')::int as backlog,
                   min(r.decided_at) filter (where o.state = 'pending') as oldest_backlog_at,
                   count(*) filter (where o.state = 'pending' and o.attempts >= %s)::int as stuck,
                   max(o.sent_at) filter (where o.state = 'sent') as last_settled_at
            from settlement_outbox o left join resolutions r on r.claim_id = o.claim_id
            where o.network = %s
        """, (STUCK_AFTER_ATTEMPTS, network))
        return cur.fetchone()
