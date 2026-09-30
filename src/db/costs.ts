import { z } from 'zod';
import type { Db } from './client.js';
import { COST_OPERATIONS, COST_PROVIDERS, costEvents } from './schema.js';

export const CostSchema = z.object({
  claimId: z.uuid().nullable(),
  provider: z.enum(COST_PROVIDERS),
  operation: z.enum(COST_OPERATIONS),
  units: z.number().int().min(1).default(1),
  usdCost: z.number().min(0),
});
export type Cost = z.input<typeof CostSchema>;

type Writer = Pick<Db, 'insert'>;

// Accepts the db or a transaction, so costs buffered before a claim exists land in the claim's insert
// transaction (data-model "Cost rows").
export async function recordCosts(writer: Writer, costs: Cost[]): Promise<void> {
  if (costs.length === 0) return;
  const rows = costs.map((cost) => {
    const c = CostSchema.parse(cost);
    return { claimId: c.claimId, provider: c.provider, operation: c.operation, units: c.units, usdCost: c.usdCost.toFixed(5) };
  });
  await writer.insert(costEvents).values(rows);
}

export async function recordCost(writer: Writer, cost: Cost): Promise<void> {
  await recordCosts(writer, [cost]);
}
