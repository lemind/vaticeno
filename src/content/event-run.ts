// The bot's own event post (spec 005 US3a): a random topic in season, a model with web search proposes the nearest
// big event, two pages the code reads confirm it, and a fixed template says it. Tue–Thu, only in a free own-post
// slot; at most three topics, then nothing that day.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { feedPosts } from '../db/schema.js';
import { type CallCost, LlmSchemaError } from '../llm/client.js';
import { loadInstruction } from '../llm/instructions.js';
import { log } from '../log.js';
import { captureError } from '../observe.js';
import type { PageFetcher } from '../resolve/fetch.js';
import { X_POST_CREATE_USD } from '../x/prices.js';
import { confirmedBy, type FoundEvent, type ReadPage } from './event-check.js';
import { eventPostText } from './event-post.js';
import type { OriginalDeps } from './original-run.js';
import { saveCosts } from './quote.js';
import { markPosted, recordPostFailure, reserveSlot, utcDay } from './slots.js';
import { overSpendCap, recordFeedPost } from './spend.js';
import { TOPICS, type Topic } from './topics.js';

export type EventDeps = OriginalDeps & {
  fetchPage: PageFetcher;
  // The poster (FR-024): null, or a throw, means the post goes out as text.
  makePoster?: (topicId: string) => Promise<Buffer | null>;
};
export type EventRunResult = {
  done: 'cap_reached' | 'slot_taken' | 'no_event' | 'logged' | 'posted' | 'failed';
};

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
    .filter((p): p is EventPayload => !!p);
  const seen = new Set(posted.map((p) => `${p.name.toLowerCase()}|${p.date}`));
  const tried = new Set<string>(posted[0] ? [posted[0].topic] : []); // never the last topic again

  for (let i = 0; i < MAX_TOPICS; i++) {
    const open = TOPICS.filter(
      (t) => t.months.includes(now.getUTCMonth() + 1) && !tried.has(t.id),
    );
    const topic = open[Math.floor(random() * open.length)];
    if (!topic) break;
    tried.add(topic.id);
    const found = await findEvent(deps, topic, now);
    if (!found) continue;
    const { event, urls } = found;
    if (seen.has(`${event.name.toLowerCase()}|${event.date}`)) continue;
    const hosts = confirmedBy(event, await readPages(deps, urls));
    if (hosts.length < 2) {
      log('info', 'event not confirmed by two sites', {
        event: 'feed.event_unconfirmed',
        topic: topic.id,
        name: event.name,
        hosts,
      });
      continue;
    }
    const text = eventPostText(event, random);
    if (!text) continue;
    return publish(deps, now, text, {
      topic: topic.id,
      name: event.name,
      date: event.date,
    });
  }
  log('info', 'no event post today', { event: 'feed.no_event', tried: [...tried] });
  return { done: 'no_event' };
}

// One grounded call. The URLs are the search's own, never the model's claims.
async function findEvent(
  deps: EventDeps,
  topic: Topic,
  now: Date,
): Promise<{ event: FoundEvent; urls: string[] } | null> {
  const from = utcDay(new Date(now.getTime() + FROM_DAYS * DAY_MS));
  const to = utcDay(new Date(now.getTime() + TO_DAYS * DAY_MS));
  const costs: CallCost[] = [];
  try {
    const answer = await deps.llm.groundedAnswer({
      model: deps.normalizerModel,
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
    return { event: { name, date, place }, urls: answer.urls.slice(0, MAX_PAGES) };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof LlmSchemaError) return null;
    throw error; // an outage fails the run; nothing is posted
  } finally {
    await saveCosts(deps, costs);
  }
}

async function readPages(
  deps: EventDeps,
  urls: readonly string[],
): Promise<ReadPage[]> {
  const pages: ReadPage[] = [];
  for (const url of urls) {
    try {
      const page = await deps.fetchPage(url);
      pages.push({ url: page.url, text: page.text });
    } catch {
      // A page that cannot be read does not count (FR-020).
    }
  }
  return pages;
}

// Reserved before posting and never retried (INIT_SPEC §6.7), in the day's own-post slot.
async function publish(
  deps: EventDeps,
  now: Date,
  text: string,
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
  const image = await poster(deps, payload.topic);
  let postedId: string;
  try {
    postedId = (await deps.postText(text, image ?? undefined)).id;
  } catch (error) {
    await recordPostFailure(deps.db, slot.id, error);
    captureError(error, { event: 'feed.event_failed', ...payload });
    return { done: 'failed' };
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

async function poster(deps: EventDeps, topicId: string): Promise<Buffer | null> {
  if (!deps.makePoster) return null;
  try {
    return await deps.makePoster(topicId);
  } catch (error) {
    log('info', 'no poster; posting the text alone', {
      event: 'feed.poster_failed',
      error: String(error),
    });
    return null;
  }
}
