// Public, read-only web server (contracts/http.md): claim pages, the wager page, author pages, health. No
// admin routes, and nothing that moves money: the wager page's script talks to the visitor's own wallet.
// `npm run dev` starts it; tests build it with `buildServer` and use `inject`.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyReply } from 'fastify';
import { type CoreConfig, loadCoreConfig } from '../config.js';
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
import { type WagerConfig, wagerPage } from './wager-page.js';

// The wager page's one script and the encoder it imports, read once at start (003 FR-045).
const SCRIPTS = {
  '/assets/wallet.js': readFileSync(new URL('./wallet.js', import.meta.url), 'utf8'),
  '/assets/wallet-abi.js': readFileSync(
    new URL('./wallet-abi.js', import.meta.url),
    'utf8',
  ),
};

export function wagerConfig(config: CoreConfig): WagerConfig | null {
  if (!config.ESCROW_ADDRESS || !config.STAKE_TOKEN_ADDRESS) return null;
  return {
    escrow: config.ESCROW_ADDRESS,
    token: config.STAKE_TOKEN_ADDRESS,
    chainId: config.ESCROW_CHAIN_ID,
    chainName: 'Base Sepolia',
    rpcUrls: config.PUBLIC_RPC_URLS,
    explorer: 'https://sepolia.basescan.org',
  };
}

export function buildServer(deps: {
  db: Db;
  now?: () => Date;
  botHandle?: string;
  wager?: WagerConfig | null;
}) {
  const now = deps.now ?? (() => new Date());
  const app = Fastify({ logger: false });

  // The public front page: health, version and the counts. Nothing operational (003 FR-004).
  app.get('/', async (_request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(await homePage(deps.db, now(), deps.botHandle)),
  );

  app.get<{ Params: { slug: string } }>('/claim/:slug', async (request, reply) => {
    const page = await claimPage(deps.db, request.params.slug, now());
    return page
      ? reply.type('text/html; charset=utf-8').send(page)
      : notFound(reply);
  });

  // No caching: the page carries the claim's open authorization only while acceptance is open (003 FR-046).
  app.get<{ Params: { slug: string } }>(
    '/claim/:slug/wager',
    async (request, reply) => {
      const page = await wagerPage(
        deps.db,
        request.params.slug,
        now(),
        deps.wager ?? null,
      );
      return page
        ? reply
            .header('cache-control', 'no-store')
            .type('text/html; charset=utf-8')
            .send(page)
        : notFound(reply);
    },
  );

  // Links to /c/ are already published: they move for good (003 FR-040).
  app.get<{ Params: { slug: string } }>('/c/:slug', async (request, reply) =>
    reply.redirect(`/claim/${encodeURIComponent(request.params.slug)}`, 308),
  );

  for (const [path, file] of Object.entries(SCRIPTS)) {
    app.get(path, async (_request, reply) =>
      reply
        .header('cache-control', 'public, max-age=300')
        .type('text/javascript; charset=utf-8')
        .send(file),
    );
  }

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

  const app = buildServer({
    db: getDb(),
    botHandle: config.X_BOT_HANDLE,
    wager: wagerConfig(config),
  });
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
