import { z } from 'zod';
import { PortfolioStrategyDraft, type PortfolioStrategyDraft as StrategyDraft, type StrategyChatResponse } from './portfolio-strategy-chat';
import { ProfileAnswers, ProfileConfirmation, INVESTOR_QUESTIONS, confirmInvestorProfile, validateInvestorProfileSnapshot, profileConstraints, type InvestorProfileSnapshot } from './investor-profile';

export const CreatorMessage = z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(4000) }).strict();
export const PortfolioCreatorState = z.object({
  answers: ProfileAnswers,
  profile: z.unknown().nullable(),
  phase: z.enum(['profiling', 'profile_review', 'constraints', 'strategy_ready', 'document_ready']),
  messages: z.array(CreatorMessage).max(24),
  draft: PortfolioStrategyDraft.nullable(),
  generationStatus: z.enum(['idle', 'working', 'failed', 'ready']),
  generationStartedAt: z.string().datetime().nullable(),
  error: z.string().max(500).nullable(),
  extractionId: z.string().nullable(),
  language: z.enum(['en', 'pt']),
  baseVersionId: z.string().uuid().nullable().default(null),
}).strict();
export type PortfolioCreatorState = z.infer<typeof PortfolioCreatorState>;
export interface CreatorSession { revision: number; state: PortfolioCreatorState }
export const CreatorAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('answer'), revision: z.number().int().nonnegative(), questionId: z.string(), answer: z.enum(['A', 'B', 'C', 'D', 'E', 'F']), language: z.enum(['en', 'pt']).optional() }).strict(),
  z.object({ action: z.literal('confirm_profile'), revision: z.number().int().nonnegative(), confirmation: ProfileConfirmation }).strict(),
  z.object({ action: z.literal('restart_profile'), revision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('restart_strategy'), revision: z.number().int().nonnegative(), baseVersionId: z.string().uuid().nullable() }).strict(),
  z.object({ action: z.literal('cancel_turn'), revision: z.number().int().nonnegative() }).strict(),
]);
export function emptyCreatorState(language: 'en' | 'pt' = 'en'): PortfolioCreatorState {
  return { answers: {}, profile: null, phase: 'profiling', messages: [], draft: null, generationStatus: 'idle', generationStartedAt: null, error: null, extractionId: null, language, baseVersionId: null };
}
export function requiredCreatorProfile(state: PortfolioCreatorState): InvestorProfileSnapshot {
  if (!state.profile || !['constraints', 'strategy_ready', 'document_ready'].includes(state.phase)) throw new Error('Complete and confirm the investor profile before generating a strategy');
  return validateInvestorProfileSnapshot(state.profile);
}
export function applyCreatorAction(state: PortfolioCreatorState, action: z.infer<typeof CreatorAction>): PortfolioCreatorState {
  if (action.action === 'restart_profile') return { ...emptyCreatorState(state.language), baseVersionId: state.baseVersionId };
  if (action.action === 'restart_strategy') {
    return {
      ...state,
      phase: state.profile ? 'constraints' : 'profiling',
      messages: state.profile ? [{ role: 'assistant', content: state.language === 'pt'
        ? 'Vamos atualizar a estratégia ativa. Seu perfil confirmado foi preservado; descreva apenas o que deve mudar.'
        : 'Let’s update the active strategy. Your confirmed investor profile is preserved; describe only what should change.' }] : [],
      draft: null,
      generationStatus: 'idle',
      generationStartedAt: null,
      error: null,
      extractionId: null,
      baseVersionId: action.baseVersionId,
    };
  }
  if (action.action === 'cancel_turn') return { ...state, generationStatus: 'idle', generationStartedAt: null, phase: state.profile ? 'constraints' : state.phase, error: null };
  if (action.action === 'confirm_profile') {
    if (state.phase !== 'profile_review') throw new Error('Finish the profile questions before confirming');
    const profile = confirmInvestorProfile(state.answers, action.confirmation);
    return { ...state, profile, phase: 'constraints', draft: null, messages: [{ role: 'assistant', content: state.language === 'pt'
      ? 'Perfil confirmado. Agora descreva seu objetivo, mercado, moeda, necessidades de liquidez e critérios da estratégia. Não criarei a carteira sem sua revisão e aprovação.'
      : 'Profile confirmed. Now describe your objective, market, currency, liquidity needs and strategy criteria. Portfolio creation requires your review and approval.' }], error: null };
  }
  if (!['profiling', 'profile_review'].includes(state.phase)) throw new Error('Restart profiling before changing a confirmed answer; this clears the unapproved strategy');
  const next = INVESTOR_QUESTIONS.find(question => !state.answers[question.id]);
  if (next && next.id !== action.questionId) throw new Error('Answer the current profile question first');
  if (!INVESTOR_QUESTIONS.some(question => question.id === action.questionId)) throw new Error('Unknown profile question');
  const answers = ProfileAnswers.parse({ ...state.answers, [action.questionId]: action.answer });
  return { ...state, answers, profile: null, draft: null, phase: INVESTOR_QUESTIONS.every(question => answers[question.id]) ? 'profile_review' : 'profiling', language: action.language ?? state.language, error: null };
}
export const CreatorTurn = z.object({ revision: z.number().int().nonnegative(), message: z.string().trim().min(1).max(4000).optional(), retry: z.boolean().optional(), startingDraft: PortfolioStrategyDraft.nullable().optional() }).strict();
export function prepareCreatorTurn(state: PortfolioCreatorState, input: z.infer<typeof CreatorTurn>): PortfolioCreatorState {
  requiredCreatorProfile(state);
  if (state.phase === 'document_ready') throw new Error('Review the generated document or start a new profile before changing its strategy');
  if (state.generationStatus === 'working') throw new Error('A Portfolio Creator turn is already running');
  const message = input.message;
  if (!message && !(input.retry && state.generationStatus === 'failed' && state.messages.at(-1)?.role === 'user')) throw new Error('Send an answer or retry the failed turn');
  const messages = message ? [...state.messages, { role: 'user' as const, content: message }] : state.messages;
  return { ...state, messages: messages.slice(-23), draft: state.draft ?? input.startingDraft ?? null, phase: 'constraints', generationStatus: 'working', generationStartedAt: new Date().toISOString(), error: null };
}
export function completeCreatorTurn(state: PortfolioCreatorState, result: StrategyChatResponse): PortfolioCreatorState {
  const profile = requiredCreatorProfile(state);
  const draft = result.draft ? attachProfileToDraft(result.draft, profile) : state.draft;
  return { ...state, draft, phase: result.status === 'ready' ? 'strategy_ready' : 'constraints', generationStatus: result.status === 'ready' ? 'ready' : 'idle', generationStartedAt: null, messages: [...state.messages, { role: 'assistant' as const, content: result.reply }].slice(-24), error: null };
}
export function attachProfileToDraft(draft: StrategyDraft, profile: InvestorProfileSnapshot): StrategyDraft {
  // Model output cannot erase or change deterministic investor-context constraints.
  const constraints = draft.globalConstraints.filter(line => !/^(Investor profile:|Strategy scope:|Liquidity context:|Profiling framework)/.test(line));
  return PortfolioStrategyDraft.parse({ ...draft, globalConstraints: [...constraints.slice(0, 26), ...profileConstraints(profile)] });
}
export function isCreatorExtraction(externalId: string): boolean {
  return externalId.startsWith('portfolio-creator:') || externalId.startsWith('strategy-chat:');
}
