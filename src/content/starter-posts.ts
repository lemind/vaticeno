// The owner's starter posts (docs/content-rules.md "Starter posts", items 2–10), written out as the
// final text. Loaded into the queue with `npm run content:queue -- load-starters`; the bot posts one a
// day, in this order, and no AI writes or edits them (spec 002 FR-003, constitution VI 2.4.0).
export const STARTER_POSTS: readonly string[] = [
  "Vaticeno doesn't make predictions. Vaticeno records yours.",
  '"Soon" is not a deadline.',
  'How it works: you say "BTC above $100k by Friday". Vaticeno turns it into one exact question with one '
    + 'deadline, then answers it: HIT, MISS or VOID.',
  "Vaticeno doesn't decide what you meant. It decides what the contract says.",
  "Predictions fade. Records don't.",
  'HIT: it happened by the deadline. MISS: it did not. VOID: the evidence never showed up, so no verdict '
    + 'is claimed. A referee that guesses is worse than one that waits.',
  'A prediction without a deadline is a feeling.',
  'Say it now. Put it on the record.',
  'Everyone remembers calling it. Nobody remembers calling it wrong. Vaticeno remembers both.',
];
