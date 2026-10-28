"""The settlement worker (003 T333): signs each locked price claim's open authorization, and after the verdict
settles every matched stake on the claim. It holds the oracle key and does nothing else (FR-028): no HTTP, no
X, no model, no input from strangers. It reads the claim and its verdict and decides nothing (001-second-runtime).

One process per network (FR-036d), each with its own chain id, contract, RPC and oracle key: it reads and writes
only its own network's rows, so a stuck transaction or a dead node on one never delays the other.

    .venv/bin/python -m settle.worker
"""

from __future__ import annotations

import logging
import os
import stat
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import psycopg
from eth_account import Account
from psycopg.rows import dict_row
from web3 import Web3
from web3.exceptions import Web3Exception

from settle.chain import SETTLED_STATES, ChainMismatch, Escrow, claim_hash, evidence_ref

POLL_SECONDS = 60
CONNECT_TIMEOUT_SECONDS = 5

log = logging.getLogger("vaticeno.settle")


@dataclass
class Run:
    signed: int = 0
    refused: int = 0
    sent: int = 0
    no_stake: int = 0
    failed: int = 0
    retrying: int = 0
    tx_references: list[str] = field(default_factory=list)


def network_of(escrow: Escrow) -> str:
    """The outbox's name for this worker's network: the chain id as text (data-model → settlement_outbox)."""
    return str(escrow.chain_id)


def run_once(conn: psycopg.Connection, escrow: Escrow, now: datetime) -> Run:
    run = Run()
    sign_authorizations(conn, escrow, now, run)
    settle_confirmed(conn, escrow, now, run)
    return run


def sign_authorizations(conn: psycopg.Connection, escrow: Escrow, now: datetime, run: Run) -> None:
    """One signature per locked price claim, valid until acceptance closes; every stake on it reuses it."""
    rows = _rows(conn, """
        select o.id, c.slug, c.deadline_at, c.resolution_method
        from settlement_outbox o join claims c on c.id = o.claim_id
        where o.network = %s and o.state = 'open' and o.open_authorization is null
    """, (network_of(escrow),))
    for row in rows:
        # The third refusal of a model-judged claim, after the lock and the contract (FR-031a, T336a).
        if row["resolution_method"] != "price_feed" or row["deadline_at"] is None:
            log.error("settle.refused_to_sign slug=%s method=%s", row["slug"], row["resolution_method"])
            run.refused += 1
            continue
        deadline = int(row["deadline_at"].timestamp())
        valid_until = deadline - escrow.acceptance_closes
        if now.timestamp() >= valid_until:
            continue  # acceptance has closed: there is nothing left to open
        hash_ = claim_hash(row["slug"])
        signature = escrow.sign_open(hash_, deadline, valid_until)
        _execute(conn, """
            update settlement_outbox
            set claim_hash = %s, open_authorization = %s, authorized_until = %s
            where id = %s and open_authorization is null
        """, ("0x" + hash_.hex(), signature, datetime.fromtimestamp(valid_until, UTC), row["id"]))
        run.signed += 1
        log.info("settle.authorized slug=%s until=%s", row["slug"], valid_until)


def settle_confirmed(conn: psycopg.Connection, escrow: Escrow, now: datetime, run: Run) -> None:
    """Rows whose verdict Node has confirmed. The verdict is read from its own table, never from the row."""
    rows = _rows(conn, """
        select o.id, o.outcome, o.tx_references, c.slug, c.deadline_at,
               r.id::text as resolution_id, r.outcome as verdict, r.review_status
        from settlement_outbox o
        join claims c on c.id = o.claim_id
        left join resolutions r on r.claim_id = o.claim_id
        where o.network = %s and o.state = 'pending'
    """, (network_of(escrow),))
    for row in rows:
        # A row is not an instruction: an outcome that is not the final verdict stops here (FR-028a).
        if row["review_status"] != "final" or row["verdict"] != row["outcome"]:
            _finish(conn, row["id"], "failed", "the row's outcome is not the final verdict")
            log.error("settle.mismatch slug=%s row=%s verdict=%s", row["slug"], row["outcome"], row["verdict"])
            run.failed += 1
            continue
        deadline = int(row["deadline_at"].timestamp())
        if now.timestamp() >= deadline + escrow.timeout:
            # The refund owns these stakes now; anyone can trigger it (FR-030).
            _finish(conn, row["id"], "failed", "past the timeout: the stakes refund instead")
            run.failed += 1
            continue
        try:
            _settle_claim(conn, escrow, row, run)
        except (ChainMismatch, Web3Exception, RuntimeError, OSError, ValueError) as error:
            # The row stays pending and is tried next run; the contract refuses a stake settled twice.
            _execute(conn, """
                update settlement_outbox set attempts = attempts + 1, last_error = %s
                where id = %s and state = 'pending'
            """, (str(error)[:500], row["id"]))
            log.warning("settle.retry slug=%s error=%s", row["slug"], error)
            run.retrying += 1


def _settle_claim(conn: psycopg.Connection, escrow: Escrow, row: dict, run: Run) -> None:
    # A transaction sent by an earlier run and not mined yet: wait for it rather than send a second.
    if any(escrow.in_flight(tx) for tx in row["tx_references"]):
        raise RuntimeError("an earlier settle is still in flight")
    hash_ = claim_hash(row["slug"])
    deadline = int(row["deadline_at"].timestamp())
    stakes = escrow.stakes_of(hash_)
    already = 0
    sent_here = 0
    for stake in stakes:
        if stake.claim_hash != hash_ or stake.deadline != deadline:
            raise ChainMismatch(f"stake {stake.id} names another claim or deadline")
        if stake.state in SETTLED_STATES:
            already += 1  # a run that died after sending; the chain is the record
            continue
        if stake.state != "Matched":
            continue  # an offer nobody took: it expires back to its maker on its own
        tx = escrow.send_settle(stake, row["outcome"], evidence_ref(row["resolution_id"]))
        # Recorded the moment it is sent, before waiting: a crash or a slow receipt loses nothing.
        _execute(conn, """
            update settlement_outbox set tx_references = array_append(tx_references, %s)
            where id = %s
        """, (tx, row["id"]))
        escrow.wait_mined(tx)
        run.tx_references.append(tx)
        sent_here += 1
        log.info("settle.sent slug=%s stake=%s tx=%s", row["slug"], stake.id, tx)
    if sent_here or already:
        _finish(conn, row["id"], "sent", None)
        run.sent += 1
    else:
        _finish(conn, row["id"], "no_stake", None)
        run.no_stake += 1


def _finish(conn: psycopg.Connection, row_id: str, state: str, error: str | None) -> None:
    _execute(conn, """
        update settlement_outbox set state = %s, last_error = %s, sent_at = now()
        where id = %s and state = 'pending'
    """, (state, error, row_id))


STALE_AFTER_SECONDS = 180


def job_name(escrow: Escrow) -> str:
    return f"settle-{network_of(escrow)}"


def register(conn: psycopg.Connection, escrow: Escrow) -> None:
    """This network's heartbeat row, created on first start: a network is added by starting its worker."""
    _execute(conn, "insert into job_state (job, stale_after_seconds) values (%s, %s) on conflict do nothing",
             (job_name(escrow), STALE_AFTER_SECONDS))


def heartbeat(conn: psycopg.Connection, escrow: Escrow, started: datetime, error: Exception | None) -> None:
    """Written every run, empty queue included, so a silent worker reads as late (FR-020a)."""
    job = job_name(escrow)
    if error is None:
        _execute(conn, """
            update job_state set last_started_at = %s, last_finished_at = now(), last_ok_at = now(),
              last_outcome = 'ok', last_error_tag = null, consecutive_failures = 0
            where job = %s
        """, (started, job))
    else:
        _execute(conn, """
            update job_state set last_started_at = %s, last_finished_at = now(), last_outcome = 'failed',
              last_error_tag = %s, consecutive_failures = consecutive_failures + 1
            where job = %s
        """, (started, type(error).__name__, job))


def read_key(path: Path) -> str:
    """The key file must be readable by this worker's own user alone (FR-028a)."""
    mode = path.stat().st_mode
    if mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise PermissionError(f"{path} is readable by others (mode {oct(mode & 0o777)}): chmod 600 it")
    return path.read_text().strip()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    account = Account.from_key(read_key(Path(os.environ["ORACLE_KEY_FILE"])))
    # RPC_URL: this network's node. BASE_SEPOLIA_RPC_URL is the name Stage 2's env file already carries.
    w3 = Web3(Web3.HTTPProvider(os.environ.get("RPC_URL") or os.environ["BASE_SEPOLIA_RPC_URL"]))
    escrow = Escrow(w3, os.environ["ESCROW_ADDRESS"], int(os.environ["ESCROW_CHAIN_ID"]), account,
                    int(os.environ.get("ESCROW_VERSION", "1")))
    log.info("settle.started network=%s oracle=%s escrow=%s version=%s",
             network_of(escrow), account.address, escrow.address, escrow.version)
    registered = False
    while True:
        started = datetime.now(UTC)
        try:
            with psycopg.connect(os.environ["DATABASE_URL_SETTLE"], connect_timeout=CONNECT_TIMEOUT_SECONDS,
                                 autocommit=True) as conn:
                if not registered:
                    register(conn, escrow)
                    registered = True
                try:
                    run_once(conn, escrow, started)
                    heartbeat(conn, escrow, started, None)
                except Exception as error:
                    heartbeat(conn, escrow, started, error)
                    log.exception("settle.run_failed")
        except psycopg.Error:
            log.exception("settle.database_unreachable")  # no heartbeat possible: the page shows it late
        time.sleep(POLL_SECONDS)


def _rows(conn: psycopg.Connection, sql: str, params: tuple = ()) -> list[dict]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def _execute(conn: psycopg.Connection, sql: str, params: tuple) -> None:
    with conn.cursor() as cur:
        cur.execute(sql, params)


if __name__ == "__main__":
    main()
