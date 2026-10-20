import {build} from 'esbuild';
// Railway Functions accept one file. Bundle the shared quality contract with it.
await build({entryPoints:['ops/portfolio-risk-function.ts'],bundle:true,platform:'neutral',format:'esm',target:'es2022',outfile:'dist/portfolio-risk-function.mjs'});
