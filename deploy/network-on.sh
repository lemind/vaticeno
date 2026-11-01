#!/usr/bin/env bash
# Switch one v2 mainnet network on, in three separate steps (003 Story 6 scenario 6, T383, T384, T386):
#   deploy/network-on.sh root@HOST 8453 0xESCROW worker     its settlement worker, settling only: it signs nothing yet
#   deploy/network-on.sh root@HOST 8453 0xESCROW page       the wager page and the bot name the network
#   deploy/network-on.sh root@HOST 8453 0xESCROW authorize  the worker starts signing: wagers can open
# Run after deploy/deploy.sh and the 0023 migration. Only this network's oracle key leaves this machine, copied once;
# the worker's database login and Sentry DSN are reused from the Stage 2 worker's env file on the server.
set -euo pipefail

HOST="${1:?usage: deploy/network-on.sh root@HOST CHAIN_ID ESCROW_ADDRESS worker|page|authorize}"
CHAIN="${2:?chain id: 8453 (Base) or 42161 (Arbitrum One)}"
ESCROW="${3:?the escrow address deploy-v2.sh printed}"
STEP="${4:?step: worker, page or authorize}"
case "$CHAIN" in
  8453) RPC="https://mainnet.base.org"; USDC="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" ;;
  42161) RPC="https://arb1.arbitrum.io/rpc"; USDC="0xaf88d065e77c8cC2239327C5EDb3A432268e5831" ;;
  *) echo "a mainnet chain id: 8453 or 42161" >&2; exit 1 ;;
esac
[[ "$ESCROW" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "not an address: $ESCROW" >&2; exit 1; }
DIR="/etc/vaticeno-settle/$CHAIN"

worker() {
  local key="$HOME/.vaticeno-keys/$CHAIN/oracle.key"
  [ -f "$key" ] || { echo "missing $key" >&2; exit 1; }
  ssh "$HOST" "install -d -m 700 -o vaticeno-settle -g vaticeno-settle $DIR"
  scp -q "$key" "$HOST:$DIR/oracle.key"
  ssh "$HOST" "chown vaticeno-settle:vaticeno-settle $DIR/oracle.key && chmod 600 $DIR/oracle.key"
  # The env file: the database login and Sentry from the Stage 2 worker's, the rest this network's; no signing yet.
  ssh "$HOST" "set -e; umask 077
    { grep -E '^(DATABASE_URL_SETTLE|SENTRY_DSN)=' /etc/vaticeno-settle/env || true
      grep -E '^SENTRY_DSN=' /opt/vaticeno/.env || true
      echo RPC_URL=$RPC
      echo ESCROW_ADDRESS=$ESCROW
      echo ESCROW_CHAIN_ID=$CHAIN
      echo ESCROW_VERSION=2
      echo ORACLE_KEY_FILE=$DIR/oracle.key
      echo SIGN_AUTHORIZATIONS=0
    } | awk -F= '!seen[\$1]++' > $DIR/env
    chown vaticeno-settle:vaticeno-settle $DIR/env"
  # The Stage 2 worker restarts on the new code too: its heartbeat is `settle-84532` since 0023.
  ssh "$HOST" "systemctl restart vaticeno-settle && cp /opt/vaticeno/deploy/vaticeno-settle@.service /etc/systemd/system/ \
    && systemctl daemon-reload && systemctl enable --now vaticeno-settle@$CHAIN && sleep 5 \
    && systemctl is-active vaticeno-settle vaticeno-settle@$CHAIN"
}

# WAGER_NETWORKS names the Stage 2 testnet and this network, replacing the single-network variables (config.ts refuses
# both). The first run keeps .env.before-<chain>; every entry is checked before the bot restarts, and a bot that does
# not come back is put back on the old .env at once.
page() {
  ssh "$HOST" "set -euo pipefail; cd /opt/vaticeno
    get() { grep -E \"^\$1=\" .env | tail -1 | cut -d= -f2- | tr -d '\"'\"'\"' ' || true; }
    current=\$(get WAGER_NETWORKS)
    case \",\$current,\" in *\",$CHAIN:\"*) echo 'this network is already on the page' >&2; exit 1 ;; esac
    if [ -z \"\$current\" ]; then
      version=\$(get ESCROW_VERSION); current=\"\$(get ESCROW_CHAIN_ID):\${version:-1}:\$(get ESCROW_ADDRESS):\$(get STAKE_TOKEN_ADDRESS)\"
    fi
    next=\"\$current,$CHAIN:2:$ESCROW:$USDC\"
    for entry in \${next//,/ }; do
      [[ \"\$entry\" =~ ^[0-9]+:[12]:0x[0-9a-fA-F]{40}:0x[0-9a-fA-F]{40}\$ ]] || { echo \"refusing a bad entry: \$entry\" >&2; exit 1; }
    done
    [ -f .env.before-$CHAIN ] || cp .env .env.before-$CHAIN
    sed -i -E 's/^(ESCROW_ADDRESS|STAKE_TOKEN_ADDRESS|ESCROW_CHAIN_ID|ESCROW_VERSION|PUBLIC_RPC_URLS|WAGER_NETWORKS)=/# &/' .env
    echo \"WAGER_NETWORKS=\$next\" >> .env
    systemctl restart vaticeno; sleep 8
    if ! systemctl is-active --quiet vaticeno; then
      cp .env.before-$CHAIN .env && systemctl restart vaticeno
      echo 'the bot did not start on the new .env: put back on the old one' >&2; exit 1
    fi
    grep '^WAGER_NETWORKS=' .env"
}

authorize() {
  ssh "$HOST" "set -e; sed -i 's/^SIGN_AUTHORIZATIONS=0\$/SIGN_AUTHORIZATIONS=1/' $DIR/env && grep -q '^SIGN_AUTHORIZATIONS=1\$' $DIR/env \
    && systemctl restart vaticeno-settle@$CHAIN && sleep 5 && systemctl is-active vaticeno-settle@$CHAIN"
}

case "$STEP" in
  worker) worker; echo "network $CHAIN: worker on, settling only" ;;
  page) page; echo "network $CHAIN: on the page and in the bot's reply" ;;
  authorize) authorize; echo "network $CHAIN: authorizations on, wagers can open" ;;
  *) echo "step: worker, page or authorize" >&2; exit 1 ;;
esac
