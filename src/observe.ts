// Sentry: errors, logs, alerts and one cron monitor (research R11). Everything is a no-op without SENTRY_DSN.
import * as Sentry from '@sentry/node';
import { log, scrubFields } from './log.js';

let enabled = false;

export function initObservability(service: string, dsn: string | undefined): void {
  if (!dsn || enabled) return;
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
  if (enabled) Sentry.captureMessage(event, { level: 'warning', tags: { event }, extra: scrubFields(fields) });
}

export function captureError(error: unknown, fields: Record<string, unknown> = {}): void {
  log('error', error instanceof Error ? error.message : String(error), { event: 'error', ...fields });
  if (enabled) Sentry.captureException(error, { extra: scrubFields(fields) });
}

// Heartbeat for the one cron monitor the free plan allows (the every-minute lock job).
export async function withCronMonitor<T>(slug: string, schedule: string, fn: () => Promise<T>): Promise<T> {
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
