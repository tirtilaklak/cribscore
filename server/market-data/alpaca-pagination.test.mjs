import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchAlpacaDailyHistory} from './alpaca-daily.mjs';
import {syntheticAlpacaOptions} from './alpaca-test-fixtures.mjs';
const page=(session,token)=>({bars:{TEST:session?[{t:session+'T04:00:00Z',o:100,h:103,l:98,c:102,v:1000}]:[]},next_page_token:token});
async function collect(bodies,edit=()=>{}) {
 const options=syntheticAlpacaOptions();options.request.start='2026-10-12T04:00:00Z';edit(options);
 const requests=[];const result=await fetchAlpacaDailyHistory({...options,fetchImpl:async(url,init)=>{requests.push({url,init});const body=bodies[requests.length-1];if(body instanceof Response)return body;if(body instanceof Error)throw body;return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});}});
 return {result,requests};
}
test('one-page history is canonical but still unreviewed and never eligible',async()=>{
 const {result,requests}=await collect([page('2026-10-16',null)]);assert.equal(requests.length,1);assert.equal(result.ok,true);assert.equal(result.status,'captured_unvalidated');assert.equal(result.pagination.complete,true);assert.equal(result.requiresCaptureSetReview,false);assert.equal(result.series.source.paginationComplete,true);assert.equal(result.eligibleForRanking,false);assert.equal(result.paperMarksEligible,false);
});
test('multi-page history preserves each exact response hash and never fabricates combined canonical provenance',async()=>{
 const bodies=[page('2026-10-12','NEXT+/%='),page('2026-10-13','LAST'),page('2026-10-16',null)];const {result,requests}=await collect(bodies);
 assert.equal(result.ok,true);assert.equal(result.status,'capture_set_unvalidated');assert.equal(result.series,null);assert.equal(result.capture,null);assert.equal(result.pagination.complete,true);assert.equal(result.requiresCaptureSetReview,true);assert.equal(result.pages.length,3);assert.equal(requests.length,3);assert.equal(new URL(requests[1].url).searchParams.get('page_token'),'NEXT+/%=');assert.equal(new URL(requests[2].url).searchParams.get('page_token'),'LAST');
 result.pages.forEach((item,index)=>{assert.equal(item.capture.responseSha256,createHash('sha256').update(JSON.stringify(bodies[index])).digest('hex'));assert.equal(item.series.source.paginationComplete,false);assert.equal(item.capture.eligibleForRanking,false);});
 assert.equal(new Set(result.pages.map(item=>item.series.id)).size,3);
});
for(const [name,bodies,reason,count] of [
 ['missing continuation metadata',[{bars:{TEST:[]}}],'pagination_completeness_unknown',1],
 ['nonprogress',[page(null,'NEXT')],'pagination_no_progress',1],
 ['cycle',[page('2026-10-12','NEXT'),page('2026-10-13','NEXT')],'pagination_token_cycle',2],
 ['duplicate session',[page('2026-10-12','NEXT'),page('2026-10-12',null)],'pagination_duplicate_session',2],
 ['out of order',[page('2026-10-13','NEXT'),page('2026-10-12',null)],'pagination_session_order_invalid',2],
 ['midway HTTP failure',[page('2026-10-12','NEXT'),new Response('secret',{status:500})],'http_failed_no_retry',2],
 ['midway throttled',[page('2026-10-12','NEXT'),new Response('secret',{status:429,headers:{'Retry-After':'1'}})],'rate_limited_no_retry',2],
 ['midway permission revoked',[page('2026-10-12','NEXT'),new Response('secret',{status:403})],'provider_permission_denied',2],
 ['midway transport failed',[page('2026-10-12','NEXT'),new Error('secret')],'transport_failed_no_retry',2],
])test(`collection fails atomically: ${name}`,async()=>{const {result,requests}=await collect(bodies);assert.equal(result.ok,false);assert.deepEqual(result.reasons,[reason]);assert.equal(requests.length,count);assert.deepEqual(result.pages,[]);assert.equal(result.series,null);assert.equal(result.capture,null);assert.equal(result.pagination.complete,false);assert.doesNotMatch(JSON.stringify(result),/secret/);});
test('page and aggregate byte bounds never return a partial history as complete',async()=>{
 const pages=[page('2026-10-12','NEXT'),page('2026-10-13',null)];
 const capped=await collect(pages,o=>o.maxPages=1);assert.equal(capped.requests.length,1);assert.deepEqual(capped.result.reasons,['pagination_page_limit']);assert.deepEqual(capped.result.pages,[]);
 const byteCapped=await collect(pages,o=>o.maxResponseBytes=Buffer.byteLength(JSON.stringify(pages[0]))+1);assert.equal(byteCapped.requests.length,2);assert.deepEqual(byteCapped.result.reasons,['collection_byte_limit']);assert.deepEqual(byteCapped.result.pages,[]);
});
test('invalid collector bounds and caller continuation page cause no requests',async()=>{
 for(const edit of [o=>o.maxPages=0,o=>o.maxPages=9,o=>o.maxPages=1.5,o=>o.maxResponseBytes=0,o=>o.maxResponseBytes=8_000_001,o=>o.request.pageToken='NEXT']){const {result,requests}=await collect([],edit);assert.equal(result.ok,false);assert.equal(requests.length,0);assert.deepEqual(result.pages,[]);}
});
test('whole collection freezes caller request and identity across page boundaries',async()=>{
 const options=syntheticAlpacaOptions();options.request.start='2026-10-12T04:00:00Z';let calls=0;
 const result=await fetchAlpacaDailyHistory({...options,fetchImpl:async()=>{calls++;options.security.entityId='MUTATED';options.request.symbols[0]='MUTATED';return new Response(JSON.stringify(page(calls===1?'2026-10-12':'2026-10-16',calls===1?'NEXT':null)),{headers:{'content-type':'application/json'}});}});
 assert.equal(result.ok,true);assert.equal(calls,2);assert.ok(result.pages.every(p=>p.series.entityId==='SYNTHETIC-PERMANENT-ID'&&p.series.symbol==='TEST'));
});
test('missing setup is harmless through the collector entry point too',async()=>{
 let calls=0;const result=await fetchAlpacaDailyHistory({at:'2026-10-17T12:00:00Z',clock:()=> '2026-10-17T12:00:00Z',fetchImpl:async()=>{calls++;throw Error();}});assert.equal(result.status,'setup_required');assert.equal(calls,0);assert.deepEqual(result.pages,[]);
});
test('a clock regressing between pages prevents the next authenticated request',async()=>{
 const clocks=['2026-10-17T12:00:00.123Z','2026-10-17T12:00:10Z','2026-10-17T12:00:01Z','2026-10-17T12:00:02Z'];let tick=0;
 const {result,requests}=await collect([page('2026-10-12','NEXT'),page('2026-10-13',null)],o=>o.clock=()=>clocks[tick++]);assert.equal(requests.length,1);assert.deepEqual(result.reasons,['operation_clock_invalid']);assert.deepEqual(result.pages,[]);
});
