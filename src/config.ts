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

// Stage 0 core (DB, models, observability). Separate from the POC config so neither breaks the other.
const optionalText = z.string().trim().transform((v) => v || undefined).optional();

const CoreEnvSchema = z
  .object({
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// URL'),
    LLM_MODE: z.enum(['live', 'record', 'replay']).default('replay'),
    GEMINI_API_KEY: optionalText,
    NORMALIZER_MODEL: optionalText,
    JUDGE_MODEL_A: optionalText,
    JUDGE_MODEL_B: optionalText,
    ARBITER_MODEL: optionalText,
    SENTRY_DSN: optionalText,
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_MODE === 'replay') return;
    const needed = ['GEMINI_API_KEY', 'NORMALIZER_MODEL', 'JUDGE_MODEL_A', 'JUDGE_MODEL_B', 'ARBITER_MODEL'] as const;
    for (const key of needed) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when LLM_MODE=${env.LLM_MODE}` });
    }
  });

export type CoreConfig = z.infer<typeof CoreEnvSchema>;

export function loadCoreConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const parsed = CoreEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid env: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
