import {expect,it} from 'vitest';
import {historyEvidenceError} from '../src/lib/market/evidence-errors';
it('retains source-specific denied/quota codes but omits arbitrary exception details',()=>{
 expect(historyEvidenceError(Error('history_brazil_relay_http_429'))).toBe('history_brazil_relay_http_429');
 expect(historyEvidenceError(Error('history_secondary_http_403'))).toBe('history_secondary_http_403');
 for(const value of [Error('https://provider.test?apikey=private'),Error('history_brazil_http_429\nsecret'),Error('history_brazil_'+ 'x'.repeat(81)),{message:'history_brazil_raw_http_403'}])expect(historyEvidenceError(value)).toBe('secondary_invalid');
});
