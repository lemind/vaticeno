"""The Tron adapter against a stubbed `tronpy` client (spec 007 T706): no network. What it proves: the open
authorization is the EVM one with Tron's chain id and the contract's 20-byte address, a wrong key or chain stops the
worker, every send carries a fee limit, a refused call costs nothing, and running out of energy is a retry."""

from __future__ import annotations

import pytest
from eth_abi import encode
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak
from tronpy.exceptions import TransactionNotFound
from tronpy.keys import PrivateKey

from settle.chain import ChainMismatch, Stake
from settle.tron import FEE_LIMIT_SUN, TronEscrow, to_hex20

KEY = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"  # anvil's second dev key, not a secret
ORACLE = PrivateKey(bytes.fromhex(KEY)).public_key.to_base58check_address()
ESCROW = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"  # any valid address; the stub answers for it
CHAIN_ID = 3448148188


def domain_separator(chain_id: int, address: str) -> bytes:
    """Built here from the contract's own formula (EscrowV2._buildDomainSeparator), not from the adapter."""
    typehash = keccak(text="EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    return keccak(encode(["bytes32", "bytes32", "bytes32", "uint256", "address"],
                         [typehash, keccak(text="Vaticeno Escrow"), keccak(text="2"), chain_id, to_hex20(address)]))


class Builder:
    def __init__(self, log: list, name: str):
        self.log, self.name, self.limit = log, name, None

    def with_owner(self, owner):
        self.owner = owner
        return self

    def fee_limit(self, sun):
        self.limit = sun
        return self

    def build(self):
        return self

    def sign(self, key):
        return self

    def broadcast(self):
        self.log.append((self.name, self.owner, self.limit))
        return type("Sent", (), {"txid": "ab" * 32})()


class Functions:
    def __init__(self, sent: list, oracle: str, separator: bytes):
        self.sent = sent
        self.oracle = lambda: oracle
        self.domainSeparator = lambda: separator
        self.acceptanceCloses = lambda: 86_400
        self.timeout = lambda: 14 * 86_400
        self.settlementWindow = lambda: 72 * 3600
        self.stakes = lambda i: (b"\1" * 32, ORACLE, ORACLE, 10, 1_000, 2_000, 0, True, 2, 0)
        for name in ("settle", "payout", "refund", "expire"):
            setattr(self, name, lambda *args, _n=name: Builder(self.sent, _n))


class Client:
    def __init__(self, oracle=ORACLE, separator=None, would=True, info=None):
        self.sent: list = []
        self.contract = type("C", (), {})()
        self.contract.functions = Functions(self.sent, oracle, separator or domain_separator(CHAIN_ID, ESCROW))
        self.would, self.info = would, info
        self.provider = self

    def get_contract(self, address):
        return self.contract

    def make_request(self, path, body):
        return {"result": {"result": True}, "transaction": {"ret": [{} if self.would else {"ret": "FAILED"}]}}

    def get_transaction_info(self, txid):
        if self.info is None:
            raise TransactionNotFound("not found")
        return self.info

    def get_transaction(self, txid):
        raise TransactionNotFound("not found")


def escrow(client: Client) -> TronEscrow:
    return TronEscrow(client, ESCROW, CHAIN_ID, KEY)


def test_the_open_authorization_is_the_evm_one_with_trons_chain_id_and_recovers_to_the_oracle():
    e = escrow(Client())
    signature = e.sign_open(b"\1" * 32, 2_000_000_000, 1_999_000_000)
    message = encode_typed_data(full_message={
        "types": {
            "EIP712Domain": [{"name": "name", "type": "string"}, {"name": "version", "type": "string"},
                             {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"}],
            "OpenAuthorization": [{"name": "claimHash", "type": "bytes32"}, {"name": "deadline", "type": "uint64"},
                                  {"name": "validUntil", "type": "uint64"}],
        },
        "primaryType": "OpenAuthorization",
        "domain": {"name": "Vaticeno Escrow", "version": "2", "chainId": CHAIN_ID,
                   "verifyingContract": to_hex20(ESCROW)},
        "message": {"claimHash": b"\1" * 32, "deadline": 2_000_000_000, "validUntil": 1_999_000_000},
    })
    signer = Account.recover_message(message, signature=signature)
    assert to_hex20(ORACLE).lower() == signer.lower(), "the contract's ecrecover sees the oracle"


def test_a_wrong_key_or_a_wrong_chain_stops_the_worker():
    with pytest.raises(ChainMismatch, match="oracle"):
        escrow(Client(oracle="TCLBgkbfVkJroVBJVqBEsxtPNQEQMTQCLQ"))
    with pytest.raises(ChainMismatch, match="not escrow version 2"):
        escrow(Client(separator=domain_separator(728126428, ESCROW)))


def test_every_send_carries_the_fee_limit_and_a_refused_call_costs_nothing():
    client = Client()
    e = escrow(client)
    assert e.send_finish("payout", 7) == "0x" + "ab" * 32
    assert client.sent == [("payout", ORACLE, FEE_LIMIT_SUN)]
    refusing = Client(would=False)
    assert escrow(refusing).send_finish("refund", 7) is None
    assert refusing.sent == []


def test_out_of_energy_is_a_failure_to_retry_and_success_is_mined():
    with pytest.raises(RuntimeError, match="OUT_OF_ENERGY"):
        escrow(Client(info={"blockNumber": 5, "receipt": {"result": "OUT_OF_ENERGY"}})).wait_mined("0x01")
    paid = escrow(Client(info={"blockNumber": 5, "fee": 345_000, "receipt": {"result": "SUCCESS"}}))
    paid.wait_mined("0x01")
    assert paid.drain_costs() == [345_000] and paid.drain_costs() == []


def test_in_flight_only_while_known_and_not_in_a_block():
    assert escrow(Client(info={"blockNumber": None})).in_flight("0x01") is True
    assert escrow(Client(info=None)).in_flight("0x01") is False
    assert escrow(Client(info={"blockNumber": 9})).in_flight("0x01") is False


def test_the_contracts_own_rules_decide_what_is_due():
    e = escrow(Client())
    assert e.due_action(Stake(1, b"", 1_000, "Settled", settled_at=0), 72 * 3600) == "payout"
    assert e.due_action(Stake(1, b"", 1_000, "Matched"), 1_000 + 14 * 86_400) == "refund"
    assert e.due_action(Stake(1, b"", 1_000, "Open", offer_expiry=50), 49) is None
