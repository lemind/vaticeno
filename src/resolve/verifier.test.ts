import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createVerifier } from './verifier.js';

const URL = 'https://verifier.example.run.app';
const TOKEN_URI = 'https://oauth2.example/token';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const accountFile = join(mkdtempSync(join(tmpdir(), 'verifier-')), 'sa.json');
writeFileSync(
  accountFile,
  JSON.stringify({
    client_email: 'bot@example.iam',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    private_key_id: 'kid-1',
    token_uri: TOKEN_URI,
  }),
);

const answer = {
  model: 'm@1',
  entail: 0.9,
  contradict: 0.05,
  windows: 1,
  truncated: false,
  ms: 40,
};

function stub(score: () => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const target = String(input);
    calls.push(target);
    if (target === TOKEN_URI) return Response.json({ id_token: 'id-token' });
    return score();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const verifierWith = (fetchImpl: typeof fetch) =>
  createVerifier({ url: URL, key: 'k', serviceAccountFile: accountFile, fetchImpl });

test('the verifier answers, and mints the identity token once for many calls', async () => {
  const { calls, fetchImpl } = stub(() => Response.json(answer));
  const score = verifierWith(fetchImpl);
  const first = await score('page', 'claim');
  await score('page', 'claim');
  assert.ok(first.ok && first.model === 'm@1' && first.entail === 0.9);
  assert.equal(calls.filter((c) => c === TOKEN_URI).length, 1);
});

const failures: [string, () => Response | Promise<Response>, string][] = [
  ['a refused key', () => new Response('', { status: 401 }), 'auth'],
  ['a server error', () => new Response('', { status: 503 }), 'http'],
  [
    'an answer out of range',
    () => Response.json({ ...answer, entail: 2 }),
    'malformed',
  ],
  [
    'a network failure',
    () => Promise.reject(new TypeError('fetch failed')),
    'network',
  ],
];
for (const [name, score, error] of failures) {
  test(`the verifier: ${name} is no opinion, never a throw`, async () => {
    const result = await verifierWith(stub(score).fetchImpl)('page', 'claim');
    assert.ok(!result.ok && result.error === error);
  });
}

test('a missing service account file is an auth failure at call time, never a crash at startup', async () => {
  const score = createVerifier({
    url: URL,
    key: 'k',
    serviceAccountFile: '/nonexistent/sa.json',
  });
  const result = await score('page', 'claim');
  assert.ok(!result.ok && result.error === 'auth');
});

test('after a timeout or a dropped call the service is left alone for a while, then asked again', async () => {
  let clock = 1_000_000;
  let calls = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    if (String(input) === TOKEN_URI) return Response.json({ id_token: 'id-token' });
    calls++;
    if (calls === 1) throw new TypeError('fetch failed');
    return Response.json(answer);
  }) as typeof fetch;
  const score = createVerifier({
    url: URL,
    key: 'k',
    serviceAccountFile: accountFile,
    fetchImpl,
    now: () => clock,
  });
  assert.ok(!(await score('p', 'c')).ok);
  const paused = await score('p', 'c');
  assert.ok(!paused.ok && paused.error === 'paused');
  assert.equal(calls, 1, 'a paused verifier is not called');
  clock += 11 * 60_000;
  assert.ok((await score('p', 'c')).ok);
});
