import { hostOf, registrableDomain } from './trust.js';

// Which endpoints may carry absence evidence (004 FR-007). "The event is not listed here" is only proof
// when the page is known to list every event of its kind — and only code knows that, because a page cannot
// say it of itself and the judge cannot read it off the page.
//
// Deliberately empty. Two public verdicts went out wrong because an official fixtures page that had not yet
// listed a match was read as proof the match never happened (owner report 2026-10-12). Until an endpoint is
// confirmed complete for a whole competition and window, a claim with no record waits or voids — which is
// the safer failure. Add one only with the check that confirmed it.
type ExhaustiveEndpoint = {
  host: string; // registrable domain
  pathPrefix: string; // '' matches the whole host
  confirmed: string; // who checked it covers every event of its kind, and when
};

const EXHAUSTIVE: readonly ExhaustiveEndpoint[] = [];

// An absence may be read off this URL. False for everything not listed, including the whole of a site whose
// other pages are complete: a competition's results page is not its fixtures page.
export function isExhaustiveRecord(url: string | null): boolean {
  if (!url) return false;
  const host = hostOf(url);
  if (!host) return false;
  const domain = registrableDomain(host);
  const path = pathOf(url);
  return EXHAUSTIVE.some((entry) => entry.host === domain && path.startsWith(entry.pathPrefix));
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}
