import {describe,it,expect,vi} from 'vitest';
import {BrazilDataQuery,readBrazilFundamentals} from '../src/lib/integrations/brazil-data';
const source={sourceUrl:'https://dados.cvm.gov.br/dados/archive.zip',archiveSha256:'a'.repeat(64),retrievedAt:'2026-10-21',stale:false};
const options={baseUrl:'https://finance.example/',token:'t'.repeat(40)};
describe('all-issuer fundamentals bridge',()=>{
 it('keeps quarterly context and exact issuer in the request',async()=>{
  const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>Response.json({schemaVersion:'cvm-companyfacts.v1',issuer:{cnpj:'33000167000101'},form:'ITR',archiveYear:2025,scope:'consolidated',source,facts:[]}));
  const result=await readBrazilFundamentals({operation:'facts',cnpj:'33000167000101',form:'ITR',year:2025},{...options,fetcher});
  expect(result.schemaVersion).toBe('cvm-companyfacts.v1');
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({form:'ITR',year:2025,scope:'consolidated'});
 });
 it('rejects mismatched issuer, untrusted source and missing source hash',async()=>{
  for(const payload of [
   {schemaVersion:'cvm-companyfacts.v1',issuer:{cnpj:'60701190000104'},source},
   {schemaVersion:'cvm-companyfacts.v1',issuer:{cnpj:'33000167000101'},source:{...source,sourceUrl:'https://other.example'}},
   {schemaVersion:'cvm-companyfacts.v1',issuer:{cnpj:'33000167000101'},source:{...source,archiveSha256:null}},
  ])await expect(readBrazilFundamentals({operation:'facts',cnpj:'33000167000101'},{...options,fetcher:async()=>Response.json(payload)})).rejects.toThrow();
 });
 it('rejects unbounded queries and fabricated point-in-time requests before any acquisition',()=>{
  for(const q of [{operation:'screen',limit:1000},{operation:'facts'},{operation:'screen',asOf:'2020-01-01'}])expect(BrazilDataQuery.safeParse(q).success).toBe(false);
 });
 it('rejects a wrong year or consolidation scope instead of comparing incompatible facts',async()=>{
  for(const mismatch of [{archiveYear:2024},{scope:'standalone'},{form:'DFP'}]){
   const payload={schemaVersion:'cvm-companyfacts.v1',issuer:{cnpj:'33000167000101'},form:'ITR',archiveYear:2025,scope:'consolidated',source,...mismatch};
   await expect(readBrazilFundamentals({operation:'facts',cnpj:'33000167000101',form:'ITR',year:2025},{...options,fetcher:async()=>Response.json(payload)})).rejects.toThrow('brazil_finance_period_scope');
  }
 });
});
