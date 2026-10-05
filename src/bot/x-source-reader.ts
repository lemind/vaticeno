// The SourceReader port on X: the current version of a post is the last id in its edit history. The text is
// used in memory only (lock hash, edit check) — never stored (FR-029).
import type { SourceReader } from '../lifecycle/source-reader.js';
import type { XClient } from '../x/client.js';

export function createXSourceReader(x: XClient): SourceReader {
  return {
    async readVersion(tweetId: string) {
      const post = await x.getTweet(tweetId);
      const latest = post.edit_history_tweet_ids?.at(-1) ?? post.id;
      const current = latest === post.id ? post : await x.getTweet(latest);
      return { versionId: latest, text: current.text };
    },
  };
}
