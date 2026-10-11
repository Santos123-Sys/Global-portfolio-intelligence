import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { APPLE_2025_PDF, APPLE_2025_PDF_SHA256, IssuerStatementReadError, readIssuerStatement } from "../src/lib/integrations/issuer-statement-client";

const base = {
  schemaVersion: "filinglens-issuer-primary-v1",
  issuer: { jurisdiction: "us", registryId: "0000320193" },
  issuerName: "Apple Inc.",
  provenance: "issuer_published_unaudited_pdf",
  secCompanyFactsVerified: false,
  source: { url: APPLE_2025_PDF, sha256: APPLE_2025_PDF_SHA256, retrievedAt: "2026-10-10T10:00:00.000Z", periodEnd: "2025-09-27" },
  facts: [
    { metric: "revenue", value: "416161", unit: "USD millions", currency: "USD", fiscalYear: 2025, periodEnd: "2025-09-27", proofStatus: "issuer_published_verified" },
    { metric: "grossProfit", value: "195201", unit: "USD millions", currency: "USD", fiscalYear: 2025, periodEnd: "2025-09-27", proofStatus: "issuer_published_verified" },
    { metric: "operatingIncome", value: "133050", unit: "USD millions", currency: "USD", fiscalYear: 2025, periodEnd: "2025-09-27", proofStatus: "issuer_published_verified" },
    { metric: "netIncome", value: "112010", unit: "USD millions", currency: "USD", fiscalYear: 2025, periodEnd: "2025-09-27", proofStatus: "issuer_published_verified" },
  ],
  revenueGrowthYoYPct: null,
  limitations: ["Unaudited issuer disclosure, not SEC CompanyFacts."],
};
const signed = (value: Record<string, unknown> = base) => ({
  ...value, contentHash: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
});
const mockFetch = (body: unknown, status = 200) => vi.fn(async () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
const options = { baseUrl: "https://filinglens.example/", token: "s".repeat(48) };
describe("FilingLens issuer-primary GPI consumer", () => {
  it("accepts only a separately labeled issuer disclosure with a valid digest", async () => {
    const fetch = mockFetch(signed());
    const result = await readIssuerStatement({ ...options, fetch: fetch as typeof globalThis.fetch });
    expect(result.provenance).toBe("issuer_published_unaudited_pdf");
    expect(result.secCompanyFactsVerified).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects modified, differently sourced or misleading proof", async () => {
    for (const value of [
      { ...signed(), facts: [{ ...base.facts[0], value: "123" }, ...base.facts.slice(1)] },
      signed({ ...base, secCompanyFactsVerified: true }),
      signed({ ...base, provenance: "sec_companyfacts" }),
      signed({ ...base, source: { ...base.source, sha256: "f".repeat(64) } }),
    ]) {
      await expect(readIssuerStatement({ ...options, fetch: mockFetch(value) as typeof globalThis.fetch }))
        .rejects.toBeInstanceOf(IssuerStatementReadError);
    }
  });
  it("refuses wrong transport, missing token or upstream auth failures", async () => {
    await expect(readIssuerStatement({ ...options, baseUrl: "http://filinglens.example/" }))
      .rejects.toMatchObject({ code: "invalid_config" });
    await expect(readIssuerStatement({ ...options, token: "too-short" }))
      .rejects.toMatchObject({ code: "invalid_config" });
    await expect(readIssuerStatement({ ...options, fetch: mockFetch({ error: "unauthorized" }, 401) as typeof globalThis.fetch }))
      .rejects.toMatchObject({ code: "upstream_auth_failed" });
  });
});
