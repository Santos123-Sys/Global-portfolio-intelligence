import { inflateSync } from 'node:zlib';
import type { ParsedDocument } from '../types';

function decodeLiteral(value: string) { return value.replace(/\\([nrtbf()\\])/g, (_, char: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[char] ?? char).replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8))); }
function strings(source: string) { return [...source.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|\[(.*?)\]\s*TJ/gs)].flatMap((match) => match[1] != null ? [decodeLiteral(match[1])] : [...(match[2] ?? '').matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((item) => decodeLiteral(item[1]))); }

/** Defensive built-in PDF text fallback; malformed/encrypted/active files fail closed. */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-' || !buffer.subarray(-4096).includes(Buffer.from('%%EOF'))) throw new Error('Incomplete PDF');
  const source = buffer.toString('latin1');
  if (/\/Encrypt\b|\/JavaScript\b|\/JS\b|\/Launch\b|\/EmbeddedFile\b/.test(source)) throw new Error('Active or encrypted PDF is not accepted');
  const pages = (source.match(/\/Type\s*\/Page\b/g) ?? []).length;
  const output = strings(source);
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const offset = match.index ?? 0; const dict = source.slice(Math.max(0, offset - 500), offset);
    if (!/\/FlateDecode/.test(dict)) continue;
    try { output.push(...strings(inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'))); } catch { /* malformed stream is ignored */ }
  }
  const text = output.join('\n').trim();
  if (text.length < 50) throw new Error('PDF contains no safely extractable text; scanned PDFs require manual processing');
  return { text, pageCount: pages || undefined, format: 'pdf' };
}
