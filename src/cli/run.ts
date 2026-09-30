// Shared entrypoint plumbing: config, observability, dependencies, clean exit (plan.md "Architecture").
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { type CoreConfig, loadCoreConfig } from '../config.js';
import { closeDb } from '../db/client.js';
import { captureError, flush, initObservability } from '../observe.js';

export { buildDeps } from '../deps.js';

// Runs one command: errors are logged and sent to Sentry, the exit code is set, connections close.
export async function runCli(name: string, main: (config: CoreConfig) => Promise<void>): Promise<void> {
  try {
    const config = loadCoreConfig();
    initObservability(`cli:${name}`, config.SENTRY_DSN);
    await main(config);
  } catch (error) {
    captureError(error, { event: 'cli.failed', command: name });
    process.exitCode = 1;
  } finally {
    await flush();
    await closeDb();
  }
}

export function cliArgs<T extends NonNullable<ParseArgsConfig['options']>>(options: T) {
  return parseArgs({ options, allowPositionals: true, strict: true });
}

// --now <ISO> overrides the clock for simulated time (contracts/cli.md).
export function nowFrom(value: string | undefined): Date {
  if (value === undefined) return new Date();
  const now = new Date(value);
  if (Number.isNaN(now.getTime())) throw new Error(`--now is not a valid ISO time: ${value}`);
  return now;
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + '\n');
}
