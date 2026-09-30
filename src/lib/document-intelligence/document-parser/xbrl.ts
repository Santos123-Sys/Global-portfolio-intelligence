import type { ParsedDocument } from '../types';
export async function parseXbrl(input: Buffer | string): Promise<ParsedDocument> {
  const xml = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  const text = xml.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|#160);/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
  return { text, format: 'xbrl' };
}
