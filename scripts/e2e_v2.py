"""End to end for escrow v2 on Base Sepolia (003 T373): four wagers on a minutes-scale throwaway deployment, settled
by the real worker code against the local database, every exit taken out with `withdraw()`.

Nobody presses anything: the worker returns D's untaken offer, settles A and B, pays A out after the hold and
refunds C at the timeout, every payment straight to a wallet. While the token freezes the maker, the maker's money
waits as a credit and the taker is paid as usual (SC-025); unfrozen, the maker withdraws it.

    scripts/e2e-v2.sh        # deploys the throwaway contracts, then runs this (about 35 minutes)
"""

from __future__ import annotations

import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import psycopg
from eth_account import Account
from web3 import Web3
from web3.exceptions import ContractLogicError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from e2e_testnet import (  # noqa: E402
    CHAIN_ID,
    Sender,
    chain_now,
    database_url,
    eventually,
    final_verdict,
    locked_claim,
    say,
    wait_until,
)

from settle.alerts import Alerts  # noqa: E402
from settle.chain import Escrow, claim_hash  # noqa: E402
from settle.health import record_health  # noqa: E402
from settle.worker import run_once  # noqa: E402

RPC = os.environ.get("RPC_URL", "https://sepolia.base.org")
KEYS = Path.home() / ".vaticeno-keys" / str(CHAIN_ID)
USDC = 10**6
STAKE = 10 * USDC
GAS_FLOAT = Web3.to_wei(0.000012, "ether")  # a top-up when under half: ~25 transactions at 0.006 gwei, measured

TOKEN_ABI = [
    {"type": "function", "name": f, "stateMutability": "nonpayable", "outputs": [],
     "inputs": [{"name": "a", "type": "address"}, {"name": "b", "type": t}]}
    for f, t in (("mint", "uint256"), ("setBlocked", "bool"))
] + [
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
] + [
    {"type": "function", "name": name, "stateMutability": "nonpayable",
     "inputs": [{"name": "id", "type": "uint256"}], "outputs": []}
    for name in ("accept", "payout", "refund", "expire")
] + [
    {"type": "function", "name": "withdraw", "stateMutability": "nonpayable", "inputs": [], "outputs": []},
    {"type": "function", "name": "creditOf", "stateMutability": "view",
     "inputs": [{"name": "", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"type": "function", "name": "settlementWindow", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "uint64"}]},
]


def key(role: str) -> Account:
    path = KEYS / f"{role}.key"
    if not path.exists():
        if not role.startswith("e2e-"):  # a real role's key is made by make-v2-wallets.py, never here
            raise SystemExit(f"missing {path}: run scripts/make-v2-wallets.py {CHAIN_ID}")
        # the two throwaway staking wallets, made on first run
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as file:
            file.write("0x" + Account.create().key.hex().removeprefix("0x"))
    return Account.from_key(path.read_text().strip())


def main() -> None:
    escrow_address, token_address = sys.argv[1], sys.argv[2]
    w3 = Web3(Web3.HTTPProvider(RPC))
    assert w3.eth.chain_id == CHAIN_ID, "not Base Sepolia"
    deployer, oracle, maker, taker = key("deployer"), key("oracle"), key("e2e-maker"), key("e2e-taker")
    sender = Sender(w3)
    escrow = w3.eth.contract(address=escrow_address, abi=ESCROW_ABI)
    token = w3.eth.contract(address=token_address, abi=TOKEN_ABI)
    client = Escrow(w3, escrow_address, CHAIN_ID, oracle, version=2)  # the worker's own client, version 2
    window = escrow.functions.settlementWindow().call()
    credit = lambda who: escrow.functions.creditOf(who.address).call()  # noqa: E731
    balance = lambda who: token.functions.balanceOf(who.address).call()  # noqa: E731
    say(f"escrow {escrow_address}, hold {window}s, timeout {client.timeout}s")

    for who in (oracle, maker, taker):
        if w3.eth.get_balance(who.address) < GAS_FLOAT // 2:
            sender.send(deployer, {"to": who.address, "value": GAS_FLOAT, "gas": 21_000})
    for who in (maker, taker):
        sender.call(deployer, token.functions.mint(who.address, 5 * STAKE))
        sender.call(who, token.functions.approve(escrow_address, 2**256 - 1))
    say("oracle, maker and taker have gas; maker and taker minted and approved")

    owner = psycopg.connect(database_url(), autocommit=True)
    worker = psycopg.connect(database_url(), autocommit=True)
    worker.execute("set role settle_rw")  # the worker's own rights, as in production
    owner.execute("delete from settlement_outbox where claim_id not in (select id from claims where slug like 'e2e%')")

    deadline = chain_now(w3) + client.acceptance_closes + 240
    claims = {name: locked_claim(owner, deadline) for name in ("A", "B", "C", "D")}
    run = run_once(worker, client, datetime.fromtimestamp(chain_now(w3), UTC))
    assert run.signed >= 4, f"the worker signed {run.signed} authorizations"
    say(f"the worker signed {run.signed} version-2 authorizations")

    stakes = {}
    for name, claim in claims.items():
        auth, until = owner.execute(
            "select open_authorization, authorized_until from settlement_outbox where claim_id = %s",
            (claim["id"],)).fetchone()
        sender.call(maker, escrow.functions.open(
            claim_hash(claim["slug"]), deadline, int(until.timestamp()), bytes.fromhex(auth[2:]), True, STAKE))
        eventually(lambda c=claim: len(client.stakes_of(claim_hash(c["slug"]))), 1)
        stakes[name] = client.stakes_of(claim_hash(claim["slug"]))[0].id
        if name != "D":
            sender.call(taker, escrow.functions.accept(stakes[name]))
            eventually(lambda n=name: client.stake(stakes[n]).state, "Matched")
    say(f"A, B, C opened by the maker on HIT and matched by the taker; D left open: {stakes}")
    maker_before, taker_before = balance(maker), balance(taker)

    run = lambda: run_once(worker, client, datetime.fromtimestamp(chain_now(w3), UTC))  # noqa: E731

    wait_until(w3, deadline + 5, "the deadline (D's offer has expired by now)")
    # SC-025: the token freezes the maker before anything is paid back.
    sender.call(deployer, token.functions.setBlocked(maker.address, True))
    final_verdict(owner, claims["A"], "hit")
    final_verdict(owner, claims["B"], "void")
    for _ in range(6):  # C is never given a verdict: as far as it is concerned, the worker is stopped
        run()
        states = {s for (s,) in owner.execute(
            "select state from settlement_outbox where claim_id = any(%s)",
            ([claims["A"]["id"], claims["B"]["id"]],)).fetchall()}
        if states == {"sent"} and client.stake(stakes["D"]).state == "Expired":
            break
        time.sleep(15)
    assert states == {"sent"}, f"outbox states {states}"
    eventually(lambda: client.stake(stakes["D"]).state, "Expired")
    eventually(lambda: client.stake(stakes["A"]).state, "Settled")
    eventually(lambda: client.stake(stakes["B"]).state, "Refunded")
    say("the worker alone: D's untaken offer returned, A settled HIT, B settled VOID")

    eventually(lambda: balance(taker), taker_before + STAKE)  # B's stake, straight to the taker's wallet
    eventually(lambda: credit(maker), 2 * STAKE)  # D's and B's, refused by the token: waiting for the maker
    try:
        escrow.functions.withdraw().call({"from": maker.address})
        raise AssertionError("a frozen maker could withdraw")
    except ContractLogicError:
        say("the frozen maker's money waits as a credit; the taker was paid straight to the wallet")
    sender.call(deployer, token.functions.setBlocked(maker.address, False))
    sender.call(maker, escrow.functions.withdraw())
    eventually(lambda: (credit(maker), balance(maker)), (0, maker_before + 2 * STAKE))
    say("unfrozen, the maker withdrew both credits")

    record_health(worker, client, datetime.now(UTC), Alerts(None))
    owed = owner.execute("select escrow_usdc, owed_usdc from network_health where network = %s",
                         (str(CHAIN_ID),)).fetchone()
    assert owed[0] == owed[1], f"the escrow holds {owed[0]} and owes {owed[1]}"
    say(f"health row: the escrow holds exactly what it owes ({owed[0] / USDC:g} USDC)")

    settled_at = client.stake(stakes["A"]).settled_at
    wait_until(w3, settled_at + window + 5, "the end of A's hold")
    eventually(lambda: (run(), client.stake(stakes["A"]).state)[1], "Paid")
    eventually(lambda: balance(maker), maker_before + 4 * STAKE)  # the pot, straight to the winner
    say("A paid out by the worker, the pot straight into the maker's wallet: nobody pressed anything")

    wait_until(w3, deadline + client.timeout + 5, "C's timeout")
    eventually(lambda: (run(), client.stake(stakes["C"]).state)[1], "Refunded")
    eventually(lambda: balance(maker), maker_before + 5 * STAKE)  # D 1, B 1, A 2, C 1
    eventually(lambda: balance(taker), taker_before + 2 * STAKE)  # B 1, C 1
    eventually(lambda: (credit(maker), credit(taker)), (0, 0))
    say("C refunded by the worker at the timeout; both have everything back in their wallets")
    say("END TO END PASSED")


if __name__ == "__main__":
    main()
