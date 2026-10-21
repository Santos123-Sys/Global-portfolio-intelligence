import {NextResponse} from 'next/server';
import {authenticateRequest} from '@/lib/api-auth';
import {assertSameOrigin} from '@/lib/auth';
import {readBoundedJson} from '@/lib/request-body';
import {BrazilDataQuery,readBrazilFundamentals} from '@/lib/integrations/brazil-data';
import {brazilMarketCatalog} from '@/lib/market/brazil-market-catalog';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'cache-control':'no-store','vary':'Cookie'};
let catalog:ReturnType<typeof brazilMarketCatalog>|undefined,expires=0;
export async function GET(req:Request){
 const session=await authenticateRequest(req);if(!session.ok)return session.response;
 const params=new URL(req.url).searchParams;
 const offset=Number(params.get('offset')??0),limit=Number(params.get('limit')??100);
 if(!Number.isInteger(offset)||offset<0||offset>20000||!Number.isInteger(limit)||limit<1||limit>200)return NextResponse.json({error:'invalid_page'},{status:400,headers});
 try{
  if(!catalog||Date.now()>expires){catalog=brazilMarketCatalog();expires=Date.now()+15*60000;}
  const result=await catalog;
  return NextResponse.json({schemaVersion:'brazil-listing-coverage.v1',sourceUrl:result.sourceUrl,retrievedAt:result.retrievedAt,
   total:result.listings.length,nextOffset:offset+limit<result.listings.length?offset+limit:null,
   listings:result.listings.slice(offset,offset+limit).map(l=>({...l,issuerMapping:'not_evaluated',fundamentals:'not_evaluated',fiveYearRisk:'not_evaluated'})),
   receipts:result.receipts,limitation:result.limitation},{headers});
 }catch{catalog=undefined;return NextResponse.json({error:'brazil_catalog_unavailable'},{status:503,headers});}
}
export async function POST(req:Request){
 const session=await authenticateRequest(req);if(!session.ok)return session.response;
 try{assertSameOrigin(req);}catch{return NextResponse.json({error:'Forbidden'},{status:403,headers});}
 const body=await readBoundedJson(req,4096);if(!body.ok)return NextResponse.json({error:body.error},{status:body.status,headers});
 const query=BrazilDataQuery.safeParse(body.value);if(!query.success)return NextResponse.json({error:'invalid_query'},{status:400,headers});
 try{return NextResponse.json(await readBrazilFundamentals(query.data,{baseUrl:process.env.FILINGLENS_API_URL??'',token:process.env.FILINGLENS_READ_API_TOKEN??''}),{headers});}
 catch{return NextResponse.json({error:'brazil_fundamentals_unavailable'},{status:503,headers});}
}
