import { describe,it,expect } from 'vitest';
import { chunkDocument,documentMeta,digest,retrieveDocuments } from '../src/lib/corpus/documents';
import apple from './fixtures/apple-fy2025-issuer-statement.json';
const text='Risk disclosure\n'+('Ordinary operations.\n'.repeat(18000))+'\nSupplier concentration creates operational dependency.\n';
const metadata=documentMeta({issuerId:'us:0000000001',company:'Test ../ issuer',year:2025,form:'10-K',name:'../../report.txt',sourceUrl:null,provenance:'user_upload',sha256:digest(text),textSha256:digest(text),parser:'test-v1',retrievedAt:'2026-10-11T00:00:00.000Z',periodEnd:null,bytes:Buffer.byteLength(text)});
const brief={question:'Supplier concentration dependency risk',startYear:2025,endYear:2025,language:'en' as const};
describe('complete document retrieval and locators',()=>{
  it('preserves real issuer evidence and labels it separately from regulator proof',()=>{
    const m=documentMeta({...metadata,issuerId:'us:0000320193',company:'Apple Inc.',sourceUrl:apple.url,provenance:'issuer_download',sha256:apple.pdfSha256,textSha256:digest(apple.text),bytes:Buffer.byteLength(apple.text)});
    const result=retrieveDocuments([{metadata:m,text:apple.text}],m.issuerId,{...brief,question:'European General Court State Aid decision tax'});
    expect(result.some(e=>e.text.includes('State Aid decision'))).toBe(true);
    expect(result.every(e=>e.sourceKind==='issuer_download'&&apple.text.includes(e.text))).toBe(true);
  });
  it('retrieves late evidence beyond the legacy excerpt cap',()=>{
    const results=retrieveDocuments([{metadata,text}],metadata.issuerId,brief);
    expect(results.some(e=>e.text.includes('Supplier concentration creates operational dependency.'))).toBe(true);
    expect(results.every(e=>e.documentId===metadata.id)).toBe(true);
  });
  it('preserves every chunk as an exact derivative span, including the tail',()=>{
    const chunks=chunkDocument({metadata,text});
    for(const chunk of chunks){const [,id,start,end]=chunk.id.split(':');expect(id).toBe(metadata.id);expect(chunk.text).toBe(text.slice(Number(start),Number(end)));}
    expect(chunks.at(-1)!.text).toContain('operational dependency.');
  });
  it('filters wrong issuers and years before ranking and abstains on no match',()=>{
    expect(retrieveDocuments([{metadata,text}],'us:0000000002',brief)).toEqual([]);
    expect(retrieveDocuments([{metadata,text}],metadata.issuerId,{...brief,startYear:2024,endYear:2024})).toEqual([]);
    expect(retrieveDocuments([{metadata,text}],metadata.issuerId,{...brief,question:'xyzzzz nonexistent'})).toEqual([]);
  });
  it('normalizes Portuguese accents without changing quotes',()=>{
    const results=retrieveDocuments([{metadata,text:'Concentração dos fornecedores é um risco operacional.'}],metadata.issuerId,{...brief,question:'concentracao fornecedores'});
    expect(results[0].text).toContain('Concentração');
  });
  it('keeps folders traversal safe and hashes stable across duplicate ingestion',()=>{
    expect(metadata.path.split('/')).toHaveLength(4);expect(metadata.path).not.toContain('../');
    expect(documentMeta({...metadata}).id).toBe(metadata.id);
  });
});
