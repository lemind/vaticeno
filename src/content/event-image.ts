// The event poster's prompt (spec 005 FR-024): it sells the event — its name, date and place on it, the two sides
// facing off in their flags or colours (owner, 2026-11-11). No crest or brand logo, no real face. Not for Vaticeno.
import type { FoundEvent } from './event-check.js';
const SCENES: Record<string, string> = {
  football: 'a football on a floodlit pitch, an abstract player in motion',
  'american-football':
    'an American football spiralling through stadium lights, an abstract player silhouette',
  basketball: 'a basketball above a glowing hoop, an abstract player mid-jump',
  tennis: 'a tennis ball on the baseline of a court, an abstract player serving',
  'formula-1':
    'an abstract open-wheel race car streaking through a corner, motion blur',
  'horse-racing': 'abstract racehorses at full gallop on turf, dust and motion',
  cricket: 'a red cricket ball and stumps on a green pitch, an abstract batter',
  baseball: 'a baseball leaving a bat under stadium lights, an abstract hitter',
  'combat-sports': 'an empty octagon under spotlights, abstract gloved fists',
  golf: 'a golf ball on a tee before a sweeping fairway at dawn',
  crypto: 'an abstract glowing chart line rising and falling over a dark grid',
  'central-banks':
    'an abstract grand columned building with a rising and falling line',
  'economic-data': 'abstract bar charts and a pulse line on a calm background',
  earnings: 'an abstract skyline with charts reflected in glass',
  politics: 'an abstract ballot box and a crowd of silhouettes',
  tech: 'an abstract glowing device on a stage under a spotlight',
  space: 'an abstract rocket lifting off into a deep blue sky',
  awards: 'an abstract golden statuette under a spotlight on a stage',
};

// "2026-11-15" → "SAT 15 NOV": short enough for the image model to spell.
export function posterDate(date: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    day.toLocaleDateString('en-GB', { timeZone: 'UTC', ...options }).toUpperCase();
  return `${part({ weekday: 'short' })} ${day.getUTCDate()} ${part({ month: 'short' })}`;
}

export function posterPrompt(topicId: string, event: FoundEvent): string {
  const scene = SCENES[topicId] ?? 'an abstract stage under a spotlight';
  const clean = (text: string) => text.replace(/["“”]/g, '').trim();
  return (
    `A bold, modern sports-event poster, 16:9, made to sell the event: ${scene}. ` +
    'If the event is between two sides, show them facing off, each in its national flag or its team colours. ' +
    'Flat vector style, strong colours, dramatic light. Three lines of text, large and bold, spelled exactly: ' +
    `"${clean(event.name)}" as the title, then "${posterDate(event.date)}", then "${clean(event.place)}". ` +
    'No other text; no club crests, logos, brand marks or watermarks, ' +
    "and no recognisable real person's face."
  );
}
