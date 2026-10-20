// GET /u/:x_user_id (contracts/http.md): claims the person holds a position on, with raw counts only —
// no percentage, ranking or comparison (FR-028).
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { renderStatement } from '../contract/render.js';
import { ContractSchema } from '../contract/schema.js';
import type { Db } from '../db/client.js';
import { claims, corrections, positions, resolutions } from '../db/schema.js';
import { REACHED_LOCK } from '../lifecycle/transitions.js';
import { html, layout, utc } from './html.js';

type Result = 'right' | 'wrong' | 'void' | null;

const MAX_CLAIMS_SHOWN = 500; // a public URL never reads without bound; counts cover what is shown

export async function authorPage(db: Db, xUserId: string): Promise<string | null> {
  const rows = await db
    .select({
      claim: claims,
      position: positions,
      resolution: resolutions,
      correction: corrections,
    })
    .from(positions)
    .innerJoin(claims, eq(claims.id, positions.claimId))
    .leftJoin(resolutions, eq(resolutions.claimId, claims.id))
    .leftJoin(corrections, eq(corrections.claimId, claims.id))
    .where(and(eq(positions.xUserId, xUserId), isNotNull(claims.contract))) // needs info / rejected: nothing to show
    .orderBy(desc(claims.createdAt))
    .limit(MAX_CLAIMS_SHOWN);
  // A stored contract that no longer parses (schema tightened later) drops out of the list, not the whole page.
  const shown = rows.flatMap((row) => {
    const contract = ContractSchema.safeParse(row.claim.contract);
    return contract.success ? [{ ...row, contract: contract.data }] : [];
  });
  if (shown.length === 0) return null;

  const withResult = shown.map((row) => {
    const final =
      row.resolution?.reviewStatus === 'final' ? row.resolution.outcome : null;
    // A corrected verdict counts as what it is now, not as what was first said (001 FR-035).
    const verdict = final === null ? null : (row.correction?.toOutcome ?? final);
    return {
      ...row,
      verdict,
      corrected: Boolean(row.correction),
      result: derivedResult(verdict, row.position.stance),
    };
  });
  const counts = {
    recorded: withResult.filter((r) => REACHED_LOCK.has(r.claim.status)).length,
    resolved: withResult.filter((r) => r.result !== null).length,
    right: withResult.filter((r) => r.result === 'right').length,
    wrong: withResult.filter((r) => r.result === 'wrong').length,
    void: withResult.filter((r) => r.result === 'void').length,
  };

  const body = html` <p class="muted">X user ${xUserId}</p>
    <h1>Predictions on record</h1>
    <p>
      ${counts.recorded} recorded · ${counts.resolved} resolved ·
      <span class="hit">${counts.right} right</span> ·
      <span class="miss">${counts.wrong} wrong</span> ·
      <span class="void">${counts.void} void</span>
    </p>
    <div class="scroll">
      <table>
        <tr>
          <th>Prediction</th>
          <th>Side</th>
          <th>Deadline</th>
          <th>Status</th>
          <th>Verdict</th>
          <th>Result</th>
        </tr>
        ${withResult.map(
          ({ claim, contract, position, verdict, corrected, result }) =>
            html`<tr>
              <td>
                <a href="/claim/${claim.slug}">${renderStatement(contract)}</a>
              </td>
              <td>${position.stance}</td>
              <td>${utc(claim.deadlineAt)}</td>
              <td>${claim.status}</td>
              <td>
                ${verdict ? verdict.toUpperCase() : '—'}${corrected ? html`<br /><span class="muted">corrected</span>` : ''}
              </td>
              <td
                class="${result === 'right' ? 'hit' : result === 'wrong' ? 'miss' : 'void'}"
              >
                ${result ?? '—'}
              </td>
            </tr>`,
        )}
      </table>
    </div>`;
  return layout(`User ${xUserId}`, body);
}

// HIT → agree right / disagree wrong; MISS → the reverse; VOID → void (data-model positions).
function derivedResult(outcome: string | null, stance: string): Result {
  if (outcome === 'void') return 'void';
  if (outcome !== 'hit' && outcome !== 'miss') return null;
  return (outcome === 'hit') === (stance === 'agree') ? 'right' : 'wrong';
}
