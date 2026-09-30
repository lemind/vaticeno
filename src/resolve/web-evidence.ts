// Non-price claims: search → fetch → judge each page → trust → gates (research R4). Page text and quotes
// live only in memory for this run; what survives is the evidence row (link, hash, answer, gates).
import type { Contract } from '../contract/schema.js';
import { type CallCost, type LlmClient, LlmSchemaError } from '../llm/client.js';
import { JUDGE_VERSION, judgePage, searchSources } from '../llm/judges.js';
import { log } from '../log.js';
import { type PageFetcher, SourceUnavailable } from './fetch.js';
import { type EvidenceDraft, type Gates, runGates } from './gates.js';
import { hostOf, registrableDomain, type SourcePolicy, trustLevel } from './trust.js';

const MAX_PAGES = 8;
const TRUST_ORDER = { official: 0, trusted: 1, other: 2 } as const;

export type WebDeps = { llm: LlmClient; fetchPage: PageFetcher; judgeModelA: string; judgeModelB: string; policy: SourcePolicy };

export type GatheredItem = {
  draft: EvidenceDraft;
  gates: Gates;
  passed: boolean;
  value: number | null; // price feed answers only
  sourceName: string;
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
): Promise<{ items: GatheredItem[]; costs: CallCost[] }> {
  const costs: CallCost[] = [];
  // Two independent search passes (outages propagate: no evidence, retry next run).
  const passA = await searchSources(deps.llm, deps.judgeModelA, contract, window, 1);
  const passB = await searchSources(deps.llm, deps.judgeModelB, contract, window, 2);
  costs.push(...passA.costs, ...passB.costs);
  const queries = [...new Set([...passA.queries, ...passB.queries])];
  const searchQuery = queries.join(' | ').slice(0, 500) || null;
  const found = [...new Set([...passA.urls, ...passB.urls])];

  // The contract's own record is always read (also for absence evidence after the deadline).
  const urls = [...new Set([contract.source.locator, ...found])].slice(0, MAX_PAGES);
  const judged: Array<Omit<GatheredItem, 'gates' | 'passed'>> = [];
  let fetchFailures = 0;
  const seen = new Set<string>(); // search redirect links often land on the same page: judge it once
  for (const url of urls) {
    let page;
    try {
      page = await deps.fetchPage(url);
    } catch (error) {
      fetchFailures++;
      log('warn', 'source page unavailable', { event: 'evidence.fetch_failed', url, error: String(error) });
      continue;
    }
    if (seen.has(page.url)) continue;
    seen.add(page.url);
    try {
      const { judgement, costs: judgeCosts } = await judgePage(deps.llm, deps.judgeModelA, contract, window, page);
      costs.push(...judgeCosts);
      const host = hostOf(page.url);
      judged.push({
        draft: {
          sourceKind: 'web',
          basis: judgement.basis,
          trustLevel: trustLevel(page.url, contract, deps.policy),
          says: judgement.says,
          eventDate: judgement.event_date,
          url: page.url,
          retrievedAt: page.retrievedAt,
          quoteFound: judgement.quoteFound,
          isFinalResult: judgement.is_final_result,
          originalSource: judgement.original_source,
          simhash: page.simhash,
        },
        value: null,
        sourceName: host ? registrableDomain(host) : page.url,
        contentSha256: page.sha256,
        searchQuery,
        modelId: deps.judgeModelA,
        instructionVersion: JUDGE_VERSION,
        pageText: page.text,
      });
    } catch (error) {
      if (!(error instanceof LlmSchemaError)) throw error;
      costs.push(...error.costs);
      log('warn', 'judge answer unusable; page skipped', { event: 'evidence.judge_malformed', url: page.url });
    }
  }

  // Every page failed to load: treat as an outage and retry later, rather than "nothing found".
  if (judged.length === 0 && fetchFailures > 0 && found.length > 0) {
    throw new SourceUnavailable(`all ${fetchFailures} source pages failed to load`);
  }

  // Gate the strongest sources first, so an official page wins the independence check over its copies.
  judged.sort((a, b) => TRUST_ORDER[a.draft.trustLevel] - TRUST_ORDER[b.draft.trustLevel]);
  const accepted: EvidenceDraft[] = [];
  const items: GatheredItem[] = judged.map((item) => {
    const { gates, passed } = runGates(item.draft, { ...window, absenceIsMeaningful: contract.source.absence_is_meaningful }, accepted);
    if (passed) accepted.push(item.draft);
    return { ...item, gates, passed };
  });

  // An empty search still writes one row, so "nothing found" runs can be counted (data-model evidences.run_at).
  if (items.length === 0) items.push(emptySearchItem(searchQuery, now));
  return { items, costs };
}

function emptySearchItem(searchQuery: string | null, now: Date): GatheredItem {
  const draft: EvidenceDraft = {
    sourceKind: 'web', basis: 'record', trustLevel: 'other', says: 'irrelevant', eventDate: null, url: null,
    retrievedAt: now, quoteFound: null, isFinalResult: false, originalSource: null, simhash: null,
  };
  const gates: Gates = { trusted: false, quote_found: null, in_window: null, final: false, independent: null };
  return { draft, gates, passed: false, value: null, sourceName: 'search', contentSha256: null, searchQuery, modelId: null, instructionVersion: null, pageText: '' };
}
