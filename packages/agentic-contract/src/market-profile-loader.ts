/** Server-only deployment configuration; never import this entry point in client components. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { load, JSON_SCHEMA } from 'js-yaml';
import { MarketProfile, marketProfiles } from './market-adaptive.js';

export async function loadMarketProfiles(directory = process.env.MARKET_PROFILE_DIR): Promise<MarketProfile[]> {
  if (!directory) return marketProfiles.map(p => MarketProfile.parse(p));
  const names = (await readdir(directory)).filter(name => /\.ya?ml$/i.test(name)).sort();
  if (!names.length || names.length > 32) throw new Error('Market profile directory must contain 1–32 YAML files');
  const profiles = new Map(marketProfiles.map(p => [p.id, p]));
  const seen = new Set<string>();
  for (const name of names) {
    const path = join(directory, name);
    if ((await stat(path)).size > 128 * 1024) throw new Error(`Market profile is too large: ${name}`);
    // JSON_SCHEMA disables executable/custom YAML tags. Zod rejects unknown config keys.
    const profile = MarketProfile.parse(load(await readFile(path, 'utf8'), { schema: JSON_SCHEMA }));
    if (seen.has(profile.id)) throw new Error(`Duplicate market profile: ${profile.id}`);
    const previous = profiles.get(profile.id);
    if (previous && previous.version === profile.version && JSON.stringify(previous) !== JSON.stringify(profile))
      throw new Error(`Changed market profile ${profile.id} requires a new version`);
    seen.add(profile.id); profiles.set(profile.id, profile);
  }
  return [...profiles.values()];
}
