import {readFileSync,readdirSync} from 'node:fs';
import {it,expect} from 'vitest';
it('keeps every remote workflow action immutable and untrusted PR CI read-only',()=>{
 for(const file of readdirSync('.github/workflows').filter(p=>p.endsWith('.yml'))){
  const text=readFileSync('.github/workflows/'+file,'utf8');
  for(const [,action] of text.matchAll(/uses:\s*([^\s#]+)/g))expect(action).toMatch(/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/);
  expect(text).not.toContain('pull_request_target:');
  expect(text).toContain('contents: read');expect(text).not.toMatch(/(?:contents|actions|packages|id-token): write/);
 }
});
