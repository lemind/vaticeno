import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

// OAuth 2.0 Authorization Code + PKCE, confidential client (INIT_SPEC §2: user context for writes).
const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export const OAUTH_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];
export const OAUTH_TOKEN_PATH = '.state/x-oauth.json';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  scope: z.string().optional(),
});

const StoredTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.string(),
  scope: z.string().optional(),
});

export type StoredToken = z.infer<typeof StoredTokenSchema>;

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function createPkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizeUrl(creds: OAuthClientCredentials, state: string, codeChallenge: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', creds.clientId);
  url.searchParams.set('redirect_uri', creds.redirectUri);
  url.searchParams.set('scope', OAUTH_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // URLSearchParams encodes spaces as '+'; X's authorize page wants %20 in `scope`.
  return url.toString().replaceAll('+', '%20');
}

async function requestToken(creds: OAuthClientCredentials, form: Record<string, string>): Promise<StoredToken> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`X token endpoint ${res.status}: ${body.slice(0, 500)}`);

  const token = TokenResponseSchema.parse(JSON.parse(body));
  if (!token.refresh_token) throw new Error('No refresh_token returned — is offline.access in the scopes?');
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    scope: token.scope,
  };
}

export function exchangeCodeForToken(creds: OAuthClientCredentials, code: string, codeVerifier: string) {
  return requestToken(creds, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: creds.redirectUri,
    code_verifier: codeVerifier,
  });
}

export async function saveToken(token: StoredToken, path = OAUTH_TOKEN_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, JSON.stringify(token, null, 2) + '\n', { mode: 0o600 });
  await rename(tmpPath, path);
}

async function loadToken(path = OAUTH_TOKEN_PATH): Promise<StoredToken> {
  try {
    return StoredTokenSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`No OAuth token at ${path}. Run \`npm run poc:auth\` signed in as the bot.`);
    }
    throw error;
  }
}

// Refresh tokens rotate on every use, so the new pair is saved before it is returned.
// `forceRefresh`: the stored expiry can be wrong (e.g. a console-issued token), so a 401 forces one.
export async function getValidAccessToken(
  creds: OAuthClientCredentials,
  { forceRefresh = false, path = OAUTH_TOKEN_PATH }: { forceRefresh?: boolean; path?: string } = {},
): Promise<string> {
  const token = await loadToken(path);
  if (!forceRefresh && Date.parse(token.expires_at) - Date.now() > REFRESH_MARGIN_MS) return token.access_token;

  const refreshed = await requestToken(creds, { grant_type: 'refresh_token', refresh_token: token.refresh_token });
  await saveToken(refreshed, path);
  return refreshed.access_token;
}
