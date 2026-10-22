import { ANALYST_PROMPT, CRITIC_PROMPT, PLANNER_PROMPT, PROMPT_VERSION } from './prompts';

// Curated adaptations; pinned provenance and MIT notice are in docs/research-rubric.md.
// These instructions confer no tools, approval authority or financial ownership.
export const RESEARCH_RUBRIC_VERSION = 'equity-evidence-research-2026-10-22-v2';
export type ResearchPromptProfile = 'baseline' | 'curated';
export const RESEARCH_RUBRIC = {
  planner: `Research standards: identify the thesis, a credible counter-explanation and the missing disclosure that could distinguish them. Use only a stated horizon; otherwise mark it unknown. Source groups only identify shared references or document bytes, not independent corroboration. Search for disconfirming evidence as well as support; report the actual search scope and unanswered questions. Do not invent a catalyst or a second perspective to complete a template.`,
  analyst: `Research standards: trace repeated claims to their disclosed origin. Multiple facts, passages, mirrors or articles repeating an issuer statement are not independent confirmations. Different source groups do not prove independence. Separate management assertions, observed disclosures and conditional explanations. Name conflicting evidence and plausible confounding, reverse causation or selection effects. Supply an observable falsifier tied to the claim; no invented timing, thresholds or catalysts. State absent evidence rather than filling the gap.`,
  critic: `Research standards: reject claims of independent corroboration based only on record counts, URLs or source-group counts. Check that causal interpretations acknowledge plausible alternatives and that a falsifier could actually disprove the claim. Repetition, a source's prestige and confident prose do not strengthen its evidence. Missing evidence is not evidence of absence. Preserve disagreement and unknowns. Reject fabricated catalysts, horizon assumptions and authority or performance claims.`,
} as const;

export function researchPrompts(profile: ResearchPromptProfile) {
  return profile === 'curated'
    ? { version: RESEARCH_RUBRIC_VERSION, planner: `${PLANNER_PROMPT}\n${RESEARCH_RUBRIC.planner}`,
      analyst: `${ANALYST_PROMPT}\n${RESEARCH_RUBRIC.analyst}`, critic: `${CRITIC_PROMPT}\n${RESEARCH_RUBRIC.critic}` }
    : { version: PROMPT_VERSION, planner: PLANNER_PROMPT, analyst: ANALYST_PROMPT, critic: CRITIC_PROMPT };
}
