import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchAlpacaDailyHistory} from './alpaca-daily.mjs';
import {syntheticAlpacaOptions} from './alpaca-test-fixtures.mjs';

// Offline fixtures only; no provider IO, real securities or approved source use.
const page=(date,token)=>JSON.stringify({bars:{TEST:[{t:date+'T04:00:00Z',o:100,h:103,l:98,c:102,v:1000}]},next_page_token:token});
const first=page('2026-10-12','NEXT'),last=page('2026-10-13',null);
const options=()=>{const o=syntheticAlpacaOptions();o.request.start='2026-10-12T04:00:00Z';return o;};
function withheld(result,completedPages){
  assert.equal(result.ok,false);assert.deepEqual(result.reasons,['collection_byte_limit']);
  assert.deepEqual(result.pages,[]);assert.equal(result.series,null);assert.equal(result.capture,null);
  assert.deepEqual(result.pagination,{complete:false,completedPages});
  assert.equal(result.eligibleForRanking,false);assert.equal(result.paperMarksEligible,false);
  assert.equal(result.automaticTrading,false);
}

test('exhausted aggregate budget prevents another authenticated request',async()=>{
  let requests=0;
  const result=await fetchAlpacaDailyHistory({...options(),maxResponseBytes:Buffer.byteLength(first),fetchImpl:async()=>{
    requests++;return new Response(requests===1?first:last,{headers:{'content-type':'application/json'}});
  }});
  withheld(result,1);assert.equal(requests,1);
});

test('remaining aggregate budget stops a later stream before reading its full page',async()=>{
  let requests=0,reads=0,cancellations=0,releases=0;
  const bytes=new TextEncoder().encode(last);
  const result=await fetchAlpacaDailyHistory({...options(),maxResponseBytes:Buffer.byteLength(first)+1,fetchImpl:async()=>{
    if(++requests===1)return new Response(first,{headers:{'content-type':'application/json'}});
    return {status:200,ok:true,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({
      read:async()=>++reads===1?{done:false,value:bytes.subarray(0,2)}:reads===2?{done:false,value:bytes.subarray(2)}:{done:true},
      cancel:()=>{cancellations++;return new Promise(()=>{});},releaseLock:()=>{releases++;}
    })}};
  }});
  withheld(result,1);assert.equal(requests,2);assert.equal(reads,1);assert.equal(cancellations,1);assert.equal(releases,1);
});

test('declared response exceeding remaining aggregate budget is rejected before body reads',async()=>{
  let requests=0,readerCalls=0,cancellations=0;
  const result=await fetchAlpacaDailyHistory({...options(),maxResponseBytes:Buffer.byteLength(first)+1,fetchImpl:async()=>{
    if(++requests===1)return new Response(first,{headers:{'content-type':'application/json'}});
    return {status:200,ok:true,headers:new Headers({'content-type':'application/json','content-length':String(Buffer.byteLength(last))}),body:{
      cancel:()=>{cancellations++;return Promise.reject(Error('synthetic cancellation failure'));},
      getReader:()=>{readerCalls++;let done=false;return {read:async()=>done?{done:true}:(done=true,{done:false,value:new TextEncoder().encode(last)}),releaseLock:()=>{}};}
    }};
  }});
  withheld(result,1);assert.equal(requests,2);assert.equal(readerCalls,0);assert.equal(cancellations,1);
});

test('exact aggregate boundary accepts complete pages and preserves individual raw-byte hashes',async()=>{
  let requests=0;
  const bodies=[first,last];
  const result=await fetchAlpacaDailyHistory({...options(),maxResponseBytes:bodies.reduce((sum,body)=>sum+Buffer.byteLength(body),0),fetchImpl:async()=>new Response(bodies[requests++],{headers:{'content-type':'application/json'}})});
  assert.equal(result.ok,true);assert.equal(requests,2);assert.equal(result.status,'capture_set_unvalidated');
  assert.equal(result.responseByteLength,Buffer.byteLength(first)+Buffer.byteLength(last));
  assert.equal(result.series,null);assert.equal(result.capture,null);assert.equal(result.requiresCaptureSetReview,true);
  for(const [index,item]of result.pages.entries())assert.equal(item.capture.responseSha256,createHash('sha256').update(bodies[index]).digest('hex'));
  assert.equal(result.eligibleForRanking,false);assert.equal(result.paperMarksEligible,false);
});

test('first page also obeys a smaller collection cap without reading to completion',async()=>{
  let reads=0,cancellations=0;
  const result=await fetchAlpacaDailyHistory({...options(),maxResponseBytes:1,fetchImpl:async()=>({status:200,ok:true,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({
    read:async()=>++reads===1?{done:false,value:new TextEncoder().encode(last)}:{done:true},cancel:()=>{cancellations++;},releaseLock:()=>{}
  })}})});
  withheld(result,0);assert.equal(reads,1);assert.equal(cancellations,1);
});
