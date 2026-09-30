// npm run resolve:manual -- --slug <slug> --outcome hit|miss|void [--deciding-evidence <id>] [--void-reason insufficient_evidence|unresolvable] --note "<why>"
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { VOID_REASONS } from '../db/schema.js';
import { decideByHuman } from '../resolve/manual.js';
import { cliArgs, nowFrom, printJson, runCli } from './run.js';

await runCli('resolve-manual', async () => {
  const { values } = cliArgs({
    slug: { type: 'string' },
    outcome: { type: 'string' },
    'deciding-evidence': { type: 'string' },
    'void-reason': { type: 'string' },
    note: { type: 'string' },
    now: { type: 'string' },
  });
  const outcome = z.enum(['hit', 'miss', 'void']).parse(values.outcome);
  if (!values.slug || !values.note) throw new Error('usage: --slug <slug> --outcome hit|miss|void --note "<why>" [--deciding-evidence <id>]');
  await decideByHuman(getDb(), {
    slug: values.slug,
    outcome,
    decidingEvidenceId: values['deciding-evidence'],
    voidReason: values['void-reason'] ? z.enum(VOID_REASONS).parse(values['void-reason']) : undefined,
    note: values.note,
    now: nowFrom(values.now),
  });
  printJson({ slug: values.slug, outcome, decided_by: 'human' });
});
