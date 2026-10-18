import { z } from 'zod';

export const StartBrowser = z.object({
  company: z.string().min(1).max(200), year: z.number().int().min(2000).max(2200),
  question: z.string().min(10).max(1000), sourceUrl: z.string().url().max(2000),
  idempotencyKey: z.string().uuid(), mode: z.enum(['model', 'fixture']),
}).strict();
export const Action = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string().url().max(2000) }).strict(),
  z.object({ kind: z.literal('link'), index: z.number().int().min(0).max(99) }).strict(),
  z.object({ kind: z.literal('scroll'), dy: z.number().int().min(-700).max(700) }).strict(),
  z.object({ kind: z.literal('point'), x: z.number().finite().min(0).max(1199), y: z.number().finite().min(0).max(799) }).strict(),
  z.object({ kind: z.literal('open_tab'), url:z.string().url().max(2000) }).strict(),
  z.object({ kind: z.literal('select_tab'), tabId:z.string().uuid() }).strict(),
  z.object({ kind: z.literal('capture'), quote: z.string().min(20).max(4000) }).strict(),
  z.object({ kind: z.literal('finish') }).strict(),
]);
export type Action = z.infer<typeof Action>;
export const Command = z.object({
  id: z.string().uuid(), epoch: z.number().int().nonnegative(),
  kind: z.enum(['pause', 'takeover', 'resume', 'stop', 'input']),
  observationId: z.string().uuid().optional(), action: Action.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.kind === 'input' && (!v.action || !v.observationId)) ctx.addIssue({code:'custom', message:'Observation and action required'});
  if (v.kind !== 'input' && (v.action || v.observationId)) ctx.addIssue({code:'custom', message:'Unexpected input'});
});
export type Command = z.infer<typeof Command>;
export type RunState = 'queued'|'running'|'pausing'|'paused'|'human'|'cancelling'|'cancelled'|'completed'|'partial'|'failed'|'expired'|'reconciling';
export const terminal = (s: RunState) => ['cancelled','completed','partial','failed','expired','reconciling'].includes(s);
export type Observation = {
  id:string; tabId:string; capturedAt:string; url:string; title:string; text:string;
  links:Array<{text:string;url:string}>; width:number; height:number; image:string;
  tabs?:Array<{id:string;title:string}>;
};
export type LiveFrame = Pick<Observation,'tabId'|'capturedAt'|'width'|'height'|'image'> & {id:string;observationId:string};
export type BrowserEvidence = {
  id:string; issuerId:string; year:number; originalUrl:string; finalUrl:string; title:string;
  observedAt:string; capturedAt:string; observationId:string; actionId:string;
  text:string; sha256:string; start:number; end:number; method:'dom-innerText';
  status:'unreviewed_source_excerpt'; documentId?:string;
};
export type BrowserRun = {
  id:string; owner:string; actor:string; authSession:string; accountId:string;
  input:z.infer<typeof StartBrowser>; issuerId:string; companyName:string;
  state:RunState; epoch:number; version:number; seq:number; controller:string|null;
  createdAt:number; expiresAt:number; leaseUntil:number; worker:string|null;
  actions:number; calls:number; tokens:number; reason:string|null;
  observation:Observation|null; frame?:LiveFrame|null; evidence:BrowserEvidence[];
};
export type BrowserEvent = {seq:number;at:string;type:string;summary:string;observationId?:string;actionId?:string;action?:Action};
export function publicRun(run:BrowserRun) {
  const {owner: _owner,actor: _actor,authSession: _auth,accountId: _account,worker: _worker,...view}=run;
  void _owner;void _actor;void _auth;void _account;void _worker;
  return view;
}
/** Object-fit contain mapping; remote CSS viewport is independent of local DPR. */
export function canvasPoint(x:number,y:number,cw:number,ch:number,iw:number,ih:number) {
  if (![x,y,cw,ch,iw,ih].every(Number.isFinite) || Math.min(cw,ch,iw,ih)<=0) return null;
  const scale=Math.min(cw/iw,ch/ih), ox=(cw-iw*scale)/2, oy=(ch-ih*scale)/2;
  const px=(x-ox)/scale,py=(y-oy)/scale;
  return px<0||py<0||px>=iw||py>=ih?null:{x:px,y:py};
}
