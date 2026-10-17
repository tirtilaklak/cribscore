import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchAlpacaDailyBars} from './alpaca-daily.mjs';
import {parseAlpacaJSON} from './alpaca-json.mjs';
import {syntheticAlpacaOptions} from './alpaca-test-fixtures.mjs';
// Every payload, clock, credential and rights attestation in this file is synthetic.
const payload=v=>`{"bars":{"TEST":[{"t":"2026-10-16T04:00:00Z","o":100.01,"h":103.02,"l":98.01,"c":102.12${v===undefined?'':',"v":'+v}}]},"next_page_token":null}`;
const run=async raw=>fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>new Response(raw,{headers:{'content-type':'application/json'}})});
for(const raw of ['9007199254740991.1','9007199254740992','-1e-400','1e-400','-0','-1','1.0','1e3','1E+3'])test(`volume token ${raw} cannot round into integer evidence`,async()=>{
 assert.throws(()=>parseAlpacaJSON(payload(raw)),/response_json_invalid/);
 const result=await run(payload(raw));assert.equal(result.ok,false);assert.equal(result.series,null);assert.deepEqual(result.reasons,['response_json_invalid']);
});
for(const raw of ['0','1','9007199254740991'])test(`exact integer volume ${raw} survives normalization`,async()=>{
 const result=await run(payload(raw));assert.equal(result.ok,true);assert.equal(result.series.bars[0].volume,Number(raw));assert.equal(result.paperMarksEligible,false);
});
for(const raw of ['null',undefined])test(`volume ${raw} stays unknown`,async()=>{
 const result=await run(payload(raw));assert.equal(result.ok,true);assert.equal(result.series.bars[0].volume,null);
});
test('received bytes are copied before the next read can reuse a Node Buffer',async()=>{
 const original=payload('1'),reused=Buffer.from(original);let reads=0;
 const result=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({async read(){if(reads++===0)return {done:false,value:reused};reused[original.indexOf('100.01')+5]=57;return {done:true};}})}})});
 assert.equal(result.ok,true);assert.equal(result.series.bars[0].decimals.open,'100.01');assert.equal(result.capture.responseSha256,createHash('sha256').update(original).digest('hex'));assert.equal(result.capture.collectorVersion,'alpaca_daily_capture_v1.1');assert.equal(reads,2);
});
test('reused sliced Uint8Array chunks retain exact read order and byte offsets',async()=>{
 const original=Buffer.from(payload('1')),backing=new Uint8Array(32);let cursor=0;
 const result=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({async read(){backing.fill(0);if(cursor===original.length)return {done:true};const count=Math.min(23,original.length-cursor);backing.set(original.subarray(cursor,cursor+count),5);cursor+=count;return {done:false,value:backing.subarray(5,5+count)};}})}})});
 assert.equal(result.ok,true);assert.equal(result.capture.responseSha256,createHash('sha256').update(original).digest('hex'));assert.equal(result.series.bars[0].decimals.open,'100.01');
});
