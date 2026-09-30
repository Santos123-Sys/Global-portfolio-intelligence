import type { AgentOutput } from '../contracts';

/** Auditable, deterministic first pass; a known URL alone does not verify a claim. */
export function validateQuality(output:AgentOutput, sources:Record<string,string>):string[] {
  const errors:string[]=[];
  if(output.citations.some(c=>!(c in sources))) errors.push('Unknown citation');
  if(output.status==='completed' && (!output.citations.length || output.confidenceScore<60)) errors.push('Completed output needs evidence and confidence >=60');
  if(output.claims) {
    const uncited=output.claims.filter(c=>!c.citations.length).length;
    if(uncited/output.claims.length>.2) errors.push('More than 20% of claims are uncited');
    for(const claim of output.claims) {
      const normalize=(s:string)=>s.toLowerCase().replace(/\s+/g,' ').trim();
      if(!claim.citations.some(c=>sources[c] && normalize(sources[c]).includes(normalize(claim.evidence)))) errors.push(`Claim evidence does not match retained sources: ${claim.text.slice(0,120)}`);
    }
  }
  const visit=(v:unknown,key='')=>{
    if(typeof v==='number' && !Number.isFinite(v)) errors.push(`Nonfinite numeric ${key}`);
    if(typeof v==='number' && /(?:score|conviction)$/i.test(key) && (v<0 || v>100)) errors.push(`Score outside 0–100: ${key}`);
    if(v && typeof v==='object') Object.entries(v).forEach(([k,x])=>visit(x,k));
  };
  visit(output.data);
  return [...new Set(errors)];
}
