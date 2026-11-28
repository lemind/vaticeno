// The bot's own event post (spec 005 US3a): a topic drawn by weight, in season, a model with web search proposes the nearest
// big event, two pages the code reads confirm it, and a fixed template says it. Every day, only in a free own-post
// slot; at most three topics, then nothing that day.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { feedPosts } from '../db/schema.js';
import { type CallCost, LlmSchemaError } from '../llm/client.js';
import { loadInstruction } from '../llm/instructions.js';
import { log } from '../log.js';
import { captureError, errorText } from '../observe.js';
import type { PageFetcher } from '../resolve/fetch.js';
import { X_POST_CREATE_USD } from '../x/prices.js';
import {
  confirmedBy,
  pageCheck,
  type FoundEvent,
  type ReadPage,
} from './event-check.js';
import { eventPostText } from './event-post.js';
import type { OriginalDeps } from './original-run.js';
import { saveCosts } from './quote.js';
import { markPosted, recordPostFailure, reserveSlot, utcDay } from './slots.js';
import { overSpendCap, recordFeedPost } from './spend.js';
import { pickWeighted, TOPICS, type Topic } from './topics.js';

const RACE_TOPIC = 'hk-racing'; // src/content/race-run.ts; not imported, since race-run imports this file

export type EventDeps = OriginalDeps & {
  fetchPage: PageFetcher;
  // The poster (FR-024): null, or a throw, means the post goes out as text.
  makePoster?: (topicId: string, event: FoundEvent) => Promise<Buffer | null>;
};
export type EventRunResult =
  | { done: 'cap_reached' | 'slot_taken' | 'logged' | 'posted' }
  | { done: 'failed'; error: string }
  // `why`: one plain line per topic tried, for the owner's failure email.
  | { done: 'no_event'; why: string[] };

const MAX_TOPICS = 3;
const MAX_PAGES = 4;
const DAY_MS = 86_400_000;
// The event's window: 3 to 10 days ahead (FR-019).
const FROM_DAYS = 3;
const TO_DAYS = 10;

const Answer = z.union([
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    name: z.string().min(3).max(80),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    place: z.string().max(60),
  }),
]);

type EventPayload = { topic: string; name: string; date: string };

export async function runEventPost(
  deps: EventDeps,
  now: Date,
  random: () => number = Math.random,
): Promise<EventRunResult> {
  if (await overSpendCap(deps, now)) return { done: 'cap_reached' };
  const day = utcDay(now);
  // Checked before any paid search: a queued post, the digest or the record already took today (FR-009).
  const [taken] = await deps.db
    .select({ id: feedPosts.id })
    .from(feedPosts)
    .where(
      and(
        eq(feedPosts.capGroup, 'original'),
        eq(feedPosts.day, day),
        inArray(feedPosts.status, ['reserved', 'posted']),
      ),
    )
    .limit(1);
  if (taken) return { done: 'slot_taken' };

  const past = await deps.db
    .select({ payload: feedPosts.payload })
    .from(feedPosts)
    .where(eq(feedPosts.kind, 'event'))
    .orderBy(desc(feedPosts.createdAt));
  const posted = past
    .map((r) => r.payload as EventPayload | null)
    .filter((p): p is EventPayload => !!p && p.topic !== RACE_TOPIC); // the weekly race is not a drawn topic
  const seen = new Set(posted.map((p) => `${p.name.toLowerCase()}|${p.date}`));
  const tried = new Set<string>(posted[0] ? [posted[0].topic] : []); // never the last topic again

  const why: string[] = [];
  for (let i = 0; i < MAX_TOPICS; i++) {
    const open = TOPICS.filter(
      (t) => t.months.includes(now.getUTCMonth() + 1) && !tried.has(t.id),
    );
    const topic = pickWeighted(open, random());
    if (!topic) break;
    tried.add(topic.id);
    const found = await findEvent(deps, topic, now);
    if (!found) {
      why.push(`${topic.id}: the search found no event 3–10 days ahead`);
      continue;
    }
    const { event, urls, searched } = found;
    const named = `${topic.id}: ${event.name} (${event.date})`;
    if (seen.has(`${event.name.toLowerCase()}|${event.date}`)) {
      why.push(`${named}: already posted`);
      continue;
    }
    let { pages, unread } = await readPages(deps, urls);
    let hosts = confirmedBy(event, pages);
    // HACK(gemini): OBSERVED 2026-11-17/18 — grounding redirect links often fail to open, so a topic's links
    // confirm one site; one search of our own is read too. See specs/005-x-growth/spec.md FR-020.
    // REVISIT: if the unread reasons in feed.event_unconfirmed logs stop naming vertexaisearch, drop this.
    if (hosts.length < 2 && !searched) {
      const more = (await searchSourcesOrNone(deps, event)).filter(
        (u) => !urls.includes(u),
      );
      const extra = await readPages(deps, more.slice(0, MAX_PAGES));
      pages = [...pages, ...extra.pages];
      unread = [...unread, ...extra.unread];
      hosts = confirmedBy(event, pages);
    }
    if (hosts.length < 2) {
      log('info', 'event not confirmed by two sites', {
        event: 'feed.event_unconfirmed',
        topic: topic.id,
        name: event.name,
        date: event.date,
        hosts,
        pages: pages.map((p) => pageCheck(event, p)),
        unread,
      });
      why.push(
        `${named}: confirmed by ${hosts.length ? hosts.join(', ') : 'no site'}, two needed` +
          (unread.length ? `; unreadable: ${unread.join('; ')}` : ''),
      );
      continue;
    }
    const text = eventPostText(event, random);
    if (!text) {
      why.push(`${named}: too long for the post template`);
      continue;
    }
    return publish(deps, now, text, event, {
      topic: topic.id,
      name: event.name,
      date: event.date,
    });
  }
  log('info', 'no event post today', { event: 'feed.no_event', tried: [...tried] });
  return { done: 'no_event', why };
}

// One grounded call. The URLs are the search's own, never the model's claims.
async function findEvent(
  deps: EventDeps,
  topic: Topic,
  now: Date,
): Promise<{ event: FoundEvent; urls: string[]; searched: boolean } | null> {
  const from = utcDay(new Date(now.getTime() + FROM_DAYS * DAY_MS));
  const to = utcDay(new Date(now.getTime() + TO_DAYS * DAY_MS));
  const costs: CallCost[] = [];
  try {
    const answer = await deps.llm.groundedAnswer({
      model: deps.answerModel,
      instructionVersion: 'event.v1',
      system: loadInstruction('event.v1'),
      input: JSON.stringify({
        topic: topic.name,
        examples: topic.events,
        today: utcDay(now),
        from,
        to,
      }),
    });
    costs.push(...answer.costs);
    const start = answer.text.indexOf('{');
    const end = answer.text.lastIndexOf('}');
    const parsed = Answer.safeParse(
      start >= 0 ? JSON.parse(answer.text.slice(start, end + 1)) : null,
    );
    if (!parsed.success || !parsed.data.found) return null;
    const { name, date, place } = parsed.data;
    if (date < from || date > to) return null; // the window is the code's, not the model's
    const event = { name, date, place };
    // The proposer often answers from memory with no links (2026-11-08), so the pages come from a search of our own.
    if (answer.urls.length < 2) {
      const urls = [
        ...new Set([...answer.urls, ...(await searchSources(deps, event))]),
      ];
      return { event, urls: urls.slice(0, MAX_PAGES), searched: true };
    }
    return { event, urls: answer.urls.slice(0, MAX_PAGES), searched: false };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof LlmSchemaError) return null;
    throw error; // an outage fails the run; nothing is posted
  } finally {
    await saveCosts(deps, costs);
  }
}

// Our own grounded search for pages about one event; its cost is saved here, whatever happens.
async function searchSources(deps: EventDeps, event: FoundEvent): Promise<string[]> {
  const search = await deps.llm.groundedSearch({
    model: deps.normalizerModel,
    instructionVersion: 'event-sources.v1',
    system: loadInstruction('event-sources.v1'),
    input: JSON.stringify(event),
  });
  await saveCosts(deps, search.costs);
  return search.urls;
}

// The second chance's search: a malformed answer skips it, as one in findEvent skips the topic; an outage still fails the run.
async function searchSourcesOrNone(
  deps: EventDeps,
  event: FoundEvent,
): Promise<string[]> {
  try {
    return await searchSources(deps, event);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof LlmSchemaError) return [];
    throw error;
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return 'a malformed link';
  }
};

async function readPages(
  deps: EventDeps,
  urls: readonly string[],
): Promise<{ pages: ReadPage[]; unread: string[] }> {
  const pages: ReadPage[] = [];
  const unread: string[] = [];
  for (const url of urls) {
    try {
      const page = await deps.fetchPage(url);
      pages.push({ url: page.url, text: page.text });
    } catch (error) {
      // A page that cannot be read does not count (FR-020). The URL is dropped: a search redirect hides the reason.
      unread.push(String(error).replace(url, hostOf(url)).slice(0, 200));
    }
  }
  return { pages, unread };
}

// Reserved before posting and never retried (INIT_SPEC §6.7), in the day's own-post slot.
async function publish(
  deps: EventDeps,
  now: Date,
  text: string,
  event: FoundEvent,
  payload: EventPayload,
): Promise<EventRunResult> {
  if (deps.dryRun) {
    log('info', 'feed dry run: would post an event', {
      event: 'feed.dry_run_event',
      ...payload,
    });
    return { done: 'logged' };
  }
  const slot = await reserveSlot(deps.db, {
    kind: 'event',
    day: utcDay(now),
    payload,
  });
  if (!slot) return { done: 'slot_taken' };
  const image = await poster(deps, payload.topic, event);
  let postedId: string;
  try {
    postedId = (await deps.postText(text, image ?? undefined)).id;
  } catch (error) {
    await recordPostFailure(deps.db, slot.id, error);
    captureError(error, { event: 'feed.event_failed', ...payload });
    return { done: 'failed', error: errorText(error) };
  }
  await markPosted(deps.db, slot.id, postedId);
  await recordFeedPost(deps, X_POST_CREATE_USD);
  log('info', 'event posted', {
    event: 'feed.event_posted',
    posted_id: postedId,
    ...payload,
  });
  return { done: 'posted' };
}

async function poster(
  deps: EventDeps,
  topicId: string,
  event: FoundEvent,
): Promise<Buffer | null> {
  if (!deps.makePoster) return null;
  try {
    return await deps.makePoster(topicId, event);
  } catch (error) {
    log('info', 'no poster; posting the text alone', {
      event: 'feed.poster_failed',
      error: String(error),
    });
    return null;
  }
}
