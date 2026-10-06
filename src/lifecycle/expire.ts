import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { claims } from '../db/schema.js';
import { log } from '../log.js';

export const NEEDS_INFO_WINDOW_MS = 24 * 60 * 60 * 1000;

// FR-011: needs info with no valid amend within 24 h expires, with no reply.
export async function expireNeedsInfo(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - NEEDS_INFO_WINDOW_MS);
  const expired = await db.update(claims).set({ status: 'expired' })
    .where(and(eq(claims.status, 'needs_info'), sql`${claims.needsInfoSince} <= ${cutoff.toISOString()}`))
    .returning({ id: claims.id });
  if (expired.length > 0) log('info', 'needs-info claims expired', { event: 'claim.expired', reason: 'needs_info_timeout', count: expired.length });
  return expired.length;
}

// A draft whose reply never reached the author has no lock_at (src/bot/mentions.ts withholdLock), so the
// lock job passes it by forever. It expires on the same 24 h clock as needs info rather than staying an
// open claim its author was never told about.
export async function expireWithheldDrafts(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - NEEDS_INFO_WINDOW_MS);
  const expired = await db.update(claims).set({ status: 'expired' })
    .where(and(eq(claims.status, 'draft'), isNull(claims.lockAt), sql`${claims.createdAt} <= ${cutoff.toISOString()}`))
    .returning({ id: claims.id });
  if (expired.length > 0) log('info', 'withheld drafts expired', { event: 'claim.expired', reason: 'reply_never_posted', count: expired.length });
  return expired.length;
}
