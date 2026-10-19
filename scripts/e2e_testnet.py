"""End to end on Base Sepolia (003 T337): three stakes on a minutes-scale throwaway deployment, settled by the
real worker code against the local database. A pays the winner after the window, B is VOID and refunds at
once, C never gets a verdict and refunds at the timeout with no operator involved (SC-010, SC-011, SC-012).

    scripts/e2e-testnet.sh        # deploys the throwaway contracts, then runs this
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import psycopg
from eth_account import Account
from web3 import Web3
from web3.exceptions import ContractLogicError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from settle.chain import Escrow, claim_hash  # noqa: E402
from settle.worker import run_once  # noqa: E402

RPC = os.environ.get("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org")
CHAIN_ID = 84532
KEYS = Path.home() / ".vaticeno-keys"
STAKE = 10 * 10**18
GAS_FLOAT = Web3.to_wei(0.00003, "ether")
TOKEN_ABI = [
    {"type": "function", "name": "mint", "stateMutability": "nonpayable",
     "inputs": [{"name": "to", "type": "address"}, {"name": "value", "type": "uint256"}], "outputs": []},
    {"type": "function", "name": "approve", "stateMutability": "nonpayable",
     "inputs": [{"name": "spender", "type": "address"}, {"name": "value", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"type": "function", "name": "balanceOf", "stateMutability": "view",
     "inputs": [{"name": "", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
]
ESCROW_ABI = [
    {"type": "function", "name": "open", "stateMutability": "nonpayable",
     "outputs": [{"name": "id", "type": "uint256"}],
     "inputs": [{"name": "claimHash", "type": "bytes32"}, {"name": "deadline", "type": "uint64"},
                {"name": "validUntil", "type": "uint64"}, {"name": "authorization", "type": "bytes"},
                {"name": "makerSaysHit", "type": "bool"}, {"name": "amount", "type": "uint128"}]},
    {"type": "function", "name": "accept", "stateMutability": "nonpayable",
     "inputs": [{"name": "id", "type": "uint256"}], "outputs": []},
    {"type": "function", "name": "payout", "stateMutability": "nonpayable",
     "inputs": [{"name": "id", "type": "uint256"}], "outputs": []},
    {"type": "function", "name": "refund", "stateMutability": "nonpayable",
     "inputs": [{"name": "id", "type": "uint256"}], "outputs": []},
    {"type": "function", "name": "settlementWindow", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "uint64"}]},
]
STATE = ["None", "Open", "Matched", "Settled", "Paid", "Voided", "Refunded", "Expired"]


def say(message: str) -> None:
    print(f"[{datetime.now(UTC):%H:%M:%S}] {message}", flush=True)


def key(role: str) -> Account:
    path = KEYS / f"{role}.key"
    if not path.exists():  # the two throwaway staking wallets, made on first run
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as file:
            file.write("0x" + Account.create().key.hex().removeprefix("0x"))
    return Account.from_key(path.read_text().strip())


class Sender:
    """Counts nonces itself: the public RPC sits behind several nodes, and one may answer a block behind."""

    def __init__(self, w3: Web3):
        self.w3 = w3
        self.nonces: dict[str, int] = {}

    def send(self, account, tx: dict) -> dict:
        address = account.address
        if address not in self.nonces:
            self.nonces[address] = self.w3.eth.get_transaction_count(address, "pending")
        tx = {**tx, "from": address, "nonce": self.nonces[address], "chainId": CHAIN_ID}
        if "gas" not in tx:
            tx["gas"] = int(self.w3.eth.estimate_gas(tx) * 1.3)
        if "maxFeePerGas" not in tx:
            tip = self.w3.to_wei(0.001, "gwei")
            tx["maxPriorityFeePerGas"] = tip
            tx["maxFeePerGas"] = 2 * self.w3.eth.get_block("latest")["baseFeePerGas"] + tip
        signed = account.sign_transaction(tx)
        receipt = self.w3.eth.wait_for_transaction_receipt(
            self.w3.eth.send_raw_transaction(signed.raw_transaction), timeout=180)
        self.nonces[address] += 1  # a reverted transaction uses its nonce too
        if receipt["status"] != 1:
            raise RuntimeError(f"reverted: {receipt['transactionHash'].hex()}")
        return receipt

    def call(self, account, fn) -> dict:
        return self.send(account, fn.build_transaction({"from": account.address, "gas": 400_000}))


def chain_now(w3: Web3) -> int:
    return int(w3.eth.get_block("latest")["timestamp"])


def wait_until(w3: Web3, when: int, why: str) -> None:
    say(f"waiting {max(0, when - chain_now(w3))}s for {why}")
    while chain_now(w3) < when:
        time.sleep(10)


def eventually(read, want, tries: int = 12):
    """A read that may come from a node a block behind: ask again until it says what was just written."""
    for _ in range(tries):
        got = read()
        if got == want:
            return got
        time.sleep(5)
    raise AssertionError(f"wanted {want}, the chain says {got}")


def database_url() -> str:
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip()
            if "localhost" not in url and "127.0.0.1" not in url:
                raise SystemExit("DATABASE_URL is not local: this run writes claims, so it never touches production")
            return url
    raise SystemExit("no DATABASE_URL in .env")


def locked_claim(owner, deadline: int) -> dict:
    slug = "e2e" + uuid.uuid4().hex[:5]
    deadline_at = datetime.fromtimestamp(deadline, UTC)
    row = owner.execute("""
        insert into claims (slug, source_tweet_id, summon_tweet_id, source_version, author_x_user_id, status,
          contract, resolution_method, deadline_at, lock_at)
        values (%s, %s, %s, 'v1', '200', 'draft', %s, 'price_feed', %s, now()) returning id::text
    """, (slug, str(uuid.uuid4().int)[:12], str(uuid.uuid4().int)[:12],
          json.dumps({"subject": "BTC", "resolution_method": "price_feed"}), deadline_at)).fetchone()
    owner.execute("update claims set status = 'locked' where id = %s", (row[0],))
    owner.execute("insert into settlement_outbox (claim_id) values (%s)", (row[0],))
    return {"id": row[0], "slug": slug}


def final_verdict(owner, claim: dict, outcome: str) -> None:
    """What Node leaves behind for a confirmed verdict: a final resolution and the row set pending."""
    owner.execute("update claims set status = 'resolving' where id = %s", (claim["id"],))
    if outcome == "void":
        owner.execute("""insert into resolutions (claim_id, outcome, void_reason, decided_by, review_status, decided_at)
            values (%s, 'void', 'unresolvable', 'evidence', 'final', now())""", (claim["id"],))
    else:
        evidence = owner.execute("""
            insert into evidences (claim_id, run_at, source_kind, basis, source_name, trust_level, says,
              retrieved_at, gates, passed)
            values (%s, now(), 'price_feed', 'record', 'coinbase', 'primary', %s, now(), '{}', true) returning id
        """, (claim["id"], outcome)).fetchone()[0]
        owner.execute("""insert into resolutions (claim_id, outcome, decided_by, review_status, decided_at,
            deciding_evidence_id) values (%s, %s, 'evidence', 'final', now(), %s)""",
                      (claim["id"], outcome, evidence))
    owner.execute("update settlement_outbox set outcome = %s, state = 'pending' where claim_id = %s",
                  (outcome, claim["id"]))


def main() -> None:
    escrow_address, token_address = sys.argv[1], sys.argv[2]
    w3 = Web3(Web3.HTTPProvider(RPC))
    assert w3.eth.chain_id == CHAIN_ID, "not Base Sepolia"
    deployer, oracle, maker, taker = key("deployer"), key("oracle"), key("e2e-maker"), key("e2e-taker")
    sender = Sender(w3)
    escrow = w3.eth.contract(address=escrow_address, abi=ESCROW_ABI)
    token = w3.eth.contract(address=token_address, abi=TOKEN_ABI)
    client = Escrow(w3, escrow_address, CHAIN_ID, oracle)  # the worker's own client, oracle key and all
    window = escrow.functions.settlementWindow().call()
    say(f"escrow {escrow_address}, window {window}s, timeout {client.timeout}s, acceptance closes "
        f"{client.acceptance_closes}s before the deadline")

    for who in (maker, taker):
        if w3.eth.get_balance(who.address) < GAS_FLOAT // 2:
            sender.send(deployer, {"to": who.address, "value": GAS_FLOAT, "gas": 21_000})
        sender.call(deployer, token.functions.mint(who.address, 3 * STAKE))
        sender.call(who, token.functions.approve(escrow_address, 2**256 - 1))
    say("maker and taker funded, minted and approved")

    owner = psycopg.connect(database_url(), autocommit=True)
    worker = psycopg.connect(database_url(), autocommit=True)
    worker.execute("set role settle_rw")  # the worker's own rights, as in production
    owner.execute("delete from settlement_outbox where claim_id not in (select id from claims where slug like 'e2e%')")

    deadline = chain_now(w3) + client.acceptance_closes + 180
    claims = {name: locked_claim(owner, deadline) for name in ("A", "B", "C")}
    run = run_once(worker, client, datetime.fromtimestamp(chain_now(w3), UTC))
    assert run.signed >= 3, f"the worker signed {run.signed} authorizations"
    say(f"the worker signed {run.signed} open authorizations")

    stakes = {}
    for name, claim in claims.items():
        auth, until = owner.execute(
            "select open_authorization, authorized_until from settlement_outbox where claim_id = %s",
            (claim["id"],)).fetchone()
        sender.call(maker, escrow.functions.open(
            claim_hash(claim["slug"]), deadline, int(until.timestamp()), bytes.fromhex(auth[2:]), True, STAKE))
        eventually(lambda c=claim: len(client.stakes_of(claim_hash(c["slug"]))), 1)
        stakes[name] = client.stakes_of(claim_hash(claim["slug"]))[0].id
        sender.call(taker, escrow.functions.accept(stakes[name]))
        eventually(lambda n=name: client.stake(stakes[n]).state, "Matched")
    say(f"three stakes opened by the maker on HIT and matched by the taker: {stakes}")
    maker_before = token.functions.balanceOf(maker.address).call()
    taker_before = token.functions.balanceOf(taker.address).call()

    wait_until(w3, deadline + 5, "the deadline")
    final_verdict(owner, claims["A"], "hit")
    final_verdict(owner, claims["B"], "void")
    for _ in range(6):  # C is never given a verdict: as far as it is concerned, the worker is stopped
        run_once(worker, client, datetime.fromtimestamp(chain_now(w3), UTC))
        states = dict(owner.execute(
            "select c.slug, o.state from settlement_outbox o join claims c on c.id = o.claim_id where c.id = any(%s)",
            ([claims["A"]["id"], claims["B"]["id"]],)).fetchall())
        if set(states.values()) == {"sent"}:
            break
        time.sleep(15)
    assert set(states.values()) == {"sent"}, f"outbox states {states}"
    eventually(lambda: client.stake(stakes["A"]).state, "Settled")
    eventually(lambda: client.stake(stakes["B"]).state, "Refunded")
    eventually(lambda: token.functions.balanceOf(maker.address).call(), maker_before + STAKE)
    eventually(lambda: token.functions.balanceOf(taker.address).call(), taker_before + STAKE)
    say("A settled HIT, nobody paid yet; B settled VOID and both sides already have their stake back")

    settled_at = int(w3.eth.get_block("latest")["timestamp"])
    try:  # asked, not sent: a refusal costs nothing
        escrow.functions.payout(stakes["A"]).call({"from": deployer.address})
        raise AssertionError("the contract would pay out inside the window")
    except ContractLogicError:
        say("a payout inside the window is refused, as it must be")
    wait_until(w3, settled_at + window + 5, "the end of A's window")
    sender.call(deployer, escrow.functions.payout(stakes["A"]))  # a third address: finality needs nobody
    eventually(lambda: token.functions.balanceOf(maker.address).call(), maker_before + 3 * STAKE)
    eventually(lambda: client.stake(stakes["A"]).state, "Paid")
    say("A paid out to the maker, triggered by a third address")

    wait_until(w3, deadline + client.timeout + 5, "C's timeout")
    sender.call(deployer, escrow.functions.refund(stakes["C"]))
    eventually(lambda: client.stake(stakes["C"]).state, "Refunded")
    eventually(lambda: token.functions.balanceOf(maker.address).call(), maker_before + 4 * STAKE)
    eventually(lambda: token.functions.balanceOf(taker.address).call(), taker_before + 2 * STAKE)
    say("C refunded both sides at the timeout, with no verdict and no worker")
    say("END TO END PASSED")


if __name__ == "__main__":
    main()
