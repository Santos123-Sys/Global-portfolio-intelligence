import {describe,it,expect,vi,afterEach} from 'vitest';
import {fxOn,convertSeries,fxHistory,globalContext,integrationAnalysis,secClassification,cvmClassification,parseCsv,classificationExposures,integratedServe} from '../ops/portfolio-risk-function';
import {RiskResult} from '../src/lib/integrations/portfolio-feedback';
afterEach(()=>vi.unstubAllGlobals());
const scope={workspaceId:'550e8400-e29b-41d4-a716-446655440000',portfolioId:'550e8400-e29b-41d4-a716-446655440001',runId:'550e8400-e29b-41d4-a716-446655440002'};
const series=(symbol:string,currency:string)=>({symbol,currency,provider:'Synthetic test only',priceBasis:'adjusted close',cached:false,stale:false,rows:Array.from({length:100},(_,i)=>({date:new Date(Date.UTC(2026,5,i+1)).toISOString().slice(0,10),price:100+i,close:100+i}))});
describe('dated FX and sourced issuer exposures',()=>{
 it('rejects invalid public reference inputs before transport and protects private computations',async()=>{
  const transport=vi.fn();vi.stubGlobal('fetch',transport);vi.stubGlobal('Bun',{env:{PORTFOLIO_RISK_API_TOKEN:'private-test-token-'.repeat(3)}});
  for(const query of ['from=BAD&to=USD','from=USD&to=CHF&date=2099-01-01','from=USD&to=CHF&date=2026-02-31'])expect((await integratedServe(new Request('https://risk.example/api/fx?'+query))).status).toBe(422);
  expect((await integratedServe(new Request('https://risk.example/v1/portfolio-analyze',{method:'POST'}))).status).toBe(401);
  expect(transport).not.toHaveBeenCalled();
 });
 it('uses backward reference dates, rejects stale/future/unverified FX and normalizes pence',()=>{
  const rows=[{date:'2026-07-03',rate:.2},{date:'2026-07-06',rate:.3}];
  expect(fxOn(rows,'2026-07-05','BRL','USD')).toEqual(rows[0]);
  expect(()=>fxOn(rows,'2026-07-02','BRL','USD')).toThrow();
  expect(()=>fxOn(rows,'2026-07-14','BRL','USD')).toThrow('stale');
  expect(()=>convertSeries(series('UNKNOWN','unverified'),'USD',new Map())).toThrow();
  const pence={...series('UK.L','GBp'),rows:[{date:'2026-07-03',price:100,close:100}]};
  const converted=convertSeries(pence,'USD',new Map([['GBP',[{date:'2026-07-03',rate:1.3}]]]));
  expect(converted.rows[0].price).toBe(1.3);expect(converted.quoteCurrency).toBe('GBP');
 });
 it('reconciles mixed BRL/USD returns and values a BRL reviewed ledger in CHF',()=>{
  const originals=new Map(['PETR4.SA','AAPL','SPY'].map(s=>[s,series(s,s==='PETR4.SA'?'BRL':'USD')]));
  const dates=originals.get('AAPL')!.rows.map(r=>r.date),fx=new Map([['BRL',dates.map((date,i)=>({date,rate:.15+i*.0001}))],['USD',dates.map((date,i)=>({date,rate:.8+i*.0002}))]]);
  const lookup=new Map([...originals].map(([s,h])=>[s,convertSeries(h,'CHF',fx)]));
  const classifications=[{symbol:'PETR4.SA',issuerId:'br:33000167000101',sector:'Petróleo e Gás',country:'BRASIL',industry:'Petróleo e Gás',classificationSystem:'CVM SETOR_ATIV',sourceUrl:'https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv',retrievedAt:new Date().toISOString(),countryBasis:'principal-office',sourceCode:null}];
  const b={...scope,baseCurrency:'CHF',benchmark:'SPY',positions:[{symbol:'PETR4.SA',shares:10},{symbol:'AAPL',shares:10}],riskFreeRate:0,valuations:[{symbol:'PETR4.SA',approvalStatus:'approved',currency:'BRL',impliedValuePerShare:'210',valuationVersionId:'flv1_'+'a'.repeat(64),valuationAsOf:new Date().toISOString(),approvedAt:new Date().toISOString()}]};
  const result=RiskResult.parse(integrationAnalysis(b,lookup,{fx,classifications}));
  expect(result.returns.contributions.reduce((s,c)=>s+c.contribution,0)).toBeCloseTo(result.returns.lookbackReturn,10);
  const v=result.valuationDiagnostics[0];expect(v.convertedValuePerShare).toBeCloseTo(210*.1599);expect(v.valueGap).toBeCloseTo(210/199-1);
  expect(result.exposures!.country.find(e=>e.label==='Unclassified')!.weight).toBeCloseTo(result.holdings[1].weight);
  expect(result.exposures!.sectorCoverage).toBeCloseTo(result.holdings[0].weight);
  expect(()=>RiskResult.parse({...result,exposures:{...result.exposures,sectorCoverage:1}})).toThrow('Exposure');
  expect(()=>RiskResult.parse({...result,holdings:result.holdings.map(h=>({...h,fxRate:999}))})).toThrow('FX');
 });
 it('binds SEC metadata to its actual ticker/CIK; country is independent of quote currency',()=>{
  const identity={registryId:'0000320193'},data={cik:'320193',tickers:['AAPL'],sic:'3571',sicDescription:'Electronic Computers',addresses:{business:{stateOrCountry:'CA',stateOrCountryDescription:'CA'}}};
  const c=secClassification('AAPL',identity,data,'2026-10-11T00:00:00Z');expect(c.sector).toBe('Manufacturing');expect(c.country).toBe('United States');
  expect(()=>secClassification('MSFT',identity,data,'2026-10-11T00:00:00Z')).toThrow();
  const foreign=secClassification('AAPL',identity,{...data,addresses:{business:{stateOrCountry:'E9',stateOrCountryDescription:'BRAZIL'}}},'2026-10-11T00:00:00Z');expect(foreign.country).toBe('BRAZIL');
 });
 it('accepts agreeing CVM duplicate rows, handles quoted CSV, rejects conflicting classifications',()=>{
  const csv='CNPJ_CIA;SIT;SETOR_ATIV;PAIS\n33.000.167/0001-01;ATIVO;"Petróleo; Gás";BRASIL\n33.000.167/0001-01;ATIVO;"Petróleo; Gás";BRASIL\n';
  expect(cvmClassification('PETR4.SA',{registryId:'33000167000101'},parseCsv(csv),'2026-10-11T00:00:00Z').sector).toBe('Petróleo; Gás');
  expect(()=>cvmClassification('PETR4.SA',{registryId:'33000167000101'},parseCsv(csv+'33.000.167/0001-01;ATIVO;Banks;BRASIL\n'),'2026-10-11T00:00:00Z')).toThrow('ambiguous');
  expect(classificationExposures([{symbol:'X',weight:1,quoteCurrency:'USD'}],[]).country).toEqual([{label:'Unclassified',weight:1}]);
 });
 it('bounds and validates the public FX response, failing closed on provider errors',async()=>{
  // A weekend range start can include the prior published business-day rate.
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json([{date:'2026-06-26',base:'BRL',quote:'USD',rate:.19},{date:'2026-07-03',base:'BRL',quote:'USD',rate:.2}])));
  const weekend=await fxHistory('BRL','USD','2026-07-05','2026-07-05');
  expect(weekend).toHaveLength(2);expect(fxOn(weekend,'2026-07-05','BRL','USD').date).toBe('2026-07-03');
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json([{date:'2026-07-03',base:'JPY',quote:'CHF',rate:.006}])));
  expect(await fxHistory('JPY','CHF','2026-07-03','2026-07-05')).toHaveLength(1);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json([{date:'2026-07-06',base:'EUR',quote:'CAD',rate:1.5}])));
  await expect(fxHistory('EUR','CAD','2026-07-03','2026-07-05')).rejects.toThrow('Invalid FX');
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'offline'},{status:503})));
  await expect(globalContext({baseCurrency:'USD',valuations:[],issuers:[]},new Map([['PETR4.SA',series('PETR4.SA','BRL')]]))).rejects.toThrow();
 });
});
