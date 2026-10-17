import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchTiingoEod,TIINGO_TERMS,TIINGO_TERMS_VERSION} from './tiingo-eod.mjs';
const at='2026-10-17T01:15:00.123Z',done='2026-10-17T01:15:00.456Z';
const authorization={provider:'tiingo',dataset:'eod',plan:'power',approved:true,reviewedAt:at,expiresAt:'2026-10-18T00:00:00Z',operations:['fetch'],reviewId:'SYNTHETIC-REVIEW',termsURL:TIINGO_TERMS,termsVersion:TIINGO_TERMS_VERSION,supplementalTermsReviewed:true,entitlement:{active:true,verifiedAt:at,expiresAt:'2026-10-18T00:00:00Z',evidenceId:'SYNTHETIC-NOT-REAL'}};
const bar={date:'2026-10-16T00:00:00.000Z',open:100,high:103,low:98,close:102,volume:1000000,adjOpen:100,adjHigh:103,adjLow:98,adjClose:102,adjVolume:1000000,divCash:0,splitFactor:1};
const request=()=>{let tick=0;return {ticker:'TEST',securityId:'SYNTHETIC-ID',startDate:'2026-07-01',endDate:'2026-10-16',token:'SYNTHETIC-NOT-A-SECRET',authorization,at,clock:()=>tick++?done:at};};
test('capture binds exact response bytes, including BOM/whitespace, rather than normalized JSON',async()=>{
 const bytes=new TextEncoder().encode('\ufeff '+JSON.stringify([bar])+'\n');
 const r=await fetchTiingoEod({...request(),fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'application/json'}})});
 assert.equal(r.ok,true);assert.equal(r.capture.responseSha256,createHash('sha256').update(bytes).digest('hex'));
 assert.notEqual(r.capture.responseSha256,createHash('sha256').update(JSON.stringify([bar])).digest('hex'));
 assert.equal(r.capture.responseByteLength,bytes.length);
});
test('capture preserves actual fractional clocks and unknown provider publication/ingestion',async()=>{
 const r=await fetchTiingoEod({...request(),fetchImpl:async()=>new Response(JSON.stringify([bar]),{headers:{'content-type':'application/json'}})});
 assert.equal(r.capture.requestStartedAt,at);assert.equal(r.capture.responseCompletedAt,done);
 assert.equal(r.data.observedAt,done);assert.equal(r.capture.ingestedAt,null);assert.equal(r.capture.providerPublishedAt,null);assert.equal(r.capture.correctionPossible,true);assert.equal(r.capture.eligibleForRanking,false);
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC-NOT-A-SECRET/);
});
test('streaming response is bounded without trusting content-length and is cancelled once',async()=>{
 let cancels=0;
 const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1_000_001));},cancel(){cancels++;}});
 const r=await fetchTiingoEod({...request(),fetchImpl:async()=>new Response(stream,{headers:{'content-type':'application/json'}})});
 assert.deepEqual(r.reasons,['response_too_large']);assert.equal(cancels,1);assert.equal(r.capture,undefined);
});
test('invalid UTF-8 does not become a replacement-character source record',async()=>{
 const r=await fetchTiingoEod({...request(),fetchImpl:async()=>new Response(new Uint8Array([0xff,0xfe]),{headers:{'content-type':'application/json'}})});
 assert.deepEqual(r.reasons,['response_json_invalid']);assert.equal(r.capture,undefined);
});
test('request carries bounded abort signal and no retry on a failed response stream',async()=>{
 let calls=0;
 const r=await fetchTiingoEod({...request(),fetchImpl:async(_url,init)=>{calls++;assert.ok(init.signal instanceof AbortSignal);return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({read:async()=>{throw new Error('SYNTHETIC-NOT-A-SECRET');}})}};}});
 assert.equal(calls,1);assert.deepEqual(r.reasons,['response_read_failed']);assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC-NOT-A-SECRET/);
});
test('missing response body cannot manufacture a successful captured record',async()=>{
 const r=await fetchTiingoEod({...request(),fetchImpl:async()=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:null})});
 assert.deepEqual(r.reasons,['response_body_unavailable']);assert.equal(r.capture,undefined);
});
