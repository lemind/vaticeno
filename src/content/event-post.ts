// The event post's text (spec 005 FR-021): a fixed template with three slots — event, date, place — and one of
// a few fixed closing lines. The model fills slots, never writes the sentence.
import {
  hasTagsOrLinks,
  weightedLength,
  X_MAX_CHARS,
} from '../replies/templates.js';
import type { FoundEvent } from './event-check.js';

const CLOSINGS = [
  'Have a call? Tag Vaticeno before it starts.',
  'Got a prediction? Put it on the record before it starts.',
  'Make your call before it starts. Vaticeno keeps score.',
] as const;

const longDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

// null when a slot is too long or carries anything an own post may not (constitution VI).
export function eventPostText(
  event: FoundEvent,
  random: () => number = Math.random,
): string | null {
  const name = event.name.trim();
  const place = event.place.trim();
  if (!name || name.length > 80 || place.length > 60) return null;
  const closing = CLOSINGS[Math.floor(random() * CLOSINGS.length)]!;
  const where = place ? ` at ${place}` : '';
  const text = `${name} is scheduled for ${longDay(event.date)}${where}.\n\n${closing}`;
  return weightedLength(text) <= X_MAX_CHARS && !hasTagsOrLinks(text) ? text : null;
}
