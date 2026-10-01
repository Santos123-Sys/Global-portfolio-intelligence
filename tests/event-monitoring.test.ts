import { describe, expect, it } from 'vitest';
import { classifyMonitoredEvents } from '../src/lib/document-intelligence/alerts/event-monitoring';

describe('document event monitoring', () => {
  it('routes financial filings into earnings review without inventing a result', () => {
    expect(classifyMonitoredEvents({
      folderType: 'REGULATORY_FILING',
      documentType: '10-Q',
      title: 'Quarterly report',
      source: 'sec_edgar',
    })).toEqual(['earnings']);
  });

  it('detects leverage and management evidence in English and Portuguese', () => {
    const events = classifyMonitoredEvents({
      folderType: 'MATERIAL_FACT',
      documentType: 'FATO_RELEVANTE',
      title: 'Mudanças na diretoria',
      contentText: 'A companhia anunciou nova diretoria e revisão de endividamento e dívida líquida.',
      source: 'cvm_dfp',
    });
    expect(events).toEqual(['leverage', 'management']);
  });

  it('does not classify unrelated evidence', () => {
    expect(classifyMonitoredEvents({
      folderType: 'NEWS_ARTICLE',
      documentType: 'NEWS_ARTICLE',
      title: 'Company opens a community program',
      source: 'news_scraper',
    })).toEqual([]);
  });
});
