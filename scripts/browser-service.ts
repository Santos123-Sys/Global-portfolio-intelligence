import {createServer} from 'node:http';
// Startup fails closed if the container cannot run the sandboxed browser.
await import('./verify-browser-engine');
if(process.env.BROWSER_CANARY_ONLY==='true'){
  createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'ok',browserFixture:'passed',modelVerified:false}));}).listen(Number(process.env.PORT??8080),'0.0.0.0');
}else{
  await import('./browser-worker');
}
