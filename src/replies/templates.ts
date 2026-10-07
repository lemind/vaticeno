// Fixed reply frames (contracts/reply-templates.md). Only the {…} parts vary; the statement is
// always rendered from the contract. Replies are produced and checked here, never stored.
import type { RejectReason } from '../contract/checks.js';

export const X_MAX_CHARS = 280;

// Dates in posted text read as "16 Oct 2026" (owner decision 2026-10-05): a reader never has to work
// out whether the middle number is the month or the day. ISO stays everywhere else — the database, the
// contract, the claim pages — and the model keeps producing ISO, which this rewrites on the way out.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function humanDates(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (iso, year, month, day) => {
    const name = MONTHS[Number(month) - 1];
    return name && Number(day) >= 1 && Number(day) <= 31 ? `${Number(day)} ${name} ${year}` : iso;
  });
}

// X's weighting (twitter-text v3): these code-point ranges count 1, everything else 2 (•, →, CJK, emoji).
const SINGLE_WEIGHT: Array<[number, number]> = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const charWeight = (ch: string) => (SINGLE_WEIGHT.some(([lo, hi]) => ch.codePointAt(0)! >= lo && ch.codePointAt(0)! <= hi) ? 1 : 2);
const X_LINK_CHARS = 23; // X counts every link as 23 characters


export function recordedReply(slug: string, statement: string): string {
  return assertReplyFits(
    `RECORDED · #${slug}\n"${statement}"\nEdits accepted for 15 min.`,
  );
}

// Used when no generated example survives the checks (FR-008): an example that is known to record.
// The deadline is the end of next year, so it is always inside the allowed range.
export function fallbackExample(now: Date): string {
  return `BTC daily close above $150,000 by ${now.getUTCFullYear() + 1}-12-31`;
}

// NEEDS INFO (case A). `checkedExample` must already have passed the checks — never an unchecked one.
export function needsInfoReply(explanation: string, checkedExample: string): string {
  const why = explanation.trim() || 'Something essential is missing.';
  return assertReplyFits(
    `NOT RECORDED — I can't judge this as written.\n\n${why}\n\nReply with the prediction and a date, e.g.\n${checkedExample}`,
  );
}

const REJECT_WORDS: Record<Exclude<RejectReason, 'x_rules' | 'duplicate'>, string> = {
  not_prediction: "that doesn't read as a prediction",
  deadline_too_close: 'the deadline must be more than 24 hours away (a sports match: just before it starts)',
  deadline_too_far: 'the deadline must be within 10 years',
  event_not_found: "I can't find that match scheduled — name both teams and the day",
};

// Anything that isn't a prediction ("@vaticeno cancel", "hi", …) gets what the bot can do.
export const HELP_REPLY = assertReplyFits('I record predictions and check them at the deadline.\n'
  + '• Tag me under your prediction → recorded\n'
  + '• Reply with a fix (15 min) → updated\n'
  + '• quote → a quote about bets\n'
  + '• selfpromo → who I am\n'
  + '• STOP → I go quiet (tag me to resume)\n'
  + '• * → nobody knows what to expect :)'); // checked at load: a too-long help fails the tests, not a post

// Sent on STOP; the bot stays silent to the author until they tag it again (constitution IV).
export const STOPPED_REPLY = "STOPPED — I won't reply to you until you tag me again. Your locked predictions are still checked.";

export function rejectedReply(reason: Exclude<RejectReason, 'duplicate'>): string {
  // X rules: no quote, no explanation.
  if (reason === 'x_rules') return "NOT RECORDED — I can't record this one.";
  if (reason === 'not_prediction') return HELP_REPLY;
  return assertReplyFits(`NOT RECORDED — ${REJECT_WORDS[reason]}.`);
}

// The reason alone, for the still-not-recorded reply to a fix.
export function rejectReasonWords(reason: Exclude<RejectReason, 'duplicate'>): string {
  return reason === 'x_rules' ? "I can't record this one" : REJECT_WORDS[reason];
}

// A fix before lock (the author's reply or an edit of the post): a new reply, never an edit of the earlier one.
export function amendedReply(slug: string, statement: string, amendsLeft: number): string {
  return assertReplyFits(`[AMENDED] #${slug}\n\nNow judging:\n"${statement}"\n\nLocks in 15 min · fixes left: ${amendsLeft}`);
}

// The post was edited before lock and the edit can't be recorded (or no fixes are left): nothing is locked.
export function expiredReply(slug: string): string {
  return assertReplyFits(`[EXPIRED] #${slug} — the post changed after recording, so nothing was locked. Tag me on a new post to record it.`);
}

// A fix that is refused outright (contracts/reply-templates.md "REFUSED").
export type RefusalReason = 'locked' | 'closed' | 'expired' | 'limit' | 'conflict';

export function refusedReply(reason: RefusalReason, slug: string): string {
  switch (reason) {
    case 'locked': return `#${slug} is locked and can't change.`;
    case 'closed': return `#${slug} can no longer be changed.`;
    case 'expired': return `#${slug} expired: no fix within 24 hours.`;
    case 'limit': return `#${slug} can't be changed again (2 fixes used).`;
    case 'conflict': return `#${slug} changed meanwhile; nothing was changed.`;
  }
}

// A fix to a needs-info claim that is still not recordable; the 24 h clock keeps running.
export function stillNotRecordedReply(why: string): string {
  return assertReplyFits(`STILL NOT RECORDED — ${why.trim() || 'Something essential is still missing.'}\nReply with the prediction and a date.`);
}

// A fix that can't be applied: the recorded version stands.
export function notChangedReply(slug: string, why: string): string {
  return assertReplyFits(`NOT CHANGED — ${why.trim() || 'Something essential is missing.'}\n#${slug} stays as recorded.`);
}

// A summon under someone else's post: only the author can put a prediction on the record.
export const THIRD_PARTY_REPLY = 'NOT RECORDED — I only record your own predictions. Tag me under your post.';

export function alreadyRecordedReply(existingSlug: string): string {
  return `ALREADY RECORDED · #${existingSlug}`;
}

// Length as X counts it: links weigh 23, everything else one per character (code point).
// A bot reply must not tag anyone or carry links (constitution VI): model or web text that does is not posted.
export function hasTagsOrLinks(text: string): boolean {
  // Any name.tld X would turn into a link (lowercase ending); "U.S.", "St. Louis", "No.1" stay fine.
  return /[@#]|https?:\/\/|www\./i.test(text) || /\b[\w-]+\.[a-z]{2,24}\b/.test(text);
}


export function weightedLength(text: string): number {
  const links = text.match(/\b[\w.-]+\.[a-z]{2,}\/\S*/gi) ?? [];
  let length = [...text].reduce((sum, ch) => sum + charWeight(ch), 0);
  for (const link of links) length += X_LINK_CHARS - [...link].reduce((sum, ch) => sum + charWeight(ch), 0);
  return length;
}

export function assertReplyFits(text: string): string {
  const length = weightedLength(text);
  if (length > X_MAX_CHARS) throw new Error(`reply is ${length} characters as X counts them; the limit is ${X_MAX_CHARS}`);
  return text;
}
