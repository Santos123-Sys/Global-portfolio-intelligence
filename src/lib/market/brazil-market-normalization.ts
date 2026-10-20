import type {MarketHistory,PriceRow} from './history-quality';
import type {BrazilEvidence} from './brazil-normalization';
const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const positive=(v:number)=>Number.isFinite(v)&&v>0;
const near=(a:number,b:number,t=.000002)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=t;
const digest=(s:string)=>/^[a-f0-9]{64}$/.test(s);
export function validBrazilIsin(s:string){
 if(!/^BR[A-Z0-9]{9}\d$/.test(s))return false;
 const digits=[...s].map(c=>/[A-Z]/.test(c)?String(c.charCodeAt(0)-55):c).join('');
 let sum=0;for(let i=digits.length-1,n=0;i>=0;i--,n++){let v=Number(digits[i]);if(n%2)v*=2;sum+=v>9?v-9:v;}return sum%10===0;
}
export function validateBrazilIdentity(h:MarketHistory,e:BrazilEvidence){
 const id=e.identity,symbol=h.symbol.slice(0,-3);
 if(!/^[A-Z]{4}\d{1,2}\.SA$/.test(h.symbol)||!/^br:\d{14}$/.test(h.issuerId)||h.currency!=='BRL'||
  e.symbol!==h.symbol||e.issuerId!==h.issuerId||!id||id.symbol!==symbol||id.cnpj!==h.issuerId.slice(3)||
  id.profileUrl!=='https://brapi.dev/api/v2/stocks/profile'||id.coverageUrl!=='https://brapi.dev/api/v2/tickers/coverage'||
  !digest(id.profileSha256)||!digest(id.coverageSha256)||!['stock','unit'].includes(id.subType)||id.assetType!=='stock')throw Error('history_brazil_identity');
 if((e.events.cash.length||e.events.stock.length)&&!validBrazilIsin(e.isin))throw Error('history_brazil_isin');
}
/** Reusable engine. Issuer-specific PETR4 exceptions remain confined to the v1 engine. */
export function normalizeBrazilMarket(h:MarketHistory,e:BrazilEvidence,now:number){
 validateBrazilIdentity(h,e);
 const invalid=()=>{throw Error('history_brazil_evidence_invalid');};
 if(e.version!=='brazil-evidence.v2'||e.raw.sourceUrl!=='https://brapi.dev/api/v2/stocks/historical'||
  e.events.sourceUrl!=='https://brapi.dev/api/v2/stocks/dividends'||e.relay.sourceUrl!=='https://cotab3.com.br/cotacoes'||
  ![e.raw.rawSha256,e.events.rawSha256,e.relay.rawSha256].every(digest)||!Number.isFinite(Date.parse(e.retrievedAt))||
  Date.parse(e.retrievedAt)>now+30000||now-Date.parse(e.retrievedAt)>8*86400000||h.secondary?.provider!=='BrAPI'||
  h.secondary.symbol!==h.symbol||h.secondary.issuerId!==h.issuerId||
  e.raw.rows.length!==h.rows.length||h.secondary.rows.length!==h.rows.length||e.raw.rows.length>1500||
  e.events.cash.length>500||e.events.stock.length>100||e.relay.rows.length>1600)invalid();
 const unresolved:string[]=[],splits=new Map<string,number>(),yahooSplits=new Map<string,number>(),dates=new Map(h.reference.dates.map((d,i)=>[d,i]));
 const inWindow=(d:string)=>d>=h.requestedStart&&d<=h.requestedEnd;
 for(const a of h.corporateActions.filter(a=>a.kind==='split')){
  if(yahooSplits.has(a.date)||!positive(a.value))invalid();yahooSplits.set(a.date,a.value);
 }
 for(const a of e.events.stock){
  if(!validDate(a.date)||!positive(a.factor)||a.isin!==e.isin||!['DESDOBRAMENTO','GRUPAMENTO','BONIFICACAO','BONIFICAÇÃO'].includes(a.label??''))invalid();
  if(!inWindow(a.date))continue;
  const recordIndex=a.recordDate?dates.get(a.recordDate):undefined;
  if(recordIndex===undefined||h.reference.dates[recordIndex+1]!==a.date)unresolved.push(a.date+':stock_record_ex_alignment');
  if(splits.has(a.date))invalid();splits.set(a.date,a.factor);
  if(!near(yahooSplits.get(a.date)??NaN,a.factor,1e-8))unresolved.push(a.date+':stock_action_unresolved');
 }
 for(const d of yahooSplits.keys())if(!splits.has(d))unresolved.push(d+':stock_action_missing');
 if(e.events.subscriptions?.length)unresolved.push('subscription_requires_review');
 const future=new Map<string,number>();let splitProduct=1;
 for(let i=h.rows.length-1;i>=0;i--){const d=h.rows[i].date;future.set(d,splitProduct);splitProduct*=splits.get(d)??1;}
 if(!positive(splitProduct))invalid();
 const relay=new Map<string,number>(),relayDuplicates:string[]=[];
 for(const r of e.relay.rows){
  if(!validDate(r.date)||!inWindow(r.date)||!positive(r.close)||!h.rows.some(p=>p.date===r.date))invalid();
  if(relay.has(r.date)){if(relay.get(r.date)!==r.close)invalid();relayDuplicates.push(r.date);}else relay.set(r.date,r.close);
 }
 const quotes:{date:string;close:number;rule:'two_raw_feeds_agree'|'relay_confirms_brapi';yahooClose:number;relayClose:number|null}[]=[];
 for(let i=0;i<h.rows.length;i++){
  const p=h.rows[i],b=e.raw.rows[i],s=h.secondary!.rows[i],w=relay.get(p.date);
  if(b.date!==p.date||s.date!==p.date||!positive(b.close)||!positive(b.adjustedClose)||!near(b.adjustedClose,s.adjustedClose,1e-8))invalid();
  const yahooClose=p.close*future.get(p.date)!,agree=near(yahooClose,b.close,.005);
  if(w!==undefined&&!near(w,b.close,.005))unresolved.push(p.date+':relay_quote_conflict');
  if(!agree&&(w===undefined||!near(w,b.close,.005)))unresolved.push(p.date+':raw_quote_unresolved');
  quotes.push({date:p.date,close:b.close,rule:agree?'two_raw_feeds_agree':'relay_confirms_brapi',yahooClose,relayClose:w??null});
 }
 const yahooCash=new Map<string,number>();
 for(const a of h.corporateActions.filter(a=>a.kind==='dividend')){if(yahooCash.has(a.date))invalid();yahooCash.set(a.date,a.value*(future.get(a.date)??NaN));}
 const groups=new Map<string,typeof e.events.cash>();
 for(const a of e.events.cash){
  if(!validDate(a.recordDate))invalid();
  if(!inWindow(a.recordDate))continue;
  if(a.isin!==e.isin||!positive(a.rawRate)||!['DIVIDENDO','JCP','RENDIMENTO'].includes(a.label)||!a.verified||!validDate(a.paymentDate))invalid();
  if(a.exDate===null){unresolved.push(a.recordDate+':ex_date_missing');continue;}
  if(!validDate(a.exDate))invalid();if(!inWindow(a.exDate))continue;
  const index=dates.get(a.recordDate);
  if(index===undefined||h.reference.dates[index+1]!==a.exDate){unresolved.push(a.exDate+':record_ex_alignment');continue;}
  if(splits.has(a.exDate)){unresolved.push(a.exDate+':simultaneous_stock_cash_review');continue;}
  const g=groups.get(a.exDate)??[];
  if(g.some(b=>b.paymentDate===a.paymentDate&&b.label===a.label&&near(b.rawRate,a.rawRate,1e-10)))invalid();
  g.push(a);groups.set(a.exDate,g);
 }
 const cash:{date:string;amount:number;vendorGross:number;yahooGross:number;sourceUrl:string;review:string}[]=[];
 const reported=new Map<string,{gross:number;taxable:number}>();
 for(const [d,g] of groups){
  const gross=g.reduce((s,a)=>s+a.rawRate,0),principal=g.filter(a=>a.label!=='RENDIMENTO').reduce((s,a)=>s+a.rawRate,0),y=yahooCash.get(d);
  if(!near(gross,y??NaN))unresolved.push(d+':cash_unresolved');
  if(!positive(principal)){unresolved.push(d+':principal_requires_review');continue;}
  cash.push({date:d,amount:principal,vendorGross:gross,yahooGross:y??0,sourceUrl:e.events.sourceUrl,review:'Corroborated gross entitlement; withholding and separately labelled monetary income excluded.'});
  reported.set(d,{gross,taxable:g.filter(a=>['JCP','RENDIMENTO'].includes(a.label)).reduce((s,a)=>s+a.rawRate,0)});
 }
 for(const d of yahooCash.keys())if(!groups.has(d))unresolved.push(d+':cash_missing_brapi');
 const sourceReturnChecks:{date:string;yahooResidual:number;brapiResidual:number;observedWithholdingFactor:number}[]=[];
 for(let i=1;i<h.rows.length;i++){
  const p=h.rows[i-1],r=h.rows[i],pb=e.raw.rows[i-1],b=e.raw.rows[i],split=splits.get(r.date)??1,event=reported.get(r.date)??{gross:0,taxable:0};
  const yCash=(yahooCash.get(r.date)??0)/future.get(r.date)!;
  const yahooResidual=Math.abs(r.adjustedClose/p.adjustedClose-r.close/(p.close-yCash));
  const actual=b.adjustedClose/pb.adjustedClose;
  const best=[0,.15,.175].map(rate=>({rate,residual:Math.abs(actual-b.close*split/(pb.close-event.gross+event.taxable*rate))})).sort((a,b)=>a.residual-b.residual)[0];
  if(!Number.isFinite(yahooResidual)||yahooResidual>.00005||!Number.isFinite(best.residual)||best.residual>.00005)unresolved.push(r.date+':source_factor_unexplained');
  sourceReturnChecks.push({date:r.date,yahooResidual,brapiResidual:best.residual,observedWithholdingFactor:best.rate});
 }
 const amounts=new Map(cash.map(a=>[a.date,a.amount])),calculationRows:PriceRow[]=[];let multiplier=1;
 for(let i=quotes.length-1;i>=0;i--){
  const q=quotes[i];calculationRows[i]={...h.rows[i],close:q.close,adjustedClose:q.close*multiplier};
  const amount=amounts.get(q.date)??0,split=splits.get(q.date)??1;
  if(amount||split!==1){if(i===0||amount>=quotes[i-1].close)unresolved.push(q.date+':adjustment_boundary');else multiplier*=(1-amount/quotes[i-1].close)/split;}
 }
 const conflictDates=h.rows.flatMap((r,i)=>i&&Math.abs(h.secondary!.rows[i].adjustedClose/h.secondary!.rows[i-1].adjustedClose-r.adjustedClose/h.rows[i-1].adjustedClose)>.001?[r.date]:[]);
 const decisions=conflictDates.map(d=>{
  const i=quotes.findIndex(q=>q.date===d),raw=[quotes[i-1],quotes[i]].some(q=>q?.rule==='relay_confirms_brapi');
  const rule=raw?'closing_quote_adjudicated':amounts.has(d)?'gross_cash_basis':splits.has(d)?'corroborated_stock_action':'unexplained';
  if(rule==='unexplained')unresolved.push(d+':return_unexplained');return {date:d,rule};
 });
 return {version:'brazil-gross-entitlement.v2' as const,status:unresolved.length?'blocked' as const:'verified' as const,unresolved:[...new Set(unresolved)],
  verifiedQuotes:unresolved.some(s=>s.includes('quote'))?0:quotes.length,adjudicatedQuoteDates:quotes.filter(q=>q.rule==='relay_confirms_brapi').map(q=>q.date),
  relayCompared:relay.size,relayMissing:h.rows.filter(r=>!relay.has(r.date)).map(r=>r.date),relayDuplicates,
  originalReturnConflicts:conflictDates.length,decisions,quotes,cash,excluded:[] as {date:string;reason:string;sourceUrl:string}[],sourceReturnChecks,sourceReturnTolerance:.00005,calculationRows,
  methodology:'Versioned Brazilian gross-entitlement back adjustment; split factors corroborated across providers; per-share cash bound to class and raw-price scale. No interpolation, issuer-rule borrowing or automatic rename stitching. Upstream independence and point-in-time availability are not certified.'};
}
