// The weekly Hong Kong race post (spec 005 FR-025): the weekend's main race, its date and course, the five shortest
// prices as quoted and one range for the rest. A fixed template; the model fills slots, never writes the sentence.
import {
  hasTagsOrLinks,
  weightedLength,
  X_MAX_CHARS,
} from '../replies/templates.js';

export type Runner = { horse: string; odds: string };
export type FoundRace = {
  name: string;
  date: string;
  course: string;
  runners: Runner[];
};
export type PricedRunner = { horse: string; ratio: number; odds: string };

export const TOP = 5;

// "5/1", "9-2", "5:1", "evens", or a decimal price ("6.0", the pool's way) → the profit per unit staked.
export function oddsRatio(odds: string): number | null {
  const text = odds.trim().toLowerCase();
  if (/^(evs|evens|even)$/.test(text)) return 1;
  const fraction = text.match(/^(\d+(?:\.\d+)?)\s*[/:-]\s*(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const ratio = Number(fraction[1]) / Number(fraction[2]);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
  }
  const decimal = Number(text);
  return Number.isFinite(decimal) && decimal > 1 ? decimal - 1 : null;
}

// 5 → "5:1", 3.5 → "7:2", 2.75 → "11:4", 0.8 → "4:5"; anything else to the nearest whole "N:1".
export function oddsText(ratio: number): string {
  for (const den of [1, 2, 4, 5]) {
    const num = ratio * den;
    if (Math.abs(num - Math.round(num)) < 0.01) return `${Math.round(num)}:${den}`;
  }
  return `${Math.max(1, Math.round(ratio))}:1`;
}

// Shortest first; a runner whose price can't be read is dropped.
export function priced(runners: readonly Runner[]): PricedRunner[] {
  return runners
    .map((r) => ({ horse: r.horse.trim(), ratio: oddsRatio(r.odds) }))
    .filter(
      (r): r is { horse: string; ratio: number } => !!r.horse && r.ratio !== null,
    )
    .map((r) => ({ ...r, odds: oddsText(r.ratio) }))
    .sort((a, b) => a.ratio - b.ratio);
}

// "Rest 14:1–99:1", or null when nobody is left after the top five.
export function restLine(field: readonly PricedRunner[]): string | null {
  const rest = field.slice(TOP);
  if (!rest.length) return null;
  const low = rest[0]!.odds;
  const high = rest[rest.length - 1]!.odds;
  return low === high ? `Rest ${low}` : `Rest ${low}–${high}`;
}

const longDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

// null when it does not fit or carries anything an own post may not (constitution VI).
export function racePostText(
  race: FoundRace,
  field: readonly PricedRunner[],
): string | null {
  const name = race.name.trim();
  const course = race.course.trim();
  if (!name || name.length > 60 || course.length > 30 || field.length < TOP)
    return null;
  const rest = restLine(field);
  const lines = [
    `${name} · ${course}`,
    `${longDay(race.date)}, early odds:`,
    ...field.slice(0, TOP).map((r) => `${r.horse} ${r.odds}`),
    ...(rest ? [rest] : []),
  ];
  const withClosing = `${lines.join('\n')}\n\nYour pick? Tag Vaticeno before the off.`;
  const bare = lines.join('\n');
  for (const text of [withClosing, bare])
    if (weightedLength(text) <= X_MAX_CHARS && !hasTagsOrLinks(text)) return text;
  return null;
}
