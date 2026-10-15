import {NextResponse} from 'next/server';
import {authenticateRequest} from '@/lib/api-auth';
import {loadWorkspace} from '@/lib/foundation/store';
import {readDocuments} from '@/lib/corpus/store';
import {listPortfolioFeedback,listValuations} from '@/lib/integrations/portfolio-feedback';
import {resolveIssuer} from '@/lib/integrations/shared-contracts';
import {financialOrigin} from '@/lib/integrations/origins';
import {WorkspaceOverview} from '@/lib/workspace/contracts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'cache-control':'no-store','vary':'Cookie'};
export async function GET(req:Request){
 const session=await authenticateRequest(req);if(!session.ok)return session.response;
 try{
  const {auth}=session,w=await loadWorkspace(auth.userId),key=new URL(req.url).searchParams.get('company');
  const candidate=w.candidates.find(c=>c.key===key);
  if(!candidate)return NextResponse.json({error:'Company not in this workspace'},{status:404,headers});
  const identity=resolveIssuer(candidate),issuerId=identity.status==='source_linked'?identity.issuer.issuerId:null;
  const [docs,valuations,runs]=await Promise.allSettled([
   issuerId?readDocuments(auth.userId,issuerId,2000,2200):Promise.resolve([]),
   listValuations(auth.userId,auth.accountId),listPortfolioFeedback(auth.userId,auth.accountId),
  ]);
  const count=valuations.status==='fulfilled'?valuations.value.filter(v=>v.valuation.issuerId===issuerId).length:null;
  const payload=WorkspaceOverview.parse({version:'investment-workspace.v1',candidateKey:candidate.key,issuerId,
   financialOrigin:financialOrigin(process.env.FILINGLENS_API_URL),checkedAt:new Date().toISOString(),
   documents:{status:docs.status==='fulfilled'?(docs.value.length?'verified':'empty'):
    docs.reason instanceof Error&&/document_(text|identity)_/.test(docs.reason.message)?'blocked':'unavailable',count:docs.status==='fulfilled'?docs.value.length:null,ruleVersion:'corpus-integrity.v1'},
   valuations:{status:count===null?'unavailable':count?'available':'empty',count},
   portfolio:{status:runs.status==='fulfilled'?(runs.value.length?'available':'empty'):'unavailable',count:runs.status==='fulfilled'?runs.value.length:null},
  });
  return NextResponse.json(payload,{headers});
 }catch{return NextResponse.json({error:'Workspace overview unavailable; existing modules remain accessible'},{status:503,headers});}
}
