import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAlpacaDailyBars,fetchAlpacaDailyHistory} from './alpaca-daily.mjs';
import {syntheticAlpacaOptions} from './alpaca-test-fixtures.mjs';
// SYNTHETIC ONLY. Controlled promises prove prompt rejection without timers,
// network, large files or waiting for the collector's real abort deadline.
const boundedTurns=async()=>{for(let i=0;i<40;i++)await Promise.resolve();return 'still_pending';};
const options=()=>({...syntheticAlpacaOptions(),clock:()=> '2026-10-17T12:00:00.456Z'});
for(const mode of ['never_settles','rejects','throws'])test(`oversize response returns failure without awaiting cancellation that ${mode}`,async()=>{
 let cancels=0,calls=0;
 const reply=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(2_000_001));},cancel(){cancels++;if(mode==='throws')throw Error('SYNTHETIC-SECRET-NOT-REAL');return mode==='rejects'?Promise.reject(Error('SYNTHETIC-SECRET-NOT-REAL')):new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
 const pending=fetchAlpacaDailyBars({...options(),fetchImpl:async()=>{calls++;return reply;}}),result=await Promise.race([pending,boundedTurns()]);
 assert.notEqual(result,'still_pending');assert.equal(cancels,1);assert.equal(calls,1);assert.equal(result.ok,false);assert.deepEqual(result.reasons,['response_too_large']);assert.equal(result.series,null);assert.equal(result.capture,null);assert.equal(result.paperMarksEligible,false);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC-SECRET/);
});
test('an oversized later history page promptly discards prior captures despite stalled cancellation',async()=>{
 let calls=0,cancels=0,secondRequest;const entered=new Promise(resolve=>{secondRequest=resolve;});const page={bars:{TEST:[{t:'2026-10-16T04:00:00Z',o:1,h:2,l:1,c:2,v:1}]},next_page_token:'SYNTHETIC-NEXT'};
 const pending=fetchAlpacaDailyHistory({...options(),fetchImpl:async()=>{if(++calls===1)return new Response(JSON.stringify(page),{headers:{'content-type':'application/json'}});secondRequest();return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(2_000_001));},cancel(){cancels++;return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});}});
 await entered;const result=await Promise.race([pending,boundedTurns()]);
 assert.notEqual(result,'still_pending');assert.equal(calls,2);assert.equal(cancels,1);assert.deepEqual(result.pages,[]);assert.equal(result.pagination.completedPages,1);assert.equal(result.pagination.complete,false);assert.equal(result.series,null);assert.equal(result.capture,null);assert.deepEqual(result.reasons,['response_too_large']);
});
