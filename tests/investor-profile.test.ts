import { describe, expect, it } from 'vitest';
import { INVESTOR_QUESTIONS, PROFILE_BANDS, ProfileAnswers, allocationForScore, assessInvestorProfile, confirmInvestorProfile, validateInvestorProfileSnapshot } from '../src/lib/investor-profile';
import { emptyCreatorState, applyCreatorAction, prepareCreatorTurn, completeCreatorTurn, requiredCreatorProfile } from '../src/lib/portfolio-creator-state';
import { emptyThesisPolicy } from '@portfolio-intelligence/agentic-contract';

import { sampleAnswers, profiledState } from './fixtures/investor-profile';
describe('investor questionnaire scoring and profile gates', () => {
  it('preserves every answer point allocation, including reverse-scored risk questions', () => {
    expect(INVESTOR_QUESTIONS.map(q => [...q.points])).toEqual([[0,1,4,7,12,17],[0,1,3,5,8],[0,1,3,5,7],[1,3,5,6],[6,5,3,1,0],[5,4,3,2,1],[5,4,3,2,1],[1,3,5,6],[1,3,5],[1,2,3,4,5],[1,2,3,4,5]]);
    const assessment = assessInvestorProfile(sampleAnswers);
    expect(assessment.score).toBe(48);
    expect(assessment.suggestedAllocation).toEqual({ stocks: 50, bonds: 50 });
  });
  for (const band of PROFILE_BANDS) {
    it(`maps both edges of ${band.min}–${band.max} to ${band.stocks}/${band.bonds}`, () => {
      expect(allocationForScore(band.min)).toEqual(band);
      expect(allocationForScore(band.max)).toEqual(band);
    });
  }
  it('reaches the documented minimum and maximum and rejects scores outside them', () => {
    const extreme = (max: boolean) => Object.fromEntries(INVESTOR_QUESTIONS.map(q => [q.id, String.fromCharCode(65 + (Array.from(q.points) as number[]).indexOf(max ? Math.max(...q.points) : Math.min(...q.points)))]));
    expect(assessInvestorProfile(extreme(false)).score).toBe(7);
    expect(assessInvestorProfile(extreme(true)).score).toBe(75);
    for (const value of [6, 76, 48.5, NaN]) expect(() => allocationForScore(value)).toThrow();
  });
  it('does not infer unanswered, unsupported or malformed answers', () => {
    expect(() => assessInvestorProfile({ ...sampleAnswers, experience: undefined })).toThrow();
    expect(ProfileAnswers.safeParse({ ...sampleAnswers, lossTradeoff: 'F' }).success).toBe(false);
    expect(ProfileAnswers.safeParse({ ...sampleAnswers, unknown: 'A' }).success).toBe(false);
  });
  it('requires confirmation and an explained deviation before a full-equity strategy', () => {
    expect(() => confirmInvestorProfile(sampleAnswers, { scope: 'full_equity', acknowledged: true })).toThrow(/Explain/);
    expect(() => confirmInvestorProfile(sampleAnswers, { scope: 'equity_sleeve', acknowledged: false })).toThrow();
    const profile = confirmInvestorProfile(sampleAnswers, { scope: 'full_equity', acknowledged: true, deviationReason: 'This is an intentionally separate long-term allocation.' });
    expect(profile.confirmation.scope).toBe('full_equity');
  });
  it('recalculates saved totals instead of trusting forged model or client fields', () => {
    const profile = confirmInvestorProfile(sampleAnswers, { scope: 'equity_sleeve', acknowledged: true });
    expect(validateInvestorProfileSnapshot({ ...profile, score: 75, suggestedAllocation: { stocks: 100, bonds: 0 } }).score).toBe(48);
  });
  it('requires all questions in sequence and prevents confirmed answers from changing silently', () => {
    const initial = emptyCreatorState();
    expect(() => applyCreatorAction(initial, { action: 'answer', revision: 0, questionId: 'incomeStability', answer: 'D' })).toThrow(/current/);
    let state = initial;
    INVESTOR_QUESTIONS.forEach(question => { state = applyCreatorAction(state, { action: 'answer', revision: 0, questionId: question.id, answer: sampleAnswers[question.id]! }); });
    expect(state.phase).toBe('profile_review');
    expect(() => requiredCreatorProfile(state)).toThrow();
    state = applyCreatorAction(state, { action: 'confirm_profile', revision: 0, confirmation: { scope: 'equity_sleeve', acknowledged: true, deviationReason: '' } });
    expect(requiredCreatorProfile(state).score).toBe(48);
    expect(() => applyCreatorAction(state, { action: 'answer', revision: 0, questionId: 'withdrawalStart', answer: 'F' })).toThrow(/Restart/);
    expect(applyCreatorAction(state, { action: 'restart_profile', revision: 0 })).toEqual(emptyCreatorState());
  });
  it('blocks strategy generation before confirmation and keeps old model drafts unapprovable during clarification', () => {
    expect(() => prepareCreatorTurn(emptyCreatorState(), { revision: 0, message: 'Create my portfolio' })).toThrow(/profile/);
    const state = prepareCreatorTurn(profiledState(), { revision: 1, message: 'Brazilian quality growth for ten years' });
    expect(state.generationStatus).toBe('working');
    expect(() => prepareCreatorTurn(state, { revision: 2, message: 'Another concurrent turn' })).toThrow(/already running/);
    const ready = completeCreatorTurn(state, { status: 'ready', missingFields: [], reply: 'Review your draft', draft: { title: 'Brazil growth', investorName: '', purpose: 'Long-term profitable growth', timeHorizon: 'Ten years', riskTolerance: 'Moderate', reviewCadence: 'Quarterly', markets: ['B3'], globalConstraints: [], mandates: [{ label: 'Brazil growth', role: 'brazilian_growth', currency: 'BRL', objective: 'Profitable growth', inclusionCriteria: [], exclusionCriteria: [], policy: emptyThesisPolicy() }] } });
    expect(ready.draft?.globalConstraints.join(' ')).toContain('48/75');
    expect(ready.draft?.globalConstraints.join(' ')).toContain('equity sleeve');
    const clarification = completeCreatorTurn(prepareCreatorTurn(ready, { revision: 3, message: 'Change the market' }), { status: 'clarifying', missingFields: ['Market'], reply: 'Which market?', draft: null });
    expect(clarification.draft).toBeTruthy(); // retained as context, never exposed as a ready review
    expect(clarification.phase).toBe('constraints');
  });
});
