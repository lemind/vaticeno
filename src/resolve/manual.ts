// Human review (FR-026): the operator decides resolutions flagged needs_human. The only operator write
// path. A final resolution never changes (DB trigger); correcting one is deferred.
import { and, desc, eq } from 'drizzle-orm';
import { renderStatement } from '../contract/render.js';
import { ContractSchema } from '../contract/schema.js';
import type { Db } from '../db/client.js';
import { claims, evidences, resolutions, VOID_REASONS } from '../db/schema.js';
import { log } from '../log.js';

export async function listNeedsHuman(db: Db) {
  const flagged = await db.select({ claim: claims, resolution: resolutions })
    .from(resolutions).innerJoin(claims, eq(claims.id, resolutions.claimId))
    .where(eq(resolutions.reviewStatus, 'needs_human'))
    .orderBy(resolutions.createdAt);

  return Promise.all(flagged.map(async ({ claim, resolution }) => {
    const rows = await db.select().from(evidences).where(eq(evidences.claimId, claim.id)).orderBy(desc(evidences.runAt));
    const latestRun = rows[0]?.runAt.getTime();
    return {
      slug: claim.slug,
      statement: renderStatement(ContractSchema.parse(claim.contract)),
      deadline_at: claim.deadlineAt?.toISOString(),
      arbiter_notes: resolution.arbiterNotes,
      evidence: rows.filter((e) => e.runAt.getTime() === latestRun).map((e) => ({
        id: e.id, source: e.sourceName, trust: e.trustLevel, says: e.says, passed: e.passed, event_date: e.eventDate, url: e.url, gates: e.gates,
      })),
    };
  }));
}

export type ManualDecision = {
  slug: string;
  outcome: 'hit' | 'miss' | 'void';
  decidingEvidenceId?: string; // required for hit/miss (the database checks it belongs to the claim)
  voidReason?: (typeof VOID_REASONS)[number];
  note: string;
  now: Date;
};

export async function decideByHuman(db: Db, input: ManualDecision): Promise<void> {
  if (!input.note.trim()) throw new Error('a note is required: it is shown on the claim page');
  if (input.outcome !== 'void' && !input.decidingEvidenceId) throw new Error('hit/miss needs --deciding-evidence <evidence id>');

  await db.transaction(async (tx) => {
    const [claim] = await tx.select().from(claims).where(eq(claims.slug, input.slug)).limit(1);
    if (!claim) throw new Error(`no claim ${input.slug}`);
    const updated = await tx.update(resolutions).set({
      outcome: input.outcome,
      decidedBy: 'human',
      reviewStatus: 'final',
      humanNotes: input.note.trim(),
      decidedAt: input.now,
      decidingEvidenceId: input.outcome === 'void' ? null : input.decidingEvidenceId,
      voidReason: input.outcome === 'void' ? (input.voidReason ?? 'insufficient_evidence') : null,
    }).where(and(eq(resolutions.claimId, claim.id), eq(resolutions.reviewStatus, 'needs_human'))).returning({ id: resolutions.id });
    if (updated.length === 0) throw new Error(`#${input.slug} has no resolution waiting for a human (final ones never change)`);
    await tx.update(claims).set({ status: input.outcome === 'void' ? 'void' : 'resolved' }).where(eq(claims.id, claim.id));
  });
  log('info', 'resolution decided by a human', { event: 'resolution.decided', slug: input.slug, outcome: input.outcome, decided_by: 'human' });
}
