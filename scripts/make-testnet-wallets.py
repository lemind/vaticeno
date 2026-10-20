"""Create the three Base Sepolia wallets for the testnet escrow (003 T330): deployer, oracle, guardian.

    .venv/bin/python scripts/make-testnet-wallets.py

Each key is written to ~/.vaticeno-keys/<role>.key, readable by its owner alone, and never printed: only the
addresses are. An existing key is never overwritten. Testnet only: these wallets hold nothing of value.
"""

from __future__ import annotations

import os
from pathlib import Path

from eth_account import Account

KEYS = Path.home() / ".vaticeno-keys"
ROLES = ("deployer", "oracle", "guardian")


def main() -> None:
    KEYS.mkdir(mode=0o700, exist_ok=True)
    os.chmod(KEYS, 0o700)
    for role in ROLES:
        path = KEYS / f"{role}.key"
        if not path.exists():
            key = Account.create().key.hex()
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as file:
                file.write(key if key.startswith("0x") else "0x" + key)
        print(f"{role:9} {Account.from_key(path.read_text().strip()).address}")


if __name__ == "__main__":
    main()
