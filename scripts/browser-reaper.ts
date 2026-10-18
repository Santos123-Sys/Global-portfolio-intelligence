import { reapRuns } from '../src/lib/browser/store';
import { closeStore } from '../src/lib/foundation/store';
try{await reapRuns();}finally{await closeStore();}
