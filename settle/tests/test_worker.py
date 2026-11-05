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
from datetime import UTC, datetime, timedelta
from pathlib import Path

import psycopg
import pytest
from eth_account import Account
from web3 import Web3
from web3.exceptions import ContractLogicError

from settle.chain import ChainMismatch, Escrow, claim_hash
from settle.worker import heartbeat, read_key, register, run_once

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
CHAIN_ID = 84532
OTHER_CHAIN_ID = 421614  # Arbitrum Sepolia: the second network
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


def _anvil(chain_id: int):
    anvil = _tool("anvil")
    if not anvil:
        _require("anvil is not installed")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen([anvil, "--port", str(port), "--chain-id", str(chain_id), "--silent"])
    web3 = Web3(Web3.HTTPProvider(f"http://127.0.0.1:{port}"))
    for _ in range(100):
        if web3.is_connected():
            break
        time.sleep(0.1)
    yield web3
    proc.terminate()


@pytest.fixture(scope="module")
def w3():
    yield from _anvil(CHAIN_ID)


@pytest.fixture(scope="module")
def w3_other():
    """A second local chain with Arbitrum Sepolia's chain id."""
    yield from _anvil(OTHER_CHAIN_ID)


@pytest.fixture(scope="module")
def artifacts():
    forge = _tool("forge")
    if not forge:
        _require("forge is not installed")
    subprocess.run([forge, "build"], cwd=CONTRACTS, check=True, capture_output=True)
    def load(name: str) -> dict:
        data = json.loads((CONTRACTS / f"out/{name}.sol/{name}.json").read_text())
        return {"abi": data["abi"], "bytecode": data["bytecode"]["object"]}
    return {name: load(name) for name in ("Escrow", "TestToken", "EscrowV2", "TestUsdc")}


def _send(w3: Web3, account, call) -> dict:
    tx = call.build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "chainId": w3.eth.chain_id,
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


USDC = 10**6


def _deploy_v2(w3: Web3, artifacts) -> dict:
    """v2 with 007's numbers, in a 6-decimal token that can block an address, on whichever chain `w3` is."""
    token = _deploy(w3, artifacts["TestUsdc"])
    escrow = _deploy(w3, artifacts["EscrowV2"], (
        token.address, ORACLE.address, GUARDIAN.address, DEPLOYER.address,
        0, 72 * 3600, 14 * DAY, DAY, 7 * DAY, 1 * USDC, 1_000 * USDC, 10_000 * USDC, 50_000 * USDC,
    ))
    for who in (MAKER, TAKER):
        _send(w3, DEPLOYER, token.functions.mint(who.address, 5_000 * USDC))
        _send(w3, who, token.functions.approve(escrow.address, 2**256 - 1))
    return {"w3": w3, "token": token, "escrow": escrow,
            "client": Escrow(w3, escrow.address, w3.eth.chain_id, ORACLE, version=2)}


@pytest.fixture
def chain_v2(w3, artifacts):
    return _deploy_v2(w3, artifacts)


@pytest.fixture
def db():
    url = _database_url()
    if not url:
        _require("no DATABASE_URL")
    try:
        owner = psycopg.connect(url, autocommit=True, connect_timeout=3)
    except psycopg.Error:
        _require("the local database is not running")
    owner.execute("""truncate feed_posts, feed_queue, opt_outs, sources, cost_events, recheck_findings, wager_replies,
        verifier_shadow, outcome_confirmations, settlement_outbox, corrections, resolutions, evidences, positions,
        claims""")
    owner.execute("delete from job_state where job like 'settle-%%'")
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


def _locked_claim(owner, deadline: int, method: str = "price_feed", networks=(str(CHAIN_ID),)) -> dict:
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
    for network in networks:
        owner.execute("insert into settlement_outbox (claim_id, network) values (%s, %s)", (row[0], network))
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


def _row(owner, claim: dict, network: str = str(CHAIN_ID)) -> dict:
    cur = owner.execute("""select state, open_authorization, authorized_until, claim_hash, tx_references, last_error,
        attempts from settlement_outbox where claim_id = %s and network = %s""", (claim["id"], network))
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


def test_an_offer_nobody_took_is_returned_to_its_maker_and_counts_as_no_stake(chain, db):
    w3, escrow = chain["w3"], chain["escrow"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    run_once(db["worker"], chain["client"], _now(w3))
    row = _row(db["owner"], claim)
    _send(w3, MAKER, escrow.functions.open(
        claim_hash(claim["slug"]), claim["deadline"], int(row["authorized_until"].timestamp()),
        bytes.fromhex(row["open_authorization"][2:]), True, AMOUNT))
    _warp_to(w3, claim["deadline"] + 3600)
    _final_verdict(db["owner"], claim, "hit")
    run = run_once(db["worker"], chain["client"], _now(w3))
    assert (run.no_stake, run.finished) == (1, 1)
    assert _stake_state(escrow, 1) == 7  # Expired: the worker returned it, nobody had to ask


def _matched_stake(chain, db, claim):
    w3, escrow = chain["w3"], chain["escrow"]
    run_once(db["worker"], chain["client"], _now(w3))
    row = _row(db["owner"], claim)
    _send(w3, MAKER, escrow.functions.open(
        claim_hash(claim["slug"]), claim["deadline"], int(row["authorized_until"].timestamp()),
        bytes.fromhex(row["open_authorization"][2:]), True, AMOUNT))
    stake_id = escrow.functions.stakesOf(claim_hash(claim["slug"])).call()[0]
    _send(w3, TAKER, escrow.functions.accept(stake_id))
    return stake_id


def test_after_the_deadline_it_records_whether_any_stake_was_matched(chain, db):
    w3, escrow = chain["w3"], chain["escrow"]
    deadline = _chain_now(w3) + 3 * DAY
    staked, offered = _locked_claim(db["owner"], deadline), _locked_claim(db["owner"], deadline)
    _matched_stake(chain, db, staked)
    row = _row(db["owner"], offered)
    _send(w3, MAKER, escrow.functions.open(
        claim_hash(offered["slug"]), deadline, int(row["authorized_until"].timestamp()),
        bytes.fromhex(row["open_authorization"][2:]), True, AMOUNT))
    unsigned = _locked_claim(db["owner"], deadline)
    db["owner"].execute("update settlement_outbox set claim_hash = null, open_authorization = null, "
                        "authorized_until = null where claim_id = %s", (unsigned["id"],))
    matched = lambda c: db["owner"].execute(  # noqa: E731
        "select matched from settlement_outbox where claim_id = %s", (c["id"],)).fetchone()[0]

    run_once(db["worker"], chain["client"], _now(w3), sign=False)
    assert [matched(c) for c in (staked, offered, unsigned)] == [None, None, None], "a stake can still come"
    _warp_to(w3, deadline + 60)
    run_once(db["worker"], chain["client"], _now(w3), sign=False)
    assert [matched(c) for c in (staked, offered, unsigned)] == [True, False, False]


def test_a_chain_error_on_one_claim_never_stops_the_others(chain, db, monkeypatch):
    w3 = chain["w3"]
    first = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    second = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    _matched_stake(chain, db, first)
    _matched_stake(chain, db, second)
    _warp_to(w3, first["deadline"] + 3600)
    _final_verdict(db["owner"], first, "hit")
    _final_verdict(db["owner"], second, "hit")

    real_send = chain["client"].send_settle
    calls = {"n": 0}
    def fails_once(stake, outcome, evidence):
        calls["n"] += 1
        if calls["n"] == 1:
            raise ContractLogicError("execution reverted: TooLate()")
        return real_send(stake, outcome, evidence)
    monkeypatch.setattr(chain["client"], "send_settle", fails_once)

    run = run_once(db["worker"], chain["client"], _now(w3))
    assert (run.retrying, run.sent) == (1, 1), "one claim retried, the other settled in the same run"
    states = sorted(_row(db["owner"], c)["state"] for c in (first, second))
    assert states == ["pending", "sent"]


def test_a_settle_still_in_flight_is_never_sent_twice(chain, db, monkeypatch):
    w3 = chain["w3"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    _matched_stake(chain, db, claim)
    _warp_to(w3, claim["deadline"] + 3600)
    _final_verdict(db["owner"], claim, "hit")
    # An earlier run sent a settle and died before its receipt: the hash is on the row, the chain has not mined it.
    db["owner"].execute("update settlement_outbox set tx_references = '{0xabc}' where claim_id = %s", (claim["id"],))
    monkeypatch.setattr(chain["client"], "in_flight", lambda tx: tx == "0xabc")
    run = run_once(db["worker"], chain["client"], _now(w3))
    assert (run.retrying, run.tx_references) == (1, [])
    assert _row(db["owner"], claim)["tx_references"] == ["0xabc"]


# ---- what it refuses ----


def test_a_row_whose_outcome_is_not_the_verdict_is_stopped_not_sent(chain, db):
    w3 = chain["w3"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    _warp_to(w3, claim["deadline"] + 3600)
    _final_verdict(db["owner"], claim, "hit", row_outcome="miss")
    run = run_once(db["worker"], chain["client"], _now(w3))
    assert (run.failed, run.tx_references) == (1, [])
    assert _row(db["owner"], claim)["state"] == "failed"


def test_it_signs_for_a_claim_judged_by_the_model_too(chain, db):
    w3 = chain["w3"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY, method="model")
    run = run_once(db["worker"], chain["client"], _now(w3))
    assert (run.signed, run.refused) == (1, 0)
    assert _row(db["owner"], claim)["open_authorization"] is not None


def test_a_network_not_yet_authorized_signs_nothing_but_still_settles(chain, db):
    claim = _locked_claim(db["owner"], _chain_now(chain["w3"]) + 3 * DAY)
    assert run_once(db["worker"], chain["client"], _now(chain["w3"]), sign=False).signed == 0
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


def test_a_market_key_names_the_rows_and_must_be_on_its_chain(chain):
    usdt = Escrow(chain["w3"], chain["escrow"].address, CHAIN_ID, ORACLE, network=f"{CHAIN_ID}-usdt")
    assert usdt.network == f"{CHAIN_ID}-usdt"
    with pytest.raises(ChainMismatch):
        Escrow(chain["w3"], chain["escrow"].address, CHAIN_ID, ORACLE, network="42161-usdt")


def test_a_key_file_others_can_read_is_refused(tmp_path):
    key = tmp_path / "oracle.key"
    key.write_text(KEYS[1])
    key.chmod(0o644)
    with pytest.raises(PermissionError):
        read_key(key)
    key.chmod(0o600)
    assert read_key(key) == KEYS[1]


# ---- its heartbeat ----


def test_each_network_registers_and_beats_its_own_heartbeat(chain, db):
    started = datetime.now(UTC)
    register(db["worker"], chain["client"])
    register(db["worker"], chain["client"])  # a restart registers nothing twice
    heartbeat(db["worker"], chain["client"], started, None)
    ok = db["owner"].execute("select last_outcome, consecutive_failures from job_state where job = 'settle-84532'")
    assert ok.fetchone() == ("ok", 0)
    heartbeat(db["worker"], chain["client"], started, RuntimeError("rpc down"))
    failed = db["owner"].execute(
        "select last_outcome, last_error_tag, consecutive_failures from job_state where job = 'settle-84532'")
    assert failed.fetchone() == ("failed", "RuntimeError", 1)


# ---- escrow v2 (007-escrow-v2) ----


def test_v2_the_worker_signs_version_2_and_pays_the_winner_after_the_hold(chain_v2, db):
    w3, escrow, token = chain_v2["w3"], chain_v2["escrow"], chain_v2["token"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    assert run_once(db["worker"], chain_v2["client"], _now(w3)).signed == 1
    row = _row(db["owner"], claim)
    stake = 250 * USDC
    _send(w3, MAKER, escrow.functions.open(
        claim_hash(claim["slug"]), claim["deadline"], int(row["authorized_until"].timestamp()),
        bytes.fromhex(row["open_authorization"][2:]), True, stake))
    _send(w3, TAKER, escrow.functions.accept(1))

    _warp_to(w3, claim["deadline"] + 3600)
    _final_verdict(db["owner"], claim, "hit")
    assert run_once(db["worker"], chain_v2["client"], _now(w3)).sent == 1
    assert _stake_state(escrow, 1) == 3  # Settled

    before = token.functions.balanceOf(MAKER.address).call()
    assert run_once(db["worker"], chain_v2["client"], _now(w3)).finished == 0  # inside the hold: nothing yet
    settled_at = escrow.functions.stakes(1).call()[6]  # the hold runs from when the verdict was mined
    _warp_to(w3, settled_at + 72 * 3600)
    # Nobody presses anything: the worker pays out, and the pot lands in the winner's wallet.
    assert run_once(db["worker"], chain_v2["client"], _now(w3)).finished == 1
    assert _stake_state(escrow, 1) == 4  # Paid
    assert token.functions.balanceOf(MAKER.address).call() == before + 2 * stake
    assert escrow.functions.creditOf(MAKER.address).call() == 0
    assert run_once(db["worker"], chain_v2["client"], _now(w3)).finished == 0  # once only


def test_v2_the_worker_returns_an_untaken_offer_and_refunds_a_stake_with_no_verdict(chain_v2, db):
    w3, escrow, token = chain_v2["w3"], chain_v2["escrow"], chain_v2["token"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    run_once(db["worker"], chain_v2["client"], _now(w3))
    row = _row(db["owner"], claim)
    open_offer = lambda: _send(w3, MAKER, escrow.functions.open(  # noqa: E731
        claim_hash(claim["slug"]), claim["deadline"], int(row["authorized_until"].timestamp()),
        bytes.fromhex(row["open_authorization"][2:]), True, 5 * USDC))
    open_offer()  # 1: taken; 2: left open
    _send(w3, TAKER, escrow.functions.accept(1))
    open_offer()
    maker_before = token.functions.balanceOf(MAKER.address).call()
    taker_before = token.functions.balanceOf(TAKER.address).call()

    _warp_to(w3, claim["deadline"] + 3600)  # past the offer's expiry: it goes back to its maker
    assert run_once(db["worker"], chain_v2["client"], _now(w3)).finished == 1
    assert _stake_state(escrow, 2) == 7  # Expired
    _warp_to(w3, claim["deadline"] + 14 * DAY)  # no verdict ever came: both get their stake back
    assert run_once(db["worker"], chain_v2["client"], _now(w3)).finished == 1
    assert _stake_state(escrow, 1) == 6  # Refunded
    assert token.functions.balanceOf(MAKER.address).call() == maker_before + 10 * USDC
    assert token.functions.balanceOf(TAKER.address).call() == taker_before + 5 * USDC


def test_v2_a_v1_signature_would_be_refused_so_the_wrong_version_stops_the_worker(chain_v2, chain):
    with pytest.raises(ChainMismatch, match="version 1"):
        Escrow(chain_v2["w3"], chain_v2["escrow"].address, CHAIN_ID, ORACLE, version=1)
    with pytest.raises(ChainMismatch, match="version 2"):
        Escrow(chain["w3"], chain["escrow"].address, CHAIN_ID, ORACLE, version=2)


# ---- two networks (FR-036d) ----


def test_an_authorization_signed_for_one_network_is_refused_on_the_other(chain_v2, w3_other, artifacts, db):
    other = _deploy_v2(w3_other, artifacts)
    deadline = max(_chain_now(chain_v2["w3"]), _chain_now(w3_other)) + 3 * DAY
    claim = _locked_claim(db["owner"], deadline, networks=(str(CHAIN_ID), str(OTHER_CHAIN_ID)))
    run_once(db["worker"], chain_v2["client"], _now(chain_v2["w3"]))
    run_once(db["worker"], other["client"], _now(w3_other))
    here, there = _row(db["owner"], claim), _row(db["owner"], claim, str(OTHER_CHAIN_ID))
    assert here["open_authorization"] != there["open_authorization"]  # one signature per network
    open_with = lambda row: other["escrow"].functions.open(  # noqa: E731
        claim_hash(claim["slug"]), deadline, int(row["authorized_until"].timestamp()),
        bytes.fromhex(row["open_authorization"][2:]), True, 10 * USDC)
    with pytest.raises(ContractLogicError):
        open_with(here).call({"from": MAKER.address})  # Base Sepolia's signature, on the other chain
    _send(w3_other, MAKER, open_with(there))  # its own signature opens


def test_a_dead_network_never_holds_up_the_other(chain, w3_other, artifacts, db, monkeypatch):
    other = _deploy_v2(w3_other, artifacts)
    w3 = chain["w3"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY, networks=(str(CHAIN_ID), str(OTHER_CHAIN_ID)))
    run_once(db["worker"], chain["client"], _now(w3))
    row = _row(db["owner"], claim)
    _send(w3, MAKER, chain["escrow"].functions.open(
        claim_hash(claim["slug"]), claim["deadline"], int(row["authorized_until"].timestamp()),
        bytes.fromhex(row["open_authorization"][2:]), True, AMOUNT))
    _send(w3, TAKER, chain["escrow"].functions.accept(1))
    _warp_to(w3, claim["deadline"] + 3600)
    _final_verdict(db["owner"], claim, "hit")

    # The other network's node is down: its worker fails on every call, and leaves its row to retry.
    def dead(*_args, **_kwargs):
        raise OSError("connection refused")
    monkeypatch.setattr(other["client"], "stakes_of", dead)
    assert run_once(db["worker"], other["client"], _now(w3)).retrying == 1
    # This network's worker never looks at that row: it settles its own as if the other did not exist.
    assert run_once(db["worker"], chain["client"], _now(w3)).sent == 1
    assert _row(db["owner"], claim)["state"] == "sent"
    stuck = _row(db["owner"], claim, str(OTHER_CHAIN_ID))
    assert (stuck["state"], stuck["attempts"]) == ("pending", 1)


# ---- each network's health (FR-022c) ----


def test_health_is_written_for_the_status_page_and_each_alert_is_raised_once(chain_v2, db, monkeypatch, caplog):
    import settle.health as health
    from settle.alerts import Alerts

    w3, escrow = chain_v2["w3"], chain_v2["escrow"]
    claim = _locked_claim(db["owner"], _chain_now(w3) + 3 * DAY)
    run_once(db["worker"], chain_v2["client"], _now(w3))
    row = _row(db["owner"], claim)
    _send(w3, MAKER, escrow.functions.open(
        claim_hash(claim["slug"]), claim["deadline"], int(row["authorized_until"].timestamp()),
        bytes.fromhex(row["open_authorization"][2:]), True, 40 * USDC))

    alerts = Alerts(None)
    monkeypatch.setattr(health, "GAS_LOW_WEI", 10**30)  # more than any oracle holds: the alert must fire
    health.record_health(db["worker"], chain_v2["client"], _now(w3), alerts)
    health.record_health(db["worker"], chain_v2["client"], _now(w3), alerts)
    got = db["owner"].execute(
        "select escrow_usdc, owed_usdc, backlog from network_health where network = %s", (str(CHAIN_ID),)).fetchone()
    assert tuple(int(v) for v in got) == (40 * USDC, 40 * USDC, 0)  # holds exactly what the open offer owes
    assert alerts.active == {"gas_low"}
    assert sum("settle.gas_low" in r.message for r in caplog.records) == 1, "raised when it starts, not every pass"

    # A node that stops answering is its own alert, and the row is left to age rather than rewritten.
    def dead():
        raise OSError("connection refused")
    monkeypatch.setattr(chain_v2["client"], "holdings", dead)
    health.record_health(db["worker"], chain_v2["client"], _now(w3), alerts)
    assert alerts.active == {"gas_low", "rpc_down"}


def test_a_balance_short_of_what_is_owed_and_an_old_backlog_are_alerts():
    from settle.health import BACKLOG_MAX_AGE, conditions

    now = datetime.now(UTC)
    queue = {"backlog": 2, "oldest_backlog_at": now - BACKLOG_MAX_AGE - timedelta(minutes=1), "stuck": 1,
             "last_settled_at": None}
    found = conditions(10**18, 99, 100, queue, now)
    assert set(found) == {"underfunded", "backlog_old", "stuck"}
    assert conditions(10**18, 100, 100, {**queue, "oldest_backlog_at": now, "stuck": 0}, now) == {}
