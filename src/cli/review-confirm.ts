// npm run review:confirm -- --list
// npm run review:confirm -- --slug <slug> --outcome hit|miss|void --event "<the underlying event>"
// A person's check of a shadow claim's outcome, for the local verifier's go-live count (003 SC-005, T349a).
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { confirmOutcome, eventKeyOf, listToConfirm } from '../resolve/manual.js';
import { cliArgs, printJson, runCli } from './run.js';

await runCli('review-confirm', async () => {
  const { values } = cliArgs({
    list: { type: 'boolean' },
    slug: { type: 'string' },
    outcome: { type: 'string' },
    event: { type: 'string' },
  });
  if (values.list) {
    const waiting = await listToConfirm(getDb());
    for (const item of waiting) printJson(item);
    printJson({ to_confirm: waiting.length });
    return;
  }
  if (!values.slug || !values.event)
    throw new Error(
      'usage: --list, or --slug <slug> --outcome hit|miss|void --event "<event>"',
    );
  const outcome = z.enum(['hit', 'miss', 'void']).parse(values.outcome);
  await confirmOutcome(getDb(), {
    slug: values.slug,
    outcome,
    eventKey: values.event,
  });
  printJson({
    slug: values.slug,
    outcome,
    event: eventKeyOf(values.event),
    confirmed: true,
  });
});
