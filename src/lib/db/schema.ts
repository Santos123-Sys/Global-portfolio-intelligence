import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).defaultNow().notNull(),
    /** platform_admin | member. Account permissions live in memberships. */
    role: text('role').notNull().default('member'),
    /** AES-256-GCM ciphertext. The encryption key remains in Railway secrets. */
    mfaSecretEncrypted: text('mfa_secret_encrypted'),
    /** Setup secrets do not become login factors until a valid TOTP confirms them. */
    mfaPendingSecretEncrypted: text('mfa_pending_secret_encrypted'),
    mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
    /** Recovery codes are HMAC digests and are disclosed only once at enrollment. */
    mfaRecoveryCodeHashes: jsonb('mfa_recovery_code_hashes').$type<string[]>(),
    /** Prevents accepting the same time-step code twice. */
    mfaLastUsedStep: integer('mfa_last_used_step'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => ({ emailIdx: uniqueIndex('users_email_idx').on(t.email) })
);

/**
 * A client-facing data boundary.  Accounts intentionally remain separate from
 * login identities: an adviser can belong to several client accounts while a
 * client normally belongs only to their own account.
 *
 * `ownerUserId` is the compatibility bridge for the existing single-tenant
 * data model.  Until every historic `owner_id` column has been renamed, it is
 * the effective tenant key used by existing portfolio/research records.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** personal | advisory_client */
    accountType: text('account_type').notNull().default('advisory_client'),
    ownerUserId: uuid('owner_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ ownerUserIdx: uniqueIndex('accounts_owner_user_idx').on(t.ownerUserId) })
);

/**
 * Authorization is per account, never a global UI-only user role.  Roles are
 * checked on the server before mutations; viewers can only read their own
 * account's information.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    accountId: uuid('account_id')
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    /** owner | analyst | viewer */
    role: text('role').notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (t) => ({
    userAccountIdx: uniqueIndex('memberships_user_account_idx').on(t.userId, t.accountId),
    accountUserIdx: index('memberships_account_user_idx').on(t.accountId, t.userId),
  })
);

/** Revocable, server-side sessions. Only a SHA-256 token digest is persisted. */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    tokenIdx: uniqueIndex('user_sessions_token_hash_idx').on(t.tokenHash),
    userExpiryIdx: index('user_sessions_user_expiry_idx').on(t.userId, t.expiresAt),
  })
);

/**
 * Durable login throttling shared by every Railway dashboard replica. Keys are
 * HMAC digests of an account identifier or network address, never raw PII.
 */
export const authenticationRateLimits = pgTable(
  'authentication_rate_limits',
  {
    keyHash: text('key_hash').primaryKey(),
    kind: text('kind').notNull(),
    failureCount: integer('failure_count').notNull().default(0),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).defaultNow().notNull(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ expiryIdx: index('authentication_rate_limits_expiry_idx').on(t.blockedUntil) })
);

/** Append-only, privacy-preserving authentication security events. */
export const authenticationEvents = pgTable(
  'authentication_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    outcome: text('outcome').notNull(),
    identityHash: text('identity_hash'),
    ipHash: text('ip_hash'),
    userAgentHash: text('user_agent_hash'),
    metadata: jsonb('metadata').$type<Record<string, string | number | boolean | null>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ userTimeIdx: index('authentication_events_user_time_idx').on(t.userId, t.occurredAt) })
);
