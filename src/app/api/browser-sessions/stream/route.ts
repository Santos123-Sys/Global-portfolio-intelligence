import { GET as snapshot } from '../route';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/** Pull-based SSE: one snapshot in flight, no producer queue, 20-second renewal.
 * Every pull executes normal session/membership authorization again. */
export async function GET(req:Request) {
  const initial=await snapshot(req);if(!initial.ok)return initial;
  const initialBody=await initial.json();
  if(!initialBody.run)return Response.json({error:'Session required'},{status:400});
  let first:unknown=initialBody;let closed=false;const deadline=Date.now()+20_000;
  const encoder=new TextEncoder();
  const stream=new ReadableStream<Uint8Array>({
    async pull(controller){
      if(closed||req.signal.aborted||Date.now()>deadline){closed=true;controller.close();return;}
      try{
        let data=first;first=null;
        if(!data){await new Promise(r=>setTimeout(r,750));if(req.signal.aborted){closed=true;controller.close();return;}const response=await snapshot(req);if(!response.ok){controller.enqueue(encoder.encode('event: revoked\ndata: {}\n\n'));closed=true;controller.close();return;}data=await response.json();}
        controller.enqueue(encoder.encode('data: '+JSON.stringify(data)+'\n\n'));
      }catch{closed=true;controller.error(Error('stream_unavailable'));}
    },cancel(){closed=true;}
  },{highWaterMark:0});
  return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-store, no-transform','x-accel-buffering':'no','x-content-type-options':'nosniff'}});
}
