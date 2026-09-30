import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

// Applies every pending migration in drizzle/ (schema, then hand-written triggers and RLS).
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, sql } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
