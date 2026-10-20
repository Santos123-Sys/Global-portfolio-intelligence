/** Saved result labels remain honest when live integration settings later change. */
export function researchState(status:string){
 const labels:Record<string,string>={disabled_or_no_evidence:'Evidence pack saved; no AI draft was produced.',
  finance_unavailable:'Financial evidence was unavailable when this run was saved.',model_disabled:'Evidence saved; AI drafting was disabled.',
  no_supported_facts:'Evidence contains no supported facts for an AI draft.',draft_requires_review:'AI draft ready for your review.',
  model_failed_evidence_pack_retained:'AI draft failed; your evidence pack is retained.',ready:'Research ready for review.',
  partial:'Research is partial; review the evidence gaps.',disabled:'Research drafting is disabled.'};
 return labels[status]??'Research saved. Review its evidence and limitations.';
}
export function financeRecovery(status:string){
 return status==='disabled'?'The FilingLens connection was disabled for this saved run. Start a new evidence pack to check the current connection.':
 status==='identity_unmapped'?'Confirm this company’s CIK/CNPJ mapping before retrying.':
 'FilingLens evidence could not be retrieved or validated. Retry the evidence pack; missing values remain unknown.';
}
