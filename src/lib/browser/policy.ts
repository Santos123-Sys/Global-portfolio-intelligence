import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

export function allowedSource(value:string, origins:readonly string[]) {
  const u=new URL(value);
  if (u.protocol!=='https:' || u.username || u.password || u.port && u.port!=='443' || isIP(u.hostname) || !origins.includes(u.origin)) throw Error('source_not_allowed');
  if (/\b(login|signin|sign-in|oauth|logout|auth|password|token)\b/i.test(u.pathname+u.search)) throw Error('private_signin_disabled');
  u.hash=''; return u.href;
}
// Conservative IPv4-only egress: IPv6 is denied rather than partially classified.
export function publicIPv4(ip:string) {
  if(isIP(ip)!==4)return false;
  const [a,b,c]=ip.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export function configuredOrigins() {
  return (process.env.BROWSER_SOURCE_ORIGINS??'').split(',').filter(Boolean).map(s=>{
    const u=new URL(s);if(u.href!==u.origin+'/'||u.protocol!=='https:'||isIP(u.hostname))throw Error('invalid_browser_origin');return u.origin;
  });
}
/** DNS is resolved once and the approved IP is pinned on the actual TLS connection.
 * Never forward cookies, authorization, browser headers or response Set-Cookie. */
export async function fetchSource(value:string,origins:readonly string[]) {
  const url=new URL(allowedSource(value,origins));
  const addresses=await lookup(url.hostname,{all:true,family:4});
  if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw Error('forbidden_network');
  return new Promise<{status:number;headers:Record<string,string>;body:Buffer}>((resolve,reject)=>{
    const req=https.get(url,{agent:false,lookup:(_h,_o,cb)=>cb(null,addresses[0].address,4),headers:{'user-agent':'GPI-Public-Research/1.0','accept-encoding':'identity'}},res=>{
      const chunks:Buffer[]=[];let bytes=0;
      res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2_000_000){req.destroy(Error('source_size_limit'));return;}chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{
        try {
        const headers:Record<string,string>={'content-type':res.headers['content-type']??'application/octet-stream',
          'content-security-policy':"default-src 'none'; img-src https: data:; style-src https: 'unsafe-inline'; form-action 'none'; frame-src 'none'; base-uri 'none'"};
        if(res.headers.location)headers.location=allowedSource(new URL(res.headers.location,url).href,origins);
        resolve({status:res.statusCode??502,headers,body:Buffer.concat(chunks)});
        } catch(error) { reject(error); }
      });
    });
    req.setTimeout(10_000,()=>req.destroy(Error('source_timeout')));
    const absolute=setTimeout(()=>req.destroy(Error('source_deadline')),12_000);
    req.once('close',()=>clearTimeout(absolute));
    req.on('error',reject);
  });
}
