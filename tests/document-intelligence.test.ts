import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chunkDocument, CHUNKING_CONFIG } from '../src/lib/document-intelligence/chunking-engine';
import { validateAnswerCitations } from '../src/lib/document-intelligence/rag/answer-parser';
import { rerank } from '../src/lib/document-intelligence/rag/reranker';
import { parseText } from '../src/lib/document-intelligence/document-parser/txt';

describe('document intelligence', () => {
  it('chunks normalized text within the configured hard limit and adds adjacent context', async () => {
    const section = (name: string, word: string) => `${name}\n${Array.from({ length: 180 }, () => word).join(' ')}`;
    const parsed = await parseText(Buffer.from(`${section('ITEM 1. BUSINESS', 'revenue')}\n\n${section('ITEM 2. RISK', 'liquidity')}`));
    const chunks = chunkDocument(parsed.text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= CHUNKING_CONFIG.maxChunkSize)).toBe(true);
    expect(chunks[0].contextAfter.length).toBeGreaterThan(0);
    expect(chunks[1].contextBefore.length).toBeGreaterThan(0);
  });

  it('applies the prescribed primary-source and temporal reranking signals', () => {
    const now = new Date('2026-09-29T00:00:00Z');
    const base = { distance: 0.2, sectionTitle: 'Revenue', chunkText: 'Revenue grew during 2026.' };
    const ranked = rerank([{ ...base, source: 'news_scraper', isPrimarySource: false, publishedDate: new Date('2024-01-01') }, { ...base, source: 'sec_edgar', isPrimarySource: true, publishedDate: new Date('2026-09-01') }], 'latest revenue', now);
    expect(ranked[0].source).toBe('sec_edgar');
    expect(ranked[0].relevanceScore).toBeGreaterThan(ranked[1].relevanceScore);
  });

  it('rejects ungrounded and out-of-range citations', () => {
    expect(validateAnswerCitations('Revenue was BRL 10m [1].', 1)).toContain('[1]');
    expect(() => validateAnswerCitations('Revenue was BRL 10m.', 1)).toThrow(/no citations/);
    expect(() => validateAnswerCitations('Revenue was BRL 10m [2].', 1)).toThrow(/not retrieved/);
  });

  it('migrates pgvector, the HNSW index, holding backfill, and tenant keys', () => {
    const migration = readFileSync('drizzle/0018_document_intelligence.sql', 'utf8');
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS vector');
    expect(migration).toContain('USING hnsw');
    expect(migration).toContain('INSERT INTO "company_workspaces"');
    expect(migration).toContain('"owner_id" uuid NOT NULL');
    expect(migration).toContain('"security_id" uuid NOT NULL');
  });

  it('integrates existing news output through an adapter without scraper code', () => {
    const adapter = readFileSync('src/lib/document-intelligence/news-adapter.ts', 'utf8');
    expect(adapter).toContain('interface NewsSource');
    expect(adapter).toContain("SELECT id, ticker, title");
    expect(adapter).not.toMatch(/fetch\(|axios|cheerio|playwright/i);
  });
});
