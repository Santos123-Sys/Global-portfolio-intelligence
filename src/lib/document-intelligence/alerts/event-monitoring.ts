import { createDocumentAlert } from './document-alerts';

export type MonitoredEvent = 'earnings' | 'leverage' | 'management';

export interface EventEvidence {
  folderType: string;
  documentType: string;
  title: string;
  description?: string | null;
  contentText?: string | null;
  source: string;
}

const EARNINGS_TYPES = new Set([
  '10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A',
  'DFP', 'ITR', 'ANNUAL_REPORT', 'INTERIM_REPORT', 'FINANCIAL_REPORT',
]);

const EARNINGS_PATTERN = /(earnings|financial results|quarterly results|annual results|revenue|net income|resultado(?:s)? financeiro(?:s)?|receita|lucro|EBITDA)/i;
const LEVERAGE_PATTERN = /(debt|borrowings?|covenants?|leverage|net debt|indebtedness|d[ií]vida|endividamento|empr[eé]stimos?|financiamentos?)/i;
const MANAGEMENT_PATTERN = /(chief executive|chief financial|\bCEO\b|\bCFO\b|board of directors|director resignation|appointed|appointment|resigned|management change|administra[cç][aã]o|diretoria|conselho de administra[cç][aã]o|ren[uú]ncia|nomea[cç][aã]o)/i;

/**
 * Classifies evidence, not outcomes. A match means that a reviewed source has
 * arrived and should enter the human review queue; it never asserts that a
 * financial metric or management role actually changed.
 */
export function classifyMonitoredEvents(evidence: EventEvidence): MonitoredEvent[] {
  const documentType = evidence.documentType.toUpperCase();
  const searchable = [evidence.title, evidence.description, evidence.contentText]
    .filter(Boolean)
    .join('\n')
    .slice(0, 250_000);
  const events = new Set<MonitoredEvent>();

  if (EARNINGS_TYPES.has(documentType) || evidence.folderType === 'FINANCIAL_REPORT' || EARNINGS_PATTERN.test(searchable)) events.add('earnings');
  if (LEVERAGE_PATTERN.test(searchable)) events.add('leverage');
  if (MANAGEMENT_PATTERN.test(searchable)) events.add('management');

  return [...events];
}

const EVENT_COPY: Record<MonitoredEvent, { label: string; severity: 'info' | 'watch'; instruction: string }> = {
  earnings: { label: 'earnings evidence', severity: 'info', instruction: 'Review the filing for changes to reported performance and guidance.' },
  leverage: { label: 'leverage evidence', severity: 'watch', instruction: 'Review debt, liquidity, covenant, and financing disclosures; no direction of change is inferred.' },
  management: { label: 'management evidence', severity: 'watch', instruction: 'Review the source for a possible management or board event; no personnel change is inferred.' },
};

export async function publishMonitoredEventAlerts(input: {
  ownerId: string;
  securityId: string;
  ticker: string;
  evidence: EventEvidence;
  events: MonitoredEvent[];
}) {
  for (const event of input.events) {
    const copy = EVENT_COPY[event];
    await createDocumentAlert({
      ownerId: input.ownerId,
      securityId: input.securityId,
      headline: `${input.ticker}: new ${copy.label}`,
      detail: `${input.evidence.title} · ${input.evidence.source}. ${copy.instruction}`,
      severity: copy.severity,
    });
  }
}
