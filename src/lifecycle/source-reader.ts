// The one port in the design (plan.md "Architecture"): reads the author's original post.
// Stage 0: a local file standing in for X (claim:submit writes v1, claim:edit writes an edit).
// Stage 1: an X API implementation. The text is used in memory only — never stored (FR-029).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type SourceVersion = { versionId: string; text: string };

export interface SourceReader {
  readVersion(tweetId: string): Promise<SourceVersion>;
}

// Local simulation file; lives under the gitignored .state/ folder.
export const SIMULATED_POSTS_FILE = '.state/stage0-posts.json';

export function createFileSourceReader(path: string = SIMULATED_POSTS_FILE) {
  async function load(): Promise<Record<string, SourceVersion>> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as Record<string, SourceVersion>;
    } catch {
      return {};
    }
  }

  return {
    async readVersion(tweetId: string): Promise<SourceVersion> {
      const post = (await load())[tweetId];
      if (!post) throw new Error(`no simulated post ${tweetId} (create it with claim:submit)`);
      return post;
    },
    async write(tweetId: string, version: SourceVersion): Promise<void> {
      const posts = await load();
      posts[tweetId] = version;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(posts, null, 2) + '\n');
    },
  } satisfies SourceReader & { write: unknown };
}

// In-memory reader for tests.
export function createMemorySourceReader(posts: Record<string, SourceVersion> = {}) {
  return {
    async readVersion(tweetId: string): Promise<SourceVersion> {
      const post = posts[tweetId];
      if (!post) throw new Error(`no post ${tweetId}`);
      return post;
    },
    edit(tweetId: string, version: SourceVersion) {
      posts[tweetId] = version;
    },
  };
}
