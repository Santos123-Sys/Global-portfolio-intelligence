import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api-auth";
import { loadWorkspace } from "@/lib/foundation/store";
import { resolveIssuer } from "@/lib/integrations/shared-contracts";
import { readIssuerStatement, IssuerStatementReadError } from "@/lib/integrations/issuer-statement-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  if (process.env.FILINGLENS_ISSUER_PRIMARY_READ_ENABLED !== "true")
    return NextResponse.json({ status: "disabled", reason: "Issuer-published evidence not enabled" }, { status: 503, headers });
  const candidateKey = new URL(req.url).searchParams.get("candidateKey") ?? "";
  if (!/^[A-Z0-9.:-]{1,60}$/.test(candidateKey))
    return NextResponse.json({ error: "Invalid candidate key" }, { status: 422, headers });
  try {
    const workspace = await loadWorkspace(session.auth.userId);
    const candidate = workspace.candidates.find(c => c.key === candidateKey);
    if (!candidate) return NextResponse.json({ error: "Candidate not found in your workspace" }, { status: 404, headers });
    const resolved = resolveIssuer(candidate);
    // Compatibility for the exact, old shipped Apple starter entry. The SEC
    // CIK is bound to the publisher's fixed Apple disclosure contract; never
    // derive a registry ID from an arbitrary ticker or submitted user string.
    const legacyApple = candidate.key === "XNAS:AAPL" && candidate.ticker === "AAPL" &&
      candidate.name === "Apple Inc." && candidate.exchange === "XNAS" &&
      candidate.market === "us" && !candidate.issuer &&
      candidate.identitySourceUrl === "https://api.gleif.org/api/v1/lei-records/HWUPKR0MPOU8FGXBT394";
    if (resolved.status !== "source_linked" && !legacyApple)
      return NextResponse.json({ status: "identity_unmapped" }, { status: 409, headers });
    if (!legacyApple && (resolved.status !== "source_linked" || resolved.issuer.issuerId !== "us:0000320193"))
      return NextResponse.json({ status: "issuer_primary_not_supported" }, { status: 404, headers });
    const snapshot = await readIssuerStatement({
      baseUrl: process.env.FILINGLENS_API_URL ?? "",
      token: process.env.FILINGLENS_ISSUER_PRIMARY_API_TOKEN ?? "",
    });
    return NextResponse.json({ status: "ready", snapshot }, { headers });
  } catch (error) {
    return NextResponse.json({
      status: "unavailable",
      reason: error instanceof IssuerStatementReadError ? error.code : "issuer_source_unavailable",
    }, { status: 503, headers });
  }
}
