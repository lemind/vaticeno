import { and, eq, sql } from 'drizzle-orm';
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
