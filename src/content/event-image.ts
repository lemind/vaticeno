// The event poster's prompt (spec 005 FR-024): an abstract picture of the sport with the event's name as its one
// title (owner, 2026-11-09). No other text and no logo; the post's text has the date and place. Not for Vaticeno.
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

export function posterPrompt(topicId: string, title: string): string {
  const scene = SCENES[topicId] ?? 'an abstract stage under a spotlight';
  const name = title.replace(/["“”]/g, '').trim();
  return (
    `A bold, modern event poster illustration, 16:9: ${scene}. Flat vector style, strong colours, ` +
    `dramatic light. Its one title, in large bold letters, spelled exactly: "${name}". ` +
    'No other text, letters or numbers; no logos, crests, brand marks or watermarks, ' +
    "and no recognisable real person's face."
  );
}
