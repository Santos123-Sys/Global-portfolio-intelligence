import type { ProfileAnswers as Answers } from '../../src/lib/investor-profile';
import { confirmInvestorProfile } from '../../src/lib/investor-profile';
import { emptyCreatorState, type PortfolioCreatorState } from '../../src/lib/portfolio-creator-state';
export const sampleAnswers: Answers = { withdrawalStart: 'D', withdrawalDuration: 'D', holdingPeriod: 'D', stockLoss: 'C', stabilityPreference: 'C', downturnReaction: 'C', informalAdvice: 'A', bondLoss: 'C', lossTradeoff: 'B', incomeStability: 'D', experience: 'C' };
export function profiledState(): PortfolioCreatorState {
  return { ...emptyCreatorState(), answers: sampleAnswers, profile: confirmInvestorProfile(sampleAnswers, { scope: 'equity_sleeve', acknowledged: true }), phase: 'constraints' };
}
