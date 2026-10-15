import {describe,it,expect} from 'vitest';
import {acceptedPublication} from '../src/lib/workspace/contracts';
import {financialOrigin} from '../src/lib/integrations/origins';
import {buildContentSecurityPolicy} from '../src/lib/content-security-policy';
import {documentMeta,digest,verifyDocument} from '../src/lib/corpus/documents';
const notice={type:'filinglens.valuation.published.v1',candidateKey:'XNAS:AAPL',valuationVersionId:'flv1_'+'a'.repeat(64)};
describe('workspace contracts and evidence integrity',()=>{
 it('requires the exact financial origin, source window, candidate and bounded event',()=>{
  const source={},event={origin:'https://financial.example',source,data:notice};
  expect(acceptedPublication(event,event.origin,source,'XNAS:AAPL')).toEqual(notice);
  for(const bad of [{...event,origin:'https://evil.example'},{...event,source:{}},{...event,data:{...notice,candidateKey:'XNYS:OTHER'}},{...event,data:{...notice,ticket:'untrusted'}}])expect(acceptedPublication(bad,event.origin,source,'XNAS:AAPL')).toBeNull();
  expect(acceptedPublication(event,event.origin,null,'XNAS:AAPL')).toBeNull();
 });
 it('allows only a configured HTTPS financial module in CSP and keeps frame ancestors denied',()=>{
  for(const bad of ['http://financial.example','https://financial.example/path','https://financial.example/?x=1','https://user:secret@financial.example'])expect(financialOrigin(bad)).toBeNull();
  const csp=buildContentSecurityPolicy('0123456789abcdef0123456789abcdef',true,'https://financial.example/');
  expect(csp).toContain('frame-src https://financial.example');expect(csp).toContain("frame-ancestors 'none'");
  expect(buildContentSecurityPolicy('0123456789abcdef0123456789abcdef',true,'invalid')).toContain("frame-src 'none'");
 });
 it('binds original bytes, text derivative and issuer/year/form identity independently',()=>{
  const text='Supplier concentration creates operational dependency. '.repeat(5),original=Buffer.from('original public source');
  const m=documentMeta({issuerId:'us:0000000001',company:'Synthetic',year:2025,form:'10-K',name:'fixture.txt',sourceUrl:null,provenance:'user_upload',sha256:digest(original),textSha256:digest(text),parser:'fixture-v1',retrievedAt:'2026-10-15T00:00:00.000Z',periodEnd:null,bytes:original.length});
  expect(()=>verifyDocument(m,text,original)).not.toThrow();
  expect(()=>verifyDocument(m,text+' tampered',original)).toThrow('document_text_integrity');
  expect(()=>verifyDocument(m,text,Buffer.from('corrupted'))).toThrow('document_original_integrity');
  expect(()=>verifyDocument({...m,year:2024},text,original)).toThrow('document_identity_mismatch');
 });
});
