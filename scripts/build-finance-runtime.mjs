import { build } from 'esbuild';
await build({entryPoints:['src/lib/agent-finance/l1/research-director.ts'],outfile:'services/agentic/dist/finance-runtime.js',bundle:true,platform:'node',format:'esm',target:'node22',packages:'external',tsconfig:'tsconfig.json'});
