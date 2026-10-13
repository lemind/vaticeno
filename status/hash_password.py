"""Print the two lines to put in the server's .env.status (003 US1).

    .venv/bin/python -m status.hash_password

The password is typed, never passed as an argument, so it does not land in shell history.
"""

from __future__ import annotations

from getpass import getpass
from secrets import token_urlsafe

from status.auth import hash_password


def main() -> None:
    password = getpass("status page password: ")
    if len(password) < 12:
        raise SystemExit("use at least 12 characters: this is the only lock on the page")
    if password != getpass("again: "):
        raise SystemExit("they did not match")
    print()
    print(f"STATUS_PASSWORD_HASH={hash_password(password)}")
    print(f"STATUS_SECRET={token_urlsafe(32)}")
    print()
    print("Append both to /opt/vaticeno/.env.status (mode 600) and restart vaticeno-status.")
    print("Changing STATUS_SECRET signs everyone out.")


if __name__ == "__main__":
    main()
