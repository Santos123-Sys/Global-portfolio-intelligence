import { z } from 'zod';
const databaseUrl = z.string().url().refine(value => /^postgres(ql)?:/.test(value));
const schema = z.object({
  DATABASE_URL: databaseUrl, SESSION_SECRET: z.string().min(32),
  MFA_ENCRYPTION_KEY: z.string().min(32).optional(), PUBLIC_APP_URL: z.string().url().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.PUBLIC_APP_URL?.startsWith('https://'))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PUBLIC_APP_URL'], message: 'HTTPS public origin required in production' });
});
export type Env = z.infer<typeof schema>;
export function getEnv(): Env { return schema.parse(process.env); }
export function getDatabaseUrl(): string { return databaseUrl.parse(process.env.DATABASE_URL); }
