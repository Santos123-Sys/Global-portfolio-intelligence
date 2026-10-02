import { z } from 'zod';

/** Vanguard Investor Questionnaire (2022), answer key p.6 and allocation insert p.7.
 * Wording is adapted for conversational intake; answer order and points are unchanged.
 * This is a general profiling guide, not comprehensive advice or a suitability certification.
 */
export const PROFILE_FRAMEWORK = 'vanguard-investor-questionnaire-2022-v1';
export const PROFILE_SOURCE = { title: 'Vanguard Investor Questionnaire', year: 2022, questionsPages: '4–5', scoringPage: 6, allocationPage: 7 } as const;
export type ProfileLanguage = 'en' | 'pt';
const agreements = ['Strongly disagree', 'Disagree', 'Somewhat agree', 'Agree', 'Strongly agree'];
const agreementsPt = ['Discordo totalmente', 'Discordo', 'Concordo um pouco', 'Concordo', 'Concordo totalmente'];
const sell = ['Sell all', 'Sell some', 'Hold without selling', 'Buy more'];
const sellPt = ['Vender tudo', 'Vender uma parte', 'Manter sem vender', 'Comprar mais'];
export const INVESTOR_QUESTIONS = [
  { id: 'withdrawalStart', question: 'When do you plan to start withdrawing from these investments?', pt: 'Quando pretende começar a retirar dinheiro destes investimentos?', options: ['Less than 1 year', '1–2 years', '3–5 years', '6–10 years', '11–15 years', 'More than 15 years'], optionsPt: ['Menos de 1 ano', '1–2 anos', '3–5 anos', '6–10 anos', '11–15 anos', 'Mais de 15 anos'], points: [0, 1, 4, 7, 12, 17] },
  { id: 'withdrawalDuration', question: 'Once withdrawals start, over how many years do you expect to spend this money?', pt: 'Após iniciar as retiradas, ao longo de quantos anos pretende gastar esse dinheiro?', options: ['2 years or less', '3–5 years', '6–10 years', '11–15 years', 'More than 15 years'], optionsPt: ['2 anos ou menos', '3–5 anos', '6–10 anos', '11–15 anos', 'Mais de 15 anos'], points: [0, 1, 3, 5, 8] },
  { id: 'holdingPeriod', question: 'For a long-term investment, how long do you plan to keep the money invested?', pt: 'Em um investimento de longo prazo, por quanto tempo pretende manter o dinheiro investido?', options: ['1–2 years', '3–4 years', '5–6 years', '7–8 years', 'More than 8 years'], optionsPt: ['1–2 anos', '3–4 anos', '5–6 anos', '7–8 anos', 'Mais de 8 anos'], points: [0, 1, 3, 5, 7] },
  { id: 'stockLoss', question: 'Imagine your stock investment loses about 31% in three months. What would you do?', pt: 'Imagine que seu investimento em ações caia cerca de 31% em três meses. O que faria?', options: sell, optionsPt: sellPt, points: [1, 3, 5, 6] },
  { id: 'stabilityPreference', question: 'I prefer little or no fluctuation in value and accept the lower returns that may come with it. How much do you agree?', pt: 'Prefiro pouca ou nenhuma oscilação de valor e aceito o retorno menor que isso pode trazer. Quanto concorda?', options: agreements, optionsPt: agreementsPt, points: [6, 5, 3, 1, 0] },
  { id: 'downturnReaction', question: 'When markets fall, I tend to move some riskier investments into safer ones. How much do you agree?', pt: 'Quando o mercado cai, costumo trocar parte dos investimentos mais arriscados por outros mais seguros. Quanto concorda?', options: agreements, optionsPt: agreementsPt, points: [5, 4, 3, 2, 1] },
  { id: 'informalAdvice', question: 'A brief conversation with a friend, colleague or relative would be enough for me to invest in a fund. How much do you agree?', pt: 'Uma conversa breve com um amigo, colega ou familiar seria suficiente para eu investir em um fundo. Quanto concorda?', options: agreements, optionsPt: agreementsPt, points: [5, 4, 3, 2, 1] },
  { id: 'bondLoss', question: 'Imagine your bond investment loses almost 4% in two months. What would you do?', pt: 'Imagine que seu investimento em renda fixa caia quase 4% em dois meses. O que faria?', options: sell, optionsPt: sellPt, points: [1, 3, 5, 6] },
  { id: 'lossTradeoff', question: 'For a hypothetical $10,000 investment, which one-year gain/loss range would you choose? These examples are not predictions.', pt: 'Em um investimento hipotético de US$ 10.000, qual intervalo de ganho/perda em um ano escolheria? São exemplos, não previsões.', options: ['A: gain $593 / loss $164', 'B: gain $1,921 / loss $1,020', 'C: gain $4,229 / loss $3,639'], optionsPt: ['A: ganho US$ 593 / perda US$ 164', 'B: ganho US$ 1.921 / perda US$ 1.020', 'C: ganho US$ 4.229 / perda US$ 3.639'], points: [1, 3, 5] },
  { id: 'incomeStability', question: 'How stable are your current and future income sources?', pt: 'Quão estáveis são suas fontes de renda atuais e futuras?', options: ['Very unstable', 'Unstable', 'Somewhat stable', 'Stable', 'Very stable'], optionsPt: ['Muito instáveis', 'Instáveis', 'Um pouco estáveis', 'Estáveis', 'Muito estáveis'], points: [1, 2, 3, 4, 5] },
  { id: 'experience', question: 'How would you describe your experience with stocks, bonds or funds?', pt: 'Como descreveria sua experiência com ações, renda fixa ou fundos?', options: ['Very inexperienced', 'Somewhat inexperienced', 'Somewhat experienced', 'Experienced', 'Very experienced'], optionsPt: ['Muito inexperiente', 'Um pouco inexperiente', 'Alguma experiência', 'Experiente', 'Muito experiente'], points: [1, 2, 3, 4, 5] },
] as const;
export type QuestionId = typeof INVESTOR_QUESTIONS[number]['id'];
export const ProfileAnswers = z.record(z.enum(INVESTOR_QUESTIONS.map(q => q.id) as [QuestionId, ...QuestionId[]]), z.enum(['A', 'B', 'C', 'D', 'E', 'F'])).superRefine((answers, ctx) => {
  for (const question of INVESTOR_QUESTIONS) {
    const answer = answers[question.id];
    if (answer && answer.charCodeAt(0) - 65 >= question.points.length) ctx.addIssue({ code: 'custom', path: [question.id], message: 'This question does not offer that answer' });
  }
});
export type ProfileAnswers = z.infer<typeof ProfileAnswers>;
export const PROFILE_BANDS = [
  { min: 7, max: 22, category: 'income', stocks: 0, bonds: 100 },
  { min: 23, max: 28, category: 'income', stocks: 20, bonds: 80 },
  { min: 29, max: 35, category: 'income', stocks: 30, bonds: 70 },
  { min: 36, max: 41, category: 'balanced', stocks: 40, bonds: 60 },
  { min: 42, max: 48, category: 'balanced', stocks: 50, bonds: 50 },
  { min: 49, max: 54, category: 'balanced', stocks: 60, bonds: 40 },
  { min: 55, max: 61, category: 'growth', stocks: 70, bonds: 30 },
  { min: 62, max: 68, category: 'growth', stocks: 80, bonds: 20 },
  { min: 69, max: 75, category: 'growth', stocks: 100, bonds: 0 },
] as const;
export function allocationForScore(score: number) {
  const band = PROFILE_BANDS.find(row => Number.isInteger(score) && score >= row.min && score <= row.max);
  if (!band) throw new Error('Questionnaire score must be an integer from 7 to 75');
  return band;
}
export function assessInvestorProfile(input: unknown) {
  const answers = ProfileAnswers.parse(input);
  if (INVESTOR_QUESTIONS.some(question => !answers[question.id])) throw new Error('Answer all 11 investor-profile questions before continuing');
  const breakdown = INVESTOR_QUESTIONS.map((question, index) => ({ question: index + 1, id: question.id, answer: answers[question.id]!, points: question.points[answers[question.id]!.charCodeAt(0) - 65]! }));
  const score = breakdown.reduce((total, answer) => total + answer.points, 0);
  const band = allocationForScore(score);
  const warnings: string[] = [];
  // Application checks are disclosed separately; they never change the source's score.
  if (['A', 'B'].includes(answers.withdrawalStart!)) warnings.push('near_term_withdrawals');
  if (['A', 'B'].includes(answers.incomeStability!)) warnings.push('unstable_income');
  if (['A', 'B'].includes(answers.stockLoss!) && band.stocks >= 60) warnings.push('loss_tolerance_conflict');
  if (['A', 'B'].includes(answers.experience!)) warnings.push('limited_experience');
  return { framework: PROFILE_FRAMEWORK, source: PROFILE_SOURCE, answers, breakdown, score, category: band.category, suggestedAllocation: { stocks: band.stocks, bonds: band.bonds }, warnings };
}
export type ProfileAssessment = ReturnType<typeof assessInvestorProfile>;
export const ProfileConfirmation = z.object({
  scope: z.enum(['equity_sleeve', 'full_equity']),
  acknowledged: z.literal(true),
  deviationReason: z.string().trim().max(1000).default(''),
}).strict();
export type ProfileConfirmation = z.infer<typeof ProfileConfirmation>;
export interface InvestorProfileSnapshot extends ProfileAssessment {
  assessedAt: string;
  confirmedAt: string;
  confirmation: ProfileConfirmation;
}
export function confirmInvestorProfile(answers: unknown, input: unknown, now = new Date().toISOString()): InvestorProfileSnapshot {
  const assessment = assessInvestorProfile(answers);
  const confirmation = ProfileConfirmation.parse(input);
  if (confirmation.scope === 'equity_sleeve' && assessment.suggestedAllocation.stocks === 0) throw new Error('The guide suggests no equity sleeve. Revisit the profile or explicitly record a deviation before creating an equity strategy.');
  if (confirmation.scope === 'full_equity' && assessment.suggestedAllocation.stocks < 100 && confirmation.deviationReason.length < 20) throw new Error('Explain the departure from the suggested mix in at least 20 characters');
  return { ...assessment, assessedAt: now, confirmedAt: now, confirmation };
}
/** Recompute saved snapshots rather than trusting supplied totals or allocation labels. */
export function validateInvestorProfileSnapshot(value: unknown): InvestorProfileSnapshot {
  const parsed = z.object({ framework: z.literal(PROFILE_FRAMEWORK), answers: ProfileAnswers, assessedAt: z.string().datetime(), confirmedAt: z.string().datetime(), confirmation: ProfileConfirmation }).passthrough().parse(value);
  return { ...confirmInvestorProfile(parsed.answers, parsed.confirmation, parsed.confirmedAt), assessedAt: parsed.assessedAt };
}
export function profileConstraints(profile: InvestorProfileSnapshot): string[] {
  const { stocks, bonds } = profile.suggestedAllocation;
  return [
    `Investor profile: ${profile.category}; questionnaire ${profile.score}/75; suggested guide ${stocks}% stocks / ${bonds}% bonds.`,
    profile.confirmation.scope === 'equity_sleeve'
      ? `Strategy scope: equity sleeve within a broader portfolio. The ${bonds}% bond portion in the guide is outside automated equity research; weights inside this sleeve are not whole-portfolio weights.`
      : `Strategy scope: investor-requested full-equity strategy.${profile.confirmation.deviationReason ? ` Departure from questionnaire guide: ${profile.confirmation.deviationReason}` : ''}`,
    `Liquidity context: withdrawals begin ${INVESTOR_QUESTIONS[0].options[profile.answers.withdrawalStart!.charCodeAt(0) - 65]}; withdrawal duration ${INVESTOR_QUESTIONS[1].options[profile.answers.withdrawalDuration!.charCodeAt(0) - 65]}.`,
    'Profiling framework is a general guide based on U.S. stock/bond assumptions, not comprehensive investment advice or a Brazilian suitability certification. Reassess when circumstances change.',
  ];
}
export function profileWarningText(code: string, language: ProfileLanguage): string {
  const copy: Record<string, [string, string]> = {
    near_term_withdrawals: ['Near-term withdrawals require a separate liquidity review; the score alone does not establish capacity for equity losses.', 'Retiradas próximas exigem revisar a liquidez; o score sozinho não demonstra capacidade de suportar perdas em ações.'],
    unstable_income: ['Unstable income needs an emergency-reserve and cash-flow review before allocating capital.', 'Renda instável exige revisar reserva de emergência e fluxo de caixa antes de alocar capital.'],
    loss_tolerance_conflict: ['Your reaction to equity losses conflicts with the growth-oriented mix. Review this before confirming.', 'Sua reação a perdas em ações conflita com a composição voltada a crescimento. Revise antes de confirmar.'],
    limited_experience: ['Limited experience is recorded; the allocation guide is not proof that complex investments fit your circumstances.', 'A experiência limitada foi registrada; a composição sugerida não comprova adequação de investimentos complexos.'],
  };
  return copy[code]?.[language === 'pt' ? 1 : 0] ?? code;
}
