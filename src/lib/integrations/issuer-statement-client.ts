import { createHash } from "node:crypto";
import { z } from "zod";

export const APPLE_2025_PDF_SHA256 =
  "43e7f0730b3cce0fc37301a2f43c29712bbde6ab299d97c6df345fd0c754508a";
export const APPLE_2025_PDF =
  "https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf";
const Sha = z.string().regex(/^[a-f0-9]{64}$/);
export const IssuerStatementV1 = z.object({
  schemaVersion: z.literal("filinglens-issuer-primary-v1"),
  issuer: z.object({ jurisdiction: z.literal("us"), registryId: z.literal("0000320193") }).strict(),
  issuerName: z.literal("Apple Inc."),
  provenance: z.literal("issuer_published_unaudited_pdf"),
  secCompanyFactsVerified: z.literal(false),
  source: z.object({
    url: z.literal(APPLE_2025_PDF),
    sha256: z.literal(APPLE_2025_PDF_SHA256),
    retrievedAt: z.string().datetime({ offset: true }),
    periodEnd: z.literal("2025-09-27"),
  }).strict(),
  facts: z.array(z.object({
    metric: z.enum(["revenue", "grossProfit", "operatingIncome", "netIncome"]),
    value: z.string().regex(/^\d+$/),
    unit: z.literal("USD millions"),
    currency: z.literal("USD"),
    fiscalYear: z.literal(2025),
    periodEnd: z.literal("2025-09-27"),
    proofStatus: z.literal("issuer_published_verified"),
  }).strict()).length(4),
  revenueGrowthYoYPct: z.null(),
  limitations: z.array(z.string().max(300)).min(1).max(10),
  contentHash: Sha,
}).strict().superRefine((body, ctx) => {
  if (new Set(body.facts.map(f => f.metric)).size !== 4) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Missing distinct annual facts" });
  }
});
export type IssuerStatementV1 = z.infer<typeof IssuerStatementV1>;
export class IssuerStatementReadError extends Error {
  constructor(readonly code: string) { super(code); this.name = "IssuerStatementReadError"; }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new IssuerStatementReadError("invalid_response_type");
  if (Number(response.headers.get("content-length")) > 64_000)
    throw new IssuerStatementReadError("oversized_response");
  if (!response.body) throw new IssuerStatementReadError("empty_response");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 64_000) throw new IssuerStatementReadError("oversized_response");
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new IssuerStatementReadError("invalid_json"); }
}

export async function readIssuerStatement(options: {
  baseUrl: string; token: string; fetch?: typeof fetch;
}): Promise<IssuerStatementV1> {
  let base: URL;
  try { base = new URL(options.baseUrl); }
  catch { throw new IssuerStatementReadError("invalid_config"); }
  if (base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash ||
      base.username || base.password || options.token.length < 32 || /[\r\n]/.test(options.token))
    throw new IssuerStatementReadError("invalid_config");
  const url = new URL("/api/integration/v1/issuers/us/0000320193/issuer-statement", base);
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(url, {
      method: "GET", cache: "no-store", redirect: "error",
      headers: { accept: "application/json", Authorization: `Bearer ${options.token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch { throw new IssuerStatementReadError("upstream_unavailable"); }
  if (!res.ok) {
    await res.body?.cancel();
    throw new IssuerStatementReadError(res.status === 404 ? "not_supported" :
      res.status === 401 || res.status === 403 ? "upstream_auth_failed" : "upstream_unavailable");
  }
  const raw = await boundedJson(res);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new IssuerStatementReadError("invalid_contract");
  const { contentHash, ...payload } = raw as Record<string, unknown>;
  if (typeof contentHash !== "string" ||
      createHash("sha256").update(JSON.stringify(payload)).digest("hex") !== contentHash)
    throw new IssuerStatementReadError("digest_mismatch");
  const parsed = IssuerStatementV1.safeParse(raw);
  if (!parsed.success) throw new IssuerStatementReadError("invalid_contract");
  return parsed.data;
}
