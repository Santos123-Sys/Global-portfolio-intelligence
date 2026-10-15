import {describe,it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {documentMeta,digest,retrieveDocuments} from '../src/lib/corpus/documents';
const issuer='us:0000000001';
function doc(text:string,year=2025,id=issuer){return {text,metadata:documentMeta({issuerId:id,company:'Synthetic evaluation',year,form:'10-K',name:'fixture.txt',sourceUrl:null,provenance:'user_upload',sha256:digest(text),textSha256:digest(text),parser:'fixture-v1',retrievedAt:'2026-10-15T00:00:00.000Z',periodEnd:null,bytes:Buffer.byteLength(text)})};}
const source=doc('The company has supplier concentration and operational dependency. Revenue and margins are assumptions here, not real issuer data.');
const pt=doc('A concentração dos fornecedores representa risco operacional relevante. Informação sintética para avaliação.');
const cases=[
 {id:'english-positive',docs:[source],question:'supplier concentration dependency',expected:1,needle:'supplier concentration'},
 {id:'portuguese-positive',docs:[pt],question:'concentracao fornecedores',expected:1,needle:'concentração'},
 {id:'english-no-answer',docs:[source],question:'What is the quantum teleportation policy?',expected:0},
 {id:'portuguese-no-answer',docs:[pt],question:'Qual é a política de teletransporte quântico?',expected:0},
 {id:'wrong-issuer',docs:[doc(source.text,2025,'us:0000000002')],question:'supplier concentration',expected:0},
 {id:'wrong-year',docs:[doc(source.text,2024)],question:'supplier concentration',expected:0},
 {id:'tampered-text',docs:[{...source,text:source.text+' fabricated supplier concentration'}],question:'supplier concentration',expected:0},
];
const results:unknown[]=[];
describe('frozen bilingual corpus evaluation v1 (synthetic)',()=>{
 for(const row of cases)it(row.id,()=>{
  const times:number[]=[];let found:ReturnType<typeof retrieveDocuments>=[];
  for(let i=0;i<100;i++){const start=performance.now();found=retrieveDocuments(row.docs,issuer,{question:row.question,startYear:2025,endYear:2025,language:'en'});times.push(performance.now()-start);}
  times.sort((a,b)=>a-b);results.push({id:row.id,expected:row.expected,found:found.length,p50Ms:times[49],p95Ms:times[94]});
  if(process.env.CORPUS_EVALUATION_OUTPUT)writeFileSync(process.env.CORPUS_EVALUATION_OUTPUT,JSON.stringify(results,null,2));
  expect(found).toHaveLength(row.expected);if(row.needle)expect(found[0].text).toContain(row.needle);
 });
});
