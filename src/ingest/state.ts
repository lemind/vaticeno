import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

// POC stand-in for the `ingest_state` table (INIT_SPEC §3). Replaced by Postgres later.
const IngestStateSchema = z.object({
  mentions_since_id: z.string().optional(),
  last_successful_poll_at: z.string().optional(),
  // POC stand-in for processed_mentions.reply_state='posted' (§6.1): never reply twice.
  replied_tweet_ids: z.array(z.string()).default([]),
  // Sent replies from the last 24h, for the §6.1 rate caps.
  reply_log: z.array(z.object({ author_id: z.string(), at: z.string() })).default([]),
});

export type IngestState = z.infer<typeof IngestStateSchema>;

export const DEFAULT_STATE_PATH = '.state/ingest.json';

export async function readIngestState(path = DEFAULT_STATE_PATH): Promise<IngestState> {
  try {
    return IngestStateSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return IngestStateSchema.parse({});
    throw error;
  }
}

export async function writeIngestState(state: IngestState, path = DEFAULT_STATE_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(state, null, 2) + '\n');
  await rename(tmpPath, path); // atomic swap: a crash never leaves a half-written cursor
}
