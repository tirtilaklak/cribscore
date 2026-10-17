import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAlpacaDailyBars,fetchAlpacaDailyHistory} from './alpaca-daily.mjs';
import {syntheticAlpacaOptions} from './alpaca-test-fixtures.mjs';
// Controlled server-input and transport failures; every value is synthetic.
const privateText='SYNTHETIC-PRIVATE-DIAGNOSTIC';
const assertWithheld=result=>{assert.equal(result.ok,false);assert.equal(result.series,null);assert.equal(result.capture,null);assert.equal(result.paperMarksEligible,false);assert.equal(result.eligibleForRanking,false);assert.equal(result.automaticTrading,false);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC-PRIVATE-DIAGNOSTIC/);};
for(const member of ['request','security','authorization','credentials'])test(`uncloneable ${member} remains a redacted zero-fetch result`,async()=>{
  const options=syntheticAlpacaOptions();let calls=0;
  options[member].diagnostic=function diagnostic(){return 'SYNTHETIC-PRIVATE-DIAGNOSTIC';};
  const result=await fetchAlpacaDailyBars({...options,fetchImpl:async()=>{calls++;throw Error(privateText);}});
  assertWithheld(result);assert.deepEqual(result.reasons,['capture_context_invalid']);assert.equal(calls,0);
});
test('throwing server-record accessors cannot escape a raw error or start IO',async()=>{
  const options=syntheticAlpacaOptions();let calls=0;
  Object.defineProperty(options.security,'entityId',{enumerable:true,get(){throw Error(privateText);}});
  const result=await fetchAlpacaDailyBars({...options,fetchImpl:async()=>{calls++;throw Error(privateText);}});
  assertWithheld(result);assert.deepEqual(result.reasons,['capture_context_invalid']);assert.equal(calls,0);
});
test('history retains its existing safe context failure with no pages or requests',async()=>{
  const options=syntheticAlpacaOptions();let calls=0;options.security.diagnostic=()=>privateText;
  const result=await fetchAlpacaDailyHistory({...options,fetchImpl:async()=>{calls++;throw Error(privateText);}});
  assertWithheld(result);assert.deepEqual(result.reasons,['collection_context_invalid']);assert.deepEqual(result.pages,[]);assert.equal(calls,0);
});
test('validation and request construction use the same snapshotted feed value',async()=>{
  const options=syntheticAlpacaOptions();let reads=0,observedFeed;
  Object.defineProperty(options.request,'feed',{enumerable:true,get(){return ++reads===1?'sip':'iex';}});
  const result=await fetchAlpacaDailyBars({...options,fetchImpl:async url=>{
    observedFeed=new URL(url).searchParams.get('feed');
    return new Response('{"bars":{"TEST":[]},"next_page_token":null}',{headers:{'content-type':'application/json'}});
  }});
  assert.equal(observedFeed,'sip');assert.equal(reads,1);assert.equal(result.ok,true);
  assert.equal(result.capture.paperMarksEligible,false);assert.equal(result.series.source.feed,'sip');
});

const cases=[
  [{status:401,ok:false},'provider_authentication_failed','setup_required'],
  [{status:403,ok:false},'provider_permission_denied','setup_required'],
  [{status:429,ok:false},'rate_limited_no_retry','unavailable'],
  [{status:500,ok:false},'http_failed_no_retry','unavailable'],
  [{status:302,ok:false},'http_failed_no_retry','unavailable'],
  [{redirected:true},'http_failed_no_retry','unavailable'],
  [{url:'https://synthetic-wrong-origin.invalid/'},'response_url_mismatch','unavailable'],
  [{headers:new Headers({'content-type':'text/html'})},'content_type_invalid','unavailable'],
  [{headers:new Headers({'content-type':'application/json','content-length':'invalid'})},'response_too_large_or_invalid_length','unavailable'],
];
for(const [metadata,reason,status]of cases)test(`rejected response ${reason} cancels its unread body without opening a reader`,async()=>{
  let cancellations=0,reads=0;
  const result=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>({status:200,ok:true,headers:new Headers({'content-type':'application/json'}),...metadata,body:{cancel(){cancellations++;return Promise.resolve();},getReader(){reads++;throw Error(privateText);}}})});
  assertWithheld(result);assert.equal(result.status,status);assert.deepEqual(result.reasons,[reason]);assert.equal(cancellations,1);assert.equal(reads,0);
});

const settleTurns=async()=>{for(let i=0;i<40;i++)await Promise.resolve();return 'still_pending';};
for(const mode of ['hang','reject','throw'])test(`early-response cancellation that ${mode}s cannot delay or leak into the result`,async()=>{
  let cancellations=0;
  const result=await Promise.race([fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>({status:403,ok:false,body:{cancel(){cancellations++;if(mode==='throw')throw Error(privateText);return mode==='reject'?Promise.reject(Error(privateText)):new Promise(()=>{});}}})}),settleTurns()]);
  assert.notEqual(result,'still_pending');assertWithheld(result);assert.deepEqual(result.reasons,['provider_permission_denied']);assert.equal(cancellations,1);
});
