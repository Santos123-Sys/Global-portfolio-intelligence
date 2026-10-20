/** Diagnostic scenarios only: never selects, blends or repairs a canonical price. */
export function priceSensitivity(primary:{rows:{date:string;adjustedClose:number}[];reference?:{dates:string[]}},secondary:{rows:{date:string;adjustedClose:number}[]} | undefined){
 if(!secondary)return null;
 const map=new Map(secondary.rows.map(r=>[r.date,r.adjustedClose]));
 const sessionIndex=primary.reference?new Map(primary.reference.dates.map((d,i)=>[d,i])):null;
 const paired=primary.rows.map((r,i)=>({r,previous:primary.rows[i-1],second:map.get(r.date)})).filter(v=>v.second!==undefined);
 const returns=(useSecondary:boolean)=>paired.flatMap(({r,previous,second})=>{
  if(!previous||!map.has(previous.date)||(sessionIndex&&(!sessionIndex.has(previous.date)||sessionIndex.get(r.date)!==sessionIndex.get(previous.date)!+1)))return [];
  return [(useSecondary?second!/map.get(previous.date)!:r.adjustedClose/previous.adjustedClose)-1];
 });
 const first=paired[0]?.r.date,last=paired.at(-1)?.r.date;
 if(paired.length<3||!first||!last)return null;
 const metrics=(values:number[])=>{
  if(values.length<2||values.some(v=>!Number.isFinite(v)))return null;
  const mean=values.reduce((s,v)=>s+v,0)/values.length;
  const variance=values.reduce((s,v)=>s+(v-mean)**2,0)/(values.length-1);
  const sorted=[...values].sort((a,b)=>a-b),q=sorted[Math.floor((sorted.length-1)*.05)];
  return {annualizedVolatility:Math.sqrt(variance*252),historicalVar95:Math.max(0,-q)};
 };
 const p=returns(false),s=returns(true);
 return {diagnosticOnly:true as const,firstDate:first,lastDate:last,comparedReturns:p.length,
  primary:metrics(p),secondary:metrics(s),
  limitation:'Same adjacent-session pairs only; no return across missing sessions. Scenario differences are not a confidence interval, source adjudication or permission to use disputed prices.'};
}
