import { randomInt } from 'node:crypto';

// Lowercase, no 0/o/1/l/i look-alikes (FR-018): vaticeno.app/c/k4m9q
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const SHORT_TRIES = 3;
const LONG_TRIES = 10;

export function randomSlug(length: number): string {
  let slug = '';
  for (let i = 0; i < length; i++) slug += ALPHABET[randomInt(ALPHABET.length)];
  return slug;
}

// 5 characters; widened to 6 after 3 collisions. The UNIQUE(slug) constraint stays the authority.
export async function newSlug(exists: (slug: string) => Promise<boolean>): Promise<string> {
  for (let attempt = 0; attempt < SHORT_TRIES + LONG_TRIES; attempt++) {
    const slug = randomSlug(attempt < SHORT_TRIES ? 5 : 6);
    if (!(await exists(slug))) return slug;
  }
  throw new Error('could not find a free slug');
}
