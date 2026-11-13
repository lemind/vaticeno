// The weekend's biggest Hong Kong race, read by the code from the Jockey Club's own race cards (spec 005 FR-025):
// every race of each meeting, its prize money and runners. The model only prices horses this card names.
import { log } from '../log.js';

export type CardRace = {
  name: string;
  date: string;
  course: string;
  raceNo: number;
  prize: number;
  horses: string[];
};
export type HtmlReader = (url: string) => Promise<string>;

const COURSES = { ST: 'Sha Tin', HV: 'Happy Valley' } as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const cardUrl = (date: string, course: string, raceNo: number) =>
  `https://racing.hkjc.com/racing/information/English/Racing/RaceCard.aspx?RaceDate=${date.replaceAll('-', '/')}&Racecourse=${course}&RaceNo=${raceNo}`;

// "THE PANASONIC CUP (HANDICAP)" → "The Panasonic Cup".
const titleCase = (text: string) =>
  text
    .replace(/\s*\((?:HANDICAP|HCP)\)\s*$/i, '')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim();

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

// HACK(hkjc): OBSERVED 2026-11-13 — a card heads "Race 7 - THE PANASONIC CUP (HANDICAP) Saturday, November 14,
// 2026, Sha Tin, … Prize Money: $2,840,000", horses link with horseid=. See specs/005-x-growth/spec.md FR-025.
// REVISIT: when the Jockey Club changes its race card page, or a weekend reads no meeting.
export function parseCard(
  html: string,
  date: string,
  course: keyof typeof COURSES,
): CardRace | null {
  const text = textOf(html);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const head = text.match(
    new RegExp(
      `Race (\\d+) - (.+?) \\w+day, ${MONTHS[m - 1]} ${d}, ${y}, ${COURSES[course]}`,
    ),
  );
  const prize = text.match(/Prize Money: \$([\d,]+)/);
  if (!head || !prize) return null; // another day's card: the site shows the next meeting instead
  const horses = [
    ...new Set(
      [...html.matchAll(/horseid=[^"]*"[^>]*>([^<]+)</gi)].map((h) =>
        titleCase(h[1]!),
      ),
    ),
  ];
  return {
    name: titleCase(head[2]!),
    date,
    course: COURSES[course],
    raceNo: Number(head[1]),
    prize: Number(prize[1]!.replaceAll(',', '')),
    horses,
  };
}

// The richest race of the weekend's meetings; null when no card for those days can be read.
export async function biggestRace(
  readHtml: HtmlReader,
  days: readonly string[],
): Promise<CardRace | null> {
  const races: CardRace[] = [];
  for (const date of days)
    for (const course of Object.keys(COURSES) as Array<keyof typeof COURSES>) {
      const first = await readCard(readHtml, date, course, 1);
      if (!first) continue;
      races.push(first.race);
      for (const no of first.raceNos.filter((n) => n > 1)) {
        const card = await readCard(readHtml, date, course, no);
        if (card) races.push(card.race);
      }
    }
  return races.sort((a, b) => b.prize - a.prize)[0] ?? null;
}

async function readCard(
  readHtml: HtmlReader,
  date: string,
  course: keyof typeof COURSES,
  raceNo: number,
): Promise<{ race: CardRace; raceNos: number[] } | null> {
  let html: string;
  try {
    html = await readHtml(cardUrl(date, course, raceNo));
  } catch (error) {
    log('info', 'race card not read', {
      event: 'feed.race_card_unread',
      date,
      course,
      raceNo,
      error: String(error).slice(-100),
    });
    return null;
  }
  const race = parseCard(html, date, course);
  if (!race) return null;
  const raceNos = [
    ...new Set([...html.matchAll(/RaceNo=(\d+)/g)].map((n) => Number(n[1]))),
  ].sort((a, b) => a - b);
  return { race, raceNos };
}

// The card page as HTML: the horse links are in the markup, which the page reader's visible text drops.
export async function readHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; vaticeno; +https://vaticeno.n30sk.cc)',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
