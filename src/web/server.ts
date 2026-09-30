// Public, read-only web server (contracts/http.md): claim pages, author pages, health. No admin routes.
// `npm run dev` starts it; tests build it with `buildServer` and use `inject`.
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyReply } from 'fastify';
import { and, count, eq, inArray, lte, min, sql } from 'drizzle-orm';
import { loadCoreConfig } from '../config.js';
import { closeDb, type Db, getDb } from '../db/client.js';
import { claims, resolutions } from '../db/schema.js';
import { log } from '../log.js';
import { captureError, initObservability } from '../observe.js';
import { lastResolverRunAt } from '../resolve/resolver.js';
import { authorPage } from './author-page.js';
import { claimPage } from './claim-page.js';
import { html, layout } from './html.js';

export function buildServer(deps: { db: Db; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const app = Fastify({ logger: false });

  app.get<{ Params: { slug: string } }>('/c/:slug', async (request, reply) => {
    const page = await claimPage(deps.db, request.params.slug, now());
    return page ? reply.type('text/html; charset=utf-8').send(page) : notFound(reply);
  });

  app.get<{ Params: { id: string } }>('/u/:id', async (request, reply) => {
    const page = /^\d{1,20}$/.test(request.params.id) ? await authorPage(deps.db, request.params.id) : null;
    return page ? reply.type('text/html; charset=utf-8').send(page) : notFound(reply);
  });

  app.get('/healthz', async (_request, reply) => {
    try {
      const at = now();
      const due = and(inArray(claims.status, ['locked', 'resolving']), lte(claims.nextCheckAt, at),
        sql`not exists (select 1 from ${resolutions} r where r.claim_id = ${claims.id})`);
      const [dueRow] = await deps.db.select({ n: count(), oldest: min(claims.nextCheckAt) }).from(claims).where(due);
      const [humanRow] = await deps.db.select({ n: count() }).from(resolutions).where(eq(resolutions.reviewStatus, 'needs_human'));
      const oldest = dueRow?.oldest ? new Date(dueRow.oldest) : null;
      return {
        ok: true, db: 'up', claims_due: dueRow?.n ?? 0,
        oldest_due_age_min: oldest ? Math.floor((at.getTime() - oldest.getTime()) / 60_000) : null,
        needs_human: humanRow?.n ?? 0,
        last_resolver_run_at: lastResolverRunAt()?.toISOString() ?? null,
      };
    } catch (error) {
      captureError(error, { event: 'healthz.db_down' });
      return reply.code(503).send({ ok: false, db: 'down' });
    }
  });

  app.setNotFoundHandler((_request, reply) => notFound(reply));
  app.setErrorHandler((error, request, reply) => {
    captureError(error, { event: 'web.error', url: request.url });
    return reply.code(500).type('text/html; charset=utf-8').send(layout('Error', html`<h1>Something went wrong</h1>`));
  });
  return app;
}

function notFound(reply: FastifyReply) {
  return reply.code(404).type('text/html; charset=utf-8').send(layout('Not found', html`<h1>Not found</h1><p class="muted">No such claim or author.</p>`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadCoreConfig();
  initObservability('web', config.SENTRY_DSN);
  const app = buildServer({ db: getDb() });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  log('info', 'web server listening', { event: 'web.started', port: config.PORT });
  const stop = async () => { await app.close(); await closeDb(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
