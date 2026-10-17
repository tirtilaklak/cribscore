import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchAlpacaDailyBars} from './alpaca-daily.mjs';
import {syntheticAlpacaOptions} from './alpaca-test-fixtures.mjs';
// Synthetic controlled clocks/promises only. No real waits or provider IO.
const bytes=new TextEncoder().encode('{"bars":{"TEST":[{"t":"2026-10-16T04:00:00Z","o":1,"h":2,"l":1,"c":2,"v":1}]},"next_page_token":null}');
const boundedTurns=async()=>{for(let i=0;i<100;i++)await Promise.resolve();return 'still_pending';};
async function controlled(fn) {
 const original=AbortSignal.timeout,own=Object.getOwnPropertyDescriptor(performance,'now'),controller=new AbortController();let elapsed=0;
 AbortSignal.timeout=()=>controller.signal;Object.defineProperty(performance,'now',{value:()=>elapsed,configurable:true});
 try{return await fn({controller,advance:value=>{elapsed=value;}});}finally{AbortSignal.timeout=original;if(own)Object.defineProperty(performance,'now',own);else delete performance.now;}
}
const response=reader=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>reader}});
for(const mode of ['abort','monotonic_elapsed'])test(`terminal done cannot bypass ${mode} deadline`,async()=>controlled(async({controller,advance})=>{
 let reads=0,cancels=0,releases=0;
 const result=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>response({async read(){if(reads++===0)return {done:false,value:bytes};if(mode==='abort')controller.abort();else advance(20000);return {done:true};},cancel(){cancels++;return new Promise(()=>{});},releaseLock(){releases++;}})});
 assert.equal(result.ok,false);assert.deepEqual(result.reasons,['response_deadline_exceeded']);assert.equal(result.series,null);assert.equal(cancels,1);assert.equal(releases,1);
}));
test('fetch ignoring abort cannot keep the collector pending',async()=>controlled(async({controller})=>{
 let calls=0;const pending=fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:()=>{calls++;queueMicrotask(()=>controller.abort());return new Promise(()=>{});}});
 const r=await Promise.race([pending,boundedTurns()]);assert.notEqual(r,'still_pending');assert.equal(calls,1);assert.deepEqual(r.reasons,['transport_deadline_exceeded']);assert.equal(r.capture,null);
}));
test('reader ignoring abort cannot keep the collector pending',async()=>controlled(async({controller})=>{
 let cancels=0;const pending=fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>response({read(){queueMicrotask(()=>controller.abort());return new Promise(()=>{});},cancel(){cancels++;return new Promise(()=>{});},releaseLock(){throw Error('pending read');}})});
 const r=await Promise.race([pending,boundedTurns()]);assert.notEqual(r,'still_pending');assert.deepEqual(r.reasons,['response_deadline_exceeded']);assert.equal(cancels,1);assert.equal(r.series,null);
}));
test('fetch/header elapsed time is part of the same deadline',async()=>controlled(async({advance})=>{
 let reads=0;const r=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>{advance(20000);return response({read(){reads++;return {done:true};}});}});
 assert.deepEqual(r.reasons,['transport_deadline_exceeded']);assert.equal(reads,0);
}));
test('repeated empty chunks stop before they can starve the abort timer',async()=>{
 let reads=0,cancels=0;const r=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>response({read:async()=>{reads++;if(reads>1000)throw Error('unbounded');return {done:false,value:new Uint8Array()};},cancel(){cancels++;return new Promise(()=>{});},releaseLock(){}})});
 assert.equal(reads,129);assert.equal(cancels,1);assert.deepEqual(r.reasons,['response_no_progress']);assert.equal(r.series,null);
});
test('bounded empty fragments and progress remain acceptable without changing exact bytes',async()=>{
 let reads=0;const r=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>response({read:async()=>++reads<=128?{done:false,value:new Uint8Array()}:reads===129?{done:false,value:bytes}:{done:true},releaseLock(){}})});
 assert.equal(r.ok,true);assert.equal(r.capture.responseByteLength,bytes.length);assert.equal(r.paperMarksEligible,false);
});

test('many one-byte fragments from reused storage retain the exact body without a fragment-count rejection',async()=>{
 const original=Buffer.from(JSON.stringify({...JSON.parse(new TextDecoder().decode(bytes)),note:'SYNTHETIC'+'.'.repeat(4096)})),reused=new Uint8Array(1);let offset=0;
 const r=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>response({read:async()=>{if(offset===original.length)return {done:true};reused[0]=original[offset++];return {done:false,value:reused};},releaseLock(){}})});
 assert.equal(r.ok,true);assert.equal(r.capture.responseByteLength,original.length);assert.equal(r.capture.responseSha256,createHash('sha256').update(original).digest('hex'));assert.equal(r.paperMarksEligible,false);
});
