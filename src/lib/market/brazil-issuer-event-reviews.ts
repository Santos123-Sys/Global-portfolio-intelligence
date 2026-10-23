import type {MarketHistory} from './history-quality';
import type {BrazilEvidence} from './brazil-normalization';

/** Reviewed public issuer facts; exact identity and observed inputs, never a ticker-prefix rule. */
export const brazilIssuerEventReviews={
 version:'brazil-issuer-event-review.v1',reviewedOn:'2026-10-21',
 vale:{symbol:'VALE3.SA',issuerId:'br:33592510000154',isin:'BRVALEACNOR0',
  recordDate:'2022-03-08',exDate:'2022-03-09',paymentDate:'2022-03-16',label:'DIVIDENDO',
  observedVendorGross:3.701840165,issuerGross:3.719256588,
  sourceUrl:'https://www.vale.com/pt/dividendos-dividas-e-debentures',
  sourceSha256:'078a6539803e72cf7c8385f909c2897b4b2f29ae382cd78d6206f87f4dc48f5a'},
 itau:[
  {recordDate:'2025-03-17',exDate:'2025-03-18',factor:1.1,
   sourceUrl:'https://www.itau.com.br/download-file/v2/d/42787847-4cf6-4461-94a5-40ed237dca33/381dd2fe-c509-52de-0470-bca329d4449b?origin=1',
   sourceSha256:'016d7f21b19660906b0d727e7ea159962354f9c9e9e5e272990e5f7fed8ca83f'},
  {recordDate:'2025-12-23',exDate:'2025-12-26',factor:1.03,
   sourceUrl:'https://www.itau.com.br/download-file/v2/d/42787847-4cf6-4461-94a5-40ed237dca33/8154a24f-7f95-d406-706a-da4535fd5f0f?origin=2',
   sourceSha256:'3d182ac1b8656afa60fac07502c291648480b03fe74c8bddc478c076968ff873'},
 ]
} as const;

export function reviewedStockExDate(h:MarketHistory,e:BrazilEvidence,a:BrazilEvidence['events']['stock'][number]){
 if(a.date!==''||h.symbol!=='ITUB4.SA'||h.issuerId!=='br:60872504000123'||e.isin!=='BRITUBACNPR1'||a.isin!==e.isin||a.label!=='BONIFICACAO')return;
 return brazilIssuerEventReviews.itau.find(r=>a.recordDate===r.recordDate&&a.factor===r.factor);
}
export function reviewedCashEntitlement(h:MarketHistory,e:BrazilEvidence,events:BrazilEvidence['events']['cash'],yahooGross:number){
 const r=brazilIssuerEventReviews.vale,a=events[0];
 if(h.symbol!==r.symbol||h.issuerId!==r.issuerId||e.isin!==r.isin||events.length!==1||!a||a.isin!==r.isin||
  a.recordDate!==r.recordDate||a.exDate!==r.exDate||a.paymentDate!==r.paymentDate||a.label!==r.label||a.verified!==true||
  Math.abs(a.rawRate-r.observedVendorGross)>1e-10||!Number.isFinite(yahooGross)||Math.abs(yahooGross-r.issuerGross)>.000002)return;
 return r;
}
