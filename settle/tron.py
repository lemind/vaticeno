"""The escrow on Tron, as the settlement worker sees it (spec 007, ADR 010): the same calls as `settle.chain.Escrow`,
sent through `tronpy` instead of web3. The open authorization is signed exactly as on EVM (EIP-712 with Tron's
chain id and the contract's 20-byte address), and checked by the contract's own `ecrecover`.

What differs on Tron: addresses are `T…` on the wire, the sender pays in energy and bandwidth (burned TRX, capped by
`fee_limit`), and a transaction that runs out of energy is mined as failed, never as a verdict.
"""

from __future__ import annotations

import os
import time

from eth_abi import encode
from eth_account import Account
from eth_account.messages import encode_typed_data
from tronpy import Tron
from tronpy.exceptions import TransactionNotFound
from tronpy.keys import PrivateKey, to_base58check_address, to_hex_address

from settle.chain import ESCROW_ABI, OUTCOMES, STATES, ChainMismatch, Holdings, Stake

# The most TRX one worker transaction may burn, in sun (1 TRX = 1,000,000 sun). UNRECONCILED until T711a estimates
# each call against mainnet; Tron's HTTP API defaults the limit to 0, so it is always set (ADR 010).
FEE_LIMIT_SUN = int(os.environ.get("TRON_FEE_LIMIT_SUN", str(100 * 1_000_000)))
CONFIRM_SECONDS = 120
# Dollars per TRX for the cost rows: the worker calls no price service (003 FR-028). UNRECONCILED; set in its env.
TRX_USD = float(os.environ.get("TRX_USD", "0.25"))


def to_hex20(address: str) -> str:
    """`T…` or `41…` → `0x…` (20 bytes), the form EIP-712 and the outbox use."""
    return "0x" + to_hex_address(address)[2:]


class TronEscrow:
    def __init__(self, client: Tron, address: str, chain_id: int, key: str, version: int = 2,
                 network: str | None = None):
        if version != 2:
            raise ChainMismatch("only escrow version 2 runs on Tron")
        self.client = client
        self.chain_id = chain_id
        self.version = version
        self.key = PrivateKey(bytes.fromhex(key.removeprefix("0x")))
        self.owner = self.key.public_key.to_base58check_address()
        self.address = to_base58check_address(address)
        self.hex_address = to_hex20(self.address)
        self.contract = client.get_contract(self.address)
        self.contract.abi = ESCROW_ABI
        oracle = to_base58check_address(self.contract.functions.oracle())
        if oracle != self.owner:
            raise ChainMismatch(f"the contract's oracle is {oracle}, this key is {self.owner}")
        # The domain carries the chain id the contract reads from `block.chainid`: a wrong one signs nothing valid.
        if self._typed(b"\0" * 32, 0, 0).header != bytes(self.contract.functions.domainSeparator()):
            raise ChainMismatch(f"the contract at {self.address} is not escrow version 2 on chain {chain_id}")
        self.network = network or f"{chain_id}-usdt"
        if self.network.split("-")[0] != str(chain_id):
            raise ChainMismatch(f"market {self.network} is not on chain {chain_id}")
        self._token = None
        self.acceptance_closes: int = int(self.contract.functions.acceptanceCloses())
        self.timeout: int = int(self.contract.functions.timeout())
        self.settlement_window: int = int(self.contract.functions.settlementWindow())
        self._spent_sun: list[int] = []  # TRX burned per mined transaction, failed ones too; the worker records them

    def sign_open(self, hash_: bytes, deadline: int, valid_until: int) -> str:
        message = self._typed(hash_, deadline, valid_until)
        signed = Account.sign_message(message, "0x" + self.key.hex())
        return "0x" + signed.signature.hex().removeprefix("0x")

    def _typed(self, hash_: bytes, deadline: int, valid_until: int):
        return encode_typed_data(full_message={
            "types": {
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
                "OpenAuthorization": [
                    {"name": "claimHash", "type": "bytes32"},
                    {"name": "deadline", "type": "uint64"},
                    {"name": "validUntil", "type": "uint64"},
                ],
            },
            "primaryType": "OpenAuthorization",
            "domain": {
                "name": "Vaticeno Escrow", "version": str(self.version),
                "chainId": self.chain_id, "verifyingContract": self.hex_address,
            },
            "message": {"claimHash": hash_, "deadline": deadline, "validUntil": valid_until},
        })

    def stakes_of(self, hash_: bytes) -> list[Stake]:
        return [self.stake(int(i)) for i in self.contract.functions.stakesOf(hash_)]

    def stake(self, stake_id: int) -> Stake:
        row = self.contract.functions.stakes(stake_id)
        return Stake(id=stake_id, claim_hash=bytes(row[0]), deadline=int(row[4]), state=STATES[row[8]],
                     offer_expiry=int(row[5]), settled_at=int(row[6]))

    def send_settle(self, stake: Stake, outcome: str, evidence: bytes) -> str:
        current = self.stake(stake.id)
        if current.state != "Matched" or current.claim_hash != stake.claim_hash:
            raise ChainMismatch(f"stake {stake.id} is {current.state}, not the matched stake that was read")
        return self._send(self.contract.functions.settle(stake.id, OUTCOMES[outcome], evidence))

    def chain_time(self) -> int:
        block = self.client.get_latest_block()
        return int(block["block_header"]["raw_data"]["timestamp"]) // 1000

    def due_action(self, stake: Stake, now: int) -> str | None:
        # The same rules as settle.chain.Escrow.due_action: the contract's own.
        if stake.state == "Settled" and now >= stake.settled_at + self.settlement_window:
            return "payout"
        if stake.state == "Matched" and now >= stake.deadline + self.timeout:
            return "refund"
        if stake.state == "Open" and now >= stake.offer_expiry:
            return "expire"
        return None

    def send_finish(self, action: str, stake_id: int) -> str | None:
        """Asked first with a constant call, sent only if the contract would accept it: a refused call costs no TRX."""
        if not self._would_succeed(f"{action}(uint256)", encode(["uint256"], [stake_id])):
            return None
        return self._send(getattr(self.contract.functions, action)(stake_id))

    def wait_mined(self, tx_hash: str) -> None:
        """Mined and succeeded. OUT_OF_ENERGY or a revert raises, so the worker retries next run (ADR 010)."""
        deadline = time.monotonic() + CONFIRM_SECONDS
        while True:
            try:
                info = self.client.get_transaction_info(tx_hash.removeprefix("0x"))
                if info.get("blockNumber") is not None:
                    break
            except TransactionNotFound:
                pass
            if time.monotonic() > deadline:
                raise RuntimeError(f"{tx_hash} not mined after {CONFIRM_SECONDS}s")
            time.sleep(3)
        self._spent_sun.append(int(info.get("fee", 0)))  # energy and bandwidth, burned even when the call failed
        result = info.get("receipt", {}).get("result", "SUCCESS")
        if result != "SUCCESS":
            raise RuntimeError(f"{tx_hash} failed on chain: {result}")

    def drain_costs(self) -> list[int]:
        spent, self._spent_sun = self._spent_sun, []
        return spent

    def in_flight(self, tx_hash: str) -> bool:
        txid = tx_hash.removeprefix("0x")
        try:
            return self.client.get_transaction_info(txid).get("blockNumber") is None
        except TransactionNotFound:
            try:
                self.client.get_transaction(txid)
                return True  # broadcast, not yet in a block
            except TransactionNotFound:
                return False

    def holdings(self) -> Holdings:
        """The oracle's TRX (in sun, in the gas column), the escrow's USDT, and what it owes."""
        if self._token is None:
            self._token = self.client.get_contract(to_base58check_address(self.contract.functions.token()))
        trx = self.client.get_account_balance(self.owner)
        return Holdings(
            oracle_gas_wei=int(trx * 1_000_000),
            escrow_usdc=int(self._token.functions.balanceOf(self.address)),
            owed_usdc=int(self.contract.functions.lockedTotal()) + int(self.contract.functions.creditTotal()),
        )

    def _send(self, call) -> str:
        # The call comes from `self.contract`, bound to the escrow's address at start: it can be sent nowhere else.
        sent = call.with_owner(self.owner).fee_limit(FEE_LIMIT_SUN).build().sign(self.key).broadcast()
        return "0x" + sent.txid

    def _would_succeed(self, signature: str, parameter: bytes) -> bool:
        reply = self.client.provider.make_request("wallet/triggerconstantcontract", {
            "owner_address": self.owner,
            "contract_address": self.address,
            "function_selector": signature,
            "parameter": parameter.hex(),
            "visible": True,
        })
        if not reply.get("result", {}).get("result"):
            return False
        ret = reply.get("transaction", {}).get("ret") or [{}]
        return ret[0].get("ret") != "FAILED"
