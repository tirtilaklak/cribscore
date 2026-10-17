// Transport faults around real API/SQLite commits. Synthetic owners only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteD1} from './helpers/sqlite-d1.mjs';
import {handleJournalRequest} from '../server/journal-api.js';
import {createJournalObserver} from '../server/journal/observe.mjs';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import * as domain from '../dist/lib/journal.js';

const at='2026-10-17T18:00:00Z',origin='https://synthetic-transport.example.test';
const empty=id=>domain.createJournal({journalId:id,at:'2026-10-17T17:00:00Z'});
async function setting(journal,id,amount='175') {
  const result=await domain.appendSettings(journal,{id,at,settings:{...domain.DEFAULT_PAPER_SETTINGS,paperNotional:amount}});
  assert.equal(result.ok,true);return result.journal;
}
const settle=async()=>{for(let n=0;n<35;n++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};

async function harness(t) {
  const db=new SQLiteD1(),observer=createJournalObserver({clock:()=>at}),handlers={},blobs=[],posts=[];
  const oldFD=globalThis.FormData,oldURL=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
  globalThis.FormData=class{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}};
  URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic-transport';};URL.revokeObjectURL=()=>{};
  const raw=(path,options={})=>handleJournalRequest(new Request(origin+path,{...options,headers:{'oai-authenticated-user-id':'synthetic-transport-owner',...(options.method==='POST'?{origin,'content-type':'application/json'}:{})}}),{DB:db},{now:()=>at,observer});
  const post=async(journal,expectedRevision,mode='append')=>{
    const response=await raw('/api/journal',{method:'POST',body:JSON.stringify({journal,expectedRevision,mode})});
    assert.equal(response.status,200);return (await response.json()).journal;
  };
  const initial=empty('synthetic-transport-original');await post(initial,0);
  let nextPost,nextGet,nextObserve,sequence=0;
  const doc={querySelector:()=>null,addEventListener:(kind,handler)=>{handlers[kind]=handler;},removeEventListener(){},body:{append(){}},createElement:()=>({click(){},remove(){}})};
  const app=createDeskTools({document:doc,now:()=>at,uuid:()=>`transport-${++sequence}`,fetch:async(path,options)=>{
    const response=await raw(path,options);
    if(path==='/api/journal/observe'&&nextObserve){const alter=nextObserve;nextObserve=null;return alter(response);}
    if(path==='/api/journal'&&options.method==='POST') {
      const body=await response.clone().json();posts.push({status:response.status,body});
      if(nextPost){const alter=nextPost;nextPost=null;return alter(response,body,options.signal);}
    }
    if(path==='/api/journal'&&options.method==='GET'&&nextGet){const alter=nextGet;nextGet=null;return alter(response);}
    return response;
  }});
  t.after(()=>{app.destroy();db.close();globalThis.FormData=oldFD;URL.createObjectURL=oldURL;URL.revokeObjectURL=oldRevoke;});
  const action=async name=>{const target={dataset:{journalAction:name},closest:()=>target};handlers.click({target});await settle();};
  const review=async journal=>{
    const text=JSON.stringify(journal),form={dataset:{journalForm:'import'},values:{file:{size:Buffer.byteLength(text),text:async()=>text}},closest:()=>form};
    handlers.submit({target:form,preventDefault(){}});await settle();assert.match(app.html('journal'),/Apply reviewed backup/);
  };
  await app.start();
  return {app,db,initial,post,posts,action,review,alterPost(fn){nextPost=fn;},alterGet(fn){nextGet=fn;},alterObserve(fn){nextObserve=fn;},
    remote:async()=>(await (await raw('/api/journal')).json()).journal,
    exported:async()=>{await action('export');return JSON.parse(await blobs.at(-1).text());}};
}

test('HTTP success requires literal boolean ok before a journal can be accepted',async()=>{
  const journal=await setting(empty('synthetic-envelope'),'synthetic-envelope-event');
  for(const malformed of [null,{}, {journal,revision:journal.revision}, {ok:'true',journal,revision:journal.revision}, {ok:1,journal,revision:journal.revision}, {ok:false,error:'synthetic-error'}]) {
    const store=domain.createHttpJournalStore({fetch:async()=>new Response(JSON.stringify(malformed),{status:200})});
    for(const result of [await store.load(),await store.commit(journal,{expectedRevision:0})]) {
      assert.equal(result.ok,false);assert.equal(result.error,'invalid_server_response');assert.equal(result.state,'unsaved');
    }
  }
});

test('non-success HTTP errors retain their explicit rejection/conflict contract',async()=>{
  const journal=await setting(empty('synthetic-rejection'),'synthetic-rejection-event');
  for(const [status,error] of [[401,'authentication_required'],[409,'revision_conflict'],[422,'publication_not_authorized'],[503,'journal_commit_uncertain']]) {
    const store=domain.createHttpJournalStore({fetch:async()=>new Response(JSON.stringify({ok:false,error,journal,revision:journal.revision}),{status})});
    const result=await store.commit(journal,{expectedRevision:0});
    assert.equal(result.ok,false);assert.equal(result.error,error);assert.equal(result.state,status===409?'conflict':'unsaved');
    assert.deepEqual(result.journal,journal);
  }
});

for(const shape of ['missing ok','nonboolean ok','truncated JSON'])test(`${shape}: a committed restore remains unconfirmed until fresh-read recovery`,{concurrency:false},async t=>{
  const h=await harness(t),backup=await setting(empty('synthetic-transport-backup'),'synthetic-backup-event');
  await h.review(backup);
  h.alterPost((_response,body)=>new Response(shape==='truncated JSON'?'{{':JSON.stringify(shape==='missing ok'?{journal:body.journal,revision:body.revision}:{...body,ok:'true'}),{status:200}));
  await h.action('confirm-import');
  assert.equal(h.posts.at(-1).status,200);assert.deepEqual(await h.remote(),backup);
  assert.equal(h.app.status().storage.state,'unsaved','A malformed success envelope must not confirm a save');
  assert.deepEqual(await h.exported(),h.initial);
  const writes=h.db.batchCount;await h.action('sync');
  assert.equal(h.app.status().storage.state,'synced','The exact committed candidate must remain recoverable');
  assert.deepEqual(await h.exported(),backup);assert.equal(h.db.batchCount,writes);
});

test('malformed successful GET cannot reset confirmed history and a later valid read recovers',{concurrency:false},async t=>{
  const h=await harness(t),confirmed=await h.exported();
  h.alterGet(()=>new Response('{}',{status:200}));await h.action('sync');
  assert.equal(h.app.status().storage.state,'unavailable');assert.deepEqual(await h.exported(),confirmed);
  const writes=h.db.batchCount;await h.action('sync');assert.equal(h.app.status().storage.state,'synced');
  assert.deepEqual(await h.exported(),confirmed);assert.equal(h.db.batchCount,writes);
});

test('a nonboolean observation success flag cannot promote response-only history',{concurrency:false},async t=>{
  const h=await harness(t),confirmed=await h.exported();
  const proposal=await domain.recordAbstention(confirmed,{id:'synthetic-unconfirmed-observation',at,date:'2026-10-17',horizonId:'next_day',snapshot:{fixture:'transport-only'}});
  assert.equal(proposal.ok,true);
  h.alterObserve(async response=>{
    const body=await response.json();
    return new Response(JSON.stringify({...body,ok:'false',journal:proposal.journal,revision:proposal.journal.revision}),{status:200});
  });
  const writes=h.db.batchCount;await h.app.observe();
  assert.equal(h.app.status().storage.state,'unavailable');
  assert.deepEqual(await h.exported(),confirmed);assert.deepEqual(await h.remote(),confirmed);assert.equal(h.db.batchCount,writes);
});

test('a timed-out JSON body completing after fresh recovery cannot replace newer confirmed history',{concurrency:false},async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=await harness(t),backup=await setting(empty('synthetic-timeout-backup'),'synthetic-timeout-event'),held=deferred();
  let oldBody,signal,bodyStarted=false;
  await h.review(backup);
  h.alterPost((_response,body,requestSignal)=>{oldBody=body;signal=requestSignal;return {ok:true,status:200,json:()=>{bodyStarted=true;return held.promise;}};});
  await h.action('confirm-import');assert.equal(bodyStarted,true);assert.equal(h.app.status().busy,true);
  assert.deepEqual(await h.remote(),backup);
  t.mock.timers.tick(15000);await settle();assert.equal(signal.aborted,true);assert.equal(h.app.status().busy,false);
  assert.equal(h.app.status().storage.state,'unsaved');assert.deepEqual(await h.exported(),h.initial);
  await h.action('sync');assert.equal(h.app.status().storage.state,'synced');assert.deepEqual(await h.exported(),backup);
  const advanced=await setting(backup,'synthetic-after-timeout','275');await h.post(advanced,backup.revision);
  await h.action('sync');assert.deepEqual(await h.exported(),advanced);
  const writes=h.db.batchCount;held.resolve(oldBody);await settle();
  assert.equal(h.app.status().busy,false);assert.equal(h.app.status().storage.state,'synced');
  assert.deepEqual(await h.exported(),advanced,'Late bytes cannot rewind the recovered revision');assert.equal(h.db.batchCount,writes);
});
