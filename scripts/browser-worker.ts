import { browserWorker } from '../src/lib/browser/worker';
import { closeStore } from '../src/lib/foundation/store';
const stop=new AbortController();
process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
try{await browserWorker(stop.signal);}finally{await closeStore();}
