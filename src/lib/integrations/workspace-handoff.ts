import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
export const HandoffContext = z.object({
  version:z.literal('workspace-handoff.v1'), workspaceId:z.string().uuid(),
  reviewerUserId:z.string().uuid(), issuerId:z.string().regex(/^(us:\d{10}|br:\d{14})$/),
  candidateKey:z.string().regex(/^[A-Z0-9.:-]{1,60}$/), ticker:z.string().regex(/^[A-Z0-9.-]{1,20}$/),
  nonce:z.string().uuid(), issuedAt:z.number().int(), expiresAt:z.number().int(),
  sessionId:z.string().uuid().optional(),
  audience:z.literal('filinglens').optional(),
  permissions:z.array(z.enum(['analysis:run','valuation:publish'])).max(2).optional(),
}).strict();
export type HandoffContext = z.infer<typeof HandoffContext>;
const mac=(s:string,v:string)=>createHmac('sha256',s).update(v).digest('base64url');
export function signHandoff(value:HandoffContext,secret:string):string {
  if(secret.length<32)throw Error('handoff_disabled');
  const body=Buffer.from(JSON.stringify(HandoffContext.parse(value))).toString('base64url');
  return body+'.'+mac(secret,body);
}
export function verifyHandoff(ticket:string,secret:string,now=Math.floor(Date.now()/1000)):HandoffContext {
  if(secret.length<32||ticket.length>2000)throw Error('invalid_handoff');
  const parts=ticket.split('.');
  if(parts.length!==2||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))throw Error('invalid_handoff');
  const a=Buffer.from(mac(secret,parts[0])),b=Buffer.from(parts[1]);
  if(a.length!==b.length||!timingSafeEqual(a,b))throw Error('invalid_handoff');
  const v=HandoffContext.parse(JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8')));
  if(v.issuedAt>now+30||v.expiresAt<=now||v.expiresAt-v.issuedAt>7200||v.expiresAt<=v.issuedAt)throw Error('expired_handoff');
  return v;
}
