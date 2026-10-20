import {build} from 'esbuild';
// Railway Functions accept one file. Bundle the shared quality contract with it.
await build({entryPoints:['ops/portfolio-risk-function.ts'],bundle:true,platform:'neutral',format:'esm',target:'es2022',minify:true,outfile:'dist/portfolio-risk-function.mjs'});

if(process.env.RISK_BUNDLE_STDOUT==='true'){
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
 const bytes=await readFile('dist/portfolio-risk-function.mjs'),encoded=bytes.toString('base64'),sha256=createHash('sha256').update(bytes).digest('hex'),size=8000,total=Math.ceil(encoded.length/size);
 for(let index=0;index<total;index++)console.log('GPI_RISK_RELEASE '+JSON.stringify({version:1,index,total,sha256,bytes:bytes.length,sourceCommit:process.env.GITHUB_SHA??null,base64:encoded.slice(index*size,(index+1)*size)}));
}
