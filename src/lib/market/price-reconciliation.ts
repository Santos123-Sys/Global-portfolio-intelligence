/** Independent acquisition, not a claim that vendor upstream sources are independent. */
export type SecondaryPrices={provider:'Alpha Vantage'|'EODHD'|'BrAPI';sourceUrl:string;symbol:string;issuerId:string;currency:'USD'|'BRL';timezone:'US/Eastern'|'America/New_York'|'America/Sao_Paulo';retrievedAt:string;priceBasis:'split-dividend-adjusted';rawSha256:string;rows:{date:string;adjustedClose:number}[]};
type Primary={symbol:string;issuerId:string;currency:string;requestedStart:string;requestedEnd:string;rows:{date:string;adjustedClose:number}[]};
export function reconcilePrices(primary:Primary,secondary:SecondaryPrices|undefined,now=Date.now()){
 const base={version:'price-reconciliation.v1',provider:secondary?.provider??null,returnTolerance:0.001,levelTolerance:0.005};
 if(!secondary)return {...base,status:'not_configured',comparedSessions:0,missingSessions:0,discrepancies:[] as string[]};
 const providerValid=secondary.provider==='Alpha Vantage'?secondary.sourceUrl==='https://www.alphavantage.co/query'&&primary.issuerId.startsWith('us:'):
  secondary.provider==='EODHD'?secondary.sourceUrl==='https://eodhd.com/api/eod/'+encodeURIComponent(primary.symbol+'.US')&&primary.issuerId.startsWith('us:'):
  secondary.provider==='BrAPI'?secondary.sourceUrl==='https://brapi.dev/api/v2/stocks/historical'&&primary.issuerId.startsWith('br:')&&primary.symbol.endsWith('.SA'):false;
 const timezoneValid=primary.issuerId.startsWith('br:')?secondary.timezone==='America/Sao_Paulo':['US/Eastern','America/New_York'].includes(secondary.timezone);
 if(!providerValid||secondary.symbol!==primary.symbol||secondary.issuerId!==primary.issuerId||
  secondary.currency!==primary.currency||!timezoneValid||secondary.priceBasis!=='split-dividend-adjusted'||
  !/^[a-f0-9]{64}$/.test(secondary.rawSha256)||!Number.isFinite(Date.parse(secondary.retrievedAt))||Date.parse(secondary.retrievedAt)>now+30000||now-Date.parse(secondary.retrievedAt)>8*86400000||
  !Array.isArray(secondary.rows)||secondary.rows.length<2||secondary.rows.length>1500||secondary.rows.some((r,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date||!Number.isFinite(r.adjustedClose)||r.adjustedClose<=0||r.date<primary.requestedStart||r.date>primary.requestedEnd||(i>0&&r.date<=secondary.rows[i-1].date)))throw Error('history_secondary_invalid');
 const map=new Map(secondary.rows.map(r=>[r.date,r.adjustedClose]));
 const missing=primary.rows.filter(r=>!map.has(r.date)).length;
 // Rebase levels to the common final session: vendors can use different adjustment anchors.
 const last=primary.rows.at(-1)!,anchor=map.get(last.date);
 const discrepancies:string[]=[];let compared=0;
 primary.rows.forEach((r,i)=>{
  const second=map.get(r.date),prev=primary.rows[i-1],prior=prev?map.get(prev.date):undefined;
  if(second===undefined)return;compared++;
  if(!anchor||Math.abs((second/anchor)/(r.adjustedClose/last.adjustedClose)-1)>base.levelTolerance)discrepancies.push(r.date+':normalized_level');
  if(prev&&prior&&Math.abs(second/prior-r.adjustedClose/prev.adjustedClose)>base.returnTolerance)discrepancies.push(r.date+':daily_return');
 });
 return {...base,status:missing||compared<1100?'incomplete':discrepancies.length?'disputed':'matched',comparedSessions:compared,missingSessions:missing,discrepancies};
}
