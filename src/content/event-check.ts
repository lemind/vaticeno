// The gate on an event post (spec 005 FR-020): the model proposes, code decides. An event counts only when two
// pages on different sites, read by the code itself, both name it and give its date. Pure over page text, which is
// read and dropped, never stored (constitution V).
export type FoundEvent = { name: string; date: string; place: string };
export type ReadPage = { url: string; text: string };

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
const STOP_WORDS = new Set([
  'the',
  'and',
  'vs',
  'v',
  'versus',
  'at',
  'of',
  'grand',
  'prix',
  'final',
  'match',
  'game',
]);

// The words that identify the event: "Crystal Palace vs Liverpool" → crystal, palace, liverpool.
export function keyWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// The ways a page may write the date 2026-11-08: "8 November", "November 8", "8 Nov", "Nov 8", "2026-11-08",
// "08/11/2026", "11/08/2026".
export function dateForms(iso: string): RegExp[] {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const month = MONTHS[m - 1]!;
  const mon = month.slice(0, 3);
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const day = `0?${d}(?:st|nd|rd|th)?`;
  return [
    new RegExp(`\\b${day}\\s+(?:of\\s+)?(?:${month}|${mon}\\.?)\\b`, 'i'),
    new RegExp(`\\b(?:${month}|${mon}\\.?)\\s+${day}\\b`, 'i'),
    new RegExp(`\\b${y}-${mm}-${dd}\\b`),
    new RegExp(`\\b${dd}/${mm}/${y}\\b`),
    new RegExp(`\\b${mm}/${dd}/${y}\\b`),
  ];
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

// Why one page does or does not confirm the event: the key words it lacks, and whether it gives the date.
export function pageCheck(
  event: FoundEvent,
  page: ReadPage,
): { host: string | null; missing: string[]; dated: boolean } {
  const text = page.text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  return {
    host: host(page.url),
    missing: keyWords(event.name).filter((w) => !text.includes(w)),
    dated: dateForms(event.date).some((f) => f.test(page.text)),
  };
}

// Two different hosts whose page carries every key word of the name and the date in some form.
export function confirmedBy(
  event: FoundEvent,
  pages: readonly ReadPage[],
): string[] {
  if (keyWords(event.name).length === 0) return [];
  const hosts = new Set<string>();
  for (const page of pages) {
    const check = pageCheck(event, page);
    if (check.host && check.missing.length === 0 && check.dated)
      hosts.add(check.host);
  }
  return [...hosts];
}
