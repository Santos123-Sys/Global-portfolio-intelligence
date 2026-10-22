import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import dataset from './fixtures/research-rubric-evaluation-v1.json';
import { planResearchEvaluation, prepareEvaluationCase } from '../src/lib/research/evaluation';
import { summarizeEvidenceSources } from '../src/lib/research/source-groups';

describe('paired rubric evaluation controls, not investment-quality certification', () => {
  it('plans both profiles with fixed corpus/prompt hashes and bounded resource ceilings', () => {
    const { manifest } = planResearchEvaluation(dataset, 5);
    expect(manifest.datasetKind).toBe('synthetic_controls');
    expect(manifest.qualityVerdict).toBe('requires_human_review');
    expect(manifest.plannedRuns).toBe(120); expect(manifest.maximumModelCalls).toBe(360);
    expect(manifest.profiles.map(row => row.profile)).toEqual(['baseline', 'curated']);
    expect(planResearchEvaluation(structuredClone(dataset), 5).manifest).toEqual(manifest);
    expect(manifest.profiles[0].promptHash).not.toBe(manifest.profiles[1].promptHash);
  });
  it('handles English/Portuguese controls, scopes before retrieval and groups original/mirror records', () => {
    const { dataset: parsed } = planResearchEvaluation(dataset, 1);
    expect(new Set(parsed.cases.map(row => row.brief.language))).toEqual(new Set(['en', 'pt']));
    for (const row of parsed.cases) {
      const { narrative } = prepareEvaluationCase(row);
      if (row.expected === 'abstain') expect(narrative).toEqual([]);
      else expect(narrative.length).toBeGreaterThan(0);
      if (row.id.includes('conflicting-assertions')) expect(narrative).toHaveLength(2);
      if (/repeated-origin|mirror-bytes/.test(row.id)) {
        expect(narrative).toHaveLength(2);
        expect(summarizeEvidenceSources(narrative).groups).toHaveLength(1);
      }
    }
  });
  it('rejects invalid scopes, duplicate case IDs and excessive trials', () => {
    expect(() => planResearchEvaluation({ ...dataset, cases: [dataset.cases[0], dataset.cases[0]] }, 1)).toThrow();
    expect(() => planResearchEvaluation({ ...dataset, cases: [{ ...dataset.cases[0], issuer: { jurisdiction: 'us', registryId: '123' } }] }, 1)).toThrow();
    for (const trials of [0, 11, 1.5, NaN]) expect(() => planResearchEvaluation(dataset, trials)).toThrow();
  });
  it('defaults the actual CLI to a no-model preflight and refuses an unrestricted live run', () => {
    const args = ['--import', 'tsx', 'scripts/evaluate-research-rubric.ts'];
    const preflight = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20_000 });
    expect(preflight.status).toBe(0);
    expect(JSON.parse(preflight.stdout)).toMatchObject({ mode: 'preflight_only_no_model_calls', plannedRuns: 24 });
    const rejected = spawnSync(process.execPath, [...args, '--live'], { encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, RESEARCH_MODEL_API_KEY: '', RESEARCH_MODEL_NAME: '' } });
    expect(rejected.status).not.toBe(0); expect(rejected.stdout).toBe('');
    expect(rejected.stderr).toContain('No quality pass was issued');
  });
});
