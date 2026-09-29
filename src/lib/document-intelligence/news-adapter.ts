import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { companyWorkspaces, intelligenceDocuments } from '../db/workflow-schema';
import { indexTextDocument } from './ingestion-pipeline';

export interface NewsArticle { id: string | number; ticker: string; title: string; summary?: string; content?: string; source?: string; url: string; published_date?: string; sentiment?: unknown; relevance_score?: unknown; keywords?: unknown; ai_summary?: unknown; word_count?: unknown }
export interface NewsSource { getArticles(ticker: string, options: { days: number }): Promise<NewsArticle[]> }

/** Read-only adapter around the existing scraper database; it never scrapes. */
export class SqliteNewsSource implements NewsSource {
  constructor(private readonly path: string) {}
  async getArticles(ticker: string, { days }: { days: number }) {
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(this.path, { readOnly: true });
    try { return database.prepare(`SELECT id, ticker, title, summary, content, source, url, published_date, sentiment, relevance_score, keywords, ai_summary, word_count FROM news_articles WHERE upper(ticker) = upper(?) AND datetime(published_date) >= datetime('now', ?) ORDER BY published_date DESC`).all(ticker, `-${days} days`) as unknown as NewsArticle[]; } finally { database.close(); }
  }
}

export async function syncNewsArticles(workspaceId: string, ownerId: string, securityId: string, source: NewsSource): Promise<number> {
  const [workspace] = await db.select().from(companyWorkspaces).where(and(eq(companyWorkspaces.id, workspaceId), eq(companyWorkspaces.ownerId, ownerId), eq(companyWorkspaces.securityId, securityId))).limit(1);
  if (!workspace) throw new Error('Workspace not found');
  const articles = await source.getArticles(workspace.ticker, { days: 7 }); let synced = 0;
  for (const article of articles) {
    const externalId = `news_${article.id}`;
    const [existing] = await db.select({ id: intelligenceDocuments.id }).from(intelligenceDocuments).where(and(eq(intelligenceDocuments.workspaceId, workspace.id), eq(intelligenceDocuments.ownerId, ownerId), eq(intelligenceDocuments.securityId, securityId), eq(intelligenceDocuments.externalId, externalId))).limit(1);
    if (existing) continue;
    const content = article.content?.slice(0, 100_000) || article.summary?.slice(0, 100_000) || '';
    const contentHash = content ? createHash('sha256').update(content).digest('hex') : null;
    if (contentHash) {
      const [byHash] = await db.select({ id: intelligenceDocuments.id }).from(intelligenceDocuments).where(and(eq(intelligenceDocuments.workspaceId, workspace.id), eq(intelligenceDocuments.ownerId, ownerId), eq(intelligenceDocuments.securityId, securityId), eq(intelligenceDocuments.contentHash, contentHash))).limit(1);
      if (byHash) continue;
    }
    const [document] = await db.insert(intelligenceDocuments).values({ workspaceId, securityId, ownerId, folderType: 'NEWS_ARTICLE', documentType: 'NEWS_ARTICLE', source: 'news_scraper', title: article.title, description: article.summary, url: article.url, externalId, contentText: content, contentLength: content.length, contentHash, publishedDate: article.published_date ? new Date(article.published_date) : null, isPrimarySource: false, processingStatus: content ? 'embedding' : 'failed', processingError: content ? null : 'News adapter received no article content', metadataJson: { originalSource: article.source, sentiment: article.sentiment, relevanceScore: article.relevance_score, keywords: article.keywords, aiSummary: article.ai_summary, wordCount: article.word_count } }).returning({ id: intelligenceDocuments.id });
    if (content) await indexTextDocument({ documentId: document.id, workspaceId, securityId, ownerId, text: content });
    synced++;
  }
  return synced;
}
