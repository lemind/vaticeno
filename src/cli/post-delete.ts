// npm run post:delete -- [--repost] <post id> [<post id> …] — delete posts of our own account (a bad reply);
// with --repost, the ids are posts we reposted and the reposts are undone. Irreversible, and only ever the bot's own posts: X refuses
// anyone else's. Run it on the server, where the bot's OAuth token lives.
import { loadConfig } from '../config.js';
import { getValidAccessToken } from '../x/oauth.js';
import { printJson, runCli } from './run.js';

await runCli('post-delete', async () => {
  const undoRepost = process.argv.includes('--repost');
  const ids = process.argv.slice(2).filter((id) => /^\d{5,25}$/.test(id));
  if (ids.length === 0) throw new Error('usage: npm run post:delete -- <post id> [<post id> …]');

  const config = loadConfig();
  if (!config.X_OAUTH2_CLIENT_ID || !config.X_OAUTH2_CLIENT_SECRET) throw new Error('X_OAUTH2_CLIENT_ID/SECRET are needed');
  const token = await getValidAccessToken({
    clientId: config.X_OAUTH2_CLIENT_ID,
    clientSecret: config.X_OAUTH2_CLIENT_SECRET,
    redirectUri: config.X_OAUTH2_REDIRECT_URI,
  });

  for (const id of ids) {
    const url = undoRepost
      ? `https://api.x.com/2/users/${config.X_BOT_USER_ID}/retweets/${id}`
      : `https://api.x.com/2/tweets/${id}`;
    const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    const body = await res.text();
    printJson({ id, status: res.status, body: body.slice(0, 200) });
  }
});
