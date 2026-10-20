import {fiveYearStart,type MarketHistory} from '../src/lib/market/history-quality';
export function historyFixture():MarketHistory {
 const end='2026-10-19',start=fiveYearStart(end),dates:string[]=[];
 for(let n=Date.parse(start);n<Date.parse(end);n+=86400000){const d=new Date(n);if(![0,6].includes(d.getUTCDay()))dates.push(d.toISOString().slice(0,10));}
 return {schemaVersion:'market-history.v1',symbol:'AAPL',issuerId:'us:0000320193',currency:'USD',exchange:'NMS',timezone:'America/New_York',
  provider:'Yahoo Finance (unofficial)',sourceUrl:'https://query1.finance.yahoo.com/v8/finance/chart/AAPL',
  retrievedAt:'2026-10-19T12:00:00Z',requestedStart:start,requestedEnd:end,priceBasis:'vendor-adjusted-close',corporateActions:[],
  reference:{symbol:'SPY',dates},rows:dates.map((date,i)=>({date,adjustedClose:100*Math.exp(.0002*i),close:200*Math.exp(.0002*i),volume:1000}))};
}
