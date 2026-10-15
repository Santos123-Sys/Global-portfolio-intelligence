import {describe,it,expect,vi,beforeEach} from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),transaction:vi.fn()}));
vi.mock('../src/lib/foundation/store',()=>({sql:()=>Object.assign(m.query,{begin:m.transaction})}));
import {saveDocument,readDocuments,downloadDocument} from '../src/lib/corpus/store';
import {documentMeta,digest} from '../src/lib/corpus/documents';
const text='Synthetic verified extraction. '.repeat(10),original=Buffer.from('original document');
const metadata=documentMeta({issuerId:'us:0000000001',company:'Test',year:2025,form:'10-K',name:'test.txt',sourceUrl:null,provenance:'user_upload',sha256:digest(original),textSha256:digest(text),parser:'fixture',retrievedAt:'2026-10-15T00:00:00.000Z',periodEnd:null,bytes:original.length});
beforeEach(()=>vi.clearAllMocks());
describe('governed document store boundaries',()=>{
 it('rejects corruption before opening an ingestion transaction',async()=>{await expect(saveDocument('owner',metadata,Buffer.from('wrong'),text)).rejects.toThrow('document_original_integrity');expect(m.transaction).not.toHaveBeenCalled();});
 it('refuses changed stored text before returning research context',async()=>{m.query.mockResolvedValueOnce([{bytes:100}]).mockResolvedValueOnce([{metadata,text_content:text+'tampered'}]);await expect(readDocuments('owner',metadata.issuerId,2025,2025)).rejects.toThrow('document_text_integrity');});
 it('refuses changed original bytes before download',async()=>{m.query.mockResolvedValue([{metadata,original:Buffer.from('wrong')}]);await expect(downloadDocument('owner',metadata.id)).rejects.toThrow('document_original_integrity');});
 it('returns unchanged bytes after verification',async()=>{m.query.mockResolvedValue([{metadata,original}]);expect((await downloadDocument('owner',metadata.id))?.bytes).toEqual(original);});
});
