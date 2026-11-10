// npm run content:queue -- add "<text>" [--on YYYY-MM-DD] [--source https://… --checked YYYY-MM-DD] | load-starters
// | list | remove <id> — the owner's queue (spec 002 US2, 005 US3). The bot posts today's dated item, else the next
// undated one, once a day; no AI ever writes or edits one.
import { parseArgs } from 'node:util';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { feedQueue } from '../db/schema.js';
import {
  hasTagsOrLinks,
  weightedLength,
  X_MAX_CHARS,
} from '../replies/templates.js';
import { STARTER_POSTS } from '../content/starter-posts.js';
import { printJson, runCli } from './run.js';
import { getDb } from '../db/client.js';
import { blockedSlugs, withoutSlugs } from '../content/claim-guard.js';
import { utcDay } from '../content/slots.js';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

await runCli('content-queue', async (config) => {
  const [command, ...rest] = process.argv.slice(2);
  const db = getDb();

  if (command === 'add') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        on: { type: 'string' },
        source: { type: 'string' },
        checked: { type: 'string' },
      },
    });
    const text = positionals.join(' ').trim();
    if (!text)
      throw new Error('nothing to add: npm run content:queue -- add "your post"');
    const length = weightedLength(text);
    if (length > X_MAX_CHARS)
      throw new Error(
        `that is ${length} characters as X counts them; the limit is ${X_MAX_CHARS}`,
      );
    // Our own posts carry no tags, links or hashtags, except a claim's own slug (constitution VI).
    if (hasTagsOrLinks(withoutSlugs(text)))
      throw new Error(
        'an own post carries no @handles, hashtags or links (a claim slug is fine)',
      );
    const blocked = await blockedSlugs(db, text, config.FEED_SHOW_AUTHOR_IDS);
    if (blocked.length > 0)
      throw new Error(
        `a claim whose author is not on FEED_SHOW_AUTHOR_IDS: ${blocked.join(', ')}`,
      );
    const postOn = values.on ?? null;
    if (postOn) {
      if (!ISO_DAY.test(postOn) || Number.isNaN(Date.parse(postOn)))
        throw new Error('--on takes YYYY-MM-DD');
      if (postOn < utcDay(new Date())) throw new Error('--on is in the past');
      // Monday and Friday are the record's days (005 FR-009): a dated post there would be crowded out.
      const weekday = new Date(`${postOn}T00:00:00Z`).getUTCDay();
      if (weekday === 1 || weekday === 5)
        throw new Error(
          '--on cannot be a Monday or a Friday: the weekly record posts then',
        );
    }
    if (values.source || values.checked) {
      if (
        !values.source?.startsWith('https://') ||
        !values.checked ||
        !ISO_DAY.test(values.checked) ||
        !postOn
      )
        throw new Error(
          'an event post needs --source https://…, --checked YYYY-MM-DD and --on YYYY-MM-DD',
        );
    }
    const [{ next } = { next: 1 }] = await db
      .select({ next: sql<number>`coalesce(max(${feedQueue.position}), 0) + 1` })
      .from(feedQueue);
    const [row] = await db
      .insert(feedQueue)
      .values({
        text,
        position: next,
        postOn,
        sourceUrl: values.source ?? null,
        checkedOn: values.checked ?? null,
      })
      .returning({ id: feedQueue.id, position: feedQueue.position });
    printJson({
      added: row!.id,
      position: row!.position,
      characters: length,
      post_on: postOn,
    });
    return;
  }

  if (command === 'load-starters') {
    const existing = new Set(
      (await db.select({ text: feedQueue.text }).from(feedQueue)).map(
        (row) => row.text,
      ),
    );
    let position =
      (
        await db
          .select({ next: sql<number>`coalesce(max(${feedQueue.position}), 0) + 1` })
          .from(feedQueue)
      )[0]?.next ?? 1;
    for (const text of STARTER_POSTS) {
      const length = weightedLength(text);
      if (length > X_MAX_CHARS || hasTagsOrLinks(text))
        throw new Error(
          `a starter post does not fit X's rules: ${text.slice(0, 40)}…`,
        );
      if (existing.has(text)) {
        printJson({ skipped: text.slice(0, 40) });
        continue;
      }
      await db.insert(feedQueue).values({ text, position });
      printJson({ added: position, characters: length, text });
      position += 1;
    }
    printJson({ loaded: STARTER_POSTS.length });
    return;
  }

  if (command === 'list') {
    const rows = await db.select().from(feedQueue).orderBy(asc(feedQueue.position));
    for (const row of rows)
      printJson({
        id: row.id,
        position: row.position,
        post_on: row.postOn,
        source: row.sourceUrl ? new URL(row.sourceUrl).host : null,
        checked_on: row.checkedOn,
        posted_at: row.postedAt,
        missed_at: row.missedAt,
        text: row.text,
      });
    const [waiting] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(feedQueue)
      .where(isNull(feedQueue.postedAt));
    printJson({ queued: rows.length, unposted: waiting?.n ?? 0 });
    return;
  }

  if (command === 'remove') {
    const id = rest[0];
    if (!id) throw new Error('which item? npm run content:queue -- remove <id>');
    const removed = await db
      .delete(feedQueue)
      .where(eq(feedQueue.id, id))
      .returning({ id: feedQueue.id });
    printJson({ removed: removed[0]?.id ?? null });
    return;
  }

  throw new Error('commands: add "<text>" | load-starters | list | remove <id>');
});
