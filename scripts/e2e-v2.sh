#!/usr/bin/env bash
# End to end for escrow v2 on Base Sepolia (003 T373): deploy a throwaway minutes-scale v2, then run four wagers.
#   scripts/e2e-v2.sh
# The published deployment keeps 007's hours and days; this one exists only to be waited out. Not verified.
set -euo pipefail

cd "$(dirname "$0")/.."
keys="$HOME/.vaticeno-keys/84532"
rpc="${RPC_URL:-https://sepolia.base.org}"

for role in deployer oracle guardian fee; do
  [ -f "$keys/$role.key" ] || { echo "missing $keys/$role.key: run scripts/make-v2-wallets.py 84532" >&2; exit 1; }
done
# Addresses from the key files, read by Python, never on a command line; assigned first so `set -e` sees a failure.
address_of() { .venv/bin/python -c 'import sys; from eth_account import Account; print(Account.from_key(open(sys.argv[1]).read().strip()).address)' "$1"; }
oracle="$(address_of "$keys/oracle.key")"
guardian="$(address_of "$keys/guardian.key")"
fee="$(address_of "$keys/fee.key")"
deployer_key="$(cat "$keys/deployer.key")"
export ORACLE_ADDRESS="$oracle" GUARDIAN_ADDRESS="$guardian" FEE_RECIPIENT_ADDRESS="$fee"
export DEPLOYER_PRIVATE_KEY="$deployer_key"

out="$(cd contracts && "$HOME/.foundry/bin/forge" script script/DeployV2.s.sol --sig "runEndToEnd()" \
  --rpc-url "$rpc" --broadcast)"
entry="$(grep -o '84532:2:0x[0-9a-fA-F]*:0x[0-9a-fA-F]*' <<<"$out" | head -1 || true)"
[ -n "$entry" ] || { echo "the deploy printed no address: $out" >&2; exit 1; }
escrow="$(cut -d: -f3 <<<"$entry")"
token="$(cut -d: -f4 <<<"$entry")"
echo "throwaway escrow $escrow, token $token"

exec .venv/bin/python scripts/e2e_v2.py "$escrow" "$token"
