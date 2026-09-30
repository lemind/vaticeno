// Near-duplicate detection for the independence gate without keeping page text: a 64-bit simhash of
// word 5-shingles. The hash is a fingerprint, not content, so replay files may store it. Pure.
import { createHash } from 'node:crypto';

const SHINGLE_WORDS = 5;
export const NEAR_DUPLICATE_BITS = 10; // Hamming distance ≤ 10 of 64 → same story

export function simhash(text: string): string {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const weights = new Array<number>(64).fill(0);
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) {
    const digest = createHash('sha256').update(words.slice(i, i + SHINGLE_WORDS).join(' ')).digest();
    for (let bit = 0; bit < 64; bit++) {
      weights[bit]! += (digest[bit >> 3]! >> (bit & 7)) & 1 ? 1 : -1;
    }
  }
  let hex = '';
  for (let nibble = 0; nibble < 16; nibble++) {
    let value = 0;
    for (let b = 0; b < 4; b++) if (weights[nibble * 4 + b]! > 0) value |= 1 << b;
    hex += value.toString(16);
  }
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

export function nearDuplicate(a: string | null, b: string | null): boolean {
  return !!a && !!b && hammingDistance(a, b) <= NEAR_DUPLICATE_BITS;
}

// The quote gate: does the model's quote really occur in the fetched page? Whitespace/case-insensitive.
export function quoteInText(quote: string | null, text: string): boolean {
  if (!quote) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  const q = norm(quote);
  return q.length >= 8 && norm(text).includes(q);
}
