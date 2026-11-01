#!/usr/bin/env bash
# Deploy escrow v2 to one network, source verified publicly (003 T379, T383).
#   scripts/deploy-v2.sh 84532|421614 [end-to-end]   testnet, with a blocking test USDC
#   scripts/deploy-v2.sh 8453|42161                  mainnet, native USDC: asks you to type the network's name first
# Keys from ~/.vaticeno-keys/<chain id>/ (scripts/make-v2-wallets.py), never the Stage 2 ones the v1 worker uses;
# ETHERSCAN_API_KEY from .env (one key covers both explorers).
set -euo pipefail

cd "$(dirname "$0")/.."
chain="${1:?chain id: 84532 (Base Sepolia) or 421614 (Arbitrum Sepolia)}"
entry="run()"
[ "${2:-}" = "end-to-end" ] && entry="runEndToEnd()"
case "$chain" in
  84532) rpc="${RPC_URL:-https://sepolia.base.org}" ;;
  421614) rpc="${RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}" ;;
  8453) rpc="${RPC_URL:-https://mainnet.base.org}"; entry="runMainnet()"; name="Base" ;;
  42161) rpc="${RPC_URL:-https://arb1.arbitrum.io/rpc}"; entry="runMainnet()"; name="Arbitrum One" ;;
  *) echo "a chain id: 84532, 421614, 8453 or 42161" >&2; exit 1 ;;
esac
if [ "$entry" = "runMainnet()" ]; then
  # Real money gets committed source only: what is verified on the explorer is a commit anyone can check out (T383).
  if ! git diff --quiet HEAD -- contracts/src contracts/script contracts/foundry.toml; then
    echo "contracts/ has uncommitted changes: commit them first, nothing deployed" >&2; exit 1
  fi
  echo "deploying commit $(git rev-parse --short HEAD)"
  read -r -p "Deploy the real-money escrow on $name? Type $name to go on: " answer
  [ "$answer" = "$name" ] || { echo "stopped: nothing deployed" >&2; exit 1; }
fi
keys="$HOME/.vaticeno-keys/$chain"
forge="$HOME/.foundry/bin/forge"
cast="$HOME/.foundry/bin/cast"

api_key="$(grep -E '^ETHERSCAN_API_KEY=' .env | cut -d= -f2- || true)"
if [ -z "$api_key" ]; then
  echo "ETHERSCAN_API_KEY is missing from .env (https://etherscan.io/myapikey)" >&2
  exit 1
fi
for role in deployer oracle guardian fee; do
  [ -f "$keys/$role.key" ] || { echo "missing $keys/$role.key" >&2; exit 1; }
done

# An address from its key file, the key read by Python, never put on a command line where `ps` would show it.
address_of() { .venv/bin/python -c 'import sys; from eth_account import Account; print(Account.from_key(open(sys.argv[1]).read().strip()).address)' "$1"; }

deployer="$(address_of "$keys/deployer.key")"
if [ "$("$cast" balance "$deployer" --rpc-url "$rpc")" = "0" ]; then
  echo "the deployer $deployer has no ETH on chain $chain yet: fund it from a faucet first" >&2
  exit 1
fi

# Assigned first, exported after: `export X="$(…)"` would hide a failed lookup from `set -e`.
oracle="$(address_of "$keys/oracle.key")"
guardian="$(address_of "$keys/guardian.key")"
fee="$(address_of "$keys/fee.key")"
deployer_key="$(cat "$keys/deployer.key")"
export ORACLE_ADDRESS="$oracle" GUARDIAN_ADDRESS="$guardian" FEE_RECIPIENT_ADDRESS="$fee"
export DEPLOYER_PRIVATE_KEY="$deployer_key"

cd contracts
"$forge" script script/DeployV2.s.sol --sig "$entry" \
  --rpc-url "$rpc" --broadcast \
  --verify --etherscan-api-key "$api_key" --chain "$chain"
