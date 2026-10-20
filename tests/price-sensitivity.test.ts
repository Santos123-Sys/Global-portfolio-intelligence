import {it,expect} from 'vitest';
import {priceSensitivity} from '../src/lib/market/price-sensitivity';
it('compares equal session pairs without bridging a missing secondary price',()=>{
 const primary={rows:[100,90,99,88,96.8].map((adjustedClose,i)=>({date:`2026-10-${String(10+i).padStart(2,'0')}`,adjustedClose}))};
 const second={rows:primary.rows.filter((_,i)=>i!==2).map(r=>({...r,adjustedClose:r.adjustedClose*2}))};
 const r=priceSensitivity(primary,second)!;
 expect(r.diagnosticOnly).toBe(true);expect(r.comparedReturns).toBe(2);expect(r.primary).toEqual(r.secondary);
 expect(r.primary!.historicalVar95).toBeCloseTo(.1);expect(r.primary!.annualizedVolatility).toBeCloseTo(Math.sqrt(.02*252));
 expect(priceSensitivity(primary,undefined)).toBeNull();
});
it('does not promote either vendor, average prices or mutate inputs',()=>{
 const primary={rows:[100,90,100].map((adjustedClose,i)=>({date:`2026-10-${10+i}`,adjustedClose}))};
 const second={rows:primary.rows.map((r,i)=>({...r,adjustedClose:i===1?80:r.adjustedClose}))},before=JSON.stringify(primary);
 const r=priceSensitivity(primary,second)!;expect(r.primary!.historicalVar95).toBeCloseTo(.1);expect(r.secondary!.historicalVar95).toBeCloseTo(.2);
 expect(JSON.stringify(primary)).toBe(before);expect(r).not.toHaveProperty('selectedProvider');
});
it('does not bridge a reference session missing from the primary feed',()=>{
 const dates=['2026-10-12','2026-10-13','2026-10-14','2026-10-15'];
 const primary={reference:{dates},rows:dates.filter((_,i)=>i!==1).map((date,i)=>({date,adjustedClose:100+i}))};
 const r=priceSensitivity(primary,{rows:primary.rows})!;expect(r.comparedReturns).toBe(1);expect(r.primary).toBeNull();expect(r.secondary).toBeNull();
});
