import type { ParsedDocument } from '../types';
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export async function parseHtml(input: Buffer | string): Promise<ParsedDocument> {
  const html = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  const text = html.replace(/<(script|style|nav|footer|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => { if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16)); if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10)); return ENTITIES[entity.toLowerCase()] ?? ' '; });
  return { text, format: 'html' };
}
