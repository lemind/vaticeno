// Tron addresses (spec 007): people and Tronscan use the base58check form (`T…`), the contract and the database the
// 20-byte one, written `0x…` like an EVM address. A Tron address is 0x41 followed by those 20 bytes.
import { createHash } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const TRON_PREFIX = 0x41;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();
const checksum = (bytes: Uint8Array) => sha256(sha256(bytes)).subarray(0, 4);

// `T…` → `0x…` (20 bytes), or null when it is not a valid Tron address.
export function fromTronAddress(text: string): string | null {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(text)) return null;
  let value = 0n;
  for (const char of text) value = value * 58n + BigInt(ALPHABET.indexOf(char));
  const bytes = Buffer.from(value.toString(16).padStart(50, '0'), 'hex');
  if (bytes.length !== 25 || bytes[0] !== TRON_PREFIX) return null;
  const body = bytes.subarray(0, 21);
  if (!checksum(body).equals(bytes.subarray(21))) return null;
  return `0x${body.subarray(1).toString('hex')}`;
}

// `0x…` (20 bytes) → `T…`.
export function toTronAddress(hex: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(hex))
    throw new Error(`not a 20-byte address: ${hex}`);
  const body = Buffer.concat([
    Buffer.from([TRON_PREFIX]),
    Buffer.from(hex.slice(2), 'hex'),
  ]);
  let value = BigInt(`0x${Buffer.concat([body, checksum(body)]).toString('hex')}`);
  let text = '';
  while (value > 0n) {
    text = ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  return text; // the 0x41 prefix means no leading zero byte, so no leading '1'
}
