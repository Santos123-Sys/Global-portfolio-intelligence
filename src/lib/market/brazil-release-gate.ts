/** A successful process or catalog download is never a financial release approval. */
export type BrazilCanaryResult = {
 symbol:string;
 status:'ready'|'quarantined'|'short_history'|'unavailable_or_review_required'|'issuer_mapping_required';
 stage:'identity'|'primary'|'acquisition'|'assessment'|'consumer'|'complete';
 normalization?:string;
 consumer?:'verified'|'not_eligible';
 reason?:string;
 issues?:string[];
 unresolved?:string[];
 unresolvedCount?:number;
 observations?:number;
 sourceHash?:string;
 snapshotId?:string;
 sourceHashBasis?:string;
};

export function brazilReleaseGate(catalogAvailable:boolean,requestedSymbols:string[],results:BrazilCanaryResult[]){
 const reasons:string[]=[];
 if(!catalogAvailable)reasons.push('catalog_unavailable');
 if(!requestedSymbols.length||requestedSymbols.length>8||new Set(requestedSymbols).size!==requestedSymbols.length||
  requestedSymbols.some(s=>!/^[A-Z][A-Z0-9]{3}\d{1,2}$/.test(s)))reasons.push('invalid_sample');
 if(results.length!==requestedSymbols.length||new Set(results.map(r=>r.symbol)).size!==results.length||
  results.some(r=>!requestedSymbols.includes(r.symbol)))reasons.push('sample_incomplete');
 const verified=(symbol:string)=>{
  const r=results.find(r=>r.symbol===symbol);
  return r?.status==='ready'&&r.stage==='complete'&&r.normalization==='verified'&&r.consumer==='verified'&&
   /^brazil-gross-entitlement\.v[123]$/.test(r.sourceHashBasis??'')&&Number.isSafeInteger(r.observations)&&(r.observations??0)>=1100&&
   /^[a-f0-9]{64}$/.test(r.sourceHash??'')&&r.snapshotId==='mh1_'+r.sourceHash&&
   (r.issues?.length??0)===0&&(r.unresolvedCount??0)===0&&(r.unresolved?.length??0)===0;
 };
 for(const symbol of requestedSymbols)if(!verified(symbol))reasons.push(symbol+':not_verified');
 return {status:reasons.length?'blocked' as const:'passed' as const,reasons,
  scope:'selected_instruments_only' as const,marketCertified:false as const,
  certifiedSymbols:reasons.length?[]:requestedSymbols.filter(verified)};
}
