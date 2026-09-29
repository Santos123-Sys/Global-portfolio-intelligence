export const FOLDER_TYPES = ['REGULATORY_FILING', 'MATERIAL_FACT', 'FINANCIAL_REPORT', 'OTHER_DOCUMENT', 'NEWS_ARTICLE'] as const;
export type FolderType = typeof FOLDER_TYPES[number];

export interface DiscoveredDocument {
  documentType: string;
  externalId?: string;
  title: string;
  description?: string;
  publishedDate?: string;
  fiscalYearEnd?: string;
  fiscalPeriod?: string;
  url: string;
  source: string;
  isPrimarySource: boolean;
  folderType: FolderType;
  isAmendment?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ParsedDocument {
  text: string;
  pageCount?: number;
  format: string;
  language?: string;
}

export interface DocumentDiscoveryAgent {
  discover(ticker: string, exchange: string, country: string): Promise<DiscoveredDocument[]>;
}

export interface StorageMetadata { contentType?: string; sourceUrl?: string; [key: string]: string | undefined }
export interface DocumentStorage {
  upload(key: string, buffer: Buffer, metadata?: StorageMetadata): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export interface Citation {
  chunkId: string; documentId: string; documentTitle: string; source: string;
  publishedDate: string; excerpt: string; relevanceScore: number; isPrimarySource: boolean;
}

export interface RAGAnswer { answer: string; citations: Citation[]; conversationId: string }
