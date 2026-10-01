import { z } from 'zod';

export const sessionControlSchema=z.object({action:z.enum(['pause','resume','cancel','retry']),confirmed:z.literal(true)}).strict();
export type SessionAction=z.infer<typeof sessionControlSchema>['action'];

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

export function runBriefing(session:{status:string;error?:string|null},runs:Array<{agentName:string;status:string;outputPayload?:unknown}>) {
  const completed=[...new Set(runs.filter(run=>run.status==='completed').map(run=>run.agentName))];
  const gaps=[...new Set(runs.filter(run=>['failed','blocked','insufficient_data'].includes(run.status)).map(run=>run.agentName))];
  return {completed,gaps,nextAction:session.status==='awaiting_approval'?'Review fiscal periods and source provenance to continue optional scoring; no timeout authorizes continuation.':session.status==='completed'?'Review the evidence, limitations and opposing cases before accepting.':session.status==='paused'?'Resume retained evidence and completed steps, or cancel this run.':session.status==='failed'?'Inspect the failed step and retry after resolving its inputs.':session.status==='cancelled'?'Run cancelled. Completed records are retained; no portfolio change was made.':'Research in progress; no portfolio or trading action is authorized.',requiresHumanReview:true};
}
