// Non-price claims: search → fetch → judge each page → trust → gates (research R4). Page text and quotes
// live only in memory for this run; what survives is the evidence row (link, hash, answer, gates).
import { SCHEDULED_EVENT_KINDS } from '../contract/schema.js';
import type { Contract } from '../contract/schema.js';
import { type CallCost, type LlmClient, LlmSchemaError } from '../llm/client.js';
import { JUDGE_VERSION, judgePage, searchSources } from '../llm/judges.js';
import { log } from '../log.js';
import { type PageFetcher, SourceUnavailable } from './fetch.js';
import { settles } from './decide.js';
import { type EvidenceDraft, type Gates, runGates } from './gates.js';
import { capTrust, hostOf, registrableDomain } from './trust.js';

const MAX_PAGES = 8;
const TRUST_ORDER = { primary: 0, established: 1, weak: 2 } as const;

export type WebDeps = { llm: LlmClient; fetchPage: PageFetcher; judgeModelA: string; judgeModelB: string; judgeVersion?: string };

export type GatheredItem = {
  draft: EvidenceDraft;
  gates: Gates;
  passed: boolean;
  value: number | null; // price feed answers only
  sourceName: string;
  trustReason: string | null;
  contentSha256: string | null;
  searchQuery: string | null;
  modelId: string | null;
  instructionVersion: string | null;
  pageText: string; // in memory only, for the arbiter in this same run; never stored
};

export async function gatherWebEvidence(
  deps: WebDeps,
  contract: Contract,
  window: { lockAt: Date; deadlineAt: Date },
  now: Date,
  knownSources: readonly string[],
  costs: CallCost[], // filled as calls are paid, so an outage part-way still records its spend
): Promise<GatheredItem[]> {
  // Two independent search passes (outages propagate: no evidence, retry next run).
  const passA = await searchSources(deps.llm, deps.judgeModelA, contract, window, 1, knownSources);
  costs.push(...passA.costs);
  const passB = await searchSources(deps.llm, deps.judgeModelB, contract, window, 2, knownSources);
  costs.push(...passB.costs);
  const queries = [...new Set([...passA.queries, ...passB.queries])];
  const searchQuery = queries.join(' | ').slice(0, 500) || null;
  const found = [...new Set([...passA.urls, ...passB.urls])];

  // The contract's own record is always read (also for absence evidence after the deadline).
  const urls = [...new Set([contract.source.locator, ...found])].slice(0, MAX_PAGES);
  const judged: Array<Omit<GatheredItem, 'gates' | 'passed'>> = [];
  let transientFailures = 0; // timeouts, 429, 5xx: the page may answer next time
  let unreadable = 0; // any page that could not be fetched or judged
  const seen = new Set<string>(); // search redirect links often land on the same page: judge it once
  for (const url of urls) {
    let page;
    try {
      page = await deps.fetchPage(url);
    } catch (error) {
      if (!(error instanceof SourceUnavailable)) throw error; // replay misses and bugs fail loudly
      if (error.transient) transientFailures++;
      unreadable++;
      log('warn', 'source page unavailable', { event: 'evidence.fetch_failed', url, transient: error.transient, error: String(error) });
      continue;
    }
    if (seen.has(page.url)) continue;
    seen.add(page.url);
    try {
      const { judgement, costs: judgeCosts } = await judgePage(deps.llm, deps.judgeModelA, contract, window, page, deps.judgeVersion);
      costs.push(...judgeCosts);
      const host = hostOf(page.url);
      judged.push({
        draft: {
          sourceKind: 'web',
          basis: judgement.basis,
          trustLevel: capTrust(judgement.source_trust, page.url, contract),
          says: judgement.says,
          eventDate: judgement.event_date,
          eventStart: judgement.event_start ?? null,
          url: page.url,
          retrievedAt: page.retrievedAt,
          quoteFound: judgement.quoteFound,
          isFinalResult: judgement.is_final_result,
          originalSource: judgement.original_source,
          simhash: page.simhash,
        },
        value: null,
        sourceName: host ? registrableDomain(host) : page.url,
        trustReason: judgement.trust_reason,
        contentSha256: page.sha256,
        searchQuery,
        modelId: deps.judgeModelA,
        instructionVersion: deps.judgeVersion ?? JUDGE_VERSION,
        pageText: page.text,
      });
    } catch (error) {
      if (!(error instanceof LlmSchemaError)) throw error;
      costs.push(...error.costs);
      unreadable++;
      log('warn', 'judge answer unusable; page skipped', { event: 'evidence.judge_malformed', url: page.url });
    }
  }

  // Gate the strongest sources first, so a primary page wins the independence check over its copies.
  judged.sort((a, b) => TRUST_ORDER[a.draft.trustLevel] - TRUST_ORDER[b.draft.trustLevel]);
  const accepted: EvidenceDraft[] = [];
  const items: GatheredItem[] = judged.map((item) => {
    const { gates, passed } = runGates(item.draft, { ...window, absenceIsMeaningful: contract.source.absence_is_meaningful, startTimeCounts: SCHEDULED_EVENT_KINDS.includes(contract.source.kind) }, accepted);
    if (passed) accepted.push(item.draft);
    return { ...item, gates, passed };
  });

  // Never "nothing found" when we did not really look (constitution III): a timeout that might have held
  // the answer, or not a single page read although there were pages to read, is an outage.
  const settled = items.some((item) => settles({ ...item.draft, passed: item.passed, quoteFound: item.gates.quote_found }));
  const readNothing = judged.length === 0 && unreadable > 0 && found.length > 0;
  if (!settled && (transientFailures > 0 || readNothing)) {
    throw new SourceUnavailable(`${unreadable} source pages could not be read or judged`);
  }
  // An empty search still writes one row, so "nothing found" runs can be counted (data-model evidences.run_at).
  if (items.length === 0) items.push(emptySearchItem(searchQuery, now));
  return items;
}

function emptySearchItem(searchQuery: string | null, now: Date): GatheredItem {
  const draft: EvidenceDraft = {
    sourceKind: 'web', basis: 'record', trustLevel: 'weak', says: 'irrelevant', eventDate: null, eventStart: null, url: null,
    retrievedAt: now, quoteFound: null, isFinalResult: false, originalSource: null, simhash: null,
  };
  const gates: Gates = { trusted: false, quote_found: null, in_window: null, final: false, independent: null };
  return { draft, gates, passed: false, value: null, sourceName: 'search', trustReason: null, contentSha256: null, searchQuery, modelId: null, instructionVersion: null, pageText: '' };
}
