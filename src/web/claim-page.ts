// GET /c/:slug (contracts/http.md): the contract, its evidence and the verdict. Read-only; no post text.
import { asc, desc, eq } from 'drizzle-orm';
import { renderStatement } from '../contract/render.js';
import { ContractSchema } from '../contract/schema.js';
import type { Db } from '../db/client.js';
import { claims, evidences, positions, resolutions } from '../db/schema.js';
import { html, layout, safeHref, utc } from './html.js';

const DAY_MS = 86_400_000;
const MAX_ROWS = 500;

const STATUS_WORDS: Record<string, string> = {
  draft: 'recorded — can still be fixed until it locks',
  locked: 'locked — waiting for the deadline',
  resolving: 'deadline passed — being checked',
  resolved: 'resolved',
  void: 'void — no verdict',
  expired: 'expired — never locked, not judged',
};

export async function claimPage(db: Db, slug: string, now: Date): Promise<string | null> {
  const [claim] = await db.select().from(claims).where(eq(claims.slug, slug)).limit(1);
  if (!claim?.contract) return null; // needs info / rejected: no contract to show
  const contract = ContractSchema.parse(claim.contract);
  // Bounded: a public URL never reads without limit (the resolver's backoff keeps evidence small anyway).
  const [[resolution], items, people] = await Promise.all([
    db.select().from(resolutions).where(eq(resolutions.claimId, claim.id)).limit(1),
    db.select().from(evidences).where(eq(evidences.claimId, claim.id)).orderBy(desc(evidences.runAt), asc(evidences.createdAt)).limit(MAX_ROWS),
    db.select().from(positions).where(eq(positions.claimId, claim.id)).orderBy(asc(positions.joinedAt)).limit(MAX_ROWS),
  ]);

  const statement = renderStatement(contract);
  const deadline = new Date(contract.deadline_at);
  const final = resolution?.reviewStatus === 'final' ? resolution : null;
  const source = contract.source;

  const body = html`
<p class="muted">#${claim.slug}</p>
<h1>${statement}</h1>
<p><span class="status">${STATUS_WORDS[claim.status] ?? claim.status}</span>
${final ? html` <strong class="${final.outcome ?? ''}">${(final.outcome ?? '').toUpperCase()}</strong>` : ''}
${resolution && !final ? html` <span class="muted">waiting for a human decision</span>` : ''}</p>

<h2>Contract</h2>
<dl>
  <dt>Criterion</dt><dd>${contract.criterion}</dd>
  <dt>"No" means</dt><dd>${contract.negative_condition}</dd>
  <dt>Deadline</dt><dd>${utc(deadline)}${deadline.getTime() > now.getTime() ? html` <span class="muted">· resolves shortly after, ${countdown(deadline, now)}</span>` : ''}</dd>
  <dt>Source</dt><dd>${source.name} · ${link(source.locator, source.locator)}<br><span class="muted">${source.scope} · ${source.entity_id}</span></dd>
  <dt>Checked by</dt><dd>${contract.resolution_method === 'price_feed' ? 'price feed (daily UTC close)' : 'AI reading web sources, with code checks'}</dd>
</dl>

<h2>Timeline</h2>
<dl>
  <dt>Recorded</dt><dd>${utc(claim.createdAt)}</dd>
  <dt>Locks</dt><dd>${utc(claim.lockAt)}${claim.status === 'expired' ? ' — never locked' : ''}</dd>
  <dt>Resolved</dt><dd>${utc(final?.decidedAt)}</dd>
  <dt>Original post</dt><dd>${link(`https://x.com/i/status/${claim.sourceTweetId}`, 'on X')}</dd>
</dl>

${resolution ? html`
<h2>Verdict</h2>
<dl>
  <dt>Outcome</dt><dd>${final ? (final.outcome ?? '').toUpperCase() : 'not decided yet — flagged for a human'}${final?.voidReason ? html` <span class="muted">(${final.voidReason.replaceAll('_', ' ')})</span>` : ''}</dd>
  <dt>Decided by</dt><dd>${final ? DECIDED_WORDS[final.decidedBy ?? ''] ?? final.decidedBy : '—'}</dd>
  ${resolution.decidingEvidenceId ? html`<dt>Deciding answer</dt><dd><a href="#e-${resolution.decidingEvidenceId}">see below</a></dd>` : ''}
  ${resolution.arbiterNotes ? html`<dt>Arbiter's reason</dt><dd>${resolution.arbiterNotes}</dd>` : ''}
  ${resolution.humanNotes ? html`<dt>Human's note</dt><dd>${resolution.humanNotes}</dd>` : ''}
</dl>` : ''}

<h2>Evidence</h2>
${items.length === 0 ? html`<p class="muted">Nothing checked yet.</p>` : html`
<div class="scroll"><table>
<tr><th>Run</th><th>Source</th><th>Trust</th><th>Says</th><th>Event</th><th>Read at</th><th>Gates</th></tr>
${items.map((e) => html`<tr id="e-${e.id}"${e.id === resolution?.decidingEvidenceId ? html` style="font-weight:600"` : ''}>
  <td>${utc(e.runAt)}</td>
  <td>${e.url ? link(e.url, e.sourceName) : e.sourceName}${e.value ? html`<br><span class="muted">close ${e.value}</span>` : ''}</td>
  <td>${e.trustLevel}${e.trustReason ? html`<br><span class="muted">${e.trustReason}</span>` : ''}</td>
  <td class="${e.says}">${e.says.replaceAll('_', ' ')}</td>
  <td>${e.eventDate ?? '—'}</td>
  <td>${utc(e.retrievedAt)}</td>
  <td>${gatesText(e.gates, e.passed)}</td>
</tr>`)}
</table></div>`}

<h2>Positions</h2>
<ul>${people.map((p) => html`<li><a href="/u/${p.xUserId}">${p.xUserId}</a> · ${p.stance}${p.isAuthor ? ' (author)' : ''} · ${utc(p.joinedAt)}</li>`)}</ul>
`;
  return layout(`#${claim.slug}`, body);
}

const DECIDED_WORDS: Record<string, string> = { evidence: 'the evidence (rules in code)', arbiter: 'the arbiter model', human: 'a human reviewer' };

function link(url: string, text: string) {
  const href = safeHref(url);
  return href ? html`<a href="${href}" rel="nofollow noopener">${text}</a>` : html`${text}`;
}

function countdown(deadline: Date, now: Date): string {
  const days = Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS);
  return days <= 1 ? 'within a day' : `in ${days} days`;
}

function gatesText(gates: Record<string, boolean | null>, passed: boolean) {
  if (passed) return html`<span class="hit">passed</span>`;
  const failed = Object.entries(gates).filter(([, ok]) => ok === false).map(([name]) => name.replaceAll('_', ' '));
  return html`<span class="muted">failed: ${failed.join(', ') || '—'}</span>`;
}
