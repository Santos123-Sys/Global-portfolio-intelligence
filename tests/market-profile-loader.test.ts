import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump } from 'js-yaml';
import { buildMarketPlan, marketProfiles, marketContextFromRecord } from '@portfolio-intelligence/agentic-contract';
import { loadMarketProfiles } from '@portfolio-intelligence/agentic-contract/market-profile-loader';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'market-profiles-')); directories.push(dir); return dir; }
it('loads the shipped YAML profiles without changing built-in policy versions', async () => {
  expect(await loadMarketProfiles('config/market-profiles')).toEqual(marketProfiles);
});
it('adds a market and deterministic triggers from YAML without changing dispatch code', async () => {
  const dir = await directory();
  const profile = { ...marketProfiles[0], id: 'CA.IFRS.CAD', country: 'CA', currency: 'CAD', exchanges: ['XTSE'], accounting: ['IFRS'],
    triggers: [{ agent: 'CommodityFXAgent', field: 'sector', includesAny: ['Industrials'] }] };
  await writeFile(join(dir, 'CA.yaml'), dump(profile));
  const snapshot = await loadMarketProfiles(dir);
  const input = marketContextFromRecord({ exchange: 'XTSE', sector: 'Industrials' });
  const plan = buildMarketPlan(input, snapshot);
  expect(plan.profiles[0].id).toBe('CA.IFRS.CAD');
  expect(plan.nodes.some(n => n.id === 'CommodityFXAgent')).toBe(true);
  await writeFile(join(dir, 'CA.yaml'), dump({ ...profile, version: '1.2.0', triggers: [] }));
  expect(buildMarketPlan(input, snapshot)).toEqual(plan); // captured requests keep their policy
  expect(buildMarketPlan(input, await loadMarketProfiles(dir)).profiles[0].version).toBe('1.2.0');
});
it('rejects malformed configuration and same-version policy replacements', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'bad.yaml'), 'country: CA\nunknown: true');
  await expect(loadMarketProfiles(dir)).rejects.toThrow();
  await writeFile(join(dir, 'bad.yaml'), dump({ ...marketProfiles[0], taxPolicy: 'silently changed' }));
  await expect(loadMarketProfiles(dir)).rejects.toThrow(/new version/);
});
