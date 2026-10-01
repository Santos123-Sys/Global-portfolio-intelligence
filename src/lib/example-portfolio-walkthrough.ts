export type PortfolioStage =
  | 'thesis'
  | 'discovery'
  | 'candidate-review'
  | 'approval'
  | 'analysis'
  | 'valuation'
  | 'portfolio'
  | 'monitoring';

export type ExampleAnimationPreset = 'settle' | 'search' | 'reveal' | 'confirm' | 'analyze' | 'value' | 'allocate' | 'monitor';
export type ExampleExecutionStatus = 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'insufficient_data' | 'blocked';

export interface PortfolioExampleUIState {
  panel: PortfolioStage;
  agent: string;
  status: ExampleExecutionStatus;
  action: string;
  inputs: string;
  result: string;
}

export interface PortfolioExampleStep {
  id: string;
  title: string;
  description: string;
  stage: PortfolioStage;
  animation: ExampleAnimationPreset;
  uiState: PortfolioExampleUIState;
}

export const portfolioExampleSteps: PortfolioExampleStep[] = [
  {
    id: 'example-stage-thesis', title: 'Investment thesis', stage: 'thesis', animation: 'settle',
    description: 'Start with the portfolio mandate. The example is a Swiss Quality strategy reported in CHF, with a long-only, fully invested allocation and a 50% per-asset cap.',
    uiState: { panel: 'thesis', agent: 'Research Director', status: 'completed', action: 'Read the mandate and carried its guardrails into the next stage.', inputs: 'Approved portfolio thesis, reporting currency and allocation guardrails.', result: 'A structured brief sets the market, style, currency and eligibility boundaries.' },
  },
  {
    id: 'example-stage-discovery', title: 'Discovery', stage: 'discovery', animation: 'search',
    description: 'The thesis guides the search universe. In this teaching case, six fictional issuers stand in for the candidate set; no live market search is performed.',
    uiState: { panel: 'discovery', agent: 'Discovery', status: 'completed', action: 'Matched the thesis to the seeded example records.', inputs: 'Swiss Quality criteria and six seeded fictional issuer records.', result: 'Six synthetic companies across six sectors are available for review.' },
  },
  {
    id: 'example-stage-candidate-review', title: 'Candidate review', stage: 'candidate-review', animation: 'reveal',
    description: 'Review a candidate’s thesis fit, risk to test and evidence gaps. The fictional record is clearly marked illustrative; it is not source-verified research.',
    uiState: { panel: 'candidate-review', agent: 'Equity Research', status: 'awaiting_approval', action: 'Summarizing the scenario fit and the missing independent evidence.', inputs: 'Candidate thesis fit, stated risk, and explicitly disclosed evidence gaps.', result: 'A human reviewer can inspect the rationale and evidence limitations before proceeding.' },
  },
  {
    id: 'example-stage-approval', title: 'Human approval', stage: 'approval', animation: 'confirm',
    description: 'A user—not an agent—decides whether research should continue. The button in this example only changes the local demonstration state; it saves nothing.',
    uiState: { panel: 'approval', agent: 'Human review', status: 'awaiting_approval', action: 'No portfolio decision has been made.', inputs: 'The candidate dossier and thesis criteria; no hidden agent reasoning.', result: 'Approval is an explicit gate before deeper analysis.' },
  },
  {
    id: 'example-stage-analysis', title: 'Financial analysis', stage: 'analysis', animation: 'analyze',
    description: 'After the review gate, deterministic calculations organize the example financial inputs. In production, analysis depends on retained issuer evidence and data-quality checks.',
    uiState: { panel: 'analysis', agent: 'Financial Analyzer', status: 'completed', action: 'Showing calculated growth, margins and FCFF from fictional figures.', inputs: 'Invented revenue, EBIT, D&A, CapEx, tax and working-capital figures.', result: 'The calculations are reproducible; they do not claim to verify an issuer.' },
  },
  {
    id: 'example-stage-valuation', title: 'Valuation', stage: 'valuation', animation: 'value',
    description: 'The three-case DCF uses the project’s existing deterministic engine. The sample includes no peer dataset, so comparable-company valuation is shown as unavailable instead of invented.',
    uiState: { panel: 'valuation', agent: 'Valuation', status: 'completed', action: 'Showing DCF outputs from the displayed FCFF and scenario assumptions.', inputs: 'Deterministic FCFF plus fictional growth, discount, terminal-growth and capital assumptions.', result: 'Downside, base and upside values are illustrative CHF outputs—not price targets.' },
  },
  {
    id: 'example-stage-portfolio', title: 'Portfolio inclusion', stage: 'portfolio', animation: 'allocate',
    description: 'Compare starting weights with the eight-method allocation preview. Choosing a method changes this sandbox only; it does not save holdings, submit trades or change a real portfolio.',
    uiState: { panel: 'portfolio', agent: 'Portfolio Allocator', status: 'completed', action: 'Showing a calculation from the fixed seeded synthetic return series.', inputs: 'Synthetic daily returns, selected weighting method and sample per-asset cap.', result: 'Every method is a comparison; a person must choose whether to use any proposal.' },
  },
  {
    id: 'example-stage-monitoring', title: 'Monitoring', stage: 'monitoring', animation: 'monitor',
    description: 'See the kind of controls and risk context available after inclusion. This example uses a fixed historical synthetic snapshot; it has no ongoing feed or live monitoring.',
    uiState: { panel: 'monitoring', agent: 'Portfolio controls', status: 'insufficient_data', action: 'No current market evidence or ongoing monitor is connected to this example.', inputs: 'Fixed synthetic history and its precomputed risk statistics; no current provider data.', result: 'Production monitoring uses refreshed evidence and human-governed portfolio controls.' },
  },
];
