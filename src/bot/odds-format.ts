// The odds reply (spec 006): each outcome's range across bookmakers, as the nearest common fractional prices with
// the decimals beside them ("2:1–9:4 (3.00–3.25)"). A race: the five shortest, then one range. Pure: no I/O.
import { weightedLength, X_MAX_CHARS } from '../replies/templates.js';

// The usual fractional ladder.
const LADDER = (
  '1/10 1/8 1/7 1/6 1/5 2/9 1/4 2/7 3/10 1/3 4/11 2/5 4/9 1/2 8/15 4/7 8/13 4/6 8/11 4/5 5/6 10/11 1/1 ' +
  '11/10 6/5 5/4 11/8 6/4 13/8 7/4 15/8 2/1 9/4 5/2 11/4 3/1 10/3 7/2 4/1 9/2 5/1 11/2 6/1 13/2 7/1 ' +
  '15/2 8/1 9/1 10/1 11/1 12/1 14/1 16/1 18/1 20/1 25/1 33/1 40/1 50/1 66/1 100/1'
)
  .split(' ')
  .map((step) => step.split('/').map(Number) as [number, number]);

export const MIN_BOOKMAKERS = 2;
const TOP = 5; // a race's named runners, as the weekly race post (005 FR-025)

export type PricedOutcome = { name: string; prices: number[] };
// `decimal`: the mean, which orders the outcomes; `low`/`high`: the shortest and longest price, which are shown.
export type OddsLine = {
  name: string;
  decimal: number;
  low: number;
  high: number;
  bookmakers: number;
};

// The nearest ladder price to a decimal price (decimal = fraction + 1).
export function fractional(decimal: number): string {
  if (decimal - 1 > 100) return `${Math.round(decimal - 1)}:1`; // past the ladder's end, as bookmakers write it
  let best = LADDER[0]!;
  for (const step of LADDER)
    if (
      Math.abs(step[0] / step[1] + 1 - decimal) <
      Math.abs(best[0] / best[1] + 1 - decimal)
    )
      best = step;
  return `${best[0]}:${best[1]}`;
}

const isPrice = (p: number) => Number.isFinite(p) && p > 1 && p <= 1001;

// Outcomes priced by at least two bookmakers, with their range and mean; shortest first.
export function averaged(outcomes: readonly PricedOutcome[]): OddsLine[] {
  return outcomes
    .map((o) => ({ name: o.name, prices: o.prices.filter(isPrice) }))
    .filter((o) => o.prices.length >= MIN_BOOKMAKERS)
    .map((o) => ({
      name: o.name,
      decimal: o.prices.reduce((a, b) => a + b, 0) / o.prices.length,
      low: Math.min(...o.prices),
      high: Math.max(...o.prices),
      bookmakers: o.prices.length,
    }))
    .sort((a, b) => a.decimal - b.decimal);
}

// Our reply carries no handle, link, hashtag or bare domain (constitution VI): a bookmaker's "bet365.com" is dropped
// with the rest. The same name.tld test as hasTagsOrLinks in src/replies/templates.ts.
const clean = (text: string, max: number) =>
  text
    .replace(/https?:\/\/\S+|www\.\S+|\b[\w-]+\.[a-z]{2,24}\b/gi, '')
    .replace(/[@#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();

// The bookmakers' range, as Grok and the tipsters give it (owner 2026-11-19): "2:1–9:4 (3.00–3.25)", one price if
// they agree.
function span(low: number, high: number, decimals: boolean): string {
  const [a, b] = [fractional(low), fractional(high)];
  const frac = a === b ? a : `${a}–${b}`;
  if (!decimals) return frac;
  const [x, y] = [low.toFixed(2), high.toFixed(2)];
  return `${frac} (${x === y ? x : `${x}–${y}`})`;
}

const priced = (line: OddsLine, max: number) =>
  `${clean(line.name, max)} ${span(line.low, line.high, true)}`;

// The reply text, or null when fewer than two outcomes are priced by two bookmakers. Too long never means
// "not priced": names are cut shorter, then a race names fewer runners, until it fits one post (FR-005).
export function oddsText(event: string, found: readonly OddsLine[]): string | null {
  const lines = found.filter((line) => clean(line.name, 40)); // a name that was only a link says nothing
  if (lines.length < 2) return null;
  const bookmakers = Math.min(...lines.map((l) => l.bookmakers));
  const tail = ` — about, from ${bookmakers} bookmakers`;
  const race = lines.length > TOP + 1; // more than six outcomes: five named, a range for the rest
  const counts = race ? [TOP, 4, 3, 2] : [lines.length];
  let text = '';
  for (const max of [40, 20, 12])
    for (const count of counts) {
      const named = lines.slice(0, count);
      const rest = lines.slice(count);
      const parts = named.map((line) => priced(line, max));
      if (rest.length > 0) {
        const low = Math.min(...rest.map((l) => l.low));
        const high = Math.max(...rest.map((l) => l.high));
        parts.push(`rest ${span(low, high, false)}`);
      }
      const body = parts.join(' · ');
      const head = clean(event, 60);
      for (text of head
        ? [`${head}: ${body}${tail}`, `${body}${tail}`]
        : [`${body}${tail}`])
        if (weightedLength(text) <= X_MAX_CHARS) return text;
    }
  return text; // twelve-letter names and two runners always fit; kept for the type
}
