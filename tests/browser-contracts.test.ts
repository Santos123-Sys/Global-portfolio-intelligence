import {describe,it,expect} from 'vitest';
import {Action,Command,canvasPoint} from '../src/lib/browser/contracts';
import {allowedSource,publicIPv4} from '../src/lib/browser/policy';
import {captureEvidence} from '../src/lib/browser/engine';
import type {Observation,BrowserRun} from '../src/lib/browser/contracts';
import {checkBudget,propose} from '../src/lib/browser/operator';
const origin='https://reports.example.com';
describe('browser source and command policy',()=>{
 it.each(['https://127.0.0.1/','http://reports.example.com/','https://reports.example.com.evil.test/','https://user:pass@reports.example.com/','https://reports.example.com:8443/','file:///etc/passwd','https://reports.example.com/login','https://reports.example.com/?token=secret'])('denies %s',url=>expect(()=>allowedSource(url,[origin])).toThrow());
 it.each(['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','198.18.0.1','::1','::ffff:127.0.0.1','224.0.0.1'])('denies private/reserved DNS %s',ip=>expect(publicIPv4(ip)).toBe(false));
 it('allows approved public address and exact origin',()=>{expect(publicIPv4('8.8.8.8')).toBe(true);expect(allowedSource(origin+'/report',[origin])).toBe(origin+'/report');});
 it('rejects arbitrary tools, keys, nonfinite input and secret entry',()=>{
   for(const action of [{kind:'type',text:'secret'},{kind:'point',x:NaN,y:0},{kind:'link',index:0,script:'evil()'},{kind:'scroll',dy:10000}])expect(Action.safeParse(action).success).toBe(false);
   expect(Command.safeParse({id:crypto.randomUUID(),epoch:0,kind:'input',action:{kind:'finish'}}).success).toBe(false);
 });
 it('maps letterboxing without applying DPR twice',()=>{expect(canvasPoint(300,300,600,600,1200,800)).toEqual({x:600,y:400});expect(canvasPoint(10,20,600,600,1200,800)).toBeNull();expect(canvasPoint(10,20,0,600,1200,800)).toBeNull();});
});
describe('source correctness and model boundaries',()=>{
 const observation={id:crypto.randomUUID(),tabId:'tab',capturedAt:new Date().toISOString(),url:origin+'/2025',title:'Report',text:'An exact report passage with sufficient context.',links:[],width:1200,height:800,image:'excluded'} satisfies Observation;
 const run={actions:0,calls:0,tokens:0,createdAt:Date.now(),expiresAt:Date.now()+100000,input:{mode:'model',question:'Find evidence',year:2025,sourceUrl:origin},evidence:[],issuerId:'us:0000000001',companyName:'Example'} as unknown as BrowserRun;
 it('captures exact offsets and leaves finance unverified',()=>{const e=captureEvidence(observation,observation.text,{issuerId:run.issuerId,year:2025,originalUrl:origin},'action');expect(e.start).toBe(0);expect(e.end).toBe(observation.text.length);expect(e.status).toBe('unreviewed_source_excerpt');expect(()=>captureEvidence(observation,'An invented quote with sufficient length',{issuerId:run.issuerId,year:2025,originalUrl:origin},'action')).toThrow();});
 it('does not send frame pixels to DOM-only model and rejects malicious tool output',async()=>{
   await expect(propose(run,observation,new AbortController().signal,async(_s,input)=>{expect(JSON.stringify(input)).not.toContain('excluded');return {value:{kind:'upload',secret:'x'},usage:{prompt_tokens:100,completion_tokens:10}};})).rejects.toThrow();
 });
 it('requires accounting and enforces budgets',async()=>{expect(()=>checkBudget({...run,actions:30})).toThrow();await expect(propose(run,observation,new AbortController().signal,async()=>({value:{kind:'finish'},usage:null}))).rejects.toThrow('model_usage_missing');});
});
