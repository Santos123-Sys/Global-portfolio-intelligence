import {expect,it} from 'vitest';
import {brazilHistoryFixture} from './brazil-history-fixture';
import {brazilIssuerEventReviews,reviewedCashEntitlement,reviewedStockExDate} from '../src/lib/market/brazil-issuer-event-reviews';
import {normalizeBrazilMarket} from '../src/lib/market/brazil-market-normalization';
function fixture(symbol:string,cnpj:string,isin:string){
 const h=brazilHistoryFixture(),e=h.brazilEvidence!;
 h.symbol=symbol+'.SA';h.issuerId='br:'+cnpj;h.sourceUrl='https://query1.finance.yahoo.com/v8/finance/chart/'+h.symbol;
 Object.assign(h.secondary!,{symbol:h.symbol,issuerId:h.issuerId});
 Object.assign(e,{version:'brazil-evidence.v2',symbol:h.symbol,issuerId:h.issuerId,isin,
  identity:{symbol,cnpj,assetType:'stock',subType:'stock',profileUrl:'https://brapi.dev/api/v2/stocks/profile',coverageUrl:'https://brapi.dev/api/v2/tickers/coverage',profileSha256:'d'.repeat(64),coverageSha256:'e'.repeat(64)}});
 e.events.subscriptions=[];return h;
}
it('binds the published Vale final entitlement to the exact observed record and preserves both originals',()=>{
 const h=fixture('VALE3','33592510000154','BRVALEACNOR0'),e=h.brazilEvidence!,r=brazilIssuerEventReviews.vale;
 const i=h.rows.findIndex(p=>p.date===r.exDate);
 e.events.cash=[{exDate:r.exDate,recordDate:r.recordDate,paymentDate:r.paymentDate,label:r.label,rawRate:r.observedVendorGross,isin:r.isin,verified:true}];
 h.corporateActions=[{date:r.exDate,kind:'dividend',value:3.719256}];
 h.rows.forEach((p,n)=>{p.close=n<i?100:100-r.issuerGross;p.adjustedClose=100-r.issuerGross;
  e.raw.rows[n]={date:p.date,close:p.close,adjustedClose:n<i?100-r.observedVendorGross:100-r.issuerGross};
  h.secondary!.rows[n].adjustedClose=e.raw.rows[n].adjustedClose;e.relay.rows[n].close=p.close;});
 const before=JSON.stringify(h),q=normalizeBrazilMarket(h,e,Date.parse('2026-10-19T13:00:00Z'));
 expect(q.status).toBe('verified');expect(q.cash[0]).toMatchObject({amount:3.719256588,vendorGross:3.701840165,yahooGross:3.719256,sourceUrl:r.sourceUrl});
 expect(q.issuerReviews[0].kind).toBe('cash_entitlement');expect(JSON.stringify(h)).toBe(before);
 // Any revised input or another company invalidates this specific exception.
 e.events.cash[0].rawRate+=.00001;expect(normalizeBrazilMarket(h,e,Date.parse('2026-10-19T13:00:00Z')).status).toBe('blocked');
 e.events.cash[0].rawRate=r.observedVendorGross;h.issuerId='br:60872504000123';expect(reviewedCashEntitlement(h,e,e.events.cash,3.719256)).toBeUndefined();
});
it.each(brazilIssuerEventReviews.itau)('uses the issuer-published ITUB4 ex-date $exDate only for the exact class, record and factor',r=>{
 const h=fixture('ITUB4','60872504000123','BRITUBACNPR1'),e=h.brazilEvidence!;
 const a={date:'',recordDate:r.recordDate,factor:r.factor,isin:e.isin,label:'BONIFICACAO'};
 expect(reviewedStockExDate(h,e,a)?.exDate).toBe(r.exDate);
 for(const changed of [{...a,factor:r.factor+.01},{...a,isin:'BRVALEACNOR0'},{...a,recordDate:'2025-01-01'},{...a,date:'2025-01-01'},{...a,label:'UNKNOWN'}])expect(reviewedStockExDate(h,e,changed)).toBeUndefined();
 h.symbol='ITUB3.SA';expect(reviewedStockExDate(h,e,a)).toBeUndefined();
});
it('requires Yahoo factor and session corroboration after an issuer review and never rewrites the missing source date',()=>{
 const h=fixture('ITUB4','60872504000123','BRITUBACNPR1'),e=h.brazilEvidence!,r=brazilIssuerEventReviews.itau[0];
 const i=h.rows.findIndex(p=>p.date===r.exDate);
 e.events.stock=[{date:'',recordDate:r.recordDate,factor:r.factor,isin:e.isin,label:'BONIFICACAO'}];h.corporateActions=[{date:r.exDate,kind:'split',value:r.factor}];
 h.rows.forEach((p,n)=>{p.close=p.adjustedClose=100/r.factor;e.raw.rows[n]={date:p.date,close:n<i?100:100/r.factor,adjustedClose:100/r.factor};e.relay.rows[n].close=e.raw.rows[n].close;h.secondary!.rows[n].adjustedClose=100/r.factor;});
 const q=normalizeBrazilMarket(h,e,Date.parse('2026-10-19T13:00:00Z'));expect(q.status).toBe('verified');expect(e.events.stock[0].date).toBe('');
 h.corporateActions[0].value=1.2;expect(normalizeBrazilMarket(h,e,Date.parse('2026-10-19T13:00:00Z')).status).toBe('blocked');
});
