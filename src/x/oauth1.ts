// OAuth 1.0a request signing (RFC 5849, HMAC-SHA1) for the poster upload only (spec 005 FR-024): the browser
// login for `media.write` fails on X's side, while the console's 1.0a keys for the bot need no browser.
import { createHmac, randomBytes } from 'node:crypto';

export type OAuth1Keys = {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
};

const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// The Authorization header for one request. A multipart body is not signed (RFC 5849 §3.4.1.3.1).
export function oauth1Header(
  method: string,
  url: string,
  keys: OAuth1Keys,
  now: Date = new Date(),
  nonce: string = randomBytes(16).toString('hex'),
): string {
  const target = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(now.getTime() / 1000)),
    oauth_token: keys.token,
    oauth_version: '1.0',
  };
  const params = [...Object.entries(oauth), ...target.searchParams.entries()]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const base = [
    method.toUpperCase(),
    encode(`${target.origin}${target.pathname}`),
    encode(params),
  ].join('&');
  const signingKey = `${encode(keys.consumerSecret)}&${encode(keys.tokenSecret)}`;
  oauth.oauth_signature = createHmac('sha1', signingKey)
    .update(base)
    .digest('base64');
  return (
    'OAuth ' +
    Object.entries(oauth)
      .map(([k, v]) => `${encode(k)}="${encode(v)}"`)
      .join(', ')
  );
}
