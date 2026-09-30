import { z } from 'zod';

// The contract that gets locked and judged (data-model.md "ContractSchema"). Validated before every write.
const text = (max: number) => z.string().trim().min(1).max(max);

export const PriceSchema = z.object({
  provider: z.literal('coinbase'),
  product_id: z.string().regex(/^[A-Z0-9]{2,12}-[A-Z]{3,5}$/, 'product_id like BTC-USD'),
  comparison: z.enum(['CLOSE_ABOVE', 'CLOSE_BELOW']), // strict: equal is a MISS
  threshold: z.number().positive(),
  window_mode: z.enum(['at_deadline', 'any_time_before']),
});

export const SourceSchema = z.object({
  name: text(120),
  kind: text(60),
  locator: z.url({ protocol: /^https?$/ }),
  scope: text(160),
  entity_id: text(160),
  absence_is_meaningful: z.boolean(),
  fallback: z.literal('same_issuer_only'),
});

export const ContractSchema = z
  .object({
    subject: text(120),
    criterion: text(280),
    deadline_at: z.iso.datetime(), // UTC only ("Z"); a bare date means 23:59:59Z
    source: SourceSchema,
    negative_condition: text(280),
    resolution_method: z.enum(['price_feed', 'model']),
    price: PriceSchema.optional(),
  })
  .superRefine((contract, ctx) => {
    const isPrice = contract.resolution_method === 'price_feed';
    if (isPrice && !contract.price) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'price is required when resolution_method is price_feed' });
    }
    if (!isPrice && contract.price) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'price is only allowed when resolution_method is price_feed' });
    }
  });

export type Contract = z.infer<typeof ContractSchema>;
export type PriceTerms = z.infer<typeof PriceSchema>;
