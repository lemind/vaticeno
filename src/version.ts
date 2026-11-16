// The one place the running version comes from: package.json. Every deploy carries a new one and its
// CHANGELOG.md entry: a feature raises the minor, a fix the patch (owner, 2026-11-16; deploy/deploy.sh checks).
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export const VERSION = pkg.version;

// The commit deploy/deploy.sh wrote into .build-info.json; null where nothing was deployed (a laptop, tests).
function deployedCommit(): string | null {
  let text: string;
  try {
    text = readFileSync(new URL('../.build-info.json', import.meta.url), 'utf8');
  } catch {
    return null; // no deploy here: the file only exists on the server
  }
  const commit = (JSON.parse(text) as { commit?: unknown }).commit;
  return typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit) ? commit : null;
}

// The changelog as of the running commit, so the live version's entry is there before the PR is merged.
export const CHANGELOG_URL = `https://github.com/lemind/vaticeno/blob/${deployedCommit() ?? 'main'}/CHANGELOG.md`;
