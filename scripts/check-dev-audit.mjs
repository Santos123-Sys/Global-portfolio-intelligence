import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const allowedAdvisories = new Set([
  // CVE-2026-93687: dev-tool-only braces stack exhaustion. As of 2026-10-04
  // GitHub reports no patched braces release. Production dependencies are
  // audited separately and must remain clean. Remove this exception as soon as
  // an upstream patched dependency chain is available.
  'GHSA-vfj7-8cjw-p6xm',
]);

/** Scanner outages and malformed output are failures, never a clean vulnerability result. */
export function checkAuditReport(report) {
if (!report || report.error || report.auditReportVersion !== 2 || !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities) ||
    !report.metadata?.vulnerabilities ||
    !['info','low','moderate','high','critical','total'].every(k=>Number.isInteger(report.metadata.vulnerabilities[k])&&report.metadata.vulnerabilities[k]>=0))
  throw new Error('npm audit returned missing, failed or unsupported scan evidence');
const vulnerabilities = report.vulnerabilities;
const severe = new Set(['high', 'critical']);

function advisoryAllowed(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return [...allowedAdvisories].some(id => entry.url === `https://github.com/advisories/${id}`);
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
  throw new Error('Unapproved high/critical development advisories');
}

const allowed = Object.entries(vulnerabilities)
  .filter(([, vulnerability]) => severe.has(vulnerability?.severity))
  .map(([name]) => name);
if (allowed.length) console.warn(`Temporarily allowing documented unpatched dev-only advisory chain: ${allowed.join(', ')}`);
return {allowed,checked:Object.keys(vulnerabilities).length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = '';
  try {
    raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if(error?.status!==1)throw new Error('npm audit failed to complete');
    raw = String(error?.stdout ?? '');
  }
  if (!raw.trim()) throw new Error('npm audit did not return a JSON report');
  checkAuditReport(JSON.parse(raw));
}
