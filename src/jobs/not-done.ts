// Which finished runs of a feed job left its planned work undone, and why, in plain words for the owner's email
// (owner 2026-11-19). An empty queue, a slot taken by an earlier post or nothing new to say is the plan working.
type Outcome = { done?: string; error?: string; why?: string[] | string };

const SPEND_CAP = "the feed's daily spend cap was reached, so nothing was posted";

export function notDoneReason(job: string, result: unknown): string | null {
  const outcome = (result ?? {}) as Outcome;
  const done = outcome.done;
  if (done === 'failed')
    return `X refused the post: ${outcome.error ?? 'no reason given'}`;
  if (done === 'spend_cap') return SPEND_CAP;
  switch (job) {
    case 'pool':
      if (done === 'no_candidate')
        return "no account in today's groups posted an upcoming event in the last 48 hours";
      return null;
    case 'event':
      if (done === 'cap_reached') return SPEND_CAP;
      if (done === 'no_event')
        return [
          'no event was confirmed by two sites:',
          ...[outcome.why ?? []].flat().map((line) => `- ${line}`),
        ].join('\n');
      return null;
    case 'race':
      if (done === 'cap_reached') return SPEND_CAP;
      if (done === 'no_race')
        return `no race post: ${String(outcome.why ?? 'no reason given')} (a Friday miss retries on Saturday)`;
      return null;
    default:
      return null;
  }
}
