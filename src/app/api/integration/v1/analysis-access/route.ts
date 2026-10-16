import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readBoundedJson } from '@/lib/request-body';
import { analysisAccessAllowed } from '@/lib/integrations/analysis-access';

const headers={'cache-control':'no-store','vary':'Authorization'};
/** Service introspection only: browser cookies are not accepted on this boundary. */
export async function POST(req:Request){
  const secret=process.env.FILINGLENS_CORPUS_TOKEN??'';
  const actual=Buffer.from(req.headers.get('authorization')??''),expected=Buffer.from('Bearer '+secret);
  if(secret.length<32||actual.length!==expected.length||!timingSafeEqual(actual,expected))
    return NextResponse.json({error:'Unauthorized'},{status:401,headers});
  const body=await readBoundedJson(req,2500);
  if(!body.ok)return NextResponse.json({error:body.error},{status:body.status,headers});
  const parsed=z.object({ticket:z.string().min(1).max(2000),operation:z.enum(['analysis:run','valuation:publish']).default('analysis:run')}).strict().safeParse(body.value);
  if(!parsed.success)return NextResponse.json({error:'Invalid delegation'},{status:400,headers});
  try{
    if((process.env.INTEGRATION_SIGNING_SECRET??'').length<32)return NextResponse.json({error:'Authorization unavailable'},{status:503,headers});
    if(!await analysisAccessAllowed(parsed.data.ticket,parsed.data.operation))return NextResponse.json({allowed:false},{status:403,headers});
    return NextResponse.json({allowed:true},{headers});
  }catch(error){
    // Cryptographically invalid tickets are denials; database failures are unavailable, never an allow.
    if(error instanceof Error && ['invalid_handoff','expired_handoff'].includes(error.message))
      return NextResponse.json({allowed:false},{status:403,headers});
    return NextResponse.json({error:'Authorization unavailable'},{status:503,headers});
  }
}
