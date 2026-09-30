// The six tables of specs/001-stage0-contract-core/data-model.md. Triggers and RLS live in hand-written
// migrations (drizzle/0001_triggers.sql, drizzle/0002_rls.sql); the database is the authority.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const CLAIM_STATUSES = [
  'parsing', 'needs_info', 'draft', 'locked', 'resolving', 'resolved', 'void', 'rejected', 'expired',
] as const;
export const REJECT_REASONS = ['not_prediction', 'x_rules', 'deadline_too_close', 'deadline_too_far', 'duplicate'] as const;
export const RESOLUTION_METHODS = ['price_feed', 'model'] as const;
export const STANCES = ['agree', 'disagree'] as const;
export const SOURCE_KINDS = ['price_feed', 'web'] as const;
export const EVIDENCE_BASES = ['record', 'absence'] as const;
export const TRUST_LEVELS = ['primary', 'established', 'weak'] as const;
export const EVIDENCE_SAYS = ['hit', 'miss', 'pending', 'irrelevant', 'entity_gone'] as const;
export const OUTCOMES = ['hit', 'miss', 'void'] as const;
export const DECIDED_BY = ['evidence', 'arbiter', 'human'] as const;
export const REVIEW_STATUSES = ['final', 'needs_human'] as const;
export const VOID_REASONS = ['insufficient_evidence', 'unresolvable'] as const;
export const COST_PROVIDERS = ['gemini', 'google_search', 'coinbase', 'web_fetch'] as const;
export const COST_OPERATIONS = ['normalize', 'search', 'judge', 'arbitrate', 'fetch', 'price'] as const;

// `col IN ('a','b')` for a CHECK constraint; values are our own constants, never user input.
function oneOf(column: AnyPgColumn, values: readonly string[]) {
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;
}

const utc = (name: string) => timestamp(name, { withTimezone: true });

export const claims = pgTable(
  'claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    sourceTweetId: text('source_tweet_id').notNull().unique(),
    summonTweetId: text('summon_tweet_id').notNull(),
    threadTweetIds: text('thread_tweet_ids').array().notNull().default(sql`'{}'`), // bot replies and fixes: a reply to any of them is a fix
    sourceVersion: text('source_version').notNull(),
    lockedSourceVersion: text('locked_source_version'),
    lockedSourceHash: text('locked_source_hash'),
    authorXUserId: text('author_x_user_id').notNull(),
    contract: jsonb('contract'),
    contractModelId: text('contract_model_id'),
    selfConfidence: real('self_confidence'),
    resolutionMethod: text('resolution_method', { enum: RESOLUTION_METHODS }),
    deadlineAt: utc('deadline_at'),
    status: text('status', { enum: CLAIM_STATUSES }).notNull(),
    rejectReason: text('reject_reason', { enum: REJECT_REASONS }),
    unclear: jsonb('unclear'),
    amendCount: integer('amend_count').notNull().default(0),
    lockAt: utc('lock_at'),
    needsInfoSince: utc('needs_info_since'),
    nextCheckAt: utc('next_check_at'),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('claims_status_check', oneOf(t.status, CLAIM_STATUSES)),
    check('claims_reject_reason_check', oneOf(t.rejectReason, REJECT_REASONS)),
    check('claims_resolution_method_check', oneOf(t.resolutionMethod, RESOLUTION_METHODS)),
    check('claims_amend_count_check', sql`${t.amendCount} between 0 and 2`),
    index('claims_due_idx').on(t.nextCheckAt).where(sql`${t.status} in ('locked', 'resolving')`),
    index('claims_draft_lock_idx').on(t.status, t.lockAt).where(sql`${t.status} = 'draft'`),
    index('claims_needs_info_idx').on(t.status, t.needsInfoSince).where(sql`${t.status} = 'needs_info'`),
    index('claims_author_idx').on(t.authorXUserId, t.createdAt.desc()),
  ],
);

export type ClaimRow = typeof claims.$inferSelect;

export const positions = pgTable(
  'positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id').notNull().references(() => claims.id),
    xUserId: text('x_user_id').notNull(),
    stance: text('stance', { enum: STANCES }).notNull(),
    isAuthor: boolean('is_author').notNull().default(false),
    joinedAt: utc('joined_at').notNull().defaultNow(),
    joinTweetId: text('join_tweet_id').unique(),
  },
  (t) => [
    check('positions_stance_check', oneOf(t.stance, STANCES)),
    unique('positions_claim_user_unique').on(t.claimId, t.xUserId),
    // One author per claim: partial unique index in drizzle/0001_triggers.sql.
  ],
);

export const evidences = pgTable(
  'evidences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id').notNull().references(() => claims.id),
    runAt: utc('run_at').notNull(),
    sourceKind: text('source_kind', { enum: SOURCE_KINDS }).notNull(),
    basis: text('basis', { enum: EVIDENCE_BASES }).notNull(),
    sourceName: text('source_name').notNull(),
    trustLevel: text('trust_level', { enum: TRUST_LEVELS }).notNull(),
    trustReason: text('trust_reason'),
    says: text('says', { enum: EVIDENCE_SAYS }).notNull(),
    eventDate: date('event_date'),
    value: numeric('value'),
    url: text('url'),
    contentSha256: text('content_sha256'),
    searchQuery: text('search_query'),
    retrievedAt: utc('retrieved_at').notNull(),
    modelId: text('model_id'),
    instructionVersion: text('instruction_version'),
    gates: jsonb('gates').$type<Record<string, boolean | null>>().notNull(), // gate name → result (resolve/gates.ts)
    passed: boolean('passed').notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('evidences_source_kind_check', oneOf(t.sourceKind, SOURCE_KINDS)),
    check('evidences_basis_check', oneOf(t.basis, EVIDENCE_BASES)),
    check('evidences_trust_level_check', oneOf(t.trustLevel, TRUST_LEVELS)),
    check('evidences_says_check', oneOf(t.says, EVIDENCE_SAYS)),
    index('evidences_claim_run_idx').on(t.claimId, t.runAt),
  ],
);

export const resolutions = pgTable(
  'resolutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id').notNull().unique().references(() => claims.id),
    outcome: text('outcome', { enum: OUTCOMES }),
    decidedBy: text('decided_by', { enum: DECIDED_BY }),
    reviewStatus: text('review_status', { enum: REVIEW_STATUSES }).notNull(),
    voidReason: text('void_reason', { enum: VOID_REASONS }),
    decidingEvidenceId: uuid('deciding_evidence_id').references(() => evidences.id),
    arbiterModelId: text('arbiter_model_id'),
    arbiterNotes: text('arbiter_notes'),
    humanNotes: text('human_notes'),
    decidedAt: utc('decided_at'),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('resolutions_outcome_check', oneOf(t.outcome, OUTCOMES)),
    check('resolutions_decided_by_check', oneOf(t.decidedBy, DECIDED_BY)),
    check('resolutions_review_status_check', oneOf(t.reviewStatus, REVIEW_STATUSES)),
    check('resolutions_void_reason_check', oneOf(t.voidReason, VOID_REASONS)),
    // HIT/MISS must name the evidence that established it; VOID must say why (data-model resolutions).
    check('resolutions_hit_miss_evidence_check', sql`${t.outcome} not in ('hit', 'miss') or ${t.decidingEvidenceId} is not null`),
    check('resolutions_void_reason_required_check', sql`(${t.outcome} is not distinct from 'void') = (${t.voidReason} is not null)`),
    check('resolutions_final_complete_check', sql`${t.reviewStatus} <> 'final' or (${t.outcome} is not null and ${t.decidedBy} is not null and ${t.decidedAt} is not null)`),
  ],
);

export const costEvents = pgTable(
  'cost_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id').references(() => claims.id),
    provider: text('provider', { enum: COST_PROVIDERS }).notNull(),
    operation: text('operation', { enum: COST_OPERATIONS }).notNull(),
    units: integer('units').notNull().default(1),
    usdCost: numeric('usd_cost', { precision: 10, scale: 5 }).notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('cost_events_provider_check', oneOf(t.provider, COST_PROVIDERS)),
    check('cost_events_operation_check', oneOf(t.operation, COST_OPERATIONS)),
    index('cost_events_claim_idx').on(t.claimId),
  ],
);

// Sites earn standing by confirming final verdicts; a row starts at the first confirmation (data-model "sources").
export const sources = pgTable(
  'sources',
  {
    domain: text('domain').primaryKey(),
    agreedCount: integer('agreed_count').notNull(),
    firstAgreedAt: utc('first_agreed_at').notNull().defaultNow(),
    lastAgreedAt: utc('last_agreed_at').notNull().defaultNow(),
  },
  (t) => [check('sources_agreed_count_check', sql`${t.agreedCount} >= 1`)],
);

// Authors who sent STOP (constitution IV), until they tag the bot again. Their locked claims still resolve.
export const optOuts = pgTable('opt_outs', {
  xUserId: text('x_user_id').primaryKey(),
  createdAt: utc('created_at').notNull().defaultNow(),
});
