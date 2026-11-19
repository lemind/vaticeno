// The odds reply (spec 006): bookmakers' decimal prices averaged, shown as the nearest common fractional price with
// the decimal beside it ("2:1 (3.00)"). A race: the five shortest, then one range. Pure: no I/O.
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
export type OddsLine = { name: string; decimal: number; bookmakers: number };

// The nearest ladder price to a decimal price (decimal = fraction + 1).
export function fractional(decimal: number): string {
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

// Outcomes priced by at least two bookmakers, each the mean of its prices; shortest first.
export function averaged(outcomes: readonly PricedOutcome[]): OddsLine[] {
  return outcomes
    .map((o) => ({ name: o.name, prices: o.prices.filter(isPrice) }))
    .filter((o) => o.prices.length >= MIN_BOOKMAKERS)
    .map((o) => ({
      name: o.name,
      decimal: o.prices.reduce((a, b) => a + b, 0) / o.prices.length,
      bookmakers: o.prices.length,
    }))
    .sort((a, b) => a.decimal - b.decimal);
}

// Our reply carries no handle, link or hashtag (constitution VI): model text is stripped of all three.
const clean = (text: string) =>
  text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[@#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

const priced = (line: OddsLine) =>
  `${clean(line.name)} ${fractional(line.decimal)} (${line.decimal.toFixed(2)})`;

// The reply text, or null when fewer than two outcomes are priced by two bookmakers.
export function oddsText(event: string, lines: readonly OddsLine[]): string | null {
  if (lines.length < 2) return null;
  const bookmakers = Math.min(...lines.map((l) => l.bookmakers));
  const tail = ` — about, from ${bookmakers} bookmakers`;
  const named = lines.length > TOP + 1 ? lines.slice(0, TOP) : lines;
  const rest = lines.slice(named.length);
  const parts = named.map(priced);
  if (rest.length > 0)
    parts.push(
      `rest ${fractional(rest[0]!.decimal)}–${fractional(rest[rest.length - 1]!.decimal)}`,
    );
  const body = parts.join(' · ');
  const head = clean(event);
  for (const text of [`${head}: ${body}${tail}`, `${body}${tail}`])
    if (weightedLength(text) <= X_MAX_CHARS) return text;
  return null;
}
