"""Create one network's escrow v2 wallets (003 T378, docs/decisions/007-escrow-v2.md): deployer, oracle, guardian, fee.

    .venv/bin/python scripts/make-v2-wallets.py 84532|421614|8453|42161|42161-usdt|3448148188|728126428-usdt

Tron (spec 007): the same kind of key; its address is printed in Tron's own form (`T…`).

Each key is written to ~/.vaticeno-keys/<chain id>/<role>.key, readable by its owner alone, and never printed: only
the addresses are. An existing key is never overwritten. On a mainnet these hold real money or real power: back
the folder up offline; the guardian and fee keys never go to the server, only the oracle's does.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from eth_account import Account
from tronpy.keys import to_base58check_address

NETWORKS = {"84532": "Base Sepolia", "421614": "Arbitrum Sepolia", "8453": "Base", "42161": "Arbitrum One",
            "42161-usdt": "Arbitrum One, USDT0", "3448148188": "Tron Nile", "728126428-usdt": "Tron, USDT"}
TRON = {"3448148188", "728126428-usdt"}  # the folder is the market's name, as deploy/network-on.sh reads it
ROLES = (
    ("deployer", "pays gas for the deploy; no power after it"),
    ("oracle", "the server's key: records verdicts; needs a little ETH for gas"),
    ("guardian", "yours alone, kept offline: pauses new stakes, voids a wrong verdict"),
    ("fee", "the fee recipient, fixed for the contract's life (the fee is 0)"),
)


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in NETWORKS:
        sys.exit(f"usage: make-v2-wallets.py {'|'.join(NETWORKS)}")
    chain = sys.argv[1]
    root = Path.home() / ".vaticeno-keys"
    folder = root / chain
    for path in (root, folder):
        path.mkdir(mode=0o700, exist_ok=True)
        os.chmod(path, 0o700)
    print(f"{NETWORKS[chain]} ({chain}), keys in {folder}")
    for role, what in ROLES:
        path = folder / f"{role}.key"
        if not path.exists():
            key = Account.create().key.hex()
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as file:
                file.write(key if key.startswith("0x") else "0x" + key)
        address = Account.from_key(path.read_text().strip()).address
        shown = to_base58check_address("41" + address[2:]) if chain in TRON else address
        print(f"  {role:9} {shown}  {what.replace('ETH', 'TRX') if chain in TRON else what}")


if __name__ == "__main__":
    main()
