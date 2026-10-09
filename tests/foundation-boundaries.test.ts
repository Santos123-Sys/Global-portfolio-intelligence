import { describe,it,expect } from 'vitest';
import { existsSync,readFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
describe('replacement architectural guardrails',()=>{
  it('contains no old financial runtime or legacy API',()=>{
    for(const path of ['src/lib/quant','src/lib/fx','src/lib/agent-finance','python/deterministic_engines.py','src/app/api/analysis','src/app/api/risk','src/app/api/portfolio','services/filings_python/analysis.py'])expect(existsSync(path),path).toBe(false);
  });
  it('does not reimport the retired workspace runtime',()=>{
    function walk(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);}
    for(const file of [...walk('src'),...walk('scripts')].filter(f=>/\.(tsx?|mjs)$/.test(f)))expect(readFileSync(file,'utf8'),file).not.toMatch(/from ['"][^'"]*(?:agent-finance|@portfolio-intelligence|\/quant\/|\/fx\/)/);
  });
  it('keeps the required CI job name and tests the replacement worker',()=>{
    const ci=readFileSync('.github/workflows/security.yml','utf8');expect(ci).toContain('  verify:');expect(ci).toContain('npm run build:worker');expect(ci).not.toContain('build:agentic');
  });
  it('has no destructive database migration',()=>{expect(readFileSync('migrations/001_foundation.sql','utf8')).not.toMatch(/\bDROP\s+(TABLE|SCHEMA|DATABASE)|\bTRUNCATE\b/i);});
});
