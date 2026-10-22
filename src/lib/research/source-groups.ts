import { createHash } from 'node:crypto';
import type { Evidence, EvidenceSourceSummary } from './contracts';

function references(row: Evidence): string[] {
  const keys: string[] = [];
  try {
    const url = new URL(row.sourceUrl);
    if (url.protocol === 'https:' && !url.username && !url.password) {
      url.hash = '';
      url.searchParams.sort();
      keys.push(`url:${url.href}`);
    }
  } catch { /* Relative upload URLs are not public-source identities. */ }
  if (row.documentId && /^[a-f0-9]{64}$/.test(row.documentId)) keys.push(`document:${row.documentId}`);
  if (row.documentId && row.documentSha256 && /^[a-f0-9]{64}$/.test(row.documentSha256))
    keys.push(`sha256:${row.documentSha256}`);
  return keys;
}

/** Shared references/bytes establish dependence, never source independence or claim truth.
 * No records are dropped. Different URLs can still repeat the same original claim.
 * This function performs no I/O and never parses instructions from evidence text.
 */
export function summarizeEvidenceSources(evidence: Evidence[]): EvidenceSourceSummary {
  if (evidence.length > 100 || new Set(evidence.map(row => row.id)).size !== evidence.length)
    throw new Error('research_source_inventory_invalid');
  const parent = evidence.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
    return index;
  };
  const seen = new Map<string, number>();
  const keys = evidence.map(references);
  keys.forEach((refs, index) => refs.forEach(key => {
    const previous = seen.get(key);
    if (previous === undefined) seen.set(key, index);
    else parent[find(index)] = find(previous);
  }));
  const groups = new Map<number, { ids: string[]; resolved: boolean }>();
  evidence.forEach((row, index) => {
    const root = find(index), group = groups.get(root) ?? { ids: [], resolved: false };
    group.ids.push(row.id); group.resolved ||= keys[index].length > 0; groups.set(root, group);
  });
  return {
    version: 'evidence-source-groups.v1', recordCount: evidence.length,
    groups: [...groups.values()].map(group => {
      const evidenceIds = group.ids.sort();
      return { id: createHash('sha256').update(JSON.stringify(evidenceIds)).digest('hex'), evidenceIds,
        relation: group.resolved ? 'shared_reference' as const : 'unresolved' as const };
    }).sort((a, b) => a.id.localeCompare(b.id)),
    unresolvedRecordCount: keys.filter(refs => !refs.length).length,
    independence: 'not_established',
  };
}
