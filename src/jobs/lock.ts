import type { Sql } from 'postgres';
import { log } from '../log.js';

// One run of a job at a time, across cron and manual `jobs:tick` (data-model "Resolver schedule").
// Session-level advisory lock on a reserved connection: needs the session pooler, not the transaction one.
export async function withJobLock<T>(sql: Sql, name: string, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false }> {
  const conn = await sql.reserve();
  try {
    const [row] = await conn<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtext(${`job:${name}`})) as locked`;
    if (!row?.locked) {
      log('info', 'job already running elsewhere; skipped', { event: 'job.skipped', job: name });
      return { ran: false };
    }
    try {
      return { ran: true, result: await fn() };
    } finally {
      await conn`select pg_advisory_unlock(hashtext(${`job:${name}`}))`;
    }
  } finally {
    conn.release();
  }
}
