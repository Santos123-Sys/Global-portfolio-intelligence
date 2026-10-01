import { z } from 'zod';

export const sessionControlSchema=z.object({action:z.enum(['pause','resume','cancel','retry']),confirmed:z.literal(true)}).strict();
export type SessionAction=z.infer<typeof sessionControlSchema>['action'];

export interface RunBriefing {
  completed:string[];gaps:string[];nextAction:string;requiresHumanReview:true;
  outcome:string;keyFindings:string[];keyRisks:string[];limitations:string[];
  confidenceScore:number|null;sourceCount:number;reportCanBeAccepted:boolean;
}

export function controlTransition(status:string,action:SessionAction):string|null {
  if(action==='pause' && ['queued','running'].includes(status)) return 'paused';
  if(action==='resume' && status==='paused') return 'queued';
  if(action==='cancel' && ['queued','running','paused','awaiting_approval'].includes(status)) return 'cancelled';
  if(action==='retry' && status==='failed') return 'queued';
  return null;
}

export class SessionInterrupted extends Error {
  constructor() { super('Session lease lost: paused, cancelled, or superseded'); this.name='SessionInterrupted'; }
}

export const AGENT_AUTHORITY = {
  read_evidence:{authority:'autonomous',consequence:'low',reversible:true},
  calculate:{authority:'autonomous',consequence:'low',reversible:true},
  change_assumptions:{authority:'notify',consequence:'medium',reversible:true},
  accept_analysis:{authority:'approval_required',consequence:'high',reversible:true},
  change_portfolio:{authority:'human_only',consequence:'high',reversible:true},
  trade:{authority:'human_only',consequence:'critical',reversible:false},
} as const;

export function runBriefing(session:{status:string;error?:string|null;finalOutput?:unknown;requestPayload?:unknown},runs:Array<{agentName:string;status:string;outputPayload?:unknown}>) {
  const completed=[...new Set(runs.filter(run=>run.status==='completed').map(run=>run.agentName))];
  const gaps=[...new Set(runs.filter(run=>['failed','blocked','insufficient_data'].includes(run.status)).map(run=>run.agentName))];
  const report=session.finalOutput && typeof session.finalOutput==='object' ? session.finalOutput as Record<string,unknown> : {};
  const outputs=report.outputs && typeof report.outputs==='object' ? report.outputs as Record<string,unknown> : {};
  const judge=outputs['judge-agent'] && typeof outputs['judge-agent']==='object' ? outputs['judge-agent'] as Record<string,unknown> : {};
  const judgeData=judge.data && typeof judge.data==='object' ? judge.data as Record<string,unknown> : {};
  const strings=(value:unknown,max:number)=>Array.isArray(value) ? [...new Set(value.filter((item):item is string=>typeof item==='string'&&item.trim().length>0))].slice(0,max) : [];
  const fallbackOutputs=['sanity-checker','fundamental-analyst','financial-statement-analyzer'].map(name=>outputs[name]).filter((value):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'));
  const firstFindingRows=[judgeData,...fallbackOutputs.map(output=>output.data&&typeof output.data==='object'?output.data as Record<string,unknown>: {})];
  const keyFindings=firstFindingRows.flatMap(data=>strings(data.findings,4)).slice(0,4);
  const bear=outputs['bear-agent']&&typeof outputs['bear-agent']==='object'?outputs['bear-agent'] as Record<string,unknown>:{};
  const bearData=bear.data&&typeof bear.data==='object'?bear.data as Record<string,unknown>:{};
  const keyRisks=[...strings(judgeData.keyRisks,4),...strings(bearData.findings,4)].slice(0,4);
  const limitations=strings(report.limitations,5);
  const citations=Array.isArray(report.citations) ? report.citations.filter((item):item is string=>typeof item==='string') : [];
  const finalStatus=typeof report.status==='string'?report.status:null;
  const request=session.requestPayload && typeof session.requestPayload==='object' ? session.requestPayload as Record<string,unknown> : {};
  const reportCanBeAccepted=Boolean(request.portfolioId && judge.status==='completed' && Array.isArray(judgeData.findings) && finalStatus==='completed');
  const outcome=session.status==='completed'
    ? finalStatus==='completed'?'Validated evidence-backed research is ready for your review.':'Research finished with material evidence gaps; treat conclusions as incomplete.'
    : session.status==='failed'?'The workflow stopped before a complete report was produced. Completed agent work remains available for review.':session.status==='cancelled'?'The workflow was cancelled. Completed agent work remains available; no portfolio change was made.':session.status==='paused'?'The workflow is paused. Completed steps remain saved.':'The workflow has not produced a final report yet.';
  const nextAction=session.status==='awaiting_approval'?'Review fiscal periods and source provenance to continue optional scoring; no timeout authorizes continuation.':session.status==='completed'&&reportCanBeAccepted?'Review the thesis fit, opposing case, cited evidence and limitations. If appropriate, explicitly accept the report into thesis history.':session.status==='completed'?'Review the findings, cited evidence and limitations. Acceptance and portfolio changes are not available from this research run.':session.status==='paused'?'Resume retained evidence and completed steps, or cancel this run.':session.status==='failed'?'Inspect the failed step and its evidence gap, then retry after resolving the input.':session.status==='cancelled'?'Review any completed partial work; no portfolio change was made.':'Research is still in progress; no portfolio or trading action is authorized.';
  return {completed,gaps,nextAction,requiresHumanReview:true as const,outcome,keyFindings,keyRisks,limitations,confidenceScore:typeof report.confidenceScore==='number'?report.confidenceScore:null,sourceCount:new Set(citations).size,reportCanBeAccepted};
}
