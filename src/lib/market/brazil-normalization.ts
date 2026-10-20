import type {MarketHistory,PriceRow} from './history-quality';
import {brazilEventReviews,june2024Review} from './brazil-event-reviews';

export type BrazilEvidence={version:'brazil-evidence.v1';symbol:'PETR4.SA';issuerId:'br:33000167000101';isin:'BRPETRACNPR6';retrievedAt:string;
 raw:{sourceUrl:string;rawSha256:string;rows:{date:string;close:number;adjustedClose:number}[]};
 events:{sourceUrl:string;rawSha256:string;cash:{exDate:string|null;recordDate:string;paymentDate:string;label:string;rawRate:number;isin:string;verified:boolean}[];stock:{date:string;factor:number}[]};
 relay:{sourceUrl:string;rawSha256:string;rows:{date:string;close:number}[]}};
const date=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const near=(a:number,b:number,tolerance=.000002)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance;
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const hash=(v:string)=>/^[a-f0-9]{64}$/.test(v);
export function normalizeBrazil(h:MarketHistory,now=Date.now()){
 const e=h.brazilEvidence;if(!e)return null;
 const invalid=()=>{throw Error('history_brazil_evidence_invalid');};
 if(h.symbol!=='PETR4.SA'||h.issuerId!=='br:33000167000101'||h.currency!=='BRL'||e.version!=='brazil-evidence.v1'||e.symbol!==h.symbol||e.issuerId!==h.issuerId||e.isin!=='BRPETRACNPR6'||h.secondary?.provider!=='BrAPI'||
  e.raw.sourceUrl!=='https://brapi.dev/api/v2/stocks/historical'||e.events.sourceUrl!=='https://brapi.dev/api/v2/stocks/dividends'||e.relay.sourceUrl!=='https://cotab3.com.br/cotacoes'||
  ![e.raw.rawSha256,e.events.rawSha256,e.relay.rawSha256].every(hash)||!Number.isFinite(Date.parse(e.retrievedAt))||Date.parse(e.retrievedAt)>now+30000||now-Date.parse(e.retrievedAt)>8*86400000)invalid();
 if(!Array.isArray(e.raw.rows)||e.raw.rows.length!==h.rows.length||h.secondary!.rows.length!==h.rows.length||!Array.isArray(e.relay.rows)||e.relay.rows.length<2||e.relay.rows.length>1600||
  !Array.isArray(e.events.cash)||e.events.cash.length>500||!Array.isArray(e.events.stock)||e.events.stock.length>100||h.corporateActions.some(a=>a.kind==='split')||
  e.events.stock.some(a=>!date(a.date)||!positive(a.factor)||(a.date>=h.requestedStart&&a.date<=h.requestedEnd)))invalid();
 const secondary=new Map(h.secondary!.rows.map(r=>[r.date,r.adjustedClose]));
 const relay=new Map<string,number>(),relayDuplicates:string[]=[];
 for(const r of e.relay.rows){
  if(!date(r.date)||r.date<h.requestedStart||r.date>h.requestedEnd||!positive(r.close))invalid();
  const old=relay.get(r.date);if(old!==undefined){if(old!==r.close)invalid();relayDuplicates.push(r.date);}else relay.set(r.date,r.close);
 }
 const quotedates=new Set(h.rows.map(r=>r.date));if([...relay.keys()].some(d=>!quotedates.has(d)))invalid();
 const quotes:{date:string;close:number;rule:'two_raw_feeds_agree'|'relay_confirms_brapi';yahooClose:number;relayClose:number|null}[]=[],unresolved:string[]=[];
 for(let i=0;i<h.rows.length;i++){
  const p=h.rows[i],r=e.raw.rows[i],w=relay.get(p.date);
  if(r?.date!==p.date||h.secondary!.rows[i]?.date!==p.date||!positive(r.close)||!positive(r.adjustedClose)||!near(r.adjustedClose,secondary.get(p.date)??NaN,.00000001))invalid();
  const agree=near(p.close,r.close,.005);
  // A contradictory third quote is never discarded, even if the original two agree.
  if(w!==undefined&&!near(w,r.close,.005))unresolved.push(p.date+':relay_quote_conflict');
  if(!agree&&(w===undefined||!near(w,r.close,.005)))unresolved.push(p.date+':raw_quote_unresolved');
  quotes.push({date:p.date,close:r.close,rule:agree?'two_raw_feeds_agree':'relay_confirms_brapi',yahooClose:p.close,relayClose:w??null});
 }
 const yahoo=new Map<string,number>();for(const a of h.corporateActions){if(yahoo.has(a.date))invalid();yahoo.set(a.date,a.value);}
 const groups=new Map<string,typeof e.events.cash>(),excluded:{date:string;reason:string;sourceUrl:string}[]=[],aliasDates=new Set<string>();
 for(const a of e.events.cash){
  if(!date(a.recordDate))invalid();
  if(a.recordDate<h.requestedStart||a.recordDate>h.requestedEnd)continue;
  if(a.isin!==e.isin||!date(a.recordDate)||!date(a.paymentDate)||!positive(a.rawRate)||!['DIVIDENDO','JCP','RENDIMENTO'].includes(a.label)||typeof a.verified!=='boolean'||(a.exDate!==null&&!date(a.exDate)))invalid();
  if(a.exDate===null){
   const duplicate=e.events.cash.some(b=>b.exDate==='2024-06-12'&&b.recordDate==='2024-06-11'&&b.paymentDate===a.paymentDate&&b.rawRate===a.rawRate&&b.label===a.label&&b.isin===a.isin);
   if(a.recordDate!=='2024-05-13'||a.paymentDate!=='2024-09-20'||!duplicate)invalid();
   aliasDates.add('2024-05-14');excluded.push({date:a.recordDate,reason:'superseded_record_date',sourceUrl:june2024Review});continue;
  }
  if(a.exDate>h.requestedEnd)continue;
  const idx=h.reference.dates.indexOf(a.recordDate);if(idx<0||h.reference.dates[idx+1]!==a.exDate)invalid();
  const g=groups.get(a.exDate)??[];
  if(g.some(b=>b.paymentDate===a.paymentDate&&b.label===a.label&&b.rawRate===a.rawRate))invalid();
  g.push(a);groups.set(a.exDate,g);
 }
 const cash:{date:string;amount:number;vendorGross:number;yahooGross:number;sourceUrl:string;review:string}[]=[];
 for(const [d,g] of groups){
  const vendorGross=g.reduce((s,a)=>s+a.rawRate,0),y=yahoo.get(d),review=brazilEventReviews[d];
  if(y===undefined){unresolved.push(d+':cash_missing_yahoo');continue;}
  let principal=g.filter(a=>a.label!=='RENDIMENTO').reduce((s,a)=>s+a.rawRate,0);
  if(g.some(a=>a.label!=='RENDIMENTO'&&!a.verified))invalid();
  if(review){
   const expected=d==='2024-12-26'?[['2025-03-20','JCP',.01053822],['2025-03-20','DIVIDENDO',.65356508],['2025-03-20','JCP',.65356508],['2025-02-20','JCP',.66410331]]:null;
   if(!near(vendorGross,review.brapiTotal)||!near(y,review.yahooTotal)||(expected&&(g.length!==expected.length||expected.some(([pay,label,rate])=>!g.some(a=>a.paymentDate===pay&&a.label===label&&near(a.rawRate,rate as number,.000000001))))))unresolved.push(d+':issuer_review_changed');principal=review.principal;
  }
  else if(!near(vendorGross,y))unresolved.push(d+':cash_unresolved');
  if(!positive(principal))invalid();
  cash.push({date:d,amount:principal,vendorGross,yahooGross:y,sourceUrl:review?.sourceUrl??e.events.sourceUrl,review:review?.reason??'Gross cash entitlement corroborated by both feeds; separately labelled monetary income excluded.'});
 }
 for(const d of yahoo.keys())if(!groups.has(d))unresolved.push(d+':cash_missing_brapi');
 const amounts=new Map(cash.map(a=>[a.date,a.amount]));
 const reportedCash=new Map<string,{gross:number;taxable:number}>();
 for(const a of e.events.cash){
  if(a.recordDate<h.requestedStart||a.recordDate>h.requestedEnd)continue;
  const d=a.exDate??h.reference.dates[h.reference.dates.indexOf(a.recordDate)+1];if(!d)continue;
  const total=reportedCash.get(d)??{gross:0,taxable:0};total.gross+=a.rawRate;
  if(['JCP','RENDIMENTO'].includes(a.label))total.taxable+=a.rawRate;reportedCash.set(d,total);
 }
 // Forensic candidates describe the observed vendor factor, not an investor tax assumption.
 // A date/category explanation alone never clears a return: verify its magnitude too.
 const sourceReturnChecks:{date:string;yahooResidual:number;brapiResidual:number;observedWithholdingFactor:number}[]=[];
 for(let i=1;i<h.rows.length;i++){
  const p=h.rows[i-1],r=h.rows[i],pb=e.raw.rows[i-1],b=e.raw.rows[i],event=reportedCash.get(r.date)??{gross:0,taxable:0};
  const yahooResidual=Math.abs(r.adjustedClose/p.adjustedClose-r.close/(p.close-(yahoo.get(r.date)??0)));
  const actual=b.adjustedClose/pb.adjustedClose;
  const candidates=[0,.15,.175].map(rate=>({rate,residual:Math.abs(actual-b.close/(pb.close-event.gross+event.taxable*rate))})).sort((a,b)=>a.residual-b.residual);
  const best=candidates[0];if(!Number.isFinite(yahooResidual)||yahooResidual>.00005||!Number.isFinite(best.residual)||best.residual>.00005)unresolved.push(r.date+':source_factor_unexplained');
  sourceReturnChecks.push({date:r.date,yahooResidual,brapiResidual:best.residual,observedWithholdingFactor:best.rate});
 }
 // CRSP-style cash back adjustment: prior closes multiply by (1 - gross entitlement / prior close).
 // This is an ex-date gross entitlement index, not actual after-tax cash or a point-in-time backtest.
 const calculationRows:PriceRow[]=[],n=quotes.length;let multiplier=1;
 for(let i=n-1;i>=0;i--){
  const q=quotes[i];calculationRows[i]={...h.rows[i],close:q.close,adjustedClose:q.close*multiplier};
  const amount=amounts.get(q.date);
  if(amount!==undefined){if(i===0||amount>=quotes[i-1].close)invalid();else multiplier*=1-amount/quotes[i-1].close;}
 }
 const originalReturns=h.rows.flatMap((r,i)=>i&&Math.abs(h.secondary!.rows[i].adjustedClose/h.secondary!.rows[i-1].adjustedClose-r.adjustedClose/h.rows[i-1].adjustedClose)>.001?[r.date]:[]);
 const decisions=originalReturns.map(d=>{
  const i=quotes.findIndex(q=>q.date===d),raw=[quotes[i-1],quotes[i]].some(q=>q?.rule==='relay_confirms_brapi');
  const rule=raw?'closing_quote_adjudicated':amounts.has(d)?'gross_cash_basis':aliasDates.has(d)?'superseded_cash_record':'unexplained';
  if(rule==='unexplained')unresolved.push(d+':return_unexplained');
  return {date:d,rule};
 });
 return {version:'brazil-gross-entitlement.v1' as const,status:unresolved.length?'blocked' as const:'verified' as const,unresolved:[...new Set(unresolved)],
  verifiedQuotes:unresolved.some(s=>s.includes('quote'))?0:quotes.length,adjudicatedQuoteDates:quotes.filter(q=>q.rule==='relay_confirms_brapi').map(q=>q.date),
  relayCompared:relay.size,relayMissing:h.rows.filter(r=>!relay.has(r.date)).map(r=>r.date),relayDuplicates,
  originalReturnConflicts:originalReturns.length,decisions,quotes,cash,excluded,sourceReturnChecks,sourceReturnTolerance:.00005,calculationRows,
  methodology:'Gross cash entitlement back-adjustment on ex-date; excludes withholding and separately identified SELIC income; 2022-04-14 principal separated using the issuer notice. No interpolation. Shared upstream independence is not certified. Current revised evidence is not a point-in-time forecast/backtest dataset.'};
}
