import {describe,it,expect} from 'vitest';
import {executeEvidenceTool} from '../src/lib/research/evidence-tools';
import type {Evidence,ResearchBrief} from '../src/lib/research/contracts';
const brief:ResearchBrief={question:'Explain revenue growth and evidence gaps',startYear:2025,endYear:2025,language:'en'};
const row=(id:string,text:string,fiscalYear=2025):Evidence=>({id,text,fiscalYear,metric:'narrative',sourceUrl:'https://example.invalid/public',sourceKind:'user_upload'});
const search=(query:string,rows:Evidence[])=>executeEvidenceTool({tool:'search_evidence',query},rows,brief).evidence;
describe('secondary evidence tool boundaries',()=>{
 it('abstains for English/Portuguese common words and substring-only matches',()=>{
  expect(search('the and of', [row('a','The issuer and its revenue grew.')])).toEqual([]);
  expect(search('de e para',[row('b','A receita da companhia cresceu.')])).toEqual([]);
  expect(search('net',[row('c','Internet sales improved.')])).toEqual([]);
 });
 it('normalizes accents and keeps whole-word financial terms',()=>{
  expect(search('operacao',[row('a','A operação apresentou receita.')]).map(r=>r.id)).toEqual(['a']);
 });
 it('rechecks fiscal-year scope before searching or reporting coverage',()=>{
  const rows=[row('old','Revenue grew.',2024),row('current','Revenue declined.',2025)];
  expect(search('revenue',rows).map(r=>r.id)).toEqual(['current']);
  expect(executeEvidenceTool({tool:'inspect_coverage'},[row('old','Revenue grew.',2024)],brief).gaps.join(' ')).toContain('2025');
 });
});
