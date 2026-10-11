import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { accountCanEdit } from '@/lib/account-scope';
import { sql } from '@/lib/foundation/store';
import { corpusRequest } from '@/lib/corpus/filinglens';
import { validateFindings } from '@/lib/research/manager';
export async function POST(req:Request){
  const s=await authenticateRequest(req);if(!s.ok)return s.response;
  try{assertSameOrigin(req);if(!accountCanEdit(s.auth.role))throw new Error();}catch{return NextResponse.json({error:'Forbidden'},{status:403});}
  const id=new URL(req.url).searchParams.get('job');if(!id||!/^[a-f0-9-]{36}$/.test(id))return NextResponse.json({error:'Invalid job'},{status:400});
  try{
    const rows=await sql()`SELECT output FROM gpi_foundation_jobs WHERE owner_id=${s.auth.userId} AND id=${id} AND status='complete'`;
    const report=rows[0]?.output?.report,run=report?.deepResearch;if(!run)return NextResponse.json({error:'Research report not found'},{status:404});
    validateFindings({findings:run.findings,gaps:[]},run.evidence);
    const res=await corpusRequest('presentation',{company:report.candidate.name,question:run.brief.question,language:run.brief.language,status:run.status,findings:run.findings,evidence:run.evidence,gaps:run.gaps});
    if(!res.ok){await res.body?.cancel();throw new Error();}
    return new Response(res.body,{headers:{'content-type':'application/vnd.openxmlformats-officedocument.presentationml.presentation','content-disposition':'attachment; filename="GPI-Research.pptx"','cache-control':'no-store'}});
  }catch{return NextResponse.json({error:'Research presentation unavailable'},{status:503});}
}
