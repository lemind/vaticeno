// An own post may name a claim (`#ab12c`) only if its author is on the owner's list (constitution VI 2.9.0, spec
// 005 FR-014a). Checked when a post is queued and again when it goes out; nothing else is checked for now.
import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { claims } from '../db/schema.js';

// A claim's slug as the bot writes it: `#` and 5–6 characters of the slug alphabet (src/contract/slug.ts).
const NAMED_SLUG = /#([a-hj-km-np-z2-9]{5,6})\b/g;

export function namedSlugs(text: string): string[] {
  return [...text.matchAll(NAMED_SLUG)].map((m) => m[1]!);
}

// The text without its claim slugs: the one hashtag an own post may carry (constitution VI).
export function withoutSlugs(text: string): string {
  return text.replace(NAMED_SLUG, '');
}

// The slugs in `text` that may not be shown: unknown, or by an author not on the list. Empty = the post may go.
export async function blockedSlugs(
  db: Db,
  text: string,
  showAuthorIds: readonly string[],
): Promise<string[]> {
  const slugs = namedSlugs(text);
  if (slugs.length === 0) return [];
  const rows = await db
    .select({ slug: claims.slug, author: claims.authorXUserId })
    .from(claims)
    .where(inArray(claims.slug, slugs));
  const allowed = new Set(
    rows.filter((r) => showAuthorIds.includes(r.author)).map((r) => r.slug),
  );
  return slugs.filter((slug) => !allowed.has(slug));
}
