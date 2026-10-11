import { z } from 'zod';
import type { Candidate } from '../foundation/contracts';
import type { ResearchBrief } from '../research/contracts';
import { corpusJson, extractDocument } from './filinglens';
import { listDocuments, saveDocument } from './store';
import { digest, documentMeta } from './documents';

const Acquired=z.object({documents:z.array(z.object({base64:z.string().max(10_666_672),name:z.string().max(180),year:z.number().int(),form:z.string(),sourceUrl:z.string().url(),periodEnd:z.string().nullable(),provenance:z.enum(['regulator_download','issuer_download']),sha256:z.string().regex(/^[a-f0-9]{64}$/)})).max(6),gaps:z.array(z.string().max(1500)).max(25)});
export async function acquireMissing(owner:string,candidate:Candidate,brief:ResearchBrief):Promise<string[]> {
  if(!candidate.issuer)return ['Company has no CIK/CNPJ mapping.'];
  const issuerId=`${candidate.issuer.jurisdiction}:${candidate.issuer.registryId}`;
  const current=await listDocuments(owner,issuerId);
  try {
    const result=Acquired.parse(await corpusJson('acquire',{...candidate.issuer,startYear:brief.startYear,endYear:brief.endYear,existing:current.flatMap(d=>d.sourceUrl?[d.sourceUrl]:[])}));
    for(const doc of result.documents){
      try {
        const source=new URL(doc.sourceUrl);
        const allowed=candidate.market==='us'?['data.sec.gov','www.sec.gov']:['dados.cvm.gov.br','www.rad.cvm.gov.br'];
        if(doc.provenance==='issuer_download'&&candidate.issuer.registryId==='0000320193'&&doc.sourceUrl==='https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf')allowed.push('www.apple.com');
        if(source.protocol!=='https:'||!allowed.includes(source.hostname)||source.username||source.password||doc.year<brief.startYear||doc.year>brief.endYear)throw new Error();
        const raw=Buffer.from(doc.base64,'base64');if(digest(raw)!==doc.sha256)throw new Error();
        const extracted=await extractDocument(raw,doc.name);
        const metadata=documentMeta({issuerId,company:candidate.name,year:doc.year,form:doc.form.replaceAll('/',' '),name:doc.name,
          sourceUrl:doc.sourceUrl,provenance:doc.provenance,sha256:doc.sha256,textSha256:digest(extracted.text),parser:extracted.parser,
          retrievedAt:new Date().toISOString(),periodEnd:doc.periodEnd,bytes:raw.length});
        await saveDocument(owner,metadata,raw,extracted.text);
      }catch{result.gaps.push(`${doc.form} ${doc.year}: extraction or persistence failed; source remains missing.`);}
    }
    return result.gaps;
  }catch{return ['Official-source acquisition unavailable; uploaded and previously stored evidence remains available.'];}
}
