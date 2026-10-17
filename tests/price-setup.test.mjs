import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMarketDataSetupRequest} from '../server/market-data/setup-status.mjs';
import {createPriceSetupClient,renderPriceSetup} from '../dist/lib/price-setup.js';

const at='2026-10-17T21:00:00Z';
const request=(path='/api/market-data/setup',options={})=>new Request('https://desk.invalid'+path,{headers:{'oai-authenticated-user-id':'synthetic-owner'},...options});
const envelope=(changes={})=>({ok:true,checkedAt:at,provider:{id:'alpaca',status:'setup_required',reasons:['credentials_missing_or_invalid','rights_review_missing'],connectionVerified:false,captureEnabled:false,displayEnabled:false,journalPricesEnabled:false,...changes}});
const reply=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});

test('setup read is authenticated, GET-only and accepts no caller configuration',async()=>{
  assert.equal(handleMarketDataSetupRequest(new Request('https://desk.invalid/api/market-data/setup')).status,401);
  assert.equal(handleMarketDataSetupRequest(request('/api/market-data/setup',{method:'POST'})).status,405);
  assert.equal(handleMarketDataSetupRequest(request('/api/market-data/setup?key=secret')).status,400);
  assert.equal(handleMarketDataSetupRequest(request('/api/other')).status,404);
});

test('missing setup returns bounded reasons without leaking server configuration or fetching data',async()=>{
  const secret='private-synthetic-secret',review='private-synthetic-review';let network=0;
  const original=globalThis.fetch;globalThis.fetch=()=>{network++;throw Error('No network allowed');};
  try{
    const response=handleMarketDataSetupRequest(request(),{ALPACA_API_KEY_ID:secret,ALPACA_API_SECRET_KEY:secret,ALPACA_DATA_AUTHORIZATION_JSON:JSON.stringify({reviewId:review})},{now:()=>at});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
    const text=await response.text(),body=JSON.parse(text);
    assert.equal(network,0);assert.ok(!text.includes(secret));assert.ok(!text.includes(review));
    assert.equal(body.provider.status,'setup_required');assert.equal(body.provider.captureEnabled,false);assert.equal(body.provider.journalPricesEnabled,false);
  }finally{globalThis.fetch=original;}
});

test('invalid server time or malformed configuration never presents a ready feed',async()=>{
  for(const now of [()=>{throw Error('private clock detail');},()=> '2026-02-31T12:00:00Z'])assert.equal(handleMarketDataSetupRequest(request(),{},{now}).status,503);
  for(const config of ['{','x'.repeat(30001)]){
    const body=await handleMarketDataSetupRequest(request(),{ALPACA_DATA_AUTHORIZATION_JSON:config},{now:()=>at}).json();
    assert.equal(body.provider.status,'setup_required');assert.equal(body.provider.connectionVerified,false);
  }
});

test('client remains manual, coalesces a check and requests only the same-origin setup endpoint',async()=>{
  let calls=0,release;const changes=[];
  const client=createPriceSetupClient({fetch:async(url,options)=>{calls++;assert.equal(url,'/api/market-data/setup');assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');await new Promise(r=>{release=r;});return reply(envelope());},onChange:state=>changes.push(state.status)});
  assert.equal(calls,0);assert.equal(client.state().status,'unchecked');
  const first=client.refresh(),second=client.refresh();assert.equal(first,second);assert.equal(calls,1);release();await first;
  assert.equal(client.state().status,'setup_required');assert.deepEqual(changes,['loading','setup_required']);client.dispose();
});

test('client rejects success claims that would silently promote a provider or omit missing inputs',async()=>{
  for(const changes of [{connectionVerified:true},{captureEnabled:true},{displayEnabled:true},{journalPricesEnabled:true},{status:'ready'},{reasons:[]},{status:'configured_unverified',reasons:['rights_review_missing']},{reasons:['<script>private</script>']}]){
    const client=createPriceSetupClient({fetch:async()=>reply(envelope(changes))});await client.refresh();assert.equal(client.state().status,'unavailable');client.dispose();
  }
  const client=createPriceSetupClient({fetch:async()=>reply({...envelope(),ok:'true'})});await client.refresh();assert.equal(client.state().status,'unavailable');client.dispose();
});

test('configured status stays unverified; snapshots cannot mutate internal reasons',async()=>{
  const client=createPriceSetupClient({fetch:async()=>reply(envelope({status:'configured_unverified',reasons:[]}))});await client.refresh();
  const state=client.state();state.reasons.push('injected');assert.deepEqual(client.state().reasons,[]);
  const html=renderPriceSetup(client.state());assert.match(html,/connection has not been tested/);assert.match(html,/price capture remains off/);client.dispose();
});

test('timeout and disposal suppress late setup responses',async()=>{
  let release;const client=createPriceSetupClient({timeoutMs:5,fetch:()=>new Promise(r=>{release=r;})});
  await client.refresh();assert.equal(client.state().status,'unavailable');release(reply(envelope({status:'configured_unverified',reasons:[]})));await new Promise(r=>setTimeout(r,1));assert.equal(client.state().status,'unavailable');client.dispose();
  let resolve;const changes=[];const disposed=createPriceSetupClient({fetch:()=>new Promise(r=>{resolve=r;}),onChange:s=>changes.push(s.status)});const pending=disposed.refresh();disposed.dispose();resolve(reply(envelope()));await pending;assert.deepEqual(changes,['loading']);
});

test('view gives actionable setup state without rendering untrusted strings or credential inputs',()=>{
  const html=renderPriceSetup({status:'setup_required',reasons:['credentials_missing_or_invalid','rights_review_missing','<script>bad</script>']});
  assert.match(html,/credentials are missing/);assert.match(html,/source-access and account-entitlement review/);assert.match(html,/market-data-setup.html/);assert.doesNotMatch(html,/<script|<input|bad/);
});

test('setup response is bounded before parsing and rejects invalid content types and encodings',async()=>{
  const invalid = [
    new Response(JSON.stringify(envelope()),{headers:{'content-type':'text/html'}}),
    new Response(JSON.stringify(envelope()),{headers:{'content-type':'application/json','content-length':'8193'}}),
    new Response(JSON.stringify(envelope()),{headers:{'content-type':'application/json','content-length':'unknown'}}),
    new Response(' '.repeat(8193),{headers:{'content-type':'application/json'}}),
    new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}}),
  ];
  for (const response of invalid) {
    const client=createPriceSetupClient({fetch:async()=>response});
    await client.refresh();assert.equal(client.state().status,'unavailable');client.dispose();
  }
  let cancelled=0;
  const oversized=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8193));},cancel(){cancelled++;return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
  const client=createPriceSetupClient({fetch:async()=>oversized,timeoutMs:100});
  await client.refresh();assert.equal(client.state().status,'unavailable');assert.equal(cancelled,1);client.dispose();
});

test('stream timeout cancels stalled bodies without awaiting an uncooperative cancellation',async()=>{
  let cancelled=0;
  const response=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled++;return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
  const client=createPriceSetupClient({fetch:async()=>response,timeoutMs:10});
  await client.refresh();assert.equal(client.state().status,'unavailable');assert.equal(cancelled,1);client.dispose();
});

test('valid status can arrive in multiple UTF-8 chunks within the byte limit',async()=>{
  const encoded=new TextEncoder().encode(JSON.stringify(envelope()));
  const response=new Response(new ReadableStream({start(controller){controller.enqueue(encoded.slice(0,41));controller.enqueue(encoded.slice(41));controller.close();}}),{headers:{'content-type':'application/json; charset=utf-8'}});
  const client=createPriceSetupClient({fetch:async()=>response});
  await client.refresh();assert.equal(client.state().status,'setup_required');client.dispose();
});

test('empty fragments cannot starve the setup deadline or await cancellation',async()=>{
  let reads=0,cancelled=0;
  const response={ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({
    read:async()=>{reads++;return {done:false,value:new Uint8Array()};},
    cancel:()=>{cancelled++;return new Promise(()=>{});},releaseLock(){},
  })}};
  const client=createPriceSetupClient({fetch:async()=>response,timeoutMs:1000});
  await client.refresh();assert.equal(client.state().status,'unavailable');assert.ok(reads<=16385);assert.equal(cancelled,1);client.dispose();
});

test('elapsed time includes headers and a final read even when the timer cannot run',async()=>{
  const pause=()=>{const end=performance.now()+15;while(performance.now()<end){}};
  for(const phase of ['headers','final-read']){
    let reads=0;const encoded=new TextEncoder().encode(JSON.stringify(envelope()));
    const response={ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({
      read:async()=>{if(!reads++)return {done:false,value:encoded};if(phase==='final-read')pause();return {done:true};},
      cancel:()=>new Promise(()=>{}),releaseLock(){},
    })}};
    const client=createPriceSetupClient({fetch:async()=>{if(phase==='headers')pause();return response;},timeoutMs:5});
    await client.refresh();assert.equal(client.state().status,'unavailable',phase);client.dispose();
  }
});

test('one-byte chunks remain valid within the setup response byte limit',async()=>{
  const encoded=new TextEncoder().encode(JSON.stringify(envelope()));let cursor=0;
  const response={ok:true,status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({
    read:async()=>cursor<encoded.length?{done:false,value:encoded.slice(cursor,++cursor)}:{done:true},cancel:async()=>{},releaseLock(){},
  })}};
  const client=createPriceSetupClient({fetch:async()=>response});
  await client.refresh();assert.equal(client.state().status,'setup_required');client.dispose();
});
