// GET / — the public front page: is it running, what version, how many claims and verdicts. Operational
// detail (spend, which job, verdicts we know are wrong) stays on the private status page (003 FR-004).
import { count, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { claims, jobState, resolutions } from '../db/schema.js';
import { VERSION } from '../version.js';
import { html, layout, safeHref, utc } from './html.js';

export type Health = { ok: boolean };

// Red when a job has missed its own window or its last run failed. A job that has never run is not red:
// after a deploy every job is in that state until its slot comes round, and a weekly one for days.
export async function publicHealth(db: Db, now: Date): Promise<Health> {
  // Nine rows: cheaper to decide here than to express the window comparison in SQL.
  const rows = await db
    .select({
      lastOkAt: jobState.lastOkAt,
      lastOutcome: jobState.lastOutcome,
      staleAfterSeconds: jobState.staleAfterSeconds,
    })
    .from(jobState);
  const watched = rows.filter((row) => row.lastOkAt !== null);
  const late = watched.filter(
    (row) =>
      row.lastOutcome === 'failed' ||
      now.getTime() - row.lastOkAt!.getTime() > row.staleAfterSeconds * 1000,
  );
  return { ok: late.length === 0 };
}

export async function homePage(
  db: Db,
  now: Date,
  handle = 'vaticeno',
): Promise<string> {
  const [health, claimRows, verdictRows] = await Promise.all([
    publicHealth(db, now),
    db.select({ n: count() }).from(claims).where(isNotNull(claims.contract)),
    db
      .select({ outcome: resolutions.outcome, n: count() })
      .from(resolutions)
      .where(eq(resolutions.reviewStatus, 'final'))
      .groupBy(resolutions.outcome),
  ]);

  const claimCount = claimRows[0]?.n ?? 0;
  const byOutcome = new Map(
    verdictRows.map((row) => [row.outcome ?? 'undecided', row.n]),
  );
  const verdictCount = verdictRows.reduce((total, row) => total + row.n, 0);

  const bot = profile(handle);
  return layout(
    'Vaticeno',
    html` <h1>Vaticeno</h1>
      <p>
        Predictions on X, written down and checked. Tag ${bot} under a prediction — a
        price, a match, an election, a follower count — and it records the terms:
        what counts as YES, the deadline, the source that decides it, and what would
        count as NO. You have 15 minutes to correct them; after that the terms lock
        and cannot be changed, by you or the bot. After the deadline it checks the
        public record and posts the verdict, HIT, MISS or VOID, in the same thread,
        with the result it was decided on.
      </p>
      <p class="muted">
        Every prediction and verdict has its own page here, and so does everyone who
        made one.
      </p>

      <h2>How to use</h2>
      <ol class="steps">
        <li>
          Post your prediction and tag ${bot} in it, or reply ${bot} under your own
          post.
        </li>
        <li>
          It replies <strong>RECORDED</strong> with the terms it extracted. You have
          15 minutes to correct them: reply in the thread with the correction.
        </li>
        <li>
          Then the terms lock. Nobody can change them after that, the bot included.
        </li>
        <li>
          After the deadline the verdict is posted once, in the same thread, with a
          link to the page that shows how it was decided.
        </li>
      </ol>

      <h2>Friendly wager</h2>
      <p>
        Put money on a recorded prediction. Reply <code>@${handle} wager</code> in
        its thread and you get a link to its wager page: pick HIT or MISS, stake USDC
        on Base or Arbitrum One from your own wallet, and anyone can take the other
        side.
      </p>
      <ul>
        <li>The verdict settles it; the winner gets both stakes. No fee.</li>
        <li>
          From 0.01 to 1,000 USDC a side. Offers close 24 hours before the deadline.
        </li>
        <li>
          An offer nobody takes expires after 7 days, or when offers close if that is
          sooner, and its stake goes back to its maker.
        </li>
        <li>
          The money sits in a public contract on that network, never with us; the
          winner is paid after a 3-day hold, during which a wrong verdict can still
          be voided and both sides refunded.
        </li>
      </ul>

      <h2>Commands</h2>
      <p class="muted">
        Reply to a post or tag the bot. Extra words around a command are fine; ask it
        anything else and it answers briefly.
      </p>
      <table class="commands">
        <tr>
          <td><code>@${handle} wager</code></td>
          <td>under a recorded prediction: the link to wager on it</td>
        </tr>
        <tr>
          <td><code>@${handle} help</code></td>
          <td>how it works, in one reply</td>
        </tr>
        <tr>
          <td><code>@${handle} quote</code></td>
          <td>a quote about bets and predictions</td>
        </tr>
        <tr>
          <td><code>@${handle} selfpromo</code></td>
          <td>who Vaticeno is</td>
        </tr>
        <tr>
          <td><code>@${handle} ping</code></td>
          <td>pong, to check it is alive</td>
        </tr>
        <tr>
          <td><code>@${handle} STOP</code></td>
          <td>
            no more replies to you; your locked predictions are still resolved. Tag
            it again to resume.
          </td>
        </tr>
      </table>

      <h2>Status</h2>
      <dl>
        <dt>System</dt>
        <dd>
          <span class="status ${health.ok ? 'hit' : 'miss'}"
            >${health.ok ? 'operational' : 'degraded'}</span
          >
        </dd>
        <dt>Version</dt>
        <dd>${VERSION}</dd>
      </dl>

      <h2>Recorded</h2>
      <p class="muted">As of ${utc(now)}.</p>
      <dl>
        <dt>Predictions</dt>
        <dd>${claimCount}</dd>
        <dt>Verdicts</dt>
        <dd>${verdictCount}</dd>
        <dt>Hit</dt>
        <dd class="hit">${byOutcome.get('hit') ?? 0}</dd>
        <dt>Miss</dt>
        <dd class="miss">${byOutcome.get('miss') ?? 0}</dd>
        <dt>Void</dt>
        <dd class="void">${byOutcome.get('void') ?? 0}</dd>
      </dl>`,
  );
}

// The bot's own profile. `safeHref` is what keeps a handle from ever becoming a different scheme.
function profile(handle: string) {
  const href = safeHref(`https://x.com/${encodeURIComponent(handle)}`);
  return href
    ? html`<a href="${href}" rel="noopener">@${handle}</a>`
    : html`@${handle}`;
}
