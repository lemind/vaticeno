import { hostOf, registrableDomain } from './trust.js';

// Endpoints that may carry absence evidence: only code can know a page lists every event of its kind
// (004 FR-007). Empty on purpose — with none, a claim with no record waits and then voids.
type ExhaustiveEndpoint = {
  host: string; // registrable domain
  pathPrefix: string; // '' matches the whole host
  confirmed: string; // who checked it, and when — add an entry only with that check
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
