import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchAlpacaDailyBars,inspectAlpacaSetup,inspectAlpacaAuthorization,ALPACA_TERMS,ALPACA_BARS_ENDPOINT} from './alpaca-daily.mjs';

import {syntheticAlpacaOptions,at,done} from './alpaca-test-fixtures.mjs';

const bar={t:'2026-10-16T04:00:00Z',o:100.01,h:103.02,l:98.01,c:102.12,v:1234567,n:100,vw:101.25};
const payload=()=>({bars:{TEST:[{...bar}]},next_page_token:null});
const response=(body=payload(),init={})=>new Response(typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body),{headers:{'content-type':'application/json'},...init});
async function run(edit,body=payload()) {const options=syntheticAlpacaOptions();edit?.(options);let calls=0;const result=await fetchAlpacaDailyBars({...options,fetchImpl:async()=>{calls++;return response(body);}});return {result,calls};}

 test('missing setup is explicit, reports both missing inputs, and performs zero IO',async()=>{
  let calls=0;const result=await fetchAlpacaDailyBars({at,clock:()=>at,fetchImpl:async()=>{calls++;throw Error();}});
  assert.equal(result.status,'setup_required');assert.deepEqual(result.reasons,['credentials_missing_or_invalid','rights_review_missing']);assert.equal(calls,0);assert.equal(result.series,null);assert.equal(result.paperMarksEligible,false);
 });
 test('configured setup is not a verified connection and cannot grant display or retention',()=>{
  const options=syntheticAlpacaOptions();const setup=inspectAlpacaSetup(options);
  assert.equal(setup.status,'configured_unverified');assert.equal(setup.connectionVerified,false);
  for(const operation of ['persist_source','display_source','display_derived','paper_marks'])assert.deepEqual(inspectAlpacaAuthorization(options.authorization,{at,operation}).reasons,['operation_not_supported']);
 });
 for (const [name,edit,reason] of [
  ['wrong provider',o=>o.authorization.provider='other','rights_review_missing'],
  ['wrong feed',o=>o.authorization.feed='iex','rights_review_missing'],
  ['expired review',o=>o.authorization.expiresAt=at,'rights_review_stale'],
  ['future review',o=>o.authorization.reviewedAt=done,'rights_review_stale'],
  ['normalize absent',o=>o.authorization.operations=['fetch'],'operation_not_authorized'],
  ['terms evidence absent',o=>delete o.authorization.terms.sha256,'terms_review_missing'],
  ['terms from future',o=>o.authorization.terms.reviewedAt=done,'terms_review_missing'],
  ['source rights absent',o=>delete o.authorization.sourceRights,'source_rights_review_missing'],
  ['source rights expired',o=>o.authorization.sourceRights.expiresAt=at,'source_rights_review_missing'],
  ['exchange review absent',o=>o.authorization.sourceRights.providerAndExchangeTermsReviewed=false,'source_rights_review_missing'],
  ['account not entitled',o=>o.authorization.entitlement.active=false,'account_entitlement_missing'],
  ['audience changed',o=>o.authorization.audience='public','audience_not_authorized'],
  ['credential injection',o=>o.credentials.keyId+='\r\nX-Test:bad','credentials_missing_or_invalid'],
 ]) test(`authorization boundary: ${name}`,async()=>{const {result,calls}=await run(edit);assert.ok(result.reasons.includes(reason));assert.equal(calls,0);assert.equal(result.series,null);});
 for(const [name,edit,reason] of [
  ['caller URL',o=>o.request.url='https://other.invalid/','request_scope_invalid'],
  ['latest endpoint smuggling',o=>o.request.endpoint='/latest','request_scope_invalid'],
  ['IEX instead of SIP',o=>o.request.feed='iex','request_scope_invalid'],
  ['adjusted prices',o=>o.request.adjustment='all','request_scope_invalid'],
  ['multiple securities',o=>o.request.symbols.push('QQQ'),'request_scope_invalid'],
  ['missing symbol asof',o=>delete o.request.asof,'request_scope_invalid'],
  ['invalid calendar date',o=>o.request.asof='2026-02-30','request_scope_invalid'],
  ['permanent ID absent',o=>delete o.security.entityId,'security_mapping_invalid'],
  ['mismatched security',o=>o.security.symbol='QQQ','security_mapping_invalid'],
  ['URL symbol injection',o=>o.request.symbols=['TEST?token=x'],'request_scope_invalid'],
  ['page token empty',o=>o.request.pageToken='','pagination_token_invalid'],
  ['page token oversize',o=>o.request.pageToken='x'.repeat(2049),'pagination_token_invalid'],
  ['SIP end too recent',o=>o.request.end='2026-10-17T11:59:00Z','historical_end_too_recent'],
  ['same-day provisional daily bar',o=>o.request.end='2026-10-17T05:00:00Z','completed_new_york_day_required'],
 ])test(`request boundary: ${name}`,async()=>{const {result,calls}=await run(edit);assert.deepEqual(result.reasons,[reason]);assert.equal(calls,0);});
 test('actual start time wins over caller time and rejects malformed or reversed clocks',async()=>{
  for(const clock of [()=>{throw Error('secret');},()=> '2026-02-30T00:00:00Z',()=> '2026-10-17T11:59:59Z']){const {result,calls}=await run(o=>o.clock=clock);assert.deepEqual(result.reasons,['operation_clock_invalid']);assert.equal(calls,0);}
 });
 test('capture sends header credentials to fixed data endpoint with no redirect, cookies or retry',async()=>{
  const options=syntheticAlpacaOptions();let calls=0;
  const result=await fetchAlpacaDailyBars({...options,fetchImpl:async(url,init)=>{
   calls++;const u=new URL(url);assert.equal(u.origin+u.pathname,ALPACA_BARS_ENDPOINT);assert.equal(u.searchParams.get('feed'),'sip');assert.equal(u.searchParams.get('limit'),'5000');assert.equal(u.searchParams.get('sort'),'asc');assert.equal(init.headers['APCA-API-KEY-ID'],options.credentials.keyId);assert.equal(init.headers['APCA-API-SECRET-KEY'],options.credentials.secretKey);assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.credentials,'omit');assert.ok(init.signal instanceof AbortSignal);return response();}});
  assert.equal(calls,1);assert.equal(result.ok,true);assert.equal(result.status,'captured_unvalidated');assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC-KEY-ID-NOT-REAL|SYNTHETIC-SECRET-NOT-REAL/);
 });
 test('exact source byte hash, clocks and unknown independent evidence survive normalization',async()=>{
  const bytes=new TextEncoder().encode('\ufeff '+JSON.stringify(payload())+'\n');const {result}=await run(null,bytes);
  assert.equal(result.ok,true);assert.equal(result.capture.responseSha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.capture.responseByteLength,bytes.length);assert.equal(result.capture.requestStartedAt,at);assert.equal(result.capture.responseCompletedAt,done);assert.equal(result.capture.providerPublishedAt,null);assert.equal(result.capture.ingestedAt,null);assert.equal(result.capture.identityReconciled,false);assert.equal(result.capture.corporateActionCoverage,'unverified');
  assert.equal(result.series.bars[0].providerTimestamp,bar.t);assert.equal(result.series.bars[0].availableAt,done);assert.equal(result.series.source.publishedAt,null);assert.equal(result.series.source.declaredDelayMinutes,15);assert.equal(result.series.source.volumeSession,'daily_including_extended_hours');assert.equal(result.series.actions.status,'unknown');assert.equal(result.paperMarksEligible,false);assert.equal(result.eligibleForRanking,false);assert.equal(result.accessVerified,false);
 });
 test('numeric OHLC lexemes retain exact decimals beyond binary floating point precision',async()=>{
  const body='{"bars":{"TEST":[{"t":"2026-10-16T04:00:00Z","o":99999999999.123456,"h":99999999999.123457,"l":99999999999.123455,"c":99999999999.123456,"v":100}]},"next_page_token":null}';
  const {result}=await run(null,body);assert.equal(result.ok,true);assert.equal(result.series.bars[0].decimals.open,'99999999999.123456');assert.equal(result.series.bars[0].decimals.high,'99999999999.123457');
 });
 test('missing/null/continuation token have distinct completeness; a suffix cannot certify history',async()=>{
  const full=await run();assert.equal(full.result.pagination.complete,true);
  const missing=payload();delete missing.next_page_token;assert.equal((await run(null,missing)).result.pagination.complete,false);
  const more=payload();more.next_page_token='SYNTHETIC-PAGE-2';assert.equal((await run(null,more)).result.pagination.complete,false);
  assert.equal((await run(o=>o.request.pageToken='SYNTHETIC-PAGE-2')).result.pagination.complete,false);
 });
 test('continuation token is bounded and cannot reflect credentials into the result',async()=>{
  for(const token of ['x'.repeat(2049),'x\n',123,'SYNTHETIC-SECRET-NOT-REAL']){const body=payload();body.next_page_token=token;const {result}=await run(null,body);assert.equal(result.ok,false);assert.equal(result.series,null);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC-SECRET-NOT-REAL/);}
 });
 test('no data is explicit empty context, never a fabricated price',async()=>{
  const {result}=await run(null,{bars:{},next_page_token:null});assert.equal(result.ok,true);assert.deepEqual(result.series.bars,[]);assert.ok(result.warnings.includes('bars_missing'));assert.equal(result.paperMarksEligible,false);
 });
 for(const [name,change] of [
  ['wrong symbol',b=>b.bars={OTHER:[bar]}],['outside request',b=>b.bars.TEST[0].t='2026-10-15T04:00:00Z'],['not New York midnight',b=>b.bars.TEST[0].t='2026-10-16T13:30:00Z'],['duplicate session',b=>b.bars.TEST.push({...bar})],['negative volume',b=>b.bars.TEST[0].v=-1],['bad OHLC',b=>b.bars.TEST[0].h=1]
 ])test(`response validation: ${name}`,async()=>{const body=payload();change(body);const {result}=await run(null,body);assert.equal(result.ok,false);assert.equal(result.capture,null);assert.equal(result.series,null);});
 test('ambiguous JSON, deep nesting, invalid UTF-8, exponent/overprecision monetary tokens fail closed',async()=>{
  for(const body of ['{"bars":{},"bars":{"TEST":[]},"next_page_token":null}','{"bars":{},"\\u0062ars":{},"next_page_token":null}','['.repeat(34)+'0'+']'.repeat(34),new Uint8Array([0xff,0xfe]),JSON.stringify(payload()).replace('100.01','1e2'),JSON.stringify(payload()).replace('100.01','100.012345678901234')]){const {result}=await run(null,body);assert.equal(result.ok,false);assert.equal(result.capture,null);}
 });
 test('HTTP 401/403/429/500, redirects, transport errors and wrong origin do not retry or return source data',async()=>{
  for(const [status,reason] of [[401,'provider_authentication_failed'],[403,'provider_permission_denied'],[429,'rate_limited_no_retry'],[500,'http_failed_no_retry'],[302,'http_failed_no_retry']]){
   let calls=0;const result=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>{calls++;return response('SYNTHETIC-SECRET-NOT-REAL',{status});}});assert.deepEqual(result.reasons,[reason]);assert.equal(calls,1);assert.equal(result.series,null);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC-SECRET-NOT-REAL/);
  }
  let calls=0;const failure=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>{calls++;throw Error('SYNTHETIC-SECRET-NOT-REAL');}});assert.deepEqual(failure.reasons,['transport_failed_no_retry']);assert.equal(calls,1);
  const mismatch=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>({ok:true,status:200,url:'https://evil.invalid/'})});assert.deepEqual(mismatch.reasons,['response_url_mismatch']);
 });
 test('response body size is enforced without Content-Length and cancels oversized streams',async()=>{
  let cancels=0;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(1_000_001));},cancel(){cancels++;}});
  const result=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>new Response(stream,{headers:{'content-type':'application/json'}})});assert.deepEqual(result.reasons,['response_too_large']);assert.equal(cancels,1);
 });
 test('invalid content type, declared size, missing body and stream read failure remain unavailable',async()=>{
  for(const [fetchImpl,reason] of [
   [async()=>response('{}',{headers:{'content-type':'text/html'}}),'content_type_invalid'],
   [async()=>response('{}',{headers:{'content-type':'application/json','content-length':'2000001'}}),'response_too_large_or_invalid_length'],
   [async()=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:null}),'response_body_unavailable'],
   [async()=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({read:async()=>{throw Error('SYNTHETIC-SECRET-NOT-REAL');}})}}),'response_read_failed'],
  ]){const result=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl});assert.deepEqual(result.reasons,[reason]);assert.equal(result.capture,null);}
 });
 test('authorization expiring in flight and reversed observation clock discard the response',async()=>{
  const expired=await run(o=>o.authorization.expiresAt='2026-10-17T12:00:00.300Z');assert.deepEqual(expired.result.reasons,['rights_review_stale']);assert.equal(expired.calls,1);assert.equal(expired.result.series,null);
  let tick=0;const reversed=await run(o=>o.clock=()=>tick++?'2026-10-17T11:59:59Z':at);assert.deepEqual(reversed.result.reasons,['observation_clock_invalid']);
 });
 test('in-flight caller mutations cannot change captured request/security/review binding',async()=>{
  const options=syntheticAlpacaOptions();const result=await fetchAlpacaDailyBars({...options,fetchImpl:async()=>{options.request.symbols[0]='OTHER';options.security.entityId='OTHER-ID';options.authorization.reviewId='OTHER-REVIEW';return response();}});
  assert.equal(result.ok,true);assert.equal(result.series.symbol,'TEST');assert.equal(result.series.entityId,'SYNTHETIC-PERMANENT-ID');assert.equal(result.capture.authorizationReviewId,'SYNTHETIC-NOT-PERMISSION');
 });
test('same-day holdout uses New York date across UTC midnight and SIP 15-minute boundary',async()=>{
 const make=stamp=>{const o=syntheticAlpacaOptions();o.at=stamp;o.clock=()=>stamp;o.authorization.reviewedAt='2026-10-16T00:00:00Z';o.authorization.terms.reviewedAt='2026-10-16T00:00:00Z';o.authorization.sourceRights.reviewedAt='2026-10-16T00:00:00Z';o.authorization.entitlement.reviewedAt='2026-10-16T00:00:00Z';return o;};
 let calls=0;const before=make('2026-10-17T03:30:00Z');before.request.end='2026-10-17T03:00:00Z';const blocked=await fetchAlpacaDailyBars({...before,fetchImpl:async()=>{calls++;return response();}});assert.deepEqual(blocked.reasons,['completed_new_york_day_required']);assert.equal(calls,0);
 const allowed=make('2026-10-17T04:14:59Z');const result=await fetchAlpacaDailyBars({...allowed,fetchImpl:async()=>{calls++;return response();}});assert.equal(result.ok,true);assert.equal(calls,1);
 const tooRecent=make('2026-10-17T04:14:58.999Z');assert.deepEqual((await fetchAlpacaDailyBars({...tooRecent,fetchImpl:async()=>{calls++;return response();}})).reasons,['historical_end_too_recent']);assert.equal(calls,1);
});
test('future symbol mapping and credential-bearing caller page token never transmit',async()=>{
 for(const [edit,reason] of [[o=>o.request.asof='2026-10-18','symbol_asof_in_future'],[o=>o.request.pageToken=o.credentials.secretKey,'pagination_token_invalid']]){const {result,calls}=await run(edit);assert.deepEqual(result.reasons,[reason]);assert.equal(calls,0);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC-SECRET-NOT-REAL/);}
});
test('fragmented UTF-8 is hashed from exact bytes and valid metadata does not corrupt parsing',async()=>{
 const body=JSON.stringify({...payload(),note:'SYNTHETIC €–𝄞'}), bytes=new TextEncoder().encode(body);let offset=0;
 const stream=new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,++offset));}});
 const result=await fetchAlpacaDailyBars({...syntheticAlpacaOptions(),fetchImpl:async()=>new Response(stream,{headers:{'content-type':'application/json'}})});assert.equal(result.ok,true);assert.equal(result.capture.responseSha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.capture.responseByteLength,bytes.length);
});
test('missing volume remains partial; a current retrieval cannot fill absent bars or prove freshness',async()=>{
 const body=payload();delete body.bars.TEST[0].v;const {result}=await run(null,body);assert.equal(result.ok,true);assert.equal(result.series.bars[0].volume,null);assert.ok(result.warnings.includes('volume_missing'));assert.equal(result.capture.calendarCoverage,'unverified');assert.equal(result.eligibleForRanking,false);
});
