import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadCoreConfig } from '../config.js';
import * as schema from './schema.js';

// prepare:false — the Supabase pooler does not support prepared statements (research R1).
export function createDb(url: string) {
  const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), sql };
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

export async function closeDb(): Promise<void> {
  if (!connection) return;
  await connection.sql.end({ timeout: 5 });
  connection = undefined;
}
