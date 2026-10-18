import type { BrowserRun } from './contracts';
export const browserEnabled=()=>process.env.BROWSER_WORKSPACE_ENABLED==='true';
export const verificationEnabled=()=>process.env.BROWSER_VERIFICATION_ENABLED==='true';
export const browserRunEnabled=(run:BrowserRun)=>browserEnabled()||
  (verificationEnabled()&&run.verification===true&&run.input.mode==='fixture');
