// A throwaway, fully migrated database next to DATABASE_URL (integration tests, seed runs). Dropped on close.
import postgres from 'postgres';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

export async function createScratchDb(adminUrl: string, prefix: string) {
  const name = `${prefix}_${process.pid}_${Date.now()}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database "${name}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  const { db, sql } = createDb(url.toString());
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
      await admin.unsafe(`drop database "${name}" with (force)`);
      await admin.end({ timeout: 5 });
    },
  };
}
