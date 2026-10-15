"""The settlement worker against a real local chain (anvil) and the real local database, as `settle_rw`
(003 T333, T334, T336a). Skipped without anvil or a database, unless REQUIRE_CHAIN_TESTS is set, as CI does."""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import psycopg
import pytest
from eth_account import Account
from web3 import Web3

from settle.chain import ChainMismatch, Escrow, claim_hash
from settle.worker import heartbeat, read_key, run_once

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
CHAIN_ID = 84532
DAY = 86400
AMOUNT = 10 * 10**18

# anvil's published development accounts: deployer, oracle, guardian, maker, taker. Not secrets.
KEYS = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
]
DEPLOYER, ORACLE, GUARDIAN, MAKER, TAKER = (Account.from_key(k) for k in KEYS)


def _require(reason: str) -> None:
    if os.environ.get("REQUIRE_CHAIN_TESTS"):
        pytest.fail(reason)
    pytest.skip(reason)


def _database_url() -> str | None:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip()
    return None


def _tool(name: str) -> str | None:
    return shutil.which(name) or (str(p) if (p := Path.home() / ".foundry/bin" / name).exists() else None)


@pytest.fixture(scope="module")
def w3():
    anvil = _tool("anvil")
    if not anvil:
        _require("anvil is not installed")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen([anvil, "--port", str(port), "--chain-id", str(CHAIN_ID), "--silent"])
    web3 = Web3(Web3.HTTPProvider(f"http://127.0.0.1:{port}"))
    for _ in range(100):
        if web3.is_connected():
            break
        time.sleep(0.1)
    yield web3
    proc.terminate()


@pytest.fixture(scope="module")
def artifacts():
    forge = _tool("forge")
    if not forge:
        _require("forge is not installed")
    subprocess.run([forge, "build"], cwd=CONTRACTS, check=True, capture_output=True)
    def load(name: str) -> dict:
        data = json.loads((CONTRACTS / f"out/{name}.sol/{name}.json").read_text())
        return {"abi": data["abi"], "bytecode": data["bytecode"]["object"]}
    return {"Escrow": load("Escrow"), "TestToken": load("TestToken")}


def _send(w3: Web3, account, call) -> dict:
    tx = call.build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "chainId": CHAIN_ID,
    })
    receipt = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_raw_transaction(account.sign_transaction(tx).raw_transaction))
    assert receipt["status"] == 1, "transaction reverted"
    return receipt


def _deploy(w3: Web3, artifact: dict, *args):
    factory = w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"])
    receipt = _send(w3, DEPLOYER, factory.constructor(*args))
    return w3.eth.contract(address=receipt["contractAddress"], abi=artifact["abi"])


@pytest.fixture
def chain(w3, artifacts):
    """A fresh token and escrow per test, with the decision doc's numbers."""
    token = _deploy(w3, artifacts["TestToken"])
    escrow = _deploy(w3, artifacts["Escrow"], (
        token.address, ORACLE.address, GUARDIAN.address, DEPLOYER.address,
        0, 72 * 3600, 14 * DAY, DAY, 7 * DAY, 100 * 10**18,
    ))
    for who in (MAKER, TAKER):
        _send(w3, DEPLOYER, token.functions.mint(who.address, 1000 * 10**18))
        _send(w3, who, token.functions.approve(escrow.address, 2**256 - 1))
    return {"w3": w3, "token": token, "escrow": escrow,
            "client": Escrow(w3, escrow.address, CHAIN_ID, ORACLE)}


@pytest.fixture
def db():
    url = _database_url()
    if not url:
        _require("no DATABASE_URL")
    try:
        owner = psycopg.connect(url, autocommit=True, connect_timeout=3)
    except psycopg.Error:
        _require("the local database is not running")
    owner.execute("""truncate feed_posts, feed_queue, opt_outs, sources, cost_events, recheck_findings,
        settlement_outbox, corrections, resolutions, evidences, positions, claims""")
    owner.execute("insert into job_state (job, stale_after_seconds) values ('settle', 180) on conflict do nothing")
    worker = psycopg.connect(url, autocommit=True, connect_timeout=3)
    worker.execute("set role settle_rw")  # the worker's own rights, nothing more
    yield {"owner": owner, "worker": worker}
    worker.close()
    owner.close()


def _chain_now(w3: Web3) -> int:
    return int(w3.eth.get_block("latest")["timestamp"])


def _warp_to(w3: Web3, when: int) -> None:
    w3.provider.make_request("evm_setNextBlockTimestamp", [when])
    w3.provider.make_request("evm_mine", [])


def _locked_claim(owner, deadline: int, method: str = "price_feed") -> dict:
    slug = uuid.uuid4().hex[:6]
    deadline_at = datetime.fromtimestamp(deadline, UTC)
    contract = {"subject": "BTC", "resolution_method": method, "deadline_at": deadline_at.isoformat()}
    row = owner.execute("""
        insert into claims (slug, source_tweet_id, summon_tweet_id, source_version, author_x_user_id, status,
          contract, resolution_method, deadline_at, lock_at)
        values (%s, %s, %s, 'v1', '200', 'draft', %s, %s, %s, now()) returning id::text
    """, (slug, str(uuid.uuid4().int)[:12], str(uuid.uuid4().int)[:12], json.dumps(contract), method,
          deadline_at)).fetchone()
    owner.execute("update claims set status = 'locked' where id = %s", (row[0],))
    owner.execute("insert into settlement_outbox (claim_id) values (%s)", (row[0],))
    return {"id": row[0], "slug": slug, "deadline": deadline}


def _final_verdict(owner, claim: dict, outcome: str, row_outcome: str | None = None) -> None:
    """A final resolution, and the row confirmed by Node with `row_outcome` (the verdict unless told otherwise)."""
    evidence = owner.execute("""
        insert into evidences (claim_id, run_at, source_kind, basis, source_name, trust_level, says,
          retrieved_at, gates, passed)
        values (%s, now(), 'price_feed', 'record', 'coinbase', 'primary', %s, now(), '{}', true) returning id
    """, (claim["id"], outcome)).fetchone()[0]
    owner.execute("update claims set status = 'resolving' where id = %s", (claim["id"],))
    owner.execute("""
        insert into resolutions (claim_id, outcome, decided_by, review_status, decided_at, deciding_evidence_id)
        values (%s, %s, 'evidence', 'final', now(), %s)
    """, (claim["id"], outcome, evidence))
    owner.execute("update settlement_outbox set outcome = %s, state = 'pending' where claim_id = %s",
                  (row_outcome or outcome, claim["id"]))


def _row(owner, claim: dict) -> dict:
    cur = owner.execute("""select state, open_authorization, authorized_until, claim_hash, tx_references, last_error
        from settlement_outbox where claim_id = %s""", (claim["id"],))
    names = [c.name for c in cur.description]
    return dict(zip(names, cur.fetchone(), strict=True))


def _stake_state(escrow, stake_id: int) -> int:
    return escrow.functions.stakes(stake_id).call()[8]


def _now(w3: Web3) -> datetime:
    return datetime.fromtimestamp(_chain_now(w3), UTC)


# ---- the whole path ----


def test_a_signed_claim_is_staked_on_settled_and_never_settled_twice(chain, db):
    w3, escrow = chain["w3"], chain["escrow"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)

    assert run_once(db["worker"], chain["client"], _now(w3)).signed == 1
    row = _row(db["owner"], claim)
    assert row["claim_hash"] == "0x" + claim_hash(claim["slug"]).hex()
    # The worker's signature is the one the contract accepts: it opens a real stake.
    valid_until = int(row["authorized_until"].timestamp())
    _send(w3, MAKER, escrow.functions.open(
        claim_hash(claim["slug"]), claim["deadline"], valid_until, bytes.fromhex(row["open_authorization"][2:]),
        True, AMOUNT))
    _send(w3, TAKER, escrow.functions.accept(1))

    _warp_to(w3, claim["deadline"] + 3600)
    _final_verdict(db["owner"], claim, "hit")
    run = run_once(db["worker"], chain["client"], _now(w3))
    assert (run.sent, len(run.tx_references)) == (1, 1)
    assert _row(db["owner"], claim)["state"] == "sent"
    assert _stake_state(escrow, 1) == 3  # Settled: the window starts, nobody is paid yet

    # Replayed: the row sent back to pending sends nothing, because the chain says it is done (FR-026).
    db["owner"].execute("update settlement_outbox set state = 'pending' where claim_id = %s", (claim["id"],))
    again = run_once(db["worker"], chain["client"], _now(w3))
    assert again.tx_references == [] and again.sent == 1
    assert len(_row(db["owner"], claim)["tx_references"]) == 1


def test_a_claim_nobody_staked_on_sends_nothing(chain, db):
    w3 = chain["w3"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    _warp_to(w3, claim["deadline"] + 3600)
    _final_verdict(db["owner"], claim, "miss")
    run = run_once(db["worker"], chain["client"], _now(w3))
    assert (run.no_stake, run.tx_references) == (1, [])
    assert _row(db["owner"], claim)["state"] == "no_stake"


def test_an_offer_nobody_took_is_left_to_expire_and_counts_as_no_stake(chain, db):
    w3, escrow = chain["w3"], chain["escrow"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    run_once(db["worker"], chain["client"], _now(w3))
    row = _row(db["owner"], claim)
    _send(w3, MAKER, escrow.functions.open(
        claim_hash(claim["slug"]), claim["deadline"], int(row["authorized_until"].timestamp()),
        bytes.fromhex(row["open_authorization"][2:]), True, AMOUNT))
    _warp_to(w3, claim["deadline"] + 3600)
    _final_verdict(db["owner"], claim, "hit")
    assert run_once(db["worker"], chain["client"], _now(w3)).no_stake == 1
    assert _stake_state(escrow, 1) == 1  # still Open: its maker takes it back with `expire`


# ---- what it refuses ----


def test_a_row_whose_outcome_is_not_the_verdict_is_stopped_not_sent(chain, db):
    w3 = chain["w3"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    _warp_to(w3, claim["deadline"] + 3600)
    _final_verdict(db["owner"], claim, "hit", row_outcome="miss")
    run = run_once(db["worker"], chain["client"], _now(w3))
    assert (run.failed, run.tx_references) == (1, [])
    assert _row(db["owner"], claim)["state"] == "failed"


def test_it_never_signs_for_a_claim_judged_by_the_model(chain, db):
    w3 = chain["w3"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY, method="model")
    run = run_once(db["worker"], chain["client"], _now(w3))
    assert (run.signed, run.refused) == (0, 1)
    assert _row(db["owner"], claim)["open_authorization"] is None


def test_it_signs_nothing_once_acceptance_has_closed(chain, db):
    w3 = chain["w3"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + DAY // 2)
    assert run_once(db["worker"], chain["client"], _now(w3)).signed == 0
    assert _row(db["owner"], claim)["open_authorization"] is None


def test_past_the_timeout_the_refund_owns_the_stakes(chain, db):
    w3 = chain["w3"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    _warp_to(w3, claim["deadline"] + 14 * DAY)
    _final_verdict(db["owner"], claim, "hit")
    assert run_once(db["worker"], chain["client"], _now(w3)).failed == 1
    assert "timeout" in _row(db["owner"], claim)["last_error"]


def test_a_key_that_is_not_the_contracts_oracle_stops_the_worker(chain):
    with pytest.raises(ChainMismatch):
        Escrow(chain["w3"], chain["escrow"].address, CHAIN_ID, MAKER)


def test_the_wrong_chain_stops_the_worker(chain):
    with pytest.raises(ChainMismatch):
        Escrow(chain["w3"], chain["escrow"].address, 1, ORACLE)


def test_a_key_file_others_can_read_is_refused(tmp_path):
    key = tmp_path / "oracle.key"
    key.write_text(KEYS[1])
    key.chmod(0o644)
    with pytest.raises(PermissionError):
        read_key(key)
    key.chmod(0o600)
    assert read_key(key) == KEYS[1]


# ---- its heartbeat ----


def test_the_heartbeat_is_written_and_says_when_a_run_failed(db):
    started = datetime.now(UTC)
    heartbeat(db["worker"], started, None)
    ok = db["owner"].execute("select last_outcome, consecutive_failures from job_state where job = 'settle'")
    assert ok.fetchone() == ("ok", 0)
    heartbeat(db["worker"], started, RuntimeError("rpc down"))
    failed = db["owner"].execute(
        "select last_outcome, last_error_tag, consecutive_failures from job_state where job = 'settle'")
    assert failed.fetchone() == ("failed", "RuntimeError", 1)
