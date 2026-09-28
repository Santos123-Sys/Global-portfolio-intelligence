import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { SecurityUniverseRecord } from '@portfolio-intelligence/agentic-contract';

const blocked = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(network, prefix, 'ipv4');
export function publicSourceUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.')) throw new Error('Unsafe primary-source URL');
  return url;
}
export function publicSourceAddress(address: string) { return isIP(address) === 4 && !blocked.check(address, 'ipv4'); }

/** DNS result is validated and pinned to the connection, preventing rebinding. */
export async function retrievePrimaryDocument(raw: string, redirects = 0): Promise<{ url: string; body: string; hash: string }> {
  const url = publicSourceUrl(raw);
  let dnsDeadline: ReturnType<typeof setTimeout> | undefined;
  const address = await Promise.race([
    lookup(url.hostname, { family: 4 }),
    new Promise<never>((_, reject) => { dnsDeadline = setTimeout(() => reject(new Error('Primary-source DNS deadline exceeded')), 5_000); }),
  ]).finally(() => clearTimeout(dnsDeadline));
  if (!publicSourceAddress(address.address)) throw new Error('Nonpublic source address');
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers: { accept: 'text/html,application/xhtml+xml,text/plain', 'user-agent': 'PortfolioIntelligence/1.0 primary-source-research' },
      lookup: (_host, _options, callback) => callback(null, address.address, 4),
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
        res.resume();
        try {
          const next = publicSourceUrl(new URL(res.headers.location ?? '', url).href);
          if (redirects >= 2 || next.hostname !== url.hostname) throw new Error('Unverified primary-source redirect');
          retrievePrimaryDocument(next.href, redirects + 1).then(resolve, reject);
        } catch (error) { reject(error); }
        return;
      }
      if (res.statusCode !== 200 || !/^(text\/html|application\/xhtml\+xml|text\/plain)\b/i.test(res.headers['content-type'] ?? '')) {
        res.resume(); reject(new Error('Primary document unavailable or unsupported content type')); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_000_000) req.destroy(new Error('Primary document exceeds byte budget'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({ url: url.href, body: bytes.toString('utf8'), hash: createHash('sha256').update(bytes).digest('hex') });
      });
    });
    const deadline = setTimeout(() => req.destroy(new Error('Primary document deadline exceeded')), 10_000);
    req.on('close', () => clearTimeout(deadline)); req.on('error', reject); req.end();
  });
}
const normalized = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function primaryText(html: string) {
  return html.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}
export function matchesIssuer(text: string, security: SecurityUniverseRecord) {
  const content = normalized(text);
  for (const attr of ['issuer_lei', 'listing_isin', 'isin']) {
    const id = security.attributes[attr];
    if (typeof id === 'string' && id.length >= 10 && content.includes(normalized(id))) return true;
  }
  const legalName = typeof security.attributes.legal_name === 'string' ? security.attributes.legal_name : security.companyName;
  const name = normalized(legalName).replace(/\b(limited|ltd|inc|plc|ag|sa|s a|corporation|corp)\b/g, '').replace(/\s+/g, ' ').trim();
  return name.length >= 4 && (` ${content} `).includes(` ${name} `);
}
export interface VerifiedPrimarySource {
  url: string; snippet: string; retrievedAt: string; publishedAt: string | null;
  tier: 'primary'; kind: 'primary_document'; contentHash: string; verification: 'issuer_identity_matched';
}
export async function verifyPrimarySources(security: SecurityUniverseRecord, retrieve = retrievePrimaryDocument) {
  const urls = ['sec_filing_source_url', 'investor_relations_url', 'issuer_website'].flatMap(field => {
    const value = security.attributes[field];
    if (typeof value !== 'string' || !value.trim()) return [];
    try { return [publicSourceUrl(value).href]; } catch { return []; }
  });
  const gaps: string[] = []; const sources: VerifiedPrimarySource[] = [];
  for (const url of [...new Set(urls)].slice(0, 2)) {
    try {
      const document = await retrieve(url);
      if (publicSourceUrl(document.url).hostname !== publicSourceUrl(url).hostname) throw new Error('Source redirected to an unverified host');
      const text = primaryText(document.body);
      if (text.length < 240 || !matchesIssuer(text, security)) {
        gaps.push('Retrieved primary page did not provide sufficient issuer-matched text.'); continue;
      }
      const published = document.body.match(/<meta\s+[^>]*(?:property|name)=["'](?:article:published_time|date|dc.date)["'][^>]*content=["']([^"']+)["']/i)?.[1];
      sources.push({ url: document.url, snippet: text.slice(0, 3600), retrievedAt: new Date().toISOString(), publishedAt: published && Number.isFinite(Date.parse(published)) ? published : null,
        tier: 'primary', kind: 'primary_document', contentHash: document.hash, verification: 'issuer_identity_matched' });
      break;
    } catch { gaps.push('Primary-source retrieval could not be verified (access, format, identity or network restriction).'); }
  }
  if (!urls.length) gaps.push('No trusted issuer or filing URL supplied; primary-source verification unavailable.');
  return { sources, gaps };
}
