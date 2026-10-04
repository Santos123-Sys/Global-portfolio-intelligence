import { execFileSync } from 'node:child_process';

const allowedAdvisories = new Set([
  // CVE-2026-93687: dev-tool-only braces stack exhaustion. As of 2026-10-04
  // GitHub reports no patched braces release. Production dependencies are
  // audited separately and must remain clean. Remove this exception as soon as
  // an upstream patched dependency chain is available.
  'GHSA-vfj7-8cjw-p6xm',
]);

let raw = '';
try {
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (error) {
  raw = String(error?.stdout ?? '');
}
if (!raw.trim()) throw new Error('npm audit did not return a JSON report');
const report = JSON.parse(raw);
const vulnerabilities = report.vulnerabilities ?? {};
const severe = new Set(['high', 'critical']);

function advisoryAllowed(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const haystack = `${entry.url ?? ''} ${entry.title ?? ''}`;
  return [...allowedAdvisories].some(id => haystack.includes(id));
}

function chainAllowed(name, visiting = new Set()) {
  if (visiting.has(name)) return false;
  const vulnerability = vulnerabilities[name];
  if (!vulnerability || !severe.has(vulnerability.severity)) return true;
  const next = new Set(visiting); next.add(name);
  const severeVia = (vulnerability.via ?? []).filter(via => {
    if (typeof via === 'string') return severe.has(vulnerabilities[via]?.severity);
    return severe.has(via?.severity);
  });
  if (!severeVia.length) return false;
  return severeVia.every(via => typeof via === 'string' ? chainAllowed(via, next) : advisoryAllowed(via));
}

const blocked = Object.entries(vulnerabilities)
  .filter(([, vulnerability]) => severe.has(vulnerability?.severity))
  .filter(([name]) => !chainAllowed(name));

if (blocked.length) {
  console.error('Unapproved high/critical development advisories detected:');
  for (const [name, vulnerability] of blocked) console.error(`- ${name}: ${vulnerability.severity}`);
  process.exit(1);
}

const allowed = Object.entries(vulnerabilities)
  .filter(([, vulnerability]) => severe.has(vulnerability?.severity))
  .map(([name]) => name);
if (allowed.length) console.warn(`Temporarily allowing documented unpatched dev-only advisory chain: ${allowed.join(', ')}`);
