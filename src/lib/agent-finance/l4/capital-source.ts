import { capitalSchema,type CapitalInputs } from './financial-model';

/** Optional canonical capital-market feed. Explicit currency, source URLs and date are mandatory;
 * absent feed/coverage falls back to persisted observations, never to guessed premiums. */
export async function fetchCapitalInputs(ticker:string,currency:string):Promise<CapitalInputs|null> {
  const endpoint=process.env.FINANCE_CAPITAL_DATA_URL;
  if(!endpoint) return null;
  const url=new URL(endpoint);
  if(url.protocol!=='https:') throw new Error('Capital data feed must use HTTPS');
  url.searchParams.set('ticker',ticker);url.searchParams.set('currency',currency);
  const response=await fetch(url,{headers:process.env.FINANCE_CAPITAL_DATA_API_KEY ? {Authorization:`Bearer ${process.env.FINANCE_CAPITAL_DATA_API_KEY}`} : {},signal:AbortSignal.timeout(15_000),cache:'no-store'});
  if(!response.ok) throw new Error(`Capital feed unavailable (${response.status})`);
  const text=await response.text();if(text.length>65536) throw new Error('Capital feed response too large');
  const input=capitalSchema.parse(JSON.parse(text));
  if(input.currency!==currency || Date.parse(input.asOf)>Date.now() || Date.parse(input.asOf)<Date.now()-180*86400_000) throw new Error('Stale or mismatched capital feed');
  return input;
}
