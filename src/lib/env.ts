/**
 * Environment validation. Fails loudly at startup, naming the missing key.
 *
 * This module keeps Railway/runtime configuration failures explicit rather than
 * allowing an undefined credential to fail deep inside a request.
 */
import { z } from 'zod';

const databaseUrlSchema = z.string().url('DATABASE_URL must be a valid Postgres connection string');

const schema = z.object({
  DATABASE_URL: databaseUrlSchema,
  MARKET_DATA_API_KEY: z.string().min(1).optional(),
  MARKET_DATA_PROVIDER: z.enum(['stub', 'stooq', 'twelvedata', 'eodhd', 'yahoo-search']).default('stub'),
  /** Low-cost breadth provider. Market validation deliberately remains separate. */
  DISCOVERY_PROVIDER: z.enum(['eodhd', 'finnhub']).default('eodhd'),
  DISCOVERY_FALLBACK_PROVIDER: z.enum(['none', 'eodhd']).default('none'),
  /** Brazil-specific primary source for B3 listings, quotes and basic indicators. */
  BRAPI_API_KEY: z.string().min(1).optional(),
  FINNHUB_API_KEY: z.string().min(1).optional(),
  /** How long a successful discovery-universe snapshot can satisfy a fallback request. */
  DISCOVERY_UNIVERSE_LIMIT: z.coerce.number().int().min(100).max(4000).default(2000),
  DISCOVERY_RESEARCH_BUDGET: z.coerce.number().int().min(1).max(100).default(40),
  DISCOVERY_UNIVERSE_CACHE_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(168),
  // Self-imposed ceilings the provider gateway enforces before making a call,
  // not a measurement of what the vendor actually allows — docs/architecture.md
  // already flags exact vendor rate limits as unverified from this codebase.
  // Defaults are deliberately conservative; raise them once you have measured
  // your real limit. A default too low costs a delay, one too high costs a
  // lockout, so the conservative direction is the safe one to default to.
  MARKET_DATA_GATEWAY_CALLS_PER_MINUTE: z.coerce.number().int().positive().default(60),
  MARKET_DATA_GATEWAY_CALLS_PER_DAY: z.coerce.number().int().positive().default(2_000),
  MARKET_DATA_GATEWAY_PLAN_LIMIT_MEMORY_HOURS: z.coerce.number().int().positive().default(24),
  WEB_SEARCH_PROVIDER: z.enum(['none', 'brave', 'tavily']).default('none'),
  WEB_SEARCH_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  DOCUMENT_STORAGE_PATH: z.string().min(1).default('./storage/documents'),
  AWS_S3_BUCKET: z.string().min(1).optional(),
  AWS_ENDPOINT: z.string().url().optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).default('us-east-1'),
  NEWS_SCRAPER_DB_PATH: z.string().min(1).optional(),
  SEC_USER_AGENT: z.string().min(3).optional(),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(100),
  CHUNK_TARGET_SIZE: z.coerce.number().int().min(200).max(1200).default(800),
  MAX_CONCURRENT_DOWNLOADS: z.coerce.number().int().min(1).max(20).default(5),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must contain at least 32 characters'),
  /** Separate key used only to encrypt TOTP seeds and hash recovery codes. */
  MFA_ENCRYPTION_KEY: z.string().min(32, 'MFA_ENCRYPTION_KEY must contain at least 32 characters').optional(),
  /** Pins CSRF origin validation to the public dashboard origin when configured. */
  PUBLIC_APP_URL: z.string().url('PUBLIC_APP_URL must be a valid absolute URL').optional(),
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 chars').optional(),
  /** External Agentic System integration; the dashboard never owns its prompts. */
  AGENTIC_SYSTEM_BASE_URL: z.string().url().optional(),
  AGENTIC_SYSTEM_API_KEY: z.string().min(32, 'AGENTIC_SYSTEM_API_KEY must contain at least 32 characters').optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
}).superRefine((env, context) => {
  if (env.MARKET_DATA_PROVIDER === 'eodhd' && !env.MARKET_DATA_API_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MARKET_DATA_API_KEY'],
      message: 'MARKET_DATA_API_KEY is required when MARKET_DATA_PROVIDER=eodhd',
    });
  }
  if (env.DISCOVERY_PROVIDER === 'finnhub' && !env.FINNHUB_API_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['FINNHUB_API_KEY'],
      message: 'FINNHUB_API_KEY is required when DISCOVERY_PROVIDER=finnhub',
    });
  }
  if (Boolean(env.AGENTIC_SYSTEM_BASE_URL) !== Boolean(env.AGENTIC_SYSTEM_API_KEY)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AGENTIC_SYSTEM_BASE_URL'],
      message: 'AGENTIC_SYSTEM_BASE_URL and AGENTIC_SYSTEM_API_KEY must be configured together',
    });
  }
  const s3Values = [env.AWS_S3_BUCKET, env.AWS_ACCESS_KEY_ID, env.AWS_SECRET_ACCESS_KEY];
  if (s3Values.some(Boolean) && !s3Values.every(Boolean)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['AWS_S3_BUCKET'], message: 'AWS_S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together' });
  if (env.NODE_ENV === 'production' && !env.PUBLIC_APP_URL?.startsWith('https://')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PUBLIC_APP_URL'],
      message: 'PUBLIC_APP_URL must be configured with an https:// origin in production',
    });
  }
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function validationFailure(issues: z.ZodIssue[]): Error {
  const missing = issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  return new Error(
    `Environment validation failed:\n${missing}\n\n` +
    `Set the missing values on the Railway dashboard service and redeploy.`
  );
}

/**
 * Database modules use this narrower validator so importing a route during a
 * framework build does not read unrelated runtime secrets. The value is still
 * required before the first query is created.
 */
export function getDatabaseUrl(): string {
  const parsed = databaseUrlSchema.safeParse(process.env.DATABASE_URL?.trim());
  if (!parsed.success) {
    throw validationFailure(parsed.error.issues.map((issue) => ({
      ...issue,
      path: ['DATABASE_URL', ...issue.path],
    })));
  }
  return parsed.data;
}

export function getEnv(): Env {
  if (cached) return cached;
  const optional = (value: string | undefined) => value?.trim() || undefined;
  const parsed = schema.safeParse({
    ...process.env,
    MARKET_DATA_API_KEY: optional(process.env.MARKET_DATA_API_KEY),
    FINNHUB_API_KEY: optional(process.env.FINNHUB_API_KEY),
    BRAPI_API_KEY: optional(process.env.BRAPI_API_KEY),
    WEB_SEARCH_API_KEY: optional(process.env.WEB_SEARCH_API_KEY),
    GEMINI_API_KEY: optional(process.env.GEMINI_API_KEY),
    AWS_S3_BUCKET: optional(process.env.AWS_S3_BUCKET),
    AWS_ENDPOINT: optional(process.env.AWS_ENDPOINT),
    AWS_ACCESS_KEY_ID: optional(process.env.AWS_ACCESS_KEY_ID),
    AWS_SECRET_ACCESS_KEY: optional(process.env.AWS_SECRET_ACCESS_KEY),
    NEWS_SCRAPER_DB_PATH: optional(process.env.NEWS_SCRAPER_DB_PATH),
    SEC_USER_AGENT: optional(process.env.SEC_USER_AGENT),
    CRON_SECRET: optional(process.env.CRON_SECRET),
    AGENTIC_SYSTEM_BASE_URL: optional(process.env.AGENTIC_SYSTEM_BASE_URL),
    AGENTIC_SYSTEM_API_KEY: optional(process.env.AGENTIC_SYSTEM_API_KEY),
    MFA_ENCRYPTION_KEY: optional(process.env.MFA_ENCRYPTION_KEY),
    PUBLIC_APP_URL: optional(process.env.PUBLIC_APP_URL),
  });
  if (!parsed.success) {
    throw validationFailure(parsed.error.issues);
  }
  cached = parsed.data;
  return cached;
}

/** Guards scheduled refresh routes with a bearer token. */
export function assertCronAuthorized(req: Request): void {
  const env = getEnv();
  if (!env.CRON_SECRET) {
    if (env.NODE_ENV === 'production') {
      throw new Error('CRON_SECRET is required in production; cron routes are public without it');
    }
    return;
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    throw new Error('Unauthorized cron invocation');
  }
}
