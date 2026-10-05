// npm run content:queue -- add "<text>" | load-starters | list | remove <id> — the owner's queue (spec 002
// US2). The bot posts the next unposted item once a day, in order, and no AI ever writes or edits one.
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { feedQueue } from '../db/schema.js';
import { hasTagsOrLinks, weightedLength, X_MAX_CHARS } from '../replies/templates.js';
import { STARTER_POSTS } from '../content/starter-posts.js';
import { printJson, runCli } from './run.js';
import { getDb } from '../db/client.js';

await runCli('content-queue', async () => {
  const [command, ...rest] = process.argv.slice(2);
  const db = getDb();

  if (command === 'add') {
    const text = rest.join(' ').trim();
    if (!text) throw new Error('nothing to add: npm run content:queue -- add "your post"');
    const length = weightedLength(text);
    if (length > X_MAX_CHARS) throw new Error(`that is ${length} characters as X counts them; the limit is ${X_MAX_CHARS}`);
    // Our own posts carry no tags, links or hashtags either (constitution VI 2.4.0).
    if (hasTagsOrLinks(text)) throw new Error('an own post carries no @handles, hashtags or links');
    const [{ next } = { next: 1 }] = await db.select({ next: sql<number>`coalesce(max(${feedQueue.position}), 0) + 1` }).from(feedQueue);
    const [row] = await db.insert(feedQueue).values({ text, position: next }).returning({ id: feedQueue.id, position: feedQueue.position });
    printJson({ added: row!.id, position: row!.position, characters: length });
    return;
  }

  if (command === 'load-starters') {
    const existing = new Set((await db.select({ text: feedQueue.text }).from(feedQueue)).map((row) => row.text));
    let position = (await db.select({ next: sql<number>`coalesce(max(${feedQueue.position}), 0) + 1` }).from(feedQueue))[0]?.next ?? 1;
    for (const text of STARTER_POSTS) {
      const length = weightedLength(text);
      if (length > X_MAX_CHARS || hasTagsOrLinks(text)) throw new Error(`a starter post does not fit X's rules: ${text.slice(0, 40)}…`);
      if (existing.has(text)) { printJson({ skipped: text.slice(0, 40) }); continue; }
      await db.insert(feedQueue).values({ text, position });
      printJson({ added: position, characters: length, text });
      position += 1;
    }
    printJson({ loaded: STARTER_POSTS.length });
    return;
  }

  if (command === 'list') {
    const rows = await db.select().from(feedQueue).orderBy(asc(feedQueue.position));
    for (const row of rows) printJson({ id: row.id, position: row.position, posted_at: row.postedAt, text: row.text });
    const [waiting] = await db.select({ n: sql<number>`count(*)::int` }).from(feedQueue).where(isNull(feedQueue.postedAt));
    printJson({ queued: rows.length, unposted: waiting?.n ?? 0 });
    return;
  }

  if (command === 'remove') {
    const id = rest[0];
    if (!id) throw new Error('which item? npm run content:queue -- remove <id>');
    const removed = await db.delete(feedQueue).where(eq(feedQueue.id, id)).returning({ id: feedQueue.id });
    printJson({ removed: removed[0]?.id ?? null });
    return;
  }

  throw new Error('commands: add "<text>" | load-starters | list | remove <id>');
});
