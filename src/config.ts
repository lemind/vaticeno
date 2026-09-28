import { z } from 'zod';

const EnvSchema = z.object({
  X_BEARER_TOKEN: z.string().min(1, 'X_BEARER_TOKEN is required (see .env.example)'),
  X_BOT_USER_ID: z.string().regex(/^\d{1,19}$/).optional(),
  X_BOT_HANDLE: z.string().regex(/^\w{1,15}$/).default('vaticeno'),
  POLL_INTERVAL_SEC: z.coerce.number().int().min(15).default(60),

  X_OAUTH2_CLIENT_ID: z.string().optional(),
  X_OAUTH2_CLIENT_SECRET: z.string().optional(),
  X_OAUTH2_REDIRECT_URI: z.url().default('http://localhost:3033/callback'),
  // Pre-approval test gate (INIT_SPEC §10): only these authors ever get a reply.
  REPLY_ALLOWLIST_USER_IDS: z
    .string()
    .default('')
    .transform((raw) => raw.split(',').map((id) => id.trim()).filter(Boolean)),
  // Self-imposed rate caps, INIT_SPEC §6.1.
  REPLY_MAX_PER_AUTHOR_PER_HOUR: z.coerce.number().int().min(0).default(3),
  REPLY_MAX_PER_DAY: z.coerce.number().int().min(0).default(300),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid env: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
