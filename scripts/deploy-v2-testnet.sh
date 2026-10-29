#!/usr/bin/env bash
# Deploy escrow v2 and its blocking test USDC to one testnet, source verified publicly (003 T379).
#   scripts/deploy-v2-testnet.sh 84532|421614 [end-to-end]
# Keys come from ~/.vaticeno-keys/<chain id>/ (deployer, oracle, guardian), never the Stage 2 ones the v1 worker
# uses; ETHERSCAN_API_KEY from .env (one key covers both explorers). DeployV2.s.sol refuses any mainnet.
set -euo pipefail

cd "$(dirname "$0")/.."
chain="${1:?chain id: 84532 (Base Sepolia) or 421614 (Arbitrum Sepolia)}"
entry="run()"
[ "${2:-}" = "end-to-end" ] && entry="runEndToEnd()"
case "$chain" in
  84532) rpc="${RPC_URL:-https://sepolia.base.org}" ;;
  421614) rpc="${RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}" ;;
  *) echo "testnets only: 84532 or 421614" >&2; exit 1 ;;
esac
keys="$HOME/.vaticeno-keys/$chain"
forge="$HOME/.foundry/bin/forge"
cast="$HOME/.foundry/bin/cast"

api_key="$(grep -E '^ETHERSCAN_API_KEY=' .env | cut -d= -f2- || true)"
if [ -z "$api_key" ]; then
  echo "ETHERSCAN_API_KEY is missing from .env (https://etherscan.io/myapikey)" >&2
  exit 1
fi
for role in deployer oracle guardian; do
  [ -f "$keys/$role.key" ] || { echo "missing $keys/$role.key" >&2; exit 1; }
done

deployer_key="$(cat "$keys/deployer.key")"
deployer="$("$cast" wallet address "$deployer_key")"
if [ "$("$cast" balance "$deployer" --rpc-url "$rpc")" = "0" ]; then
  echo "the deployer $deployer has no ETH on chain $chain yet: fund it from a faucet first" >&2
  exit 1
fi

export ORACLE_ADDRESS="$("$cast" wallet address "$(cat "$keys/oracle.key")")"
export GUARDIAN_ADDRESS="$("$cast" wallet address "$(cat "$keys/guardian.key")")"
export DEPLOYER_PRIVATE_KEY="$deployer_key"
export FEE_RECIPIENT_ADDRESS="$deployer"

cd contracts
"$forge" script script/DeployV2.s.sol --sig "$entry" \
  --rpc-url "$rpc" --broadcast \
  --verify --etherscan-api-key "$api_key" --chain "$chain"
