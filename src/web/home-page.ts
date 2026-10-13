// GET / — the public front page: is it running, what version, how many claims and verdicts. Operational
// detail (spend, which job, verdicts we know are wrong) stays on the private status page (003 FR-004).
import { count, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { claims, jobState, resolutions } from '../db/schema.js';
import { VERSION } from '../version.js';
import { html, layout } from './html.js';

export type Health = { ok: boolean };

// Red when a job has missed its own window or its last run failed. A job that has never run is not red:
// after a deploy every job is in that state until its slot comes round, and a weekly one for days.
export async function publicHealth(db: Db, now: Date): Promise<Health> {
  // Nine rows: cheaper to decide here than to express the window comparison in SQL.
  const rows = await db
    .select({ lastOkAt: jobState.lastOkAt, lastOutcome: jobState.lastOutcome, staleAfterSeconds: jobState.staleAfterSeconds })
    .from(jobState);
  const watched = rows.filter((row) => row.lastOkAt !== null);
  const late = watched.filter(
    (row) => row.lastOutcome === 'failed' || now.getTime() - row.lastOkAt!.getTime() > row.staleAfterSeconds * 1000,
  );
  return { ok: late.length === 0 };
}

export async function homePage(db: Db, now: Date): Promise<string> {
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
  const byOutcome = new Map(verdictRows.map((row) => [row.outcome ?? 'undecided', row.n]));
  const verdictCount = verdictRows.reduce((total, row) => total + row.n, 0);

  return layout(
    'Vaticeno',
    html`
<h1>Vaticeno</h1>
<p class="muted">Tag the bot under a prediction on X and it records it, then posts the verdict in the same
thread after the deadline — with the result it was decided on.</p>

<h2>Status</h2>
<dl>
  <dt>System</dt>
  <dd><span class="status ${health.ok ? 'hit' : 'miss'}">${health.ok ? 'operational' : 'degraded'}</span></dd>
  <dt>Version</dt>
  <dd>${VERSION}</dd>
</dl>

<h2>Recorded</h2>
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
