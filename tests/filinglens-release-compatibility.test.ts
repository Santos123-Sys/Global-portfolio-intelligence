import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

it('CI verifies the released five-year FilingLens consumer, not an obsolete authorization fixture',()=>{
  const workflow=readFileSync('.github/workflows/security.yml','utf8');
  expect(workflow).toContain('ref: 3e2e896085dd7263da5524210693cbadfa7a4a97');
  expect(workflow).toContain('FILINGLENS_TEST_ROOT="$GITHUB_WORKSPACE/.cross-app/filinglens" npm test -- tests/approval-flow.integration.test.ts');
  expect(workflow).toContain('persist-credentials: false');
});
