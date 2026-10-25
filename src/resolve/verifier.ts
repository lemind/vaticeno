// The local verifier's client (003 FR-012a, docs/decisions/005-verifier-on-cloud-run.md): one HTTPS call per
// evidence page. It never throws: every failure is "no opinion", and the resolution goes on the paid path.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

// Measured 2026-10-25: a cold start answered in 7.6 s, a warm call in 0.36 s (decision 005).
const TIMEOUT_MS = 20_000;
const TOKEN_LIFETIME_SEC = 3600;
const TOKEN_REFRESH_MARGIN_SEC = 300;

const AnswerSchema = z.object({
  model: z.string().min(1),
  entail: z.number().min(0).max(1).nullable(),
  contradict: z.number().min(0).max(1).nullable(),
  windows: z.number().int().min(0),
  truncated: z.boolean(),
  ms: z.number().int().min(0),
});

const ServiceAccountSchema = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
  private_key_id: z.string().min(1),
  token_uri: z.url(),
});

const TokenSchema = z.object({ id_token: z.string().min(1) });

export type VerifierError =
  | 'timeout'
  | 'network'
  | 'auth' // Google refused the identity token or our key (401/403), or no token could be minted
  | 'http' // any other non-2xx
  | 'malformed' // an answer that does not parse
  | 'no_text'; // a passed page with no text to send (set by the caller, never by the service)

export type VerifierResult =
  | {
      ok: true;
      model: string;
      entail: number | null; // null: the service had no opinion (an empty page)
      contradict: number | null;
      windows: number;
      truncated: boolean;
      latencyMs: number;
    }
  | { ok: false; error: VerifierError; latencyMs: number };

export function createVerifier(options: {
  url: string; // the Cloud Run service URL, also the identity token's audience
  key: string; // our own X-Verifier-Key
  serviceAccountFile: string; // the vaticeno-bot JSON key, outside the repo
  fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  const { url, key } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  // Shared by concurrent calls, so one claim's pages mint one token; dropped on any failure or refusal.
  let token: Promise<{ value: string; expiresAt: number }> | undefined;

  // A Google identity token for the service, minted from the service account (RS256 JWT → token_uri).
  // The key file is read here, not at startup: a missing file is an 'auth' failure, never a crashed bot.
  async function mintToken(signal: AbortSignal) {
    let account;
    try {
      account = ServiceAccountSchema.parse(
        JSON.parse(readFileSync(options.serviceAccountFile, 'utf8')),
      );
    } catch (error) {
      throw new VerifierAuthError('service account file unreadable', {
        cause: error,
      });
    }
    const iat = Math.floor(now() / 1000);
    const encode = (part: object) =>
      Buffer.from(JSON.stringify(part)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid: account.private_key_id })}.${encode(
      {
        iss: account.client_email,
        sub: account.client_email,
        aud: account.token_uri,
        target_audience: url,
        iat,
        exp: iat + TOKEN_LIFETIME_SEC,
      },
    )}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(account.private_key, 'base64url');
    const response = await fetchImpl(account.token_uri, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
    if (!response.ok)
      throw new VerifierAuthError(`token_uri HTTP ${response.status}`);
    const parsed = TokenSchema.safeParse(await response.json());
    if (!parsed.success) throw new VerifierAuthError('token_uri answer malformed');
    return {
      value: parsed.data.id_token,
      expiresAt: (iat + TOKEN_LIFETIME_SEC) * 1000,
    };
  }

  async function identityToken(signal: AbortSignal): Promise<string> {
    if (token) {
      const held = await token.catch(() => undefined);
      if (held && held.expiresAt - TOKEN_REFRESH_MARGIN_SEC * 1000 > now())
        return held.value;
    }
    const minting = mintToken(signal);
    token = minting;
    minting.catch(() => {
      if (token === minting) token = undefined;
    });
    return (await minting).value;
  }

  return async function scoreEvidence(
    premise: string, // the page text, in memory only (FR-029)
    hypothesis: string,
  ): Promise<VerifierResult> {
    const started = now();
    const failed = (error: VerifierError): VerifierResult => ({
      ok: false,
      error,
      latencyMs: now() - started,
    });
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const bearer = await identityToken(signal);
      const response = await fetchImpl(`${url}/score`, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${bearer}`,
          'X-Verifier-Key': key,
          'Content-Type': 'application/json',
        },
        // A page cut at the 40,000-character cap can end in half a surrogate pair, which the service rejects.
        body: JSON.stringify({
          premise: premise.replace(/[\uD800-\uDBFF]$/, ''),
          hypothesis,
        }),
      });
      if (response.status === 401 || response.status === 403) {
        token = undefined; // a refused token is never reused for the rest of its hour
        return failed('auth');
      }
      if (!response.ok) return failed('http');
      // The body is read under the same deadline: a stall here is a timeout, a bad body is malformed.
      const parsed = AnswerSchema.safeParse(await response.json());
      if (!parsed.success) return failed('malformed');
      const { ms: _serviceMs, ...answer } = parsed.data;
      return { ok: true, ...answer, latencyMs: now() - started };
    } catch (error) {
      if (error instanceof VerifierAuthError) return failed('auth');
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        return failed('timeout');
      }
      if (error instanceof SyntaxError) return failed('malformed');
      return failed('network');
    }
  };
}

export type ScoreEvidence = ReturnType<typeof createVerifier>;

class VerifierAuthError extends Error {}
