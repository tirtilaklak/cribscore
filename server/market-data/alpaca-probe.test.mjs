import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleMarketDataProbeRequest,probeWindow,PROBE_SYMBOL,PROBE_RATE_LIMIT_MS} from './alpaca-probe.mjs';
import {handleMarketDataSetupRequest} from './setup-status.mjs';
import {validateAlpacaDailyRequest} from './alpaca-daily.mjs';
import {syntheticAlpacaOptions,at} from './alpaca-test-fixtures.mjs';

// SYNTHETIC ONLY: no key, review, price or provider response here is real.
const origin='https://desk.invalid',secret='SYNTHETIC-SECRET-NOT-REAL',keyId='SYNTHETIC-KEY-ID-NOT-REAL',review='SYNTHETIC-NOT-PERMISSION';
const configured=()=>({ALPACA_API_KEY_ID:keyId,ALPACA_API_SECRET_KEY:secret,ALPACA_DATA_AUTHORIZATION_JSON:JSON.stringify(syntheticAlpacaOptions().authorization)});
const probe=({method='POST',headers={},body='{}',path='/api/market-data/probe',init={}}={})=>{
  const merged={'oai-authenticated-user-id':'synthetic-owner',origin,'content-type':'application/json',...headers};
  for(const key of Object.keys(merged))if(merged[key]===undefined)delete merged[key];
  return new Request(origin+path,{method,headers:merged,...(['GET','HEAD'].includes(method)?{}:{body}),...init});
};
const payload=()=>({bars:{SPY:[{t:'2026-10-16T04:00:00Z',o:100.01,h:103.02,l:98.01,c:102.12,v:1234567}]},next_page_token:null});
const reply=(body=payload(),init={})=>new Response(typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body),{headers:{'content-type':'application/json'},...init});
const network=()=>{let calls=0;return {fetchImpl:async()=>{calls++;throw Error('No network allowed');},calls:()=>calls};};
async function run(request,env,options={}) {
  const response=await handleMarketDataProbeRequest(request,env,{now:()=>at,recent:new Map(),fetchImpl:network().fetchImpl,...options});
  const text=await response.text();
  return {status:response.status,headers:response.headers,text,body:JSON.parse(text)};
}
const security={symbol:PROBE_SYMBOL,originalSymbol:PROBE_SYMBOL,entityId:'probe-unreconciled',currency:'USD',exchange:'unverified',sessionTimezone:'America/New_York'};

test('probe window is the most recent completed New York day the transport accepts',()=>{
  for (const [when,session,start,end] of [
    ['2026-10-18T21:00:00Z','2026-10-17','2026-10-17T04:00:00Z','2026-10-18T03:59:59Z'], // Sunday afternoon in New York
    ['2026-10-19T04:05:00Z','2026-10-17','2026-10-17T04:00:00Z','2026-10-18T03:59:59Z'], // 00:05 Monday: Sunday's last second is under 15 minutes old
    ['2026-10-19T04:14:59Z','2026-10-18','2026-10-18T04:00:00Z','2026-10-19T03:59:59Z'], // exactly 15 minutes: Sunday is accepted
    ['2026-11-02T12:00:00Z','2026-11-01','2026-11-01T04:00:00Z','2026-11-02T04:59:59Z'], // the 25-hour day when daylight time ends
    ['2026-03-09T12:00:00Z','2026-03-08','2026-03-08T05:00:00Z','2026-03-09T03:59:59Z'], // the 23-hour day when daylight time starts
  ]) {
    const window=probeWindow(when);
    assert.deepEqual([window.session,window.request.start,window.request.end],[session,start,end],when);
    assert.deepEqual(window.request.symbols,[PROBE_SYMBOL]);assert.equal(window.request.asof,session);assert.equal(window.request.feed,'sip');assert.equal(window.request.adjustment,'raw');
    assert.equal(validateAlpacaDailyRequest(window.request,security,'alpaca-connection-probe',when),null,when);
  }
});

test('probe is owner-only, POST-only, same-origin JSON and takes no parameters',async()=>{
  const expect=async(request,status,error)=>{const net=network();const result=await run(request,configured(),{fetchImpl:net.fetchImpl});assert.equal(result.status,status,error);assert.deepEqual(result.body,{ok:false,error});assert.equal(net.calls(),0,error);return result;};
  await expect(probe({headers:{'oai-authenticated-user-id':undefined}}),401,'authentication_required');
  await expect(probe({headers:{'oai-authenticated-user-id':'x'.repeat(513)}}),401,'authentication_required');
  const get=await expect(probe({method:'GET'}),405,'method_not_allowed');assert.equal(get.headers.get('allow'),'POST');
  await expect(probe({headers:{origin:'https://other.invalid'}}),403,'same_origin_required');
  await expect(probe({headers:{origin:undefined}}),403,'same_origin_required');
  await expect(probe({headers:{'sec-fetch-site':'cross-site'}}),403,'same_origin_required');
  await expect(probe({headers:{'content-type':'text/plain'}}),415,'json_content_type_required');
  await expect(probe({path:'/api/market-data/probe?symbol=X'}),400,'probe_parameters_not_supported');
  await expect(probe({headers:{'content-length':'4097'}}),413,'probe_request_too_large');
  await expect(probe({path:'/api/market-data/other'}),404,'not_found');
});

test('missing setup is setup_required with bounded reasons and no network',async()=>{
  const net=network();
  const {status,headers,body}=await run(probe(),{},{fetchImpl:net.fetchImpl});
  assert.equal(status,200);assert.equal(headers.get('cache-control'),'private, no-store');assert.equal(net.calls(),0);
  assert.deepEqual(body,{ok:true,checkedAt:at,provider:{id:'alpaca',probe:'setup_required',httpStatus:null,reasons:['credentials_missing_or_invalid','rights_review_missing'],barsReturned:null,responseSha256:null}});
  const partial=await run(probe(),{ALPACA_API_KEY_ID:keyId,ALPACA_API_SECRET_KEY:secret,ALPACA_DATA_AUTHORIZATION_JSON:JSON.stringify({reviewId:review})},{fetchImpl:net.fetchImpl});
  assert.equal(partial.body.provider.probe,'setup_required');assert.equal(net.calls(),0);
  for(const leak of [secret,keyId,review])assert.ok(!partial.text.includes(leak),leak);
});

test('success reports bars and the exact response hash; the body is ignored and nothing is stored or enabled',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify(payload()));let calls=0,seen;
  const fetchImpl=async(target,init)=>{calls++;seen={url:new URL(target),init};return reply(bytes);};
  const env=configured();
  const untrusted=JSON.stringify({symbols:['EVIL'],credentials:{keyId:'x',secretKey:'y'},end:'2030-01-01T00:00:00Z'});
  const {status,text,body}=await run(probe({body:untrusted}),env,{fetchImpl});
  assert.equal(status,200);assert.equal(calls,1);
  assert.equal(seen.url.origin+seen.url.pathname,'https://data.alpaca.markets/v2/stocks/bars');assert.equal(seen.url.searchParams.get('symbols'),'SPY');
  assert.equal(seen.url.searchParams.get('start'),'2026-10-16T04:00:00Z');assert.equal(seen.url.searchParams.get('end'),'2026-10-17T03:59:59Z');
  assert.equal(seen.init.headers['APCA-API-KEY-ID'],keyId);assert.equal(seen.init.headers['APCA-API-SECRET-KEY'],secret);assert.ok(!seen.url.href.includes(secret));assert.ok(seen.init.signal instanceof AbortSignal);
  assert.deepEqual(body,{ok:true,checkedAt:at,provider:{id:'alpaca',probe:'succeeded',httpStatus:200,reasons:[],barsReturned:1,responseSha256:createHash('sha256').update(bytes).digest('hex')}});
  for(const leak of [secret,keyId,review,'100.01','"bars"','EVIL'])assert.ok(!text.includes(leak),leak);
  const setup=await handleMarketDataSetupRequest(new Request(origin+'/api/market-data/setup',{headers:{'oai-authenticated-user-id':'synthetic-owner'}}),env,{now:()=>at}).json();
  assert.equal(setup.provider.status,'configured_unverified');assert.equal(setup.provider.connectionVerified,false);
  assert.equal(setup.provider.captureEnabled,false);assert.equal(setup.provider.displayEnabled,false);assert.equal(setup.provider.journalPricesEnabled,false);
  // A body stream is never read.
  const stream=new ReadableStream({pull(){throw Error('The probe must not read the request body');}});
  const unread=await run(probe({body:stream,init:{duplex:'half'}}),env,{fetchImpl});
  assert.equal(unread.status,200);assert.equal(unread.body.provider.probe,'succeeded');assert.equal(calls,2);
});

test('an empty completed day is a successful probe with zero bars, never a fabricated bar',async()=>{
  for(const body of [{bars:{},next_page_token:null},{bars:{SPY:[]},next_page_token:null}]){
    const result=await run(probe(),configured(),{fetchImpl:async()=>reply(body)});
    assert.equal(result.body.provider.probe,'succeeded');assert.equal(result.body.provider.barsReturned,0);assert.equal(result.body.provider.httpStatus,200);assert.match(result.body.provider.responseSha256,/^[a-f0-9]{64}$/);
  }
});

test('provider rejections, transport errors and invalid pages fail with the observed status only',async()=>{
  for (const [status,reason] of [[401,'provider_authentication_failed'],[403,'provider_permission_denied'],[429,'rate_limited_no_retry'],[500,'http_failed_no_retry']]) {
    const {body,text}=await run(probe(),configured(),{fetchImpl:async()=>reply(`{"message":"${secret}"}`,{status})});
    assert.deepEqual(body.provider,{id:'alpaca',probe:'failed',httpStatus:status,reasons:[reason],barsReturned:null,responseSha256:null},String(status));
    assert.ok(!text.includes(secret));
  }
  const thrown=await run(probe(),configured(),{fetchImpl:async()=>{throw Error(secret);}});
  assert.equal(thrown.body.provider.probe,'failed');assert.equal(thrown.body.provider.httpStatus,null);assert.deepEqual(thrown.body.provider.reasons,['transport_failed_no_retry']);assert.ok(!thrown.text.includes(secret));
  const html=await run(probe(),configured(),{fetchImpl:async()=>reply(`<html>${secret}</html>`,{headers:{'content-type':'text/html'}})});
  assert.deepEqual([html.body.provider.probe,html.body.provider.httpStatus,html.body.provider.reasons],['failed',200,['content_type_invalid']]);assert.ok(!html.text.includes(secret));
  const wrongSymbol=await run(probe(),configured(),{fetchImpl:async()=>reply({bars:{OTHER:[payload().bars.SPY[0]]},next_page_token:null})});
  assert.equal(wrongSymbol.body.provider.probe,'failed');assert.equal(wrongSymbol.body.provider.barsReturned,null);assert.ok(!wrongSymbol.text.includes('OTHER'));
});

test('a stalled provider fails at the transport deadline without keeping the probe pending',async()=>{
  const originalTimeout=AbortSignal.timeout,own=Object.getOwnPropertyDescriptor(performance,'now'),controller=new AbortController();
  AbortSignal.timeout=()=>controller.signal;Object.defineProperty(performance,'now',{value:()=>0,configurable:true});
  try {
    let calls=0;
    const pending=handleMarketDataProbeRequest(probe(),configured(),{now:()=>at,recent:new Map(),fetchImpl:()=>{calls++;queueMicrotask(()=>controller.abort());return new Promise(()=>{});}});
    const bounded=(async()=>{for(let i=0;i<200;i++)await Promise.resolve();return 'still_pending';})();
    const outcome=await Promise.race([pending,bounded]);
    assert.notEqual(outcome,'still_pending');assert.equal(calls,1);
    const body=await outcome.json();
    assert.equal(outcome.status,200);assert.deepEqual(body.provider,{id:'alpaca',probe:'failed',httpStatus:null,reasons:['transport_deadline_exceeded'],barsReturned:null,responseSha256:null});
  } finally { AbortSignal.timeout=originalTimeout;if(own)Object.defineProperty(performance,'now',own);else delete performance.now; }
});

test('a second probe within sixty seconds per owner is rejected in memory; other owners and later probes proceed',async()=>{
  const recent=new Map(),net=network();
  assert.equal((await run(probe(),{},{recent,fetchImpl:net.fetchImpl})).status,200);
  const second=await run(probe(),{},{recent,fetchImpl:net.fetchImpl});
  assert.equal(second.status,429);assert.deepEqual(second.body,{ok:false,error:'probe_rate_limited'});assert.equal(second.headers.get('retry-after'),'60');
  const soon=new Date(Date.parse(at)+PROBE_RATE_LIMIT_MS-1).toISOString();
  assert.equal((await run(probe(),{},{recent,fetchImpl:net.fetchImpl,now:()=>soon})).headers.get('retry-after'),'1');
  assert.equal((await run(probe({headers:{'oai-authenticated-user-id':'synthetic-other-owner'}}),{},{recent,fetchImpl:net.fetchImpl})).status,200);
  const later=new Date(Date.parse(at)+PROBE_RATE_LIMIT_MS).toISOString();
  assert.equal((await run(probe(),{},{recent,fetchImpl:net.fetchImpl,now:()=>later})).status,200);
  assert.equal(net.calls(),0);
  for(let index=0;index<1100;index++)await run(probe({headers:{'oai-authenticated-user-id':`synthetic-owner-${index}`}}),{},{recent,fetchImpl:net.fetchImpl,now:()=>later});
  assert.ok(recent.size<=1024);
});

test('an invalid server clock cannot run a probe or disclose clock detail',async()=>{
  for (const now of [()=>{throw Error('private clock detail');},()=> '2026-02-31T12:00:00Z']) {
    const net=network();const result=await run(probe(),configured(),{now,fetchImpl:net.fetchImpl});
    assert.equal(result.status,503);assert.deepEqual(result.body,{ok:false,error:'probe_unavailable'});assert.equal(net.calls(),0);assert.ok(!result.text.includes('private clock detail'));
  }
});

test('the compiled Worker serves the probe route behind the same identity boundary',async t=>{
  const {default:worker}=await import('../../dist/server/index.js');
  const external=t.mock.method(globalThis,'fetch',()=>{throw Error('No network allowed');});
  const anonymous=await worker.fetch(new Request(origin+'/api/market-data/probe',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'}),{});
  assert.equal(anonymous.status,401);assert.deepEqual(await anonymous.json(),{ok:false,error:'authentication_required'});
  const owned=await worker.fetch(probe({headers:{'oai-authenticated-user-id':'compiled-worker-probe-owner'}}),{});
  assert.equal(owned.status,200);const body=await owned.json();
  assert.equal(body.provider.probe,'setup_required');assert.equal(body.provider.httpStatus,null);assert.equal(body.provider.barsReturned,null);
  assert.equal(external.mock.callCount(),0);
});
