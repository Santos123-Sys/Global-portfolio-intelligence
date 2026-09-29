type Candidate = { distance: number; publishedDate: Date | null; source: string; isPrimarySource: boolean; sectionTitle: string | null; chunkText: string };
const quality = (item: Candidate) => item.source === 'sec_edgar' || item.source === 'cvm_dfp' ? 1 : item.isPrimarySource ? 0.8 : item.source === 'news_scraper' ? 0.35 : 0.55;
const tokens = (value: string) => new Set(value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
export function rerank<T extends Candidate>(items: T[], question: string, now = new Date()): Array<T & { relevanceScore: number }> {
  const query = tokens(question); const year = question.match(/\b(20\d{2})\b/)?.[1]; const current = /current|latest|recent|today|now/i.test(question);
  return items.map((item) => {
    const vectorSimilarity = Math.max(0, 1 - Number(item.distance));
    const ageDays = item.publishedDate ? Math.max(0, (now.getTime() - item.publishedDate.getTime()) / 86_400_000) : 3650;
    let recencyScore = Math.exp(-ageDays / 730);
    if (year && item.publishedDate?.getUTCFullYear() === Number(year)) recencyScore = 1;
    if (!current && !year) recencyScore = Math.max(recencyScore, 0.5);
    const section = tokens(`${item.sectionTitle ?? ''} ${item.chunkText.slice(0, 300)}`); const matches = [...query].filter((word) => section.has(word)).length;
    const sectionRelevanceScore = query.size ? Math.min(1, matches / Math.min(query.size, 8)) : 0;
    return { ...item, relevanceScore: vectorSimilarity * 0.4 + recencyScore * 0.25 + quality(item) * 0.25 + sectionRelevanceScore * 0.1 };
  }).sort((a, b) => b.relevanceScore - a.relevanceScore);
}
