import { createHash } from 'node:crypto';

export const CHUNKING_CONFIG = { targetChunkSize: 800, maxChunkSize: 1200, minChunkSize: 200, overlapSize: 100, maxTableRows: 20 } as const;
export interface SemanticChunk { index: number; text: string; length: number; contextBefore: string; contextAfter: string; sectionTitle?: string; sectionType?: string; hash: string }

const heading = /^(Item\s+\d+[A-Z]?\.|PART\s+\d+|\d+\.\s+[A-Z]|[A-Z][A-Z\s]{3,50})/i;
export function chunkDocument(text: string, target: number = CHUNKING_CONFIG.targetChunkSize): SemanticChunk[] {
  const max = Math.max(target, Math.min(CHUNKING_CONFIG.maxChunkSize, Math.round(target * 1.5)));
  const paragraphs = text.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  const raw: Array<{ text: string; sectionTitle?: string }> = []; let current = ''; let sectionTitle: string | undefined;
  const flush = () => { if (current.trim()) raw.push({ text: current.trim(), sectionTitle }); current = ''; };
  for (const paragraph of paragraphs) {
    if (heading.test(paragraph.split('\n')[0] ?? '')) { flush(); sectionTitle = paragraph.split('\n')[0]?.slice(0, 120); }
    const units = paragraph.length > max ? paragraph.match(new RegExp(`.{1,${max}}(?:\\s|$)`, 'gs')) ?? [paragraph] : [paragraph];
    for (const unit of units) { if (current && current.length + unit.length + 2 > max) flush(); current += `${current ? '\n\n' : ''}${unit.trim()}`; if (current.length >= target) flush(); }
  }
  flush();
  const merged: typeof raw = [];
  for (const item of raw) { if (item.text.length < CHUNKING_CONFIG.minChunkSize && merged.length) merged[merged.length - 1].text += `\n\n${item.text}`; else merged.push(item); }
  return merged.filter((item) => item.text.length >= CHUNKING_CONFIG.minChunkSize).map((item, index, all) => {
    const before = all[index - 1]?.text.slice(-CHUNKING_CONFIG.overlapSize) ?? ''; const after = all[index + 1]?.text.slice(0, CHUNKING_CONFIG.overlapSize) ?? '';
    return { index, text: item.text, length: item.text.length, contextBefore: before, contextAfter: after, sectionTitle: item.sectionTitle, sectionType: item.sectionTitle?.split(/\s+/).slice(0, 2).join(' '), hash: createHash('sha256').update(item.text).digest('hex') };
  });
}
