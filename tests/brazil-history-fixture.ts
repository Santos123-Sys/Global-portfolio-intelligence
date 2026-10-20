import {historyFixture} from './market-history-fixture';
import type {MarketHistory} from '../src/lib/market/history-quality';
/** Synthetic, flat prices; never a production-price fixture. */
export function brazilHistoryFixture():MarketHistory{
 const h=historyFixture();Object.assign(h,{symbol:'PETR4.SA',issuerId:'br:33000167000101',currency:'BRL',exchange:'SAO',timezone:'America/Sao_Paulo',sourceUrl:'https://query1.finance.yahoo.com/v8/finance/chart/PETR4.SA',reference:{...h.reference,symbol:'^BVSP',sourceUrl:'https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP'}});
 h.rows=h.rows.map(r=>({...r,close:100,adjustedClose:100}));
 h.secondary={provider:'BrAPI',sourceUrl:'https://brapi.dev/api/v2/stocks/historical',symbol:h.symbol,issuerId:h.issuerId,currency:'BRL',timezone:'America/Sao_Paulo',retrievedAt:h.retrievedAt,priceBasis:'split-dividend-adjusted',rawSha256:'a'.repeat(64),rows:h.rows.map(r=>({date:r.date,adjustedClose:100}))};
 h.brazilEvidence={version:'brazil-evidence.v1',symbol:'PETR4.SA',issuerId:'br:33000167000101',isin:'BRPETRACNPR6',retrievedAt:h.retrievedAt,
  raw:{sourceUrl:h.secondary.sourceUrl,rawSha256:'a'.repeat(64),rows:h.rows.map(r=>({date:r.date,close:100,adjustedClose:100}))},
  events:{sourceUrl:'https://brapi.dev/api/v2/stocks/dividends',rawSha256:'b'.repeat(64),cash:[],stock:[]},
  relay:{sourceUrl:'https://cotab3.com.br/cotacoes',rawSha256:'c'.repeat(64),rows:h.rows.map(r=>({date:r.date,close:100}))}};
 return h;
}
