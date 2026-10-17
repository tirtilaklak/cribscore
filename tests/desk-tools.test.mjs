// Offline review of exact controller bytes and real domain/view dependencies.
import test from 'node:test';
import {createDeskTools,actualFillTime} from '../dist/lib/desk-tools.js';
import * as journalDomain from '../dist/lib/journal.js';
import assert from 'node:assert/strict';
const at='2026-10-17T19:00:00Z';
const snapshot={id:'synthetic-unranked-snapshot',method_version:'synthetic-v1',reviewed_at:'2026-10-17T18:00:00Z',source_cutoff_at:'2026-10-17T18:00:00Z',window:{horizon_id:'next_day',entry_at:'2026-10-19T13:30:00Z',exit_at:'2026-10-19T20:00:00Z'},hypotheses:[{}],candidates:[]};
const settingsValues={paperNotional:'300',commissionPerFill:'0',slippageBps:'5',benchmarkSymbol:'SPY'};
async function harness({empty=false,fail=false}={}){
  const handlers={},posts=[],observations=[],gets=[],blobs=[];let remote,postFailure=fail,observationFailure=false,uid=0;
  const document={addEventListener:(kind,fn)=>{handlers[kind]=fn;},removeEventListener:()=>{},querySelector:()=>null,body:{append(){}},createElement:()=>({click(){},remove(){}})};
  class TestURL extends URL {static createObjectURL(blob){blobs.push(blob);return 'blob:synthetic';}static revokeObjectURL(){}}
  globalThis.FormData=class{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}};
  globalThis.URL=TestURL;
  const controller={namespace:{createDeskTools}},domain=journalDomain;
  remote=empty?null:domain.createJournal({journalId:'synthetic-existing-controller-journal',at:'2026-10-17T18:00:00Z'});
  const app=controller.namespace.createDeskTools({document,now:()=>at,uuid:()=>`synthetic-${++uid}`,getSnapshots:()=>[snapshot],fetch:async(_url,options)=>{
    if(options?.method==='POST'&&_url==='/api/journal/observe'){
      const body=JSON.parse(options.body);observations.push(body);
      assert.deepEqual(Object.keys(body).sort(),['expectedRevision','requestId']);
      if(observationFailure)return {ok:false,status:503,json:async()=>({ok:false,error:'synthetic_observation_unconfirmed'})};
      assert.equal(body.expectedRevision,remote.revision);
      remote=(await domain.recordAbstention(remote,{id:'synthetic-server-abstention',at,date:at.slice(0,10),horizonId:'next_day',unrankedCount:1,snapshot:{id:snapshot.id}})).journal;
      return {ok:true,status:200,json:async()=>({ok:true,journal:remote,revision:remote.revision,automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:['publisher_unconfigured']}})};
    }
    if(options?.method==='POST'){
      const body=JSON.parse(options.body);posts.push(body);
      if(postFailure)return {ok:false,status:503,json:async()=>({ok:false,error:'synthetic_save_unavailable'})};
      assert.equal(body.expectedRevision,remote?.revision||0,'controller passes latest loaded revision');
      assert.equal(domain.checkAppendOnly(remote,body.journal,{allowEmptyRestore:body.mode==='restore'}).ok,true);
      remote=body.journal;return {ok:true,status:200,json:async()=>({ok:true,journal:remote,revision:remote.revision})};
    }
    gets.push({revision:remote?.revision||0});return {ok:true,status:200,json:async()=>({ok:true,journal:remote,revision:remote?.revision||0})};
  }});
  const flush=async()=>{for(let i=0;i<18;i++)await new Promise(resolve=>setImmediate(resolve));};
  const action=async name=>{const target={dataset:{journalAction:name},closest:()=>target};handlers.click({target});await flush();};
  const submit=async(kind,values)=>{const form={dataset:{journalForm:kind},values};form.closest=()=>form;handlers.submit({target:form,preventDefault(){}});await flush();};
  return {app,domain,posts,observations,gets,action,submit,remote:()=>remote,setRemote:value=>{remote=value;},fail:value=>{postFailure=value;},failObservation:value=>{observationFailure=value;},export:async()=>{await action('export');return JSON.parse(await blobs.at(-1).text());}};
}
const run=(name,fn)=>test(name,{concurrency:false},fn);
async function pendingReconcile(h){await h.app.start();await h.submit('settings',settingsValues);const original=h.posts.at(-1).journal.events.at(-1);assert.equal(h.app.status().storage.state,'unsaved');h.setRemote((await h.domain.appendSettings(h.remote(),{id:'synthetic-other-device-settings',at,settings:{...h.domain.DEFAULT_PAPER_SETTINGS,paperNotional:'200'}})).journal);h.fail(false);await h.action('sync');assert.match(h.app.html('journal'),/Reconcile 1 unsynced event/);return original;}
await run('pending reconciliation blocks manual, automatic, and repeated-load competitors then preserves both histories',async()=>{
  const h=await harness({fail:true}),original=await pendingReconcile(h),beforePosts=h.posts.length,beforeGets=h.gets.length,beforeObservations=h.observations.length;
  await h.submit('settings',settingsValues);await h.app.observe();await h.action('sync');
  assert.equal(h.posts.length,beforePosts);assert.equal(h.gets.length,beforeGets);assert.equal(h.observations.length,beforeObservations);assert.match(h.app.html('journal'),/Reconcile 1 unsynced event/);
  assert.ok((await h.export()).events.some(e=>e.id===original.id));
  await h.action('confirm-import');assert.equal(h.app.status().storage.state,'synced');assert.ok(h.remote().events.some(e=>e.id===original.id));assert.ok(h.remote().events.some(e=>e.id==='synthetic-other-device-settings'));assert.equal(h.remote().events.length,3);h.app.destroy();return {eventIds:h.remote().events.map(e=>e.id)};
});
await run('cancel reconciliation retains original unsynced draft and a later retry saves it',async()=>{
  const h=await harness({fail:true}),original=await pendingReconcile(h);await h.action('cancel-import');assert.equal(h.app.status().storage.state,'conflict');assert.ok((await h.export()).events.some(e=>e.id===original.id));await h.action('sync');await h.action('confirm-import');assert.ok(h.remote().events.some(e=>e.id===original.id));h.app.destroy();return {eventIds:h.remote().events.map(e=>e.id)};
});
await run('empty server has no write before explicit setup and then saves only an abstention',async()=>{
  const h=await harness({empty:true});await h.app.start();await h.app.observe();await h.submit('settings',settingsValues);assert.equal(h.posts.length,0);assert.match(h.app.html('journal'),/Start your private journal/);await h.action('start');assert.equal(h.posts.length,1);assert.equal(h.observations.length,1);assert.equal(h.posts[0].journal.revision,0);assert.deepEqual(h.remote().events.map(e=>e.kind),['abstain']);assert.equal(h.remote().events[0].data.snapshot.id,snapshot.id);assert.equal(h.app.html('journal').includes('Start your private journal'),false);h.app.destroy();return {postRevisions:h.posts.map(p=>p.journal.revision)};
});
await run('empty server restores identity only after review; no auto event races the preview',async()=>{
  const h=await harness({empty:true});await h.app.start();let backup=h.domain.createJournal({journalId:'synthetic-backup-device',at:'2026-10-17T18:00:00Z'});backup=(await h.domain.recordAbstention(backup,{id:'synthetic-restored-abstention',at,date:'2026-10-17',horizonId:'next_day',unrankedCount:1,snapshot:{id:'saved-original-context'}})).journal;const raw=(await h.domain.exportJournal(backup)).text;
  await h.submit('import',{file:{size:raw.length,text:async()=>raw}});await h.app.observe();await h.action('start');assert.equal(h.posts.length,0);assert.equal(h.app.html('journal').includes('saved-original-context'),false);await h.action('confirm-import');assert.equal(h.posts.length,1);assert.equal(h.posts[0].mode,'restore');assert.equal(h.remote().journalId,backup.journalId);assert.equal(h.remote().events.length,1);assert.equal(h.remote().events[0].data.snapshot.id,'saved-original-context');h.app.destroy();return {mode:h.posts[0].mode,journalId:h.remote().journalId};
});
await run('failed restore never projects unaccepted imported history or claims sync',async()=>{
  const h=await harness({empty:true,fail:true});await h.app.start();let backup=h.domain.createJournal({journalId:'synthetic-rejected-backup',at:'2026-10-17T18:00:00Z'});backup=(await h.domain.recordAbstention(backup,{id:'synthetic-not-accepted',at,date:'2026-10-17',horizonId:'next_week',snapshot:{id:'REJECTED-IMPORT-CONTEXT'}})).journal;const raw=(await h.domain.exportJournal(backup)).text;await h.submit('import',{file:{size:raw.length,text:async()=>raw}});await h.action('confirm-import');assert.equal(h.remote(),null);assert.equal(h.app.status().storage.state,'unsaved');assert.equal(h.app.html('journal').includes('REJECTED-IMPORT-CONTEXT'),false);assert.equal((await h.export()).revision,0);h.app.destroy();return {storageState:h.app.status().storage.state};
});

await run('actual UTC fill parser preserves fractional instants and rejects invalid calendar dates',()=>{
  for(const value of ['2026-10-19T13:30:00','2026-10-19T13:30:00.1','2026-10-19T13:30:00.12','2026-10-19T13:30:00.123'])assert.equal(actualFillTime(value),value+'Z');
  assert.equal(actualFillTime('2026-10-19T13:30'),'2026-10-19T13:30:00Z');
  for(const value of ['2026-02-30T13:30','2026-10-19T13:30:00.1234','2026-10-19T13:30:00Z','2026-10-19T13:30:00+01:00','not a date'])assert.throws(()=>actualFillTime(value));
});

await run('unconfirmed automatic response preserves last confirmed history and requires sync before edits',async()=>{
  const h=await harness();await h.app.start();const before=await h.export();h.failObservation(true);await h.app.observe();assert.equal(h.app.status().storage.state,'unavailable');assert.deepEqual(await h.export(),before);const posts=h.posts.length;await h.submit('settings',settingsValues);assert.equal(h.posts.length,posts);h.failObservation(false);await h.action('sync');assert.equal(h.app.status().storage.state,'synced');assert.equal(h.app.status().automation.publisherState,'unconfigured');assert.deepEqual(h.remote(),before);h.app.destroy();
});

await run('a stalled JSON response body reaches the request deadline without blocking the journal forever',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let bodyStarted=false;
  const document={addEventListener(){},removeEventListener(){},querySelector:()=>null};
  const app=createDeskTools({document,now:()=>at,fetch:async()=>({ok:true,status:200,json:()=>{bodyStarted=true;return new Promise(()=>{});}})});
  const loading=app.start();for(let i=0;i<5;i++)await Promise.resolve();assert.equal(bodyStarted,true);t.mock.timers.tick(15000);await loading;assert.equal(app.status().busy,false);assert.equal(app.status().loadState,'unavailable');app.destroy();
});
