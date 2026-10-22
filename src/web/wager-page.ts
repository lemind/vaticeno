// GET /claim/:slug/wager (003 Story 5): the claim, the escrow's terms and the verdict's settlement, rendered
// here; the wagers themselves are read from the chain in the browser, since Node makes no chain calls (FR-027).
import { eq } from 'drizzle-orm';
import { renderStatement } from '../contract/render.js';
import { ContractSchema } from '../contract/schema.js';
import type { Db } from '../db/client.js';
import { claims, corrections, resolutions, settlementOutbox } from '../db/schema.js';
import { wagerKind } from '../wager/terms.js';
import { html, jsonData, layout, utc } from './html.js';

export type WagerConfig = {
  escrow: string;
  token: string;
  chainId: number;
  chainName: string;
  rpcUrls: string[];
  explorer: string;
};

const POLICY_URL =
  'https://github.com/lemind/vaticeno/blob/main/docs/settlement-policy.md';

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
  const [[outbox], [resolution], [correction]] = await Promise.all([
    db
      .select()
      .from(settlementOutbox)
      .where(eq(settlementOutbox.claimId, claim.id))
      .limit(1),
    db.select().from(resolutions).where(eq(resolutions.claimId, claim.id)).limit(1),
    db.select().from(corrections).where(eq(corrections.claimId, claim.id)).limit(1),
  ]);
  const deadline = new Date(contract.deadline_at);
  // The same rule the bot answers by (src/wager/terms.ts).
  const kind = wagerKind({ ...claim, outbox: outbox ?? null }, now);
  // The close the worker signed, from the contract's own acceptanceCloses; none until it has signed.
  const closes = outbox?.authorizedUntil ?? null;
  const statement = renderStatement(contract);
  const head = html`<p class="muted">
      <a href="/claim/${claim.slug}">#${claim.slug}</a> · wager
    </p>
    <h1>${statement}</h1>
    <p class="notice">
      <strong>Testnet only.</strong> Wagers use VTS, a test token with no value, on
      the Base Sepolia test network. Nothing here is real money.
    </p>`;

  if (kind === 'not_price')
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
  // A corrected verdict is what holds now, as on the claim page (001 FR-035).
  const verdict = correction?.toOutcome ?? final?.outcome ?? null;
  // Until the script has read the chain it claims nothing; it replaces this line or hides it (FR-043).
  const opening =
    kind === 'not_locked'
      ? html`Wagering opens when the claim locks, ${utc(claim.lockAt)}.`
      : kind === 'closed'
        ? html`Wagering is closed for new offers.`
        : authorization
          ? html`Reading the chain…`
          : html`Wagering opens shortly: the referee is signing this claim's
            permission.`;

  const body = html`${head}
    <h2>Terms</h2>
    <dl>
      <dt>HIT means</dt>
      <dd>${contract.criterion}</dd>
      <dt>MISS means</dt>
      <dd>${contract.negative_condition}</dd>
      <dt>Contract</dt>
      <dd>
        <a
          href="${config.explorer}/address/${config.escrow}#code"
          rel="noopener"
          target="_blank"
          >the escrow on Basescan</a
        >, source code verified ·
        <a
          href="${config.explorer}/token/${config.token}"
          rel="noopener"
          target="_blank"
          >the VTS token</a
        >
        <br /><span class="muted"
          >Check any wager there: Read Contract → <code>stakes(number)</code>.
          Addresses in the table link to their own pages.</span
        >
      </dd>
      <dt>Decided by</dt>
      <dd>${contract.source.name}, daily UTC close</dd>
      <dt>Deadline</dt>
      <dd>${utc(deadline)}</dd>
      <dt>Wagering closes</dt>
      <dd>${closes ? utc(closes) : 'set when the referee signs this claim'}</dd>
      <dt>An offer</dt>
      <dd>
        expires <span id="offer-lifetime">after a fixed time</span>, or when wagering
        closes if sooner; then anyone can return it to its maker
      </dd>
      <dt>The winner gets</dt>
      <dd id="payout-rule">twice the stake, minus the fee set at deployment</dd>
      <dt>Largest stake</dt>
      <dd id="max-stake">read from the chain</dd>
      <dt>Payout hold</dt>
      <dd>
        <span id="hold">A fixed time</span> after the verdict reaches the chain.
        During it the referee can void its own mistake, which refunds both sides.
        After it anyone can pay out.
        <a href="${POLICY_URL}" rel="noopener">Settlement policy</a>
      </dd>
      <dt>No settlement</dt>
      <dd>
        if no verdict reaches the chain within
        <span id="timeout">a fixed time</span> of the deadline, anyone can refund
        both sides
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
        ${verdict ? verdict.toUpperCase() : resolution ? 'waiting for a human decision' : 'not yet'}${correction ? html` <span class="muted">corrected</span>` : ''}
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
        <button type="button" id="connect" class="primary">Connect wallet</button>
        <span id="balance" class="muted"></span>
      </p>
      <p class="muted">
        Your own wallet signs every step and pays its network fee. Base Sepolia test
        ETH comes from a faucet; VTS from the operator.
      </p>
      <form id="offer" class="offer" hidden>
        <fieldset class="side">
          <legend>Your side</legend>
          <label class="pick hit"
            ><input type="radio" name="side" value="hit" checked /><span
              >HIT</span
            ></label
          >
          <label class="pick miss"
            ><input type="radio" name="side" value="miss" /><span>MISS</span></label
          >
        </fieldset>
        <label class="field" for="amount">
          <span>Stake</span>
          <span class="amount">
            <input
              id="amount"
              name="amount"
              inputmode="decimal"
              placeholder="10"
              autocomplete="off"
              required
            />
            <span class="unit">VTS</span>
          </span>
        </label>
        <button type="submit" class="primary">Make an offer</button>
        <p class="muted hint">
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
      rpcUrls: config.rpcUrls,
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
