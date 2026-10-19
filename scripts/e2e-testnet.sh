#!/usr/bin/env bash
# End to end on Base Sepolia (003 T337): deploy a throwaway minutes-scale escrow, then run three stakes through it.
#   scripts/e2e-testnet.sh
# The published deployment keeps the decision doc's hours and days; this one exists only to be waited out.
set -euo pipefail

cd "$(dirname "$0")/.."
keys="$HOME/.vaticeno-keys"
cast="$HOME/.foundry/bin/cast"
rpc="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
deployer_key="$(cat "$keys/deployer.key")"

export ORACLE_ADDRESS="$("$cast" wallet address "$(cat "$keys/oracle.key")")"
export GUARDIAN_ADDRESS="$("$cast" wallet address "$(cat "$keys/guardian.key")")"
export DEPLOYER_PRIVATE_KEY="$deployer_key"
export FEE_RECIPIENT_ADDRESS="$("$cast" wallet address "$deployer_key")"

out="$(cd contracts && "$HOME/.foundry/bin/forge" script script/Deploy.s.sol --sig "runEndToEnd()" \
  --rpc-url "$rpc" --broadcast)"
escrow="$(grep -o 'ESCROW_ADDRESS=0x[0-9a-fA-F]*' <<<"$out" | cut -d= -f2)"
token="$(grep -o 'STAKE_TOKEN_ADDRESS=0x[0-9a-fA-F]*' <<<"$out" | cut -d= -f2)"
echo "throwaway escrow $escrow, token $token"

exec .venv/bin/python scripts/e2e_testnet.py "$escrow" "$token"
