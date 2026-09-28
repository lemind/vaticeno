// One-time: authorize the bot account for posting. Open the printed URL signed in as the BOT, not yourself.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { loadConfig } from '../config.js';
import { log } from '../log.js';
import { getAuthenticatedUser } from '../x/client.js';
import { buildAuthorizeUrl, createPkcePair, exchangeCodeForToken, saveToken } from '../x/oauth.js';

const config = loadConfig();
if (!config.X_OAUTH2_CLIENT_ID || !config.X_OAUTH2_CLIENT_SECRET) {
  throw new Error('X_OAUTH2_CLIENT_ID and X_OAUTH2_CLIENT_SECRET are required in .env');
}
const creds = {
  clientId: config.X_OAUTH2_CLIENT_ID,
  clientSecret: config.X_OAUTH2_CLIENT_SECRET,
  redirectUri: config.X_OAUTH2_REDIRECT_URI,
};

const redirect = new URL(creds.redirectUri);
const state = randomBytes(16).toString('hex');
const pkce = createPkcePair();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirect.origin);
  if (url.pathname !== redirect.pathname) {
    res.writeHead(404).end();
    return;
  }

  try {
    if (url.searchParams.get('state') !== state) throw new Error('state mismatch — restart `npm run poc:auth`');
    const code = url.searchParams.get('code');
    if (!code) throw new Error(`no code in callback: ${url.searchParams.get('error') ?? 'unknown error'}`);

    const token = await exchangeCodeForToken(creds, code, pkce.verifier);
    const me = await getAuthenticatedUser(token.access_token);
    if (config.X_BOT_USER_ID && me.id !== config.X_BOT_USER_ID) {
      throw new Error(`authorized as @${me.username} (${me.id}), expected the bot ${config.X_BOT_USER_ID}. Sign in as @${config.X_BOT_HANDLE} and retry.`);
    }

    await saveToken(token);
    log('info', 'bot authorized for posting', { handle: me.username, x_user_id: me.id, scope: token.scope });
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`Authorized as @${me.username}. You can close this tab.`);
    server.close();
  } catch (error) {
    log('error', 'authorization failed', { error: String(error) });
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end(`Failed: ${String(error)}`);
    server.close();
    process.exitCode = 1;
  }
});

server.listen(Number(redirect.port || 80), redirect.hostname, () => {
  process.stdout.write(
    `\nOpen this URL in a browser where you are signed in as @${config.X_BOT_HANDLE}:\n\n` +
      `${buildAuthorizeUrl(creds, state, pkce.challenge)}\n\nWaiting for the callback on ${creds.redirectUri} ...\n`,
  );
});
