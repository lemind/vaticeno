#!/usr/bin/env bash
# Switch one v2 mainnet network on, in three separate steps (003 Story 6 scenario 6, T383, T384, T386):
#   deploy/network-on.sh root@HOST 8453 0xESCROW worker     its settlement worker, settling only: it signs nothing yet
#   deploy/network-on.sh root@HOST 8453 0xESCROW page       the wager page and the bot name the network
#   deploy/network-on.sh root@HOST 8453 0xESCROW authorize  the worker starts signing: wagers can open
#   deploy/network-on.sh root@HOST 8453 0xNEW replace       a network already on moves to a new, unused contract
# The market `42161-usdt` is Tether's USDT0 on Arbitrum One: its own contract, worker, oracle key and offers.
# Run after deploy/deploy.sh and the 0023 migration. Only this network's oracle key leaves this machine, copied once;
# the worker's database login and Sentry DSN are reused from the Stage 2 worker's env file on the server.
set -euo pipefail

HOST="${1:?usage: deploy/network-on.sh root@HOST MARKET ESCROW_ADDRESS worker|page|authorize}"
MARKET="${2:?market: 8453 (Base), 42161 (Arbitrum One) or 42161-usdt (USDT0 on Arbitrum One)}"
CHAIN="${MARKET%-usdt}"
ESCROW="${3:?the escrow address deploy-v2.sh printed}"
STEP="${4:?step: worker, page, authorize or replace}"
case "$MARKET" in
  8453) RPC="https://mainnet.base.org"; TOKEN="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" ;;
  42161) RPC="https://arb1.arbitrum.io/rpc"; TOKEN="0xaf88d065e77c8cC2239327C5EDb3A432268e5831" ;;
  42161-usdt) RPC="https://arb1.arbitrum.io/rpc"; TOKEN="0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" ;;
  *) echo "a mainnet market: 8453, 42161 or 42161-usdt" >&2; exit 1 ;;
esac
[[ "$ESCROW" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "not an address: $ESCROW" >&2; exit 1; }
DIR="/etc/vaticeno-settle/$MARKET"

worker() {
  local key="$HOME/.vaticeno-keys/$MARKET/oracle.key"
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
      echo NETWORK_KEY=$MARKET
      echo ESCROW_VERSION=2
      echo ORACLE_KEY_FILE=$DIR/oracle.key
      echo SIGN_AUTHORIZATIONS=0
    } | awk -F= '!seen[\$1]++' > $DIR/env
    chown vaticeno-settle:vaticeno-settle $DIR/env"
  # The Stage 2 worker restarts on the new code too: its heartbeat is `settle-84532` since 0023.
  ssh "$HOST" "systemctl restart vaticeno-settle && cp /opt/vaticeno/deploy/vaticeno-settle@.service /etc/systemd/system/ \
    && systemctl daemon-reload && systemctl enable --now vaticeno-settle@$MARKET && sleep 5 \
    && systemctl is-active vaticeno-settle vaticeno-settle@$MARKET"
}

# WAGER_NETWORKS names the Stage 2 testnet and this network, replacing the single-network variables (config.ts refuses
# both). The first run keeps .env.before-<chain>; every entry is checked before the bot restarts, and a bot that does
# not come back is put back on the old .env at once.
page() {
  ssh "$HOST" "set -euo pipefail; cd /opt/vaticeno
    get() { grep -E \"^\$1=\" .env | tail -1 | cut -d= -f2- | tr -d '\"'\"'\"' ' || true; }
    current=\$(get WAGER_NETWORKS)
    case \",\$current,\" in *\",$CHAIN:\"*\":$TOKEN,\"*) echo 'this market is already on the page' >&2; exit 1 ;; esac
    if [ -z \"\$current\" ]; then
      version=\$(get ESCROW_VERSION); current=\"\$(get ESCROW_CHAIN_ID):\${version:-1}:\$(get ESCROW_ADDRESS):\$(get STAKE_TOKEN_ADDRESS)\"
    fi
    next=\"\$current,$CHAIN:2:$ESCROW:$TOKEN\"
    for entry in \${next//,/ }; do
      [[ \"\$entry\" =~ ^[0-9]+:[12]:0x[0-9a-fA-F]{40}:0x[0-9a-fA-F]{40}\$ ]] || { echo \"refusing a bad entry: \$entry\" >&2; exit 1; }
    done
    [ -f .env.before-$MARKET ] || cp .env .env.before-$MARKET
    sed -i -E 's/^(ESCROW_ADDRESS|STAKE_TOKEN_ADDRESS|ESCROW_CHAIN_ID|ESCROW_VERSION|PUBLIC_RPC_URLS|WAGER_NETWORKS)=/# &/' .env
    echo \"WAGER_NETWORKS=\$next\" >> .env
    systemctl restart vaticeno; sleep 8
    if ! systemctl is-active --quiet vaticeno; then
      cp .env.before-$MARKET .env && systemctl restart vaticeno
      echo 'the bot did not start on the new .env: put back on the old one' >&2; exit 1
    fi
    grep '^WAGER_NETWORKS=' .env"
}

authorize() {
  ssh "$HOST" "set -e; sed -i 's/^SIGN_AUTHORIZATIONS=0\$/SIGN_AUTHORIZATIONS=1/' $DIR/env && grep -q '^SIGN_AUTHORIZATIONS=1\$' $DIR/env \
    && systemctl restart vaticeno-settle@$MARKET && sleep 5 && systemctl is-active vaticeno-settle@$MARKET"
}

# A contract's numbers never change, so changing one is a new contract (007-escrow-v2). The worker and the page move
# to it, and every authorization signed for the old one is cleared: it is bound to the old address, and the worker
# signs again on its next pass. Only for a contract nobody has staked on; the old one keeps running down otherwise.
replace() {
  ssh "$HOST" "set -euo pipefail
    old=\$(grep -E '^ESCROW_ADDRESS=' $DIR/env | cut -d= -f2)
    [ -n \"\$old\" ] && [ \"\${old,,}\" != \"${ESCROW,,}\" ] || { echo 'nothing to replace' >&2; exit 1; }
    sed -i \"s/^ESCROW_ADDRESS=.*/ESCROW_ADDRESS=$ESCROW/\" $DIR/env
    cd /opt/vaticeno; cp .env .env.before-replace-$MARKET
    sed -i -E \"/^WAGER_NETWORKS=/s/$CHAIN:2:\$old:/$CHAIN:2:$ESCROW:/I\" .env
    grep -q \"$CHAIN:2:$ESCROW:\" .env || { cp .env.before-replace-$MARKET .env; echo 'WAGER_NETWORKS not updated' >&2; exit 1; }
    sudo -u vaticeno-settle bash -c 'set -a; . $DIR/env; set +a; exec /opt/vaticeno/.venv/bin/python -c \"
import os, psycopg
with psycopg.connect(os.environ[\\\"DATABASE_URL_SETTLE\\\"], autocommit=True) as c:
    n = c.execute(\\\"update settlement_outbox set claim_hash = null, open_authorization = null, authorized_until = null where network = %s and state = %s\\\", (\\\"$MARKET\\\", \\\"open\\\")).rowcount
    print(n, \\\"authorizations cleared\\\")
\"'
    systemctl restart vaticeno-settle@$MARKET vaticeno; sleep 8
    systemctl is-active vaticeno-settle@$MARKET vaticeno
    grep '^WAGER_NETWORKS=' .env"
}

case "$STEP" in
  worker) worker; echo "market $MARKET: worker on, settling only" ;;
  page) page; echo "market $MARKET: on the page and in the bot's reply" ;;
  authorize) authorize; echo "market $MARKET: authorizations on, wagers can open" ;;
  replace) replace; echo "market $MARKET: moved to $ESCROW, authorizations signed again on the next pass" ;;
  *) echo "step: worker, page, authorize or replace" >&2; exit 1 ;;
esac
