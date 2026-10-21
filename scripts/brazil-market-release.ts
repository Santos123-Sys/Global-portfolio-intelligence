import {checkBrazilMarket} from './check-brazil-market';
import {historyEvidenceError} from '../src/lib/market/evidence-errors';
// Separate executable: bundling the observational worker must never execute a CLI gate.
try{
 const report=await checkBrazilMarket();
 if(report.gate.status!=='passed')process.exitCode=1;
}catch(error){
 console.error(JSON.stringify({kind:'brazil_market_release',gate:{status:'blocked',marketCertified:false},reason:historyEvidenceError(error)}));
 process.exitCode=1;
}
