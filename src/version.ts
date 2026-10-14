// The one place the running version comes from: package.json. The minor bumps when a spec ships — 001
// and 002 are 1.0, spec 004 is 1.1, spec 003 Stage 1 is 1.2 — so it never goes backwards the way
// numbering by spec number would (owner decision 2026-10-13).
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export const VERSION = pkg.version;
