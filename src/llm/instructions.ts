import { readFileSync } from 'node:fs';

// Prompts live as versioned files in instructions/ (AGENTS.md: centralized and versionable).
// The version (file name) is part of every replay key, so changing a prompt means a new file.
const cache = new Map<string, string>();

export function loadInstruction(version: string): string {
  let text = cache.get(version);
  if (text === undefined) {
    text = readFileSync(new URL(`./instructions/${version}.md`, import.meta.url), 'utf8');
    cache.set(version, text);
  }
  return text;
}
