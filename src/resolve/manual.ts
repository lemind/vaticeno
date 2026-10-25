// Human review (FR-026): the operator decides resolutions flagged needs_human. The only operator write
// path. A final resolution never changes (DB trigger); correcting one is deferred.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { renderStatement } from '../contract/render.js';
import { ContractSchema } from '../contract/schema.js';
import type { Db } from '../db/client.js';
import {
  claims,
  evidences,
  outcomeConfirmations,
  resolutions,
  verifierShadow,
  VOID_REASONS,
} from '../db/schema.js';
import { log } from '../log.js';
import { SHADOW_CANDIDATE } from './shadow.js';
import { recordSourceStanding } from './sources.js';

export async function listNeedsHuman(db: Db) {
  const flagged = await db
    .select({ claim: claims, resolution: resolutions })
    .from(resolutions)
    .innerJoin(claims, eq(claims.id, resolutions.claimId))
    .where(eq(resolutions.reviewStatus, 'needs_human'))
    .orderBy(resolutions.createdAt);

  return Promise.all(
    flagged.map(async ({ claim, resolution }) => {
      const rows = await db
        .select()
        .from(evidences)
        .where(eq(evidences.claimId, claim.id))
        .orderBy(desc(evidences.runAt));
      const latestRun = rows[0]?.runAt.getTime();
      return {
        slug: claim.slug,
        statement: renderStatement(ContractSchema.parse(claim.contract)),
        deadline_at: claim.deadlineAt?.toISOString(),
        arbiter_notes: resolution.arbiterNotes,
        evidence: rows
          .filter((e) => e.runAt.getTime() === latestRun)
          .map((e) => ({
            id: e.id,
            source: e.sourceName,
            trust: e.trustLevel,
            says: e.says,
            passed: e.passed,
            event_date: e.eventDate,
            url: e.url,
            gates: e.gates,
          })),
      };
    }),
  );
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
  if (!input.note.trim())
    throw new Error('a note is required: it is shown on the claim page');
  if (input.outcome !== 'void' && !input.decidingEvidenceId)
    throw new Error('hit/miss needs --deciding-evidence <evidence id>');

  await db.transaction(async (tx) => {
    const [claim] = await tx
      .select()
      .from(claims)
      .where(eq(claims.slug, input.slug))
      .limit(1);
    if (!claim) throw new Error(`no claim ${input.slug}`);
    const updated = await tx
      .update(resolutions)
      .set({
        outcome: input.outcome,
        decidedBy: 'human',
        reviewStatus: 'final',
        humanNotes: input.note.trim(),
        decidedAt: input.now,
        decidingEvidenceId:
          input.outcome === 'void' ? null : input.decidingEvidenceId,
        voidReason:
          input.outcome === 'void'
            ? (input.voidReason ?? 'insufficient_evidence')
            : null,
      })
      .where(
        and(
          eq(resolutions.claimId, claim.id),
          eq(resolutions.reviewStatus, 'needs_human'),
        ),
      )
      .returning({ id: resolutions.id });
    if (updated.length === 0)
      throw new Error(
        `#${input.slug} has no resolution waiting for a human (final ones never change)`,
      );
    await tx
      .update(claims)
      .set({ status: input.outcome === 'void' ? 'void' : 'resolved' })
      .where(eq(claims.id, claim.id));
    if (input.outcome !== 'void')
      await recordSourceStanding(tx, claim.id, input.outcome, input.now);
  });
  log('info', 'resolution decided by a human', {
    event: 'resolution.decided',
    slug: input.slug,
    outcome: input.outcome,
    decided_by: 'human',
  });
}

// Shadow claims the current candidate would have finalised at their latest attempt and nobody has checked yet:
// the same set as the count's `to_confirm` (status/shadow_count.sql). The verifier's own answer is left out,
// so the person checks the outcome rather than the model (003 SC-005, T349a).
export async function listToConfirm(db: Db) {
  const attempts = await db
    .select({
      claimId: verifierShadow.claimId,
      wouldFinalise: verifierShadow.wouldFinalise,
    })
    .from(verifierShadow)
    .where(eq(verifierShadow.model, SHADOW_CANDIDATE))
    .orderBy(desc(verifierShadow.createdAt));
  const latest = new Map<string, boolean>();
  for (const a of attempts)
    if (!latest.has(a.claimId)) latest.set(a.claimId, a.wouldFinalise);
  const finalising = [...latest].filter(([, would]) => would).map(([id]) => id);
  if (finalising.length === 0) return [];
  const rows = await db
    .select({ claim: claims, resolution: resolutions })
    .from(claims)
    .leftJoin(resolutions, eq(resolutions.claimId, claims.id))
    .where(
      and(
        inArray(claims.id, finalising),
        sql`not exists (select 1 from ${outcomeConfirmations} o where o.claim_id = ${claims.id})`,
      ),
    )
    .orderBy(claims.deadlineAt);
  return Promise.all(
    rows.map(async ({ claim, resolution }) => ({
      slug: claim.slug,
      statement: renderStatement(ContractSchema.parse(claim.contract)),
      deadline_at: claim.deadlineAt?.toISOString(),
      published: resolution?.reviewStatus === 'final' ? resolution.outcome : null,
      evidence: (
        await db
          .selectDistinct({ url: evidences.url })
          .from(evidences)
          .where(and(eq(evidences.claimId, claim.id), eq(evidences.passed, true)))
      ).map((e) => e.url),
    })),
  );
}

// One spelling per event, so claims about it count once whatever the case or spacing typed (SC-005).
export const eventKeyOf = (raw: string) =>
  raw.trim().toLowerCase().replace(/\s+/g, ' ');

export type Confirmation = {
  slug: string;
  outcome: 'hit' | 'miss' | 'void';
  eventKey: string;
};

// A person's check of a shadow claim's outcome; once per claim, never rewritten. Never read by the resolver.
export async function confirmOutcome(db: Db, input: Confirmation): Promise<void> {
  const eventKey = eventKeyOf(input.eventKey);
  if (!eventKey)
    throw new Error(
      '--event is required: claims about one event count once (SC-005)',
    );
  const [claim] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(eq(claims.slug, input.slug))
    .limit(1);
  if (!claim) throw new Error(`no claim ${input.slug}`);
  const [shadow] = await db
    .select({ id: verifierShadow.id })
    .from(verifierShadow)
    .where(eq(verifierShadow.claimId, claim.id))
    .limit(1);
  if (!shadow)
    throw new Error(
      `#${input.slug} has no shadow answer: there is nothing to count`,
    );
  const inserted = await db
    .insert(outcomeConfirmations)
    .values({ claimId: claim.id, outcome: input.outcome, eventKey })
    .onConflictDoNothing()
    .returning({ claimId: outcomeConfirmations.claimId });
  if (inserted.length === 0) throw new Error(`#${input.slug} is already confirmed`);
  log('info', 'shadow outcome confirmed', {
    event: 'shadow.confirmed',
    slug: input.slug,
    outcome: input.outcome,
  });
}
