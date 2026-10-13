// Is this page about the event the contract names? (004 FR-002.) The judge reports what the page says it
// is about; this decides the match. Pure — no model answer is trusted with it.
import type { Contract } from '../contract/schema.js';

// What one page said about which event it describes. Every field is the page's own words, or absent.
export type EventIdentity = {
  date: string | null; // YYYY-MM-DD
  competition: string | null;
  round: string | null; // "Race 2", "Round 3", "Matchday 8" — as written
  venue: string | null;
  participants: string[];
};

// `not_applicable`: the contract names nothing machine-comparable, so the judge's own answer stands (FR-002).
export type EventMatch = 'yes' | 'no' | 'unknown' | 'not_applicable';

export type EventKey = {
  round: number | null; // named by the source entity: the page must confirm it
  date: string | null; // named by the source entity: the page must confirm it
  roundHint: number | null; // named anywhere: the page may contradict it, but need not state it
};

const ROUND = /\b(?:race|round|week|matchday|leg|game|heat)\s*(?:no\.?\s*)?(\d{1,3})\b/i;
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WRITTEN_DATE = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i');

// The event the contract names, from fields a locked contract already has (004 FR-002, FR-012). Only
// `entity_id` may demand confirmation: a date in the criterion is usually the deadline.
export function contractEventKey(contract: Contract): EventKey {
  const entity = contract.source.entity_id;
  const round = roundNumber(entity);
  return { round, date: dateIn(entity), roundHint: round ?? roundNumber(contract.criterion) };
}

// Unknown fails closed (004 FR-003): a page that will not say which round it reports is not taken for ours.
export function matchEvent(key: EventKey, identity: EventIdentity | null): EventMatch {
  const required = key.round !== null || key.date !== null;
  if (!identity) return required ? 'unknown' : 'not_applicable';

  const pageRound = identity.round ? roundNumber(identity.round) : null;
  const pageDate = identity.date && ISO_DATE.test(identity.date) ? identity.date : null;

  // A page that names a different round or a different day is about another event, whatever else matches.
  if (key.roundHint !== null && pageRound !== null && pageRound !== key.roundHint) return 'no';
  if (key.date !== null && pageDate !== null && pageDate !== key.date) return 'no';
  if (!required) return 'not_applicable';

  const roundOk = key.round === null || pageRound === key.round;
  const dateOk = key.date === null || pageDate === key.date;
  return roundOk && dateOk ? 'yes' : 'unknown';
}

function roundNumber(text: string): number | null {
  const found = ROUND.exec(text);
  if (!found?.[1]) return null;
  const n = Number(found[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function dateIn(text: string): string | null {
  const iso = ISO_DATE.exec(text);
  if (iso?.[1]) return iso[1];
  const written = WRITTEN_DATE.exec(text);
  if (!written) return null;
  const month = MONTHS.indexOf(written[1]!.toLowerCase()) + 1;
  const day = Number(written[2]);
  return `${written[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
