// Sentry: errors, logs, alerts and one cron monitor (research R11). Production only: a no-op without
// SENTRY_DSN or unless NODE_ENV=production (set in the droplet's .env), so local runs never report.
import * as Sentry from '@sentry/node';
import { log, scrubFields } from './log.js';

let enabled = false;

export function initObservability(service: string, dsn: string | undefined): void {
  if (!dsn || enabled || process.env.NODE_ENV !== 'production') return;
  Sentry.init({
    dsn,
    // FR-029: nothing that could carry post text, quotes or page text leaves the server.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    initialScope: { tags: { service } },
    beforeSend(event) {
      if (event.extra) event.extra = scrubFields(event.extra);
      delete event.request?.data;
      return event;
    },
    beforeSendLog(entry) {
      if (entry.attributes) entry.attributes = scrubFields(entry.attributes);
      return entry;
    },
  });
  enabled = true;
}

// Something a human must look at: needs_human, budget breach, a job failing repeatedly. Sentry → email.
export function alert(event: string, fields: Record<string, unknown> = {}): void {
  log('warn', event, { event, alert: true, ...fields });
  if (enabled)
    Sentry.captureMessage(event, {
      level: 'warning',
      tags: { event },
      extra: scrubFields(fields),
    });
}

// An error in one plain line: its kind, its message and what caused it, for logs and the owner's email.
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 300);
  const cause = error.cause ? ` (cause: ${String(error.cause)})` : '';
  return `${error.name}: ${error.message}${cause}`.slice(0, 300);
}

export function captureError(
  error: unknown,
  fields: Record<string, unknown> = {},
): void {
  log('error', error instanceof Error ? error.message : String(error), {
    event: 'error',
    ...fields,
  });
  if (enabled) Sentry.captureException(error, { extra: scrubFields(fields) });
}

// The owner's email when a scheduled job did not do its work (owner 2026-11-19): a Sentry issue per job per UTC day,
// so the project's "new issue" alert mails it once a day at most, with the reason as its title.
export function notifyOwner(job: string, reason: string): void {
  log('warn', `${job} not done: ${reason}`, {
    event: 'job.not_done',
    alert: true,
    job,
  });
  if (!enabled) return;
  // A warning: the job ran and skipped its work; a crash is reported as an error by captureError too (owner 2026-11-21).
  Sentry.withScope((scope) => {
    // HACK(sentry): OBSERVED 2026-11-21 — a message with no transaction is mailed as "None: …". See docs/server.md.
    // REVISIT: if Sentry's mail titles change.
    scope.setTransactionName(`job ${job}`);
    Sentry.captureMessage(`${job} not done: ${reason}`.slice(0, 2000), {
      level: 'warning',
      tags: { event: 'job.not_done', job },
      fingerprint: ['job.not_done', job, new Date().toISOString().slice(0, 10)],
    });
  });
}

// Heartbeat for the one cron monitor the free plan allows (the every-minute lock job).
export async function withCronMonitor<T>(
  slug: string,
  schedule: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!enabled) return fn();
  return Sentry.withMonitor(slug, fn, {
    schedule: { type: 'crontab', value: schedule },
    checkinMargin: 5,
    maxRuntime: 10,
    timezone: 'Etc/UTC',
  });
}

// CLIs exit right after their work; without this, queued events are lost.
export async function flush(): Promise<void> {
  if (enabled) await Sentry.flush(5000);
}
