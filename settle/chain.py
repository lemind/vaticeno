"""The escrow, as the settlement worker sees it (003 T333): read a stake, sign an open authorization, settle.

Nothing here can move funds except `settle`, and the contract itself refuses a second settlement (FR-026).
"""

from __future__ import annotations

from dataclasses import dataclass

from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_account.signers.local import LocalAccount
from web3 import Web3
from web3.contract import Contract

# Escrow.Outcome and Escrow.State, in the contract's own order.
OUTCOMES = {"hit": 1, "miss": 2, "void": 3}
STATES = ["None", "Open", "Matched", "Settled", "Paid", "Voided", "Refunded", "Expired"]
# A stake in one of these has had its verdict already, or never needed one.
SETTLED_STATES = {"Settled", "Paid", "Voided", "Refunded"}

# Only the functions the worker calls (contracts/src/Escrow.sol).
ESCROW_ABI = [
    {"type": "function", "name": "oracle", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "address"}]},
    {"type": "function", "name": "acceptanceCloses", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "uint64"}]},
    {"type": "function", "name": "timeout", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "uint64"}]},
    {"type": "function", "name": "stakesOf", "stateMutability": "view",
     "inputs": [{"name": "claimHash", "type": "bytes32"}], "outputs": [{"name": "", "type": "uint256[]"}]},
    {"type": "function", "name": "stakes", "stateMutability": "view",
     "inputs": [{"name": "", "type": "uint256"}],
     "outputs": [
         {"name": "claimHash", "type": "bytes32"}, {"name": "maker", "type": "address"},
         {"name": "taker", "type": "address"}, {"name": "amount", "type": "uint128"},
         {"name": "deadline", "type": "uint64"}, {"name": "offerExpiry", "type": "uint64"},
         {"name": "settledAt", "type": "uint64"}, {"name": "makerSaysHit", "type": "bool"},
         {"name": "state", "type": "uint8"}, {"name": "outcome", "type": "uint8"},
     ]},
    {"type": "function", "name": "settle", "stateMutability": "nonpayable",
     "inputs": [{"name": "id", "type": "uint256"}, {"name": "outcome", "type": "uint8"},
                {"name": "evidenceRef", "type": "bytes32"}], "outputs": []},
]


class ChainMismatch(Exception):
    """The chain, the contract or the key is not the one this worker was configured for (FR-028a)."""


def claim_hash(slug: str) -> bytes:
    """keccak-256 of the slug: the one place it is computed (data-model → settlement_outbox)."""
    return Web3.keccak(text=slug)


def evidence_ref(resolution_id: str) -> bytes:
    """What the chain records as the verdict's evidence: the hash of the resolution row's id."""
    return Web3.keccak(text=resolution_id)


@dataclass(frozen=True)
class Stake:
    id: int
    claim_hash: bytes
    deadline: int
    state: str


class Escrow:
    def __init__(self, w3: Web3, address: str, chain_id: int, account: LocalAccount):
        # Checked once at start, then before every send: a wrong chain or a wrong key stops the worker.
        if w3.eth.chain_id != chain_id:
            raise ChainMismatch(f"connected to chain {w3.eth.chain_id}, configured for {chain_id}")
        self.w3 = w3
        self.chain_id = chain_id
        self.account = account
        self.address = Web3.to_checksum_address(address)
        self.contract: Contract = w3.eth.contract(address=self.address, abi=ESCROW_ABI)
        oracle = self.contract.functions.oracle().call()
        if oracle != account.address:
            raise ChainMismatch(f"the contract's oracle is {oracle}, this key is {account.address}")
        self.acceptance_closes: int = self.contract.functions.acceptanceCloses().call()
        self.timeout: int = self.contract.functions.timeout().call()

    def sign_open(self, hash_: bytes, deadline: int, valid_until: int) -> str:
        """The EIP-712 authorization `Escrow.open` checks (FR-031a), bound to this contract and chain."""
        message = encode_typed_data(full_message={
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
                "name": "Vaticeno Escrow", "version": "1",
                "chainId": self.chain_id, "verifyingContract": self.address,
            },
            "message": {"claimHash": hash_, "deadline": deadline, "validUntil": valid_until},
        })
        return "0x" + Account.sign_message(message, self.account.key).signature.hex().removeprefix("0x")

    def stakes_of(self, hash_: bytes) -> list[Stake]:
        return [self.stake(int(i)) for i in self.contract.functions.stakesOf(hash_).call()]

    def stake(self, stake_id: int) -> Stake:
        row = self.contract.functions.stakes(stake_id).call()
        return Stake(id=stake_id, claim_hash=bytes(row[0]), deadline=int(row[4]), state=STATES[row[8]])

    def settle(self, stake: Stake, outcome: str, evidence: bytes) -> str:
        """Settle one stake and wait for it. The worker builds this itself from the claim and the verdict;
        it never signs a payload it was handed (FR-028a)."""
        if self.w3.eth.chain_id != self.chain_id:
            raise ChainMismatch("the chain changed under the worker")
        current = self.stake(stake.id)
        if current.state != "Matched" or current.claim_hash != stake.claim_hash:
            raise ChainMismatch(f"stake {stake.id} is {current.state}, not the matched stake that was read")
        tx = self.contract.functions.settle(stake.id, OUTCOMES[outcome], evidence).build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address, "pending"),
            "chainId": self.chain_id,
        })
        if Web3.to_checksum_address(tx["to"]) != self.address:
            raise ChainMismatch("the transaction is not addressed to the escrow")
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt["status"] != 1:
            raise RuntimeError(f"settle of stake {stake.id} reverted in {tx_hash.hex()}")
        return "0x" + tx_hash.hex().removeprefix("0x")
