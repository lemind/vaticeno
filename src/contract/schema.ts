import { z } from 'zod';

// The contract that gets locked and judged (data-model.md "ContractSchema"). Validated before every write.
// Single scheduled events (a match): may be recorded until shortly before they start (checks.ts, gates.ts).
export const SCHEDULED_EVENT_KINDS: readonly string[] = ['football_results', 'sports_results'];

export const X_PROFILE_KIND = 'x_profile';

const text = (max: number) => z.string().trim().min(1).max(max);

export const PriceSchema = z.object({
  provider: z.literal('coinbase'),
  product_id: z.string().regex(/^[A-Z0-9]{2,12}-[A-Z]{3,5}$/, 'product_id like BTC-USD'),
  comparison: z.enum(['CLOSE_ABOVE', 'CLOSE_BELOW']), // strict: equal is a MISS
  threshold: z.number().positive(),
  window_mode: z.enum(['at_deadline', 'any_time_before']),
});

// A follower count read from the X API at the deadline (004 T419–T420). Set by code at recording, never by the model.
export const FollowersSchema = z.object({
  user_id: z.string().regex(/^\d{1,25}$/, 'numeric X user id'),
  comparison: z.enum(['AT_LEAST', 'BELOW']),
  threshold: z.number().int().positive(),
});

export const SourceSchema = z.object({
  name: text(48), // appears in the statement; the RECORDED reply must fit 280 (contracts/reply-templates.md)
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
    criterion: text(100), // same reply budget as source.name
    deadline_at: z.iso.datetime(), // UTC only ("Z"); a bare date means 23:59:59Z
    source: SourceSchema,
    negative_condition: text(280),
    resolution_method: z.enum(['price_feed', 'model']),
    price: PriceSchema.optional(),
    // Kickoff found by the fixture check at recording; in_window uses it when a report omits the time (004 T418).
    event_start_at: z.iso.datetime().optional(),
    followers: FollowersSchema.optional(),
  })
  .superRefine((contract, ctx) => {
    const isPrice = contract.resolution_method === 'price_feed';
    if (isPrice && !contract.price) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'price is required when resolution_method is price_feed' });
    }
    if (!isPrice && contract.price) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'price is only allowed when resolution_method is price_feed' });
    }
    if (contract.followers && (isPrice || contract.source.kind !== X_PROFILE_KIND)) {
      ctx.addIssue({ code: 'custom', path: ['followers'], message: `followers is only allowed with source.kind ${X_PROFILE_KIND}` });
    }
  });

export type Contract = z.infer<typeof ContractSchema>;
export type PriceTerms = z.infer<typeof PriceSchema>;
export type FollowerTerms = z.infer<typeof FollowersSchema>;
