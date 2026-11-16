// The one place the running version comes from: package.json. Every deploy carries a new one and its
// CHANGELOG.md entry: a feature raises the minor, a fix the patch (owner, 2026-11-16; deploy/deploy.sh checks).
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export const VERSION = pkg.version;
