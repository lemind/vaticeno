// Public, read-only web server (contracts/http.md): claim pages, author pages, health. No admin routes.
// `npm run dev` starts it; tests build it with `buildServer` and use `inject`.
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyReply } from 'fastify';
import { loadCoreConfig } from '../config.js';
import { buildContentDeps } from '../content/wire.js';
import { buildBotDeps } from '../bot/wire.js';
import { buildDeps } from '../deps.js';
import { closeDb, type Db, getDb, getLockSql } from '../db/client.js';
import { startScheduler } from '../jobs/scheduler.js';
import { createFileSourceReader } from '../lifecycle/source-reader.js';
import { log } from '../log.js';
import { captureError, flush, initObservability } from '../observe.js';
import { resolverHealth } from '../resolve/resolver.js';
import { homePage } from './home-page.js';
import { authorPage } from './author-page.js';
import { claimPage } from './claim-page.js';
import { html, layout } from './html.js';

export function buildServer(deps: { db: Db; now?: () => Date; botHandle?: string }) {
  const now = deps.now ?? (() => new Date());
  const app = Fastify({ logger: false });

  // The public front page: health, version and the counts. Nothing operational (003 FR-004).
  app.get('/', async (_request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(await homePage(deps.db, now(), deps.botHandle)),
  );

  app.get<{ Params: { slug: string } }>('/c/:slug', async (request, reply) => {
    const page = await claimPage(deps.db, request.params.slug, now());
    return page
      ? reply.type('text/html; charset=utf-8').send(page)
      : notFound(reply);
  });

  app.get<{ Params: { id: string } }>('/u/:id', async (request, reply) => {
    const page = /^\d{1,20}$/.test(request.params.id)
      ? await authorPage(deps.db, request.params.id)
      : null;
    return page
      ? reply.type('text/html; charset=utf-8').send(page)
      : notFound(reply);
  });

  app.get('/healthz', async (_request, reply) => {
    try {
      return { ok: true, db: 'up', ...(await resolverHealth(deps.db, now())) };
    } catch (error) {
      captureError(error, { event: 'healthz.db_down' });
      return reply.code(503).send({ ok: false, db: 'down' });
    }
  });

  app.setNotFoundHandler((_request, reply) => notFound(reply));
  app.setErrorHandler((error, request, reply) => {
    captureError(error, { event: 'web.error', url: request.url });
    return reply
      .code(500)
      .type('text/html; charset=utf-8')
      .send(layout('Error', html`<h1>Something went wrong</h1>`));
  });
  return app;
}

function notFound(reply: FastifyReply) {
  return reply
    .code(404)
    .type('text/html; charset=utf-8')
    .send(
      layout(
        'Not found',
        html`<h1>Not found</h1>
          <p class="muted">No such claim or author.</p>`,
      ),
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadCoreConfig();
  initObservability('web', config.SENTRY_DSN);
  // Crash, don't limp on: systemd restarts a clean process (constitution III: failures are visible).
  const die = async (error: unknown, event: string) => {
    captureError(error, { event });
    await flush();
    process.exit(1);
  };
  process.on(
    'unhandledRejection',
    (error) => void die(error, 'process.unhandled_rejection'),
  );
  process.on(
    'uncaughtException',
    (error) => void die(error, 'process.uncaught_exception'),
  );

  const app = buildServer({ db: getDb(), botHandle: config.X_BOT_HANDLE });
  // Caddy in front terminates HTTPS; the app is never reachable directly from outside.
  await app.listen({ port: config.PORT, host: '127.0.0.1' });
  const deps = buildDeps(config);
  const bot = config.ENABLE_X ? buildBotDeps(deps) : null;
  const content = config.ENABLE_FEED ? buildContentDeps(deps, config) : null;
  // On X the lock job re-reads the real post; without X, the Stage 0 simulation file.
  const scheduler = config.ENABLE_JOBS
    ? await startScheduler({
        ...deps,
        x: bot?.x, // follower-count claims read the X API; without X they wait as an outage (004 T420)
        reader: bot?.reader ?? createFileSourceReader(),
        sql: getLockSql(),
        bot,
        content,
      })
    : null; // started only once the server is up
  log('info', 'web server listening', {
    event: 'web.started',
    port: config.PORT,
    jobs: config.ENABLE_JOBS,
    x: Boolean(bot),
    feed: content ? (config.FEED_DRY_RUN ? 'dry_run' : 'live') : 'off',
  });
  const stop = async () => {
    try {
      await scheduler?.stop();
      await app.close();
      await flush();
      await closeDb();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
