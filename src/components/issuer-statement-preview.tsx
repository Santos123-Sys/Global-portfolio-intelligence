"use client";
import { useState } from "react";
import type { IssuerStatementV1 } from "@/lib/integrations/issuer-statement-client";

export function IssuerStatementPreview({ candidateKey }: { candidateKey: string }) {
  const [state, setState] = useState<{
    busy: boolean; message: string; data: IssuerStatementV1 | null;
  }>({ busy: false, message: "", data: null });
  async function load() {
    setState({ busy: true, message: "", data: null });
    try {
      const response = await fetch(
        "/api/integration/v1/issuer-statement?candidateKey=" + encodeURIComponent(candidateKey),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok || body.status !== "ready") {
        setState({ busy: false, message: body.reason ?? body.status ?? body.error ?? "Evidence unavailable", data: null });
        return;
      }
      setState({ busy: false, message: "", data: body.snapshot as IssuerStatementV1 });
    } catch {
      setState({ busy: false, message: "Source read unavailable", data: null });
    }
  }
  return <div>
    <button className="secondary" type="button" onClick={load} disabled={state.busy}>
      {state.busy ? "Verifying source…" : "Issuer PDF evidence"}
    </button>
    {state.message && <small role="status">{state.message}</small>}
    {state.data && <details open>
      <summary>Apple FY2025 · issuer-published unaudited</summary>
      <p className="muted"><strong>NOT SEC CompanyFacts verified.</strong> FilingLens checked the issuer-published PDF and its accepted SHA-256. Values are USD millions.</p>
      <ul>{state.data.facts.map(f =>
        <li key={f.metric}>{f.metric}: {f.value} {f.unit}, FY{f.fiscalYear}</li>)}</ul>
      <a href={state.data.source.url} target="_blank" rel="noreferrer">Source: Apple financial statement PDF</a>
      <small>PDF SHA-256: {state.data.source.sha256}</small>
      <small>Annual growth: unavailable (one validated fiscal year). No SEC certification or audit assertion.</small>
    </details>}
  </div>;
}
