// GET /u/:x_user_id (contracts/http.md): claims the person holds a position on, with raw counts only —
// no percentage, ranking or comparison (FR-028).
import { desc, eq } from 'drizzle-orm';
import { renderStatement } from '../contract/render.js';
import { ContractSchema } from '../contract/schema.js';
import type { Db } from '../db/client.js';
import { claims, positions, resolutions } from '../db/schema.js';
import { html, layout, utc } from './html.js';

type Result = 'right' | 'wrong' | 'void' | null;

const REACHED_LOCK = new Set(['locked', 'resolving', 'resolved', 'void']);
const MAX_CLAIMS_SHOWN = 500; // a public URL never reads without bound; counts cover what is shown

export async function authorPage(db: Db, xUserId: string): Promise<string | null> {
  const rows = await db.select({ claim: claims, position: positions, resolution: resolutions })
    .from(positions)
    .innerJoin(claims, eq(claims.id, positions.claimId))
    .leftJoin(resolutions, eq(resolutions.claimId, claims.id))
    .where(eq(positions.xUserId, xUserId))
    .orderBy(desc(claims.createdAt))
    .limit(MAX_CLAIMS_SHOWN);
  const shown = rows.filter((row) => row.claim.contract); // needs info / rejected have nothing to show
  if (shown.length === 0) return null;

  const withResult = shown.map((row) => {
    const final = row.resolution?.reviewStatus === 'final' ? row.resolution.outcome : null;
    return { ...row, verdict: final, result: derivedResult(final, row.position.stance) };
  });
  const counts = {
    recorded: withResult.filter((r) => REACHED_LOCK.has(r.claim.status)).length,
    resolved: withResult.filter((r) => r.result !== null).length,
    right: withResult.filter((r) => r.result === 'right').length,
    wrong: withResult.filter((r) => r.result === 'wrong').length,
    void: withResult.filter((r) => r.result === 'void').length,
  };

  const body = html`
<p class="muted">X user ${xUserId}</p>
<h1>Predictions on record</h1>
<p>${counts.recorded} recorded · ${counts.resolved} resolved · <span class="hit">${counts.right} right</span> · <span class="miss">${counts.wrong} wrong</span> · <span class="void">${counts.void} void</span></p>
<div class="scroll"><table>
<tr><th>Prediction</th><th>Side</th><th>Deadline</th><th>Status</th><th>Verdict</th><th>Result</th></tr>
${withResult.map(({ claim, position, verdict, result }) => html`<tr>
  <td><a href="/c/${claim.slug}">${renderStatement(ContractSchema.parse(claim.contract))}</a></td>
  <td>${position.stance}</td>
  <td>${utc(claim.deadlineAt)}</td>
  <td>${claim.status}</td>
  <td>${verdict ? verdict.toUpperCase() : '—'}</td>
  <td class="${result === 'right' ? 'hit' : result === 'wrong' ? 'miss' : 'void'}">${result ?? '—'}</td>
</tr>`)}
</table></div>`;
  return layout(`User ${xUserId}`, body);
}

// HIT → agree right / disagree wrong; MISS → the reverse; VOID → void (data-model positions).
function derivedResult(outcome: string | null, stance: string): Result {
  if (outcome === 'void') return 'void';
  if (outcome !== 'hit' && outcome !== 'miss') return null;
  return (outcome === 'hit') === (stance === 'agree') ? 'right' : 'wrong';
}
