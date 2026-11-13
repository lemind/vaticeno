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
import { racePosterPrompt } from './event-image.js';
import type { EventDeps } from './event-run.js';
import {
  biggestRace,
  readHtml,
  type CardRace,
  type HtmlReader,
} from './race-card.js';
import {
  priced,
  racePostText,
  restLine,
  TOP,
  type FoundRace,
  type PricedRunner,
  type Runner,
} from './race-post.js';
import { saveCosts } from './quote.js';
import { markPosted, recordPostFailure, reserveSlot, utcDay } from './slots.js';
import { overSpendCap, recordFeedPost } from './spend.js';

export type RaceDeps = EventDeps & {
  // The poster from a finished prompt: null, or a throw, means the post goes out as text.
  drawPoster?: (prompt: string) => Promise<Buffer | null>;
  readHtml?: HtmlReader; // the race cards; tests pass their own
};
export type RaceRunResult = {
  done:
    'cap_reached' | 'already_posted' | 'no_race' | 'logged' | 'posted' | 'failed';
};

export const RACE_TOPIC = 'hk-racing';
const DAY_MS = 86_400_000;

const Answer = z.object({
  runners: z
    .array(z.object({ horse: z.string().max(40), odds: z.string().max(12) }))
    .max(20),
});

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

  // The race and its horses come from the Jockey Club's own card, read by the code; the model only prices them.
  const card = await biggestRace(deps.readHtml ?? readHtml, days);
  if (!card) return noRace('no race card for the weekend', { days });
  const race: FoundRace = { ...card, runners: await priceRace(deps, card) };
  const field = priced(race.runners);
  if (field.length < TOP)
    return noRace('race not priced', {
      name: race.name,
      date: race.date,
      priced: field.length,
    });
  if (!racePostText(race, field))
    return noRace('race post does not fit', { name: race.name });
  const rest = restLine(field);
  const board = [
    ...field.slice(0, TOP).map((r) => `${r.horse} ${r.odds}`),
    ...(rest ? [rest] : []),
  ];
  return publish(deps, now, race, field, racePosterPrompt(race, board, random), {
    topic: RACE_TOPIC,
    name: race.name,
    date: race.date,
  });
}

function noRace(message: string, fields: Record<string, unknown>): RaceRunResult {
  log('info', message, { event: 'feed.no_race', ...fields });
  return { done: 'no_race' };
}

// One grounded call for the card's horses; a horse the card does not name is dropped.
async function priceRace(deps: RaceDeps, card: CardRace): Promise<Runner[]> {
  const costs: CallCost[] = [];
  try {
    const answer = await deps.llm.groundedAnswer({
      model: deps.answerModel,
      instructionVersion: 'race.v2',
      system: loadInstruction('race.v2'),
      input: JSON.stringify({
        race: card.name,
        date: card.date,
        course: card.course,
        race_no: card.raceNo,
        horses: card.horses,
      }),
    });
    costs.push(...answer.costs);
    const start = answer.text.indexOf('{');
    const end = answer.text.lastIndexOf('}');
    const parsed = Answer.safeParse(
      start >= 0 ? JSON.parse(answer.text.slice(start, end + 1)) : null,
    );
    if (!parsed.success) return [];
    const byName = new Map(card.horses.map((h) => [h.toLowerCase(), h]));
    const seen = new Set<string>();
    return parsed.data.runners.flatMap((r) => {
      const horse = byName.get(r.horse.trim().toLowerCase());
      if (!horse || seen.has(horse)) return [];
      seen.add(horse);
      return [{ horse, odds: r.odds }];
    });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof LlmSchemaError) return [];
    throw error; // an outage fails the run; nothing is posted
  } finally {
    await saveCosts(deps, costs);
  }
}

// A second slot when the day's own post is taken, so the weekly post is never crowded out (owner: every week);
// reserved before posting and never retried (INIT_SPEC §6.7).
async function publish(
  deps: RaceDeps,
  now: Date,
  race: FoundRace,
  field: readonly PricedRunner[],
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
  // Checked above with the odds; the short text, for a post that carries the poster, fits whenever that one does.
  const text = racePostText(race, field, !image)!;
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
