// The record as the feed (spec 002 US4, spec 005 US4): what comes due this week, and last week's counts. Written
// from the database alone — no AI, no link, no author — and pure, so every rule is testable without X.
import {
  hasTagsOrLinks,
  weightedLength,
  X_MAX_CHARS,
} from '../replies/templates.js';
import { withoutSlugs } from './claim-guard.js';

export type DueClaim = { slug: string; deadlineAt: Date };
export type WeekCounts = {
  recorded: number;
  cameDue: number;
  hit: number;
  miss: number;
  void: number;
  open: number;
};

const MAX_NAMED = 5;
const WEEK_MS = 7 * 86_400_000;

const shortDay = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Own-feed text rules (constitution VI): fits a post, no @mention, link or hashtag but a claim's slug.
function fits(text: string): boolean {
  return weightedLength(text) <= X_MAX_CHARS && !hasTagsOrLinks(withoutSlugs(text));
}

// Locked claims due in the next 7 days, soonest first, at most five; a claim named in a digest in the last 7
// days is left out, so a slug is posted at most once a week. Nothing left → null (spec 002 FR-013).
export function deadlineDigest(
  claims: readonly DueClaim[],
  now: Date,
  namedRecently: ReadonlySet<string>,
): { text: string; slugs: string[] } | null {
  const due = claims
    .filter((c) => !namedRecently.has(c.slug))
    .filter(
      (c) => c.deadlineAt > now && c.deadlineAt.getTime() - now.getTime() <= WEEK_MS,
    )
    .sort((a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime());
  if (due.length === 0) return null;
  const named = due.slice(0, MAX_NAMED);
  const lines = named.map((c) => `#${c.slug} · ${shortDay(c.deadlineAt)}`);
  const more = due.length - named.length;
  const text = [
    'Coming due this week on the record:',
    ...lines,
    ...(more > 0 ? [`…and ${more} more.`] : []),
  ].join('\n');
  return fits(text) ? { text, slugs: named.map((c) => c.slug) } : null;
}

// The past week's numbers, no claim singled out. The same counts as the last record post, or a week with no
// claims and no verdicts → null.
export function recordPost(
  counts: WeekCounts,
  last: WeekCounts | null,
): string | null {
  const empty = Object.values(counts).every((n) => n === 0);
  const same = last !== null && JSON.stringify(counts) === JSON.stringify(last);
  if (empty || same) return null;
  const text =
    `The week on the record: ${counts.recorded} recorded, ${counts.cameDue} came due — ` +
    `${counts.hit} HIT, ${counts.miss} MISS, ${counts.void} VOID. ${counts.open} still open.`;
  return fits(text) ? text : null;
}
