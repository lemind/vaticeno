// The weekly Hong Kong race post (spec 005 FR-025, owner 2026-11-13): every weekend's biggest race at Sha Tin or
// Happy Valley, with the five shortest prices and a range for the rest. Friday, Saturday as the retry; once a weekend.
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { feedPosts } from '../db/schema.js';
import { type CallCost, LlmSchemaError } from '../llm/client.js';
import { loadInstruction } from '../llm/instructions.js';
import { log } from '../log.js';
import { captureError } from '../observe.js';
import { X_POST_CREATE_USD } from '../x/prices.js';
import { confirmedBy, pageCheck, type ReadPage } from './event-check.js';
import { racePosterPrompt } from './event-image.js';
import { readPages, type EventDeps } from './event-run.js';
import { priced, racePostText, restLine, TOP, type FoundRace } from './race-post.js';
import { saveCosts } from './quote.js';
import { markPosted, recordPostFailure, reserveSlot, utcDay } from './slots.js';
import { overSpendCap, recordFeedPost } from './spend.js';

export type RaceDeps = EventDeps & {
  // The poster from a finished prompt: null, or a throw, means the post goes out as text.
  drawPoster?: (prompt: string) => Promise<Buffer | null>;
};
export type RaceRunResult = {
  done:
    'cap_reached' | 'already_posted' | 'no_race' | 'logged' | 'posted' | 'failed';
};

export const RACE_TOPIC = 'hk-racing';
const MAX_PAGES = 4;
const DAY_MS = 86_400_000;

const Answer = z.union([
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    name: z.string().min(3).max(60),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    course: z.string().max(30),
    runners: z
      .array(
        z.object({ horse: z.string().min(2).max(30), odds: z.string().max(12) }),
      )
      .max(20),
  }),
]);

// The coming Saturday and Sunday, at most three days ahead: Friday → both, Saturday → Sunday.
export function weekendDays(now: Date): string[] {
  const days: string[] = [];
  for (let ahead = 1; ahead <= 3; ahead++) {
    const day = new Date(now.getTime() + ahead * DAY_MS);
    if (day.getUTCDay() === 6 || day.getUTCDay() === 0) days.push(utcDay(day));
  }
  return days;
}

export async function runRacePost(
  deps: RaceDeps,
  now: Date,
  random: () => number = Math.random,
): Promise<RaceRunResult> {
  if (await overSpendCap(deps, now)) return { done: 'cap_reached' };
  const days = weekendDays(now);
  // Once a weekend: any row of Friday's, posted or not, stops Saturday's retry (a failed post is never retried).
  const [posted] = await deps.db
    .select({ id: feedPosts.id })
    .from(feedPosts)
    .where(
      and(
        eq(feedPosts.kind, 'event'),
        sql`${feedPosts.payload}->>'topic' = ${RACE_TOPIC}`,
        sql`${feedPosts.payload}->>'date' >= ${utcDay(now)}`,
      ),
    )
    .limit(1);
  if (posted || !days.length) return { done: 'already_posted' };

  const found = await findRace(deps, now, days);
  if (!found) return noRace('no race found', {});
  const { race, urls } = found;
  const field = priced(race.runners);
  const { pages, unread } = await readPages(deps, urls);
  const event = { name: race.name, date: race.date, place: race.course };
  const hosts = confirmedBy(event, pages);
  // Two sites give the race and its day; the five named horses each appear on a page the code read.
  const unseen = field.slice(0, TOP).filter((r) => !onAPage(r.horse, pages));
  if (hosts.length < 2 || field.length < TOP || unseen.length)
    return noRace('race not confirmed', {
      name: race.name,
      date: race.date,
      hosts,
      priced: field.length,
      unseen: unseen.map((r) => r.horse),
      pages: pages.map((p) => pageCheck(event, p)),
      unread,
    });
  const text = racePostText(race, field);
  if (!text) return noRace('race post does not fit', { name: race.name });
  const rest = restLine(field);
  const board = [
    ...field.slice(0, TOP).map((r) => `${r.horse} ${r.odds}`),
    ...(rest ? [rest] : []),
  ];
  return publish(deps, now, text, racePosterPrompt(race, board, random), {
    topic: RACE_TOPIC,
    name: race.name,
    date: race.date,
  });
}

const onAPage = (horse: string, pages: readonly ReadPage[]) =>
  pages.some((p) => p.text.toLowerCase().includes(horse.toLowerCase()));

function noRace(message: string, fields: Record<string, unknown>): RaceRunResult {
  log('info', message, { event: 'feed.no_race', ...fields });
  return { done: 'no_race' };
}

// One grounded call; the pages are the search's own, topped up by a search of ours when it gave fewer than two.
async function findRace(
  deps: RaceDeps,
  now: Date,
  days: string[],
): Promise<{ race: FoundRace; urls: string[] } | null> {
  const costs: CallCost[] = [];
  try {
    const answer = await deps.llm.groundedAnswer({
      model: deps.answerModel,
      instructionVersion: 'race.v1',
      system: loadInstruction('race.v1'),
      input: JSON.stringify({ today: utcDay(now), days }),
    });
    costs.push(...answer.costs);
    const start = answer.text.indexOf('{');
    const end = answer.text.lastIndexOf('}');
    const parsed = Answer.safeParse(
      start >= 0 ? JSON.parse(answer.text.slice(start, end + 1)) : null,
    );
    if (!parsed.success || !parsed.data.found) return null;
    const { found: _, ...race } = parsed.data;
    if (!days.includes(race.date)) return null; // the weekend is the code's, not the model's
    let urls = answer.urls;
    if (urls.length < 2) {
      const search = await deps.llm.groundedSearch({
        model: deps.normalizerModel,
        instructionVersion: 'event-sources.v1',
        system: loadInstruction('event-sources.v1'),
        input: JSON.stringify({
          name: race.name,
          date: race.date,
          place: race.course,
        }),
      });
      costs.push(...search.costs);
      urls = [...new Set([...urls, ...search.urls])];
    }
    return { race, urls: urls.slice(0, MAX_PAGES) };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof LlmSchemaError) return null;
    throw error; // an outage fails the run; nothing is posted
  } finally {
    await saveCosts(deps, costs);
  }
}

// Its own slot beyond the day's own-post cap, so the weekly post is never crowded out (owner: every week);
// reserved before posting and never retried (INIT_SPEC §6.7).
async function publish(
  deps: RaceDeps,
  now: Date,
  text: string,
  prompt: string,
  payload: { topic: string; name: string; date: string },
): Promise<RaceRunResult> {
  if (deps.dryRun) {
    log('info', 'feed dry run: would post the race', {
      event: 'feed.dry_run_race',
      ...payload,
    });
    return { done: 'logged' };
  }
  const slot = await reserveSlot(
    deps.db,
    { kind: 'event', day: utcDay(now), payload },
    1,
  );
  if (!slot) return { done: 'already_posted' };
  const image = await poster(deps, prompt);
  let postedId: string;
  try {
    postedId = (await deps.postText(text, image ?? undefined)).id;
  } catch (error) {
    await recordPostFailure(deps.db, slot.id, error);
    captureError(error, { event: 'feed.race_failed', ...payload });
    return { done: 'failed' };
  }
  await markPosted(deps.db, slot.id, postedId);
  await recordFeedPost(deps, X_POST_CREATE_USD);
  log('info', 'race posted', {
    event: 'feed.race_posted',
    posted_id: postedId,
    ...payload,
  });
  return { done: 'posted' };
}

async function poster(deps: RaceDeps, prompt: string): Promise<Buffer | null> {
  if (!deps.drawPoster) return null;
  try {
    return await deps.drawPoster(prompt);
  } catch (error) {
    log('info', 'no poster; posting the text alone', {
      event: 'feed.poster_failed',
      error: String(error),
    });
    return null;
  }
}
