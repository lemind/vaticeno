import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadCoreConfig } from '../config.js';
import * as schema from './schema.js';

// prepare:false — the Supabase pooler does not support prepared statements (research R1).
export function createDb(url: string) {
  const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), sql, locks: createLockPool(url) };
}

// Job locks get their own connections. A session-level advisory lock must hold one connection for the
// whole run, and at :00 of the hour five jobs start at once — on the query pool that is all five of its
// connections, so every query inside those jobs waits for one that can never free. That deadlocked
// production on 2026-10-13 08:00 until systemd killed it.
function createLockPool(url: string) {
  return postgres(url, { max: 6, prepare: false, onnotice: () => {} });
}

export type Db = ReturnType<typeof createDb>['db'];

let connection: ReturnType<typeof createDb> | undefined;

// Lazily connects on first use so importing this module never opens a connection.
export function getDb(): Db {
  connection ??= createDb(loadCoreConfig().DATABASE_URL);
  return connection.db;
}

// Raw postgres.js handle, for what Drizzle does not cover (advisory locks).
export function getSql() {
  getDb();
  return connection!.sql;
}

// The pool the job locks reserve from, never the query pool (see createLockPool).
export function getLockSql() {
  getDb();
  return connection!.locks;
}

export async function closeDb(): Promise<void> {
  if (!connection) return;
  await Promise.all([connection.sql.end({ timeout: 5 }), connection.locks.end({ timeout: 5 })]);
  connection = undefined;
}
