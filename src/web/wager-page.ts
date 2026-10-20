// GET /claim/:slug/wager (003 Story 5): the claim, the escrow's terms and the verdict's settlement, rendered
// here; the wagers themselves are read from the chain in the browser, since Node makes no chain calls (FR-027).
import { eq } from 'drizzle-orm';
import { renderStatement } from '../contract/render.js';
import { ContractSchema } from '../contract/schema.js';
import type { Db } from '../db/client.js';
import { claims, resolutions, settlementOutbox } from '../db/schema.js';
import {
  OFFER_LIFETIME_MS,
  SETTLEMENT_WINDOW_MS,
  TIMEOUT_MS,
  wageringClosesAt,
} from '../wager/terms.js';
import { html, jsonData, layout, utc } from './html.js';

export type WagerConfig = {
  escrow: string;
  token: string;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorer: string;
};

const POLICY_URL =
  'https://github.com/lemind/vaticeno/blob/main/docs/settlement-policy.md';
const HOURS = (ms: number) => ms / 3_600_000;

// What the settlement row's state means to someone holding a wager (data-model → settlement_outbox).
const SETTLEMENT_WORDS: Record<string, string> = {
  open: 'no verdict yet',
  pending: 'verdict confirmed by a second price read; being written to the chain',
  held: 'the second price read disagreed, so nothing settles: matched wagers refund at the timeout',
  sent: 'written to the chain',
  no_stake: 'no matched wager to settle',
  failed: 'not settled by the referee: matched wagers refund at the timeout',
};

export async function wagerPage(
  db: Db,
  slug: string,
  now: Date,
  config: WagerConfig | null,
): Promise<string | null> {
  const [claim] = await db
    .select()
    .from(claims)
    .where(eq(claims.slug, slug))
    .limit(1);
  if (!claim?.contract) return null;
  const contract = ContractSchema.parse(claim.contract);
  const [[outbox], [resolution]] = await Promise.all([
    db
      .select()
      .from(settlementOutbox)
      .where(eq(settlementOutbox.claimId, claim.id))
      .limit(1),
    db.select().from(resolutions).where(eq(resolutions.claimId, claim.id)).limit(1),
  ]);
  const deadline = new Date(contract.deadline_at);
  const closes = wageringClosesAt(deadline);
  const statement = renderStatement(contract);
  const head = html`<p class="muted">
      <a href="/claim/${claim.slug}">#${claim.slug}</a> · wager
    </p>
    <h1>${statement}</h1>
    <p class="notice">
      <strong>Testnet only.</strong> Wagers use VTS, a test token with no value, on
      the Base Sepolia test network. Nothing here is real money.
    </p>`;

  if (contract.resolution_method !== 'price_feed')
    return layout(
      `#${claim.slug} · wager`,
      html`${head}
        <p>
          This claim can't carry a wager: only claims decided by a price feed can.
        </p>`,
    );
  if (!config)
    return layout(
      `#${claim.slug} · wager`,
      html`${head}
        <p>Wagering is not switched on here.</p>`,
    );

  // Served only while acceptance is open; the contract enforces the expiry either way (FR-046).
  const authorization =
    outbox?.openAuthorization &&
    outbox.authorizedUntil &&
    now < outbox.authorizedUntil
      ? outbox.openAuthorization
      : null;
  const final = resolution?.reviewStatus === 'final' ? resolution : null;
  const opening =
    claim.status === 'draft'
      ? html`Wagering opens when the claim locks, ${utc(claim.lockAt)}.`
      : claim.status === 'locked' && now < closes && !authorization
        ? html`Wagering opens shortly: the referee is signing this claim's
          permission.`
        : html`Wagering is closed for new offers.`;

  const body = html`${head}
    <h2>Terms</h2>
    <dl>
      <dt>HIT means</dt>
      <dd>${contract.criterion}</dd>
      <dt>MISS means</dt>
      <dd>${contract.negative_condition}</dd>
      <dt>Decided by</dt>
      <dd>${contract.source.name}, daily UTC close</dd>
      <dt>Deadline</dt>
      <dd>${utc(deadline)}</dd>
      <dt>Wagering closes</dt>
      <dd>${utc(closes)}, 24 hours before the deadline</dd>
      <dt>An offer</dt>
      <dd>
        expires after ${HOURS(OFFER_LIFETIME_MS) / 24} days, or when wagering closes
        if sooner; then anyone can return it to its maker
      </dd>
      <dt>The winner gets</dt>
      <dd id="payout-rule">twice the stake, minus the fee set at deployment</dd>
      <dt>Largest stake</dt>
      <dd id="max-stake">read from the chain</dd>
      <dt>Payout hold</dt>
      <dd>
        ${HOURS(SETTLEMENT_WINDOW_MS)} hours after the verdict reaches the chain.
        During it the referee can void its own mistake, which refunds both sides.
        After it anyone can pay out.
        <a href="${POLICY_URL}" rel="noopener">Settlement policy</a>
      </dd>
      <dt>No settlement</dt>
      <dd>
        if no verdict reaches the chain within ${HOURS(TIMEOUT_MS) / 24} days of the
        deadline, anyone can refund both sides
      </dd>
    </dl>
    <p class="muted">
      Anyone can make an offer on any claim, so a wager is not the author's own.
      Wallets are shown by address.
    </p>

    <h2>Verdict</h2>
    <dl>
      <dt>Vaticeno's verdict</dt>
      <dd>
        ${final ? (final.outcome ?? '').toUpperCase() : resolution ? 'waiting for a human decision' : 'not yet'}
      </dd>
      <dt>On the chain</dt>
      <dd>${SETTLEMENT_WORDS[outbox?.state ?? 'open']}</dd>
    </dl>

    <h2>Wagers</h2>
    <p id="paused" class="notice" hidden>
      New offers and accepts are paused by the referee. Every way out still works:
      payout, refund and returning an expired offer.
    </p>
    <p id="chain-error" class="notice" hidden></p>
    <p id="wager-count" class="muted">Reading the chain…</p>
    <noscript
      ><p>
        The wagers are read from the chain in your browser, which needs JavaScript.
      </p></noscript
    >
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Wager</th>
            <th>Stake</th>
            <th>Maker</th>
            <th>Taker</th>
            <th>State</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="wagers"></tbody>
      </table>
    </div>

    <div id="wallet-panel" hidden>
      <h2>Your wallet</h2>
      <p>
        <button type="button" id="connect">Connect wallet</button>
        <span id="balance" class="muted"></span>
      </p>
      <p class="muted">
        Your own wallet signs every step and pays its network fee. Base Sepolia test
        ETH comes from a faucet; VTS from the operator.
      </p>
      <form id="offer" hidden>
        <p>
          <label><input type="radio" name="side" value="hit" checked /> HIT</label>
          <label><input type="radio" name="side" value="miss" /> MISS</label>
        </p>
        <p>
          <label
            >Amount (VTS)
            <input id="amount" name="amount" inputmode="decimal" required
          /></label>
          <button type="submit">Make an offer</button>
        </p>
        <p class="muted">
          Your wallet asks first to approve exactly this amount, if needed, then to
          open the offer.
        </p>
      </form>
      <p id="offer-closed" class="muted">${opening}</p>
      <p id="tx-status" aria-live="polite"></p>
    </div>
    ${jsonData('wager-data', {
      escrow: config.escrow,
      token: config.token,
      chainId: config.chainId,
      chainName: config.chainName,
      rpcUrl: config.rpcUrl,
      explorer: config.explorer,
      claimHash: outbox?.claimHash ?? null,
      // The claim's own deadline column, the number the worker signed with (settle/worker.py).
      deadline: Math.floor((claim.deadlineAt ?? deadline).getTime() / 1000),
      validUntil: outbox?.authorizedUntil
        ? Math.floor(outbox.authorizedUntil.getTime() / 1000)
        : null,
      authorization,
    })}`;
  return layout(`#${claim.slug} · wager`, body, { script: '/assets/wallet.js' });
}
