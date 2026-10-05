// Which of an account's latest posts we may repost (spec 002 FR-002): the newest one that is recent
// enough and that we have never posted. Pure, so the rules are testable without X or the database.
import type { UserPost } from '../x/client.js';

export const MAX_AGE_MS = 48 * 60 * 60 * 1000;
// X's clock and ours can differ by seconds, and the newest post of a busy account is exactly what we
// want: a few minutes "in the future" still counts as just posted.
const SKEW_MS = 5 * 60 * 1000;

export function latestEligible(posts: readonly UserPost[], now: Date, usedIds: ReadonlySet<string>): UserPost | null {
  const fresh = posts.filter((post) => {
    // No timestamp (X omits fields on withheld posts) means we cannot prove it is recent: skip it.
    if (!post.created_at) return false;
    const age = now.getTime() - new Date(post.created_at).getTime();
    return Number.isFinite(age) && age >= -SKEW_MS && age <= MAX_AGE_MS && !usedIds.has(post.id);
  });
  // X returns newest first, but the order is not promised anywhere.
  return [...fresh].sort((a, b) => Date.parse(b.created_at!) - Date.parse(a.created_at!))[0] ?? null;
}
