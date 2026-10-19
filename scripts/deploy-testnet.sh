#!/usr/bin/env bash
# Deploy the test token and the escrow to Base Sepolia, source verified publicly (003 T330).
#   scripts/deploy-testnet.sh
# Keys come from ~/.vaticeno-keys (scripts/make-testnet-wallets.py); ETHERSCAN_API_KEY from .env. Testnet only:
# Deploy.s.sol itself refuses any chain but 84532.
set -euo pipefail

cd "$(dirname "$0")/.."
keys="$HOME/.vaticeno-keys"
forge="$HOME/.foundry/bin/forge"
cast="$HOME/.foundry/bin/cast"
rpc="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"

api_key="$(grep -E '^ETHERSCAN_API_KEY=' .env | cut -d= -f2- || true)"
if [ -z "$api_key" ]; then
  echo "ETHERSCAN_API_KEY is missing from .env (https://etherscan.io/myapikey)" >&2
  exit 1
fi

deployer_key="$(cat "$keys/deployer.key")"
deployer="$("$cast" wallet address "$deployer_key")"
balance="$("$cast" balance "$deployer" --rpc-url "$rpc")"
if [ "$balance" = "0" ]; then
  echo "the deployer $deployer has no Base Sepolia ETH yet: fund it from the faucet first" >&2
  exit 1
fi

export ORACLE_ADDRESS="$("$cast" wallet address "$(cat "$keys/oracle.key")")"
export GUARDIAN_ADDRESS="$("$cast" wallet address "$(cat "$keys/guardian.key")")"
export DEPLOYER_PRIVATE_KEY="$deployer_key"
export FEE_RECIPIENT_ADDRESS="$deployer"

cd contracts
"$forge" script script/Deploy.s.sol \
  --rpc-url "$rpc" --broadcast \
  --verify --etherscan-api-key "$api_key" --chain 84532
