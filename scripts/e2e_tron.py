"""End to end for escrow v2 on Tron Nile (spec 007 T711), with Tether's test USDT, whose `transfer` returns false
when it worked. Three wagers on the minutes-scale deployment `scripts/deploy-tron.py 3448148188 end-to-end` made:

    A  HIT, paid out after the hold        B  VOID, both refunded at once        C  an offer nobody took, returned

Settled and finished by the worker's own Tron adapter (`settle.tron.TronEscrow`), as production would. The proof is
that every exit lands in a wallet and nothing is left as a credit: the escrow ends holding nothing, owing nothing.

    .venv/bin/python scripts/e2e_tron.py <escrow T…>        # about 20 minutes; keys from ~/.vaticeno-keys/3448148188
    .venv/bin/python scripts/e2e_tron.py <escrow T…> <test token T…>
        # the blocked path, on `deploy-tron.py 3448148188 end-to-end-blocked`: the maker frozen at the verdict waits as
        # a credit while the taker is paid; unfrozen, the maker withdraws it (SC-025). About 8 minutes.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from eth_account import Account
from tronpy import Tron
from tronpy.exceptions import AddressNotFound
from tronpy.keys import PrivateKey, to_base58check_address

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from settle.tron import TronEscrow  # noqa: E402

CHAIN = 3448148188
USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"
KEYS = Path.home() / ".vaticeno-keys" / str(CHAIN)
UNIT = 10**6
AMOUNT = 1 * UNIT
FEE = 200 * UNIT  # the most one call here may burn
MAX = 2**256 - 1
TOKEN_ABI = [
    {"type": "function", "name": n, "stateMutability": m, "inputs": i, "outputs": o}
    for n, m, i, o in [
        ("balanceOf", "view", [{"name": "a", "type": "address"}], [{"name": "", "type": "uint256"}]),
        ("allowance", "view", [{"name": "o", "type": "address"}, {"name": "s", "type": "address"}],
         [{"name": "", "type": "uint256"}]),
        ("approve", "nonpayable", [{"name": "s", "type": "address"}, {"name": "v", "type": "uint256"}],
         [{"name": "", "type": "bool"}]),
        ("transfer", "nonpayable", [{"name": "t", "type": "address"}, {"name": "v", "type": "uint256"}],
         [{"name": "", "type": "bool"}]),
        ("mint", "nonpayable", [{"name": "t", "type": "address"}, {"name": "v", "type": "uint256"}], []),
        ("setBlocked", "nonpayable", [{"name": "a", "type": "address"}, {"name": "b", "type": "bool"}], []),
    ]
]
USER_ABI = [
    {"type": "function", "name": "open", "stateMutability": "nonpayable", "outputs": [{"name": "", "type": "uint256"}],
     "inputs": [{"name": "claimHash", "type": "bytes32"}, {"name": "deadline", "type": "uint64"},
                {"name": "validUntil", "type": "uint64"}, {"name": "signature", "type": "bytes"},
                {"name": "makerSaysHit", "type": "bool"}, {"name": "amount", "type": "uint128"}]},
    {"type": "function", "name": "accept", "stateMutability": "nonpayable", "outputs": [],
     "inputs": [{"name": "id", "type": "uint256"}]},
    {"type": "function", "name": "stakesOf", "stateMutability": "view", "outputs": [{"name": "", "type": "uint256[]"}],
     "inputs": [{"name": "claimHash", "type": "bytes32"}]},
    {"type": "function", "name": "lockedTotal", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"type": "function", "name": "creditTotal", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"type": "function", "name": "creditOf", "stateMutability": "view", "inputs": [{"name": "a", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"type": "function", "name": "withdraw", "stateMutability": "nonpayable", "inputs": [], "outputs": []},
]


def say(text: str) -> None:
    print(time.strftime("%H:%M:%S"), text, flush=True)


def key(role: str) -> str:
    path = KEYS / f"{role}.key"
    if not path.exists():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as file:
            file.write("0x" + Account.create().key.hex().removeprefix("0x"))
    return path.read_text().strip()


class Wallet:
    def __init__(self, client: Tron, role: str):
        self.key = PrivateKey(bytes.fromhex(key(role).removeprefix("0x")))
        self.address = self.key.public_key.to_base58check_address()
        self.client = client

    def send(self, call, what: str) -> dict:
        result = call.with_owner(self.address).fee_limit(FEE).build().sign(self.key).broadcast().wait()
        outcome = result.get("receipt", {}).get("result", "SUCCESS")
        say(f"  {what}: {outcome}, burned {result.get('fee', 0) / UNIT} TRX, "
            f"energy {result.get('receipt', {}).get('energy_usage_total', 0)}")
        if outcome != "SUCCESS":
            raise SystemExit(f"{what} failed")
        return result


def main() -> None:
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    if len(sys.argv) == 3:
        return blocked(to_base58check_address(sys.argv[1]), to_base58check_address(sys.argv[2]))
    client = Tron(network="nile")
    escrow_address = to_base58check_address(sys.argv[1])
    oracle = TronEscrow(client, escrow_address, CHAIN, key("oracle"), 2, str(CHAIN))
    usdt = client.get_contract(USDT)
    usdt.abi = TOKEN_ABI
    escrow = client.get_contract(escrow_address)
    escrow.abi = USER_ABI
    deployer, maker, taker = (Wallet(client, r) for r in ("deployer", "e2e-maker", "e2e-taker"))
    balance = lambda w: usdt.functions.balanceOf(w.address)  # noqa: E731

    say("funding the two sides from the deployer")
    for w in (maker, taker):
        try:
            trx = client.get_account_balance(w.address)
        except AddressNotFound:  # a new address exists on chain only once something is sent to it
            trx = 0
        if trx < 60:
            deployer.send(client.trx.transfer(deployer.address, w.address, 80 * UNIT), f"80 TRX to {w.address}")
        if balance(w) < 3 * AMOUNT:
            deployer.send(usdt.functions.transfer(w.address, 5 * AMOUNT), f"5 test USDT to {w.address}")
        if usdt.functions.allowance(w.address, escrow_address) < 3 * AMOUNT:
            w.send(usdt.functions.approve(escrow_address, MAX), f"{w.address} approves once, for all stakes")

    now = oracle.chain_time()
    deadline = now + 6 * 60
    valid_until = deadline - oracle.acceptance_closes
    stakes = {}
    for name in ("A", "B", "C"):
        claim = bytes.fromhex(os.urandom(32).hex())
        signature = bytes.fromhex(oracle.sign_open(claim, deadline, valid_until).removeprefix("0x"))
        maker.send(escrow.functions.open(claim, deadline, valid_until, signature, True, AMOUNT), f"{name}: open")
        stakes[name] = (claim, int(escrow.functions.stakesOf(claim)[-1]))
    for name in ("A", "B"):
        taker.send(escrow.functions.accept(stakes[name][1]), f"{name}: accept")
    start = {w.address: balance(w) for w in (maker, taker)}

    say(f"waiting for the deadline ({deadline - oracle.chain_time()} s)")
    while oracle.chain_time() < deadline:
        time.sleep(10)
    for name, outcome in (("A", "hit"), ("B", "void")):
        tx = oracle.send_settle(oracle.stake(stakes[name][1]), outcome, os.urandom(32))
        oracle.wait_mined(tx)
        say(f"  {name}: settled {outcome} by the oracle, {tx}")
    a_settled = oracle.stake(stakes["A"][1])
    finish_at = max(a_settled.settled_at + oracle.settlement_window, oracle.stake(stakes["C"][1]).offer_expiry)
    say(f"waiting for A's hold and C's expiry ({finish_at - oracle.chain_time()} s)")
    while oracle.chain_time() < finish_at:
        time.sleep(15)
    for name in ("A", "C"):
        stake = oracle.stake(stakes[name][1])
        action = oracle.due_action(stake, oracle.chain_time())
        tx = oracle.send_finish(action, stake.id)
        oracle.wait_mined(tx)
        say(f"  {name}: {action} by the worker's adapter, {tx}")

    got = {w.address: balance(w) - start[w.address] for w in (maker, taker)}
    held = usdt.functions.balanceOf(escrow_address)
    owed = escrow.functions.lockedTotal() + escrow.functions.creditTotal()
    say(f"maker received {got[maker.address] / UNIT} USDT, taker {got[taker.address] / UNIT}")
    say(f"escrow holds {held / UNIT} USDT, owes {owed / UNIT} (credits {escrow.functions.creditTotal() / UNIT})")
    assert got[maker.address] == 2 * AMOUNT + AMOUNT + AMOUNT, "A's pot, B's refund and C's returned offer"
    assert got[taker.address] == AMOUNT, "B's refund"
    assert held == 0 and owed == 0, "every exit left as a payment, none as a credit"
    say(f"PASSED; the worker burned {sum(oracle.drain_costs()) / UNIT} TRX on 4 transactions")


def blocked(escrow_address: str, token_address: str) -> None:
    client = Tron(network="nile")
    oracle = TronEscrow(client, escrow_address, CHAIN, key("oracle"), 2, str(CHAIN))
    token = client.get_contract(token_address)
    token.abi = TOKEN_ABI
    escrow = client.get_contract(escrow_address)
    escrow.abi = USER_ABI
    deployer, maker, taker = (Wallet(client, r) for r in ("deployer", "e2e-maker", "e2e-taker"))
    say("the two sides get test tokens and approve once")
    for w in (maker, taker):
        try:
            trx = client.get_account_balance(w.address)
        except AddressNotFound:
            trx = 0
        if trx < 30:
            deployer.send(client.trx.transfer(deployer.address, w.address, 40 * UNIT), f"40 TRX to {w.address}")
        deployer.send(token.functions.mint(w.address, 2 * AMOUNT), f"2 test tokens to {w.address}")
        w.send(token.functions.approve(escrow_address, MAX), f"{w.address} approves once")
    deadline = oracle.chain_time() + 4 * 60
    valid_until = deadline - oracle.acceptance_closes
    claim = os.urandom(32)
    signature = bytes.fromhex(oracle.sign_open(claim, deadline, valid_until).removeprefix("0x"))
    maker.send(escrow.functions.open(claim, deadline, valid_until, signature, True, AMOUNT), "open")
    stake_id = int(escrow.functions.stakesOf(claim)[-1])
    taker.send(escrow.functions.accept(stake_id), "accept")
    start = {w.address: token.functions.balanceOf(w.address) for w in (maker, taker)}
    say(f"waiting for the deadline ({deadline - oracle.chain_time()} s)")
    while oracle.chain_time() < deadline:
        time.sleep(10)
    deployer.send(token.functions.setBlocked(maker.address, True), "the token freezes the maker")
    tx = oracle.send_settle(oracle.stake(stake_id), "void", os.urandom(32))
    oracle.wait_mined(tx)
    say(f"  VOID settled by the oracle, {tx}")
    got_taker = token.functions.balanceOf(taker.address) - start[taker.address]
    credit = escrow.functions.creditOf(maker.address)
    say(f"taker paid {got_taker / UNIT}; the frozen maker credited {credit / UNIT}, paid "
        f"{(token.functions.balanceOf(maker.address) - start[maker.address]) / UNIT}")
    assert got_taker == AMOUNT, "the frozen maker never holds up the taker"
    assert credit == AMOUNT, "the maker's refund waits as one credit"
    deployer.send(token.functions.setBlocked(maker.address, False), "the token unfreezes the maker")
    maker.send(escrow.functions.withdraw(), "the maker withdraws")
    assert token.functions.balanceOf(maker.address) - start[maker.address] == AMOUNT, "withdrawn in full"
    assert token.functions.balanceOf(escrow_address) == 0 and escrow.functions.creditTotal() == 0
    say("PASSED: frozen side credited once, other side paid, the credit withdrawn, the escrow empty")


if __name__ == "__main__":
    main()
