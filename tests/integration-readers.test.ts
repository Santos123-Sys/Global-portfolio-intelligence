import { describe, expect, it, vi } from 'vitest';
import { readApprovedValuation, readPortfolioExposure, readRiskRun,
  mappedRiskStudioWorkspace } from '../src/lib/integrations/external-readers';
const account='550e8400-e29b-41d4-a716-446655440000';
const portfolio='550e8400-e29b-41d4-a716-446655440001';
const workspace='550e8400-e29b-41d4-a716-446655440002';
const run='550e8400-e29b-41d4-a716-446655440003';
const config={baseUrl:'https://risk.example/',token:'t'.repeat(40)};
const exposure={schemaVersion:'portfolio-exposure.v1',portfolioId:portfolio,workspaceId:workspace,
  snapshotId:'risk-published-1',baseCurrency:'USD',asOf:'2026-10-10T00:00:00Z',
  source:'portfolio-risk-studio',status:'ready',holdingsCount:3,
  sectorWeights:{Technology:'0.45'},countryWeights:{US:'0.45'},methodologyVersion:'risk-method-v1'};
const riskRun={schemaVersion:'portfolio-risk.v1',runId:run,portfolioId:portfolio,workspaceId:workspace,
  asOf:exposure.asOf,snapshotId:'run-snapshot-1',status:'partial',
  priceSource:'provider',fxSource:null,baseCurrency:'USD',methodVersion:'risk-method-v1',
  warnings:['FX missing'],resultReference:null};
const valuation={schemaVersion:'valuation.v1',valuationVersionId:'v1',issuerId:'us:0000000001',
  method:'dcf',scenario:'base',currency:'USD',impliedValuePerShare:'120.30',
  valuationAsOf:exposure.asOf,approvedAt:exposure.asOf,approvedBy:'analyst',
  sourceSnapshotIds:['finance-1'],assumptionsHash:'b'.repeat(64),approvalStatus:'approved'};

describe('disabled-by-default future provider readers',()=>{
  it('never issues POSTs or redirects, and accepts matching approved valuation',async()=>{
    const fetcher=vi.fn(async()=>Response.json(valuation));
    const result=await readApprovedValuation('v1','us:0000000001',{...config,fetch:fetcher});
    expect(result.approvalStatus).toBe('approved');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url,init]=fetcher.mock.calls[0] as unknown as [URL,RequestInit];
    expect(url.pathname).toBe('/api/integration/v1/valuations/v1');
    expect(init.method).toBe('GET');expect(init.redirect).toBe('error');
  });
  it('rejects unapproved, wrong-issuer or wrong-version valuations',async()=>{
    await expect(readApprovedValuation('v1',valuation.issuerId,{...config,
      fetch:async()=>Response.json({...valuation,approvalStatus:'draft'})})).rejects.toThrow('invalid_contract');
    await expect(readApprovedValuation('v1','br:00000000000001',{...config,
      fetch:async()=>Response.json(valuation)})).rejects.toThrow('identity_mismatch');
  });
  it('rejects exposure from a different portfolio or tenant',async()=>{
    expect((await readPortfolioExposure(portfolio,workspace,{...config,fetch:async()=>Response.json(exposure)})).workspaceId).toBe(workspace);
    await expect(readPortfolioExposure(portfolio,account,{...config,fetch:async()=>Response.json(exposure)})).rejects.toThrow('identity_mismatch');
    await expect(readRiskRun(run,portfolio,account,{...config,fetch:async()=>Response.json(riskRun)})).rejects.toThrow('identity_mismatch');
  });
  it('requires administrative workspace mapping and never trusts a caller-supplied id',()=>{
    expect(mappedRiskStudioWorkspace(account,JSON.stringify({[account]:workspace}))).toBe(workspace);
    expect(mappedRiskStudioWorkspace(portfolio,JSON.stringify({[account]:workspace}))).toBeNull();
    expect(()=>mappedRiskStudioWorkspace(account,'{"bad":"anything"}')).toThrow('invalid_configuration');
  });
  it('fails closed on insecure URL, invalid credentials, and huge bodies',async()=>{
    await expect(readPortfolioExposure(portfolio,workspace,{...config,baseUrl:'http://risk.example',
      fetch:async()=>Response.json(exposure)})).rejects.toThrow('invalid_configuration');
    await expect(readPortfolioExposure(portfolio,workspace,{...config,token:'short',
      fetch:async()=>Response.json(exposure)})).rejects.toThrow('invalid_configuration');
    await expect(readPortfolioExposure(portfolio,workspace,{...config,
      fetch:async()=>new Response('x'.repeat(128001),{headers:{'content-type':'application/json'}})}))
      .rejects.toThrow('response_too_large');
  });
});
