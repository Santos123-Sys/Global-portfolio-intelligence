import type { ParsedDocument } from '../types';
export async function parseText(input: Buffer | string): Promise<ParsedDocument> { return { text: Buffer.isBuffer(input) ? input.toString('utf8') : input, format: 'txt' }; }
