// Structured JSON lines to stdout (INIT_SPEC §8: no bare console.log), also forwarded to Sentry Logs
// when observability is initialised (research R11). Fields that could carry content are dropped.
import * as Sentry from '@sentry/node';

type Level = 'info' | 'warn' | 'error';

// FR-029: post text, quotes and page text never reach a log line.
const CONTENT_FIELDS = new Set(['text', 'quote', 'body', 'prompt']);

export function scrubFields(fields: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!CONTENT_FIELDS.has(key)) clean[key] = value;
  }
  return clean;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const clean = scrubFields(fields);
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...clean }) + '\n');
  // No-op until Sentry.init ran with a DSN.
  Sentry.logger[level](msg, clean);
}
