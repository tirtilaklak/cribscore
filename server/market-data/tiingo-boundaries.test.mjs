import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchTiingoEod,inspectFeedAuthorization,TIINGO_TERMS,TIINGO_TERMS_VERSION} from './tiingo-eod.mjs';
const at='2026-10-17T01:15:00Z';
const authorization={provider:'tiingo',dataset:'eod',plan:'power',approved:true,reviewedAt:at,expiresAt:'2026-10-18T00:00:00Z',operations:['fetch','persist_source'],reviewId:'SYNTHETIC',termsURL:TIINGO_TERMS,termsVersion:TIINGO_TERMS_VERSION,supplementalTermsReviewed:true,entitlement:{active:true,verifiedAt:at,expiresAt:'2026-10-18T00:00:00Z',evidenceId:'SYNTHETIC-NOT-AN-ENTITLEMENT'}};
const bar={date:'2026-10-16T00:00:00.000Z',open:100,high:103,low:98,close:102,volume:1000000,adjOpen:100,adjHigh:103,adjLow:98,adjClose:102,adjVolume:1000000,divCash:0,splitFactor:1};
const request={ticker:'TEST',securityId:'SYNTHETIC-ID',startDate:'2026-07-01',endDate:'2026-10-16',token:'SYNTHETIC-NOT-A-SECRET',authorization,at,clock:()=>at};
const response=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});

test('an authorization expired at the actual operation clock cannot send a request',async()=>{
  let calls=0;
  const result=await fetchTiingoEod({...request,clock:()=>authorization.expiresAt,fetchImpl:async()=>{calls++;return response([bar]);}});
  assert.equal(result.ok,false,'post-fetch check does reject the expired authorization');
  assert.equal(calls,0,JSON.stringify({calls,reasons:result.reasons}));
});

test('impossible request dates return a blocked result instead of throwing',async()=>{
  let calls=0;
  await assert.doesNotReject(async()=>{
    const result=await fetchTiingoEod({...request,startDate:'2026-99-01',fetchImpl:async()=>{calls++;return response([bar]);}});
    assert.equal(result.ok,false);
  });
  assert.equal(calls,0);
});

test('authorization timestamps cannot silently roll invalid dates into a different day',()=>{
  const result=inspectFeedAuthorization({...authorization,reviewedAt:'2026-02-01T00:00:00Z',expiresAt:'2026-02-30T00:00:00Z'},{at:'2026-03-01T00:00:00Z'});
  assert.equal(result.ok,false,JSON.stringify(result));
});

test('a successful response cannot retain bars outside the requested interval',async()=>{
  for(const date of ['2026-06-30T00:00:00.000Z','2026-10-17T00:00:00.000Z']){
    const result=await fetchTiingoEod({...request,fetchImpl:async()=>response([{...bar,date}])});
    assert.equal(result.ok,false,JSON.stringify({date,result}));
  }
});

test('transport errors and explicit redirects neither retry nor expose the header token',async()=>{
  let calls=0;
  const failure=await fetchTiingoEod({...request,fetchImpl:async(url,init)=>{calls++;assert.equal(init.redirect,'error');assert.equal(new URL(url).hostname,'api.tiingo.com');throw new Error(request.token);}});
  assert.equal(calls,1);assert.equal(failure.ok,false);assert.ok(!JSON.stringify(failure).includes(request.token));
  calls=0;
  const redirect=await fetchTiingoEod({...request,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://example.invalid/'}});}});
  assert.equal(calls,1);assert.equal(redirect.ok,false);assert.ok(!JSON.stringify(redirect).includes(request.token));
});
