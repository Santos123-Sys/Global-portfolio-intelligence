import type { ParsedDocument } from '../types';
import { parseHtml } from './html'; import { parsePdf } from './pdf'; import { parseText } from './txt'; import { parseXbrl } from './xbrl';

export function cleanDocumentText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').replace(/^\s*\d+\s*$/gm, '').replace(/^(Copyright|All rights reserved|Confidential|Page \d+).*$/gmi, '').replace(/^(Item\s+\d+[A-Z]?\.|PART\s+\d+|SECTION\s+\d+)/gmi, '\n\n$1').trim().slice(0, 5_000_000);
}
export async function parseDocument(input: Buffer, contentType: string, filename: string): Promise<ParsedDocument> {
  const lower = filename.toLowerCase(); let parsed: ParsedDocument;
  if (contentType === 'application/pdf' || lower.endsWith('.pdf')) parsed = await parsePdf(input);
  else if (/html/.test(contentType) || /\.html?$/.test(lower)) parsed = await parseHtml(input);
  else if (/xml|xbrl/.test(contentType) || /\.(xml|xbrl)$/.test(lower)) parsed = await parseXbrl(input);
  else parsed = await parseText(input);
  return { ...parsed, text: cleanDocumentText(parsed.text) };
}
