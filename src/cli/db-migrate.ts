import { loadCoreConfig } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { log } from '../log.js';

try {
  await runMigrations(loadCoreConfig().DATABASE_URL);
  log('info', 'migrations applied', { event: 'db.migrated' });
} catch (error) {
  log('error', 'migration failed', { event: 'db.migrate_failed', error: String(error) });
  process.exitCode = 1;
}
