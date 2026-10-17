// Independent recovery scenarios. Only synthetic owners and in-memory SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteD1} from './helpers/sqlite-d1.mjs';
import {handleJournalRequest} from '../server/journal-api.js';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import * as domain from '../dist/lib/journal.js';
import {createJournalObserver} from '../server/journal/observe.mjs';
const time='2026-10-17T18:00:00Z',created='2026-10-17T17:00:00Z',origin='https://independent-recovery.example.test';
const base=id=>domain.createJournal({journalId:id,at:created});
const settle=async()=>{for(let n=0;n<40;n++)await new Promise(resolve=>setImmediate(resolve));};
async function withSettings(journal,id,amount='175') {const r=await domain.appendSettings(journal,{id,at:time,settings:{...domain.DEFAULT_PAPER_SETTINGS,paperNotional:amount}});assert.equal(r.ok,true);return r.journal;}
async function harness(t,initial) {
  const db=new SQLiteD1(),observer=createJournalObserver({clock:()=>time}),handlers={},requests=[],blobs=[];
  const oldFD=globalThis.FormData,oldURL=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
  globalThis.FormData=class{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}};
  URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic-recovery';};URL.revokeObjectURL=()=>{};
  const raw=async(path,options={})=>handleJournalRequest(new Request(origin+path,{...options,headers:{'oai-authenticated-user-id':'independent-synthetic-owner',...(options.method==='POST'?{origin,'content-type':'application/json'}:{})}}),{DB:db},{now:()=>time,observer});
  if(initial){const response=await raw('/api/journal',{method:'POST',body:JSON.stringify({journal:initial,expectedRevision:0})});assert.equal(response.status,200);}
  let loseResponse=false,rejectRestore=false,sequence=0,nextGet;
  const doc={querySelector:()=>null,addEventListener:(kind,fn)=>{handlers[kind]=fn;},removeEventListener(){},body:{append(){}},createElement:()=>({click(){},remove(){}})};
  const app=createDeskTools({document:doc,now:()=>time,uuid:()=>`independent-${++sequence}`,fetch:async(path,options)=>{
    requests.push({path,method:options.method,body:options.body?JSON.parse(options.body):null});
    if(path==='/api/journal'&&options.method==='GET'&&nextGet!==undefined){const journal=nextGet;nextGet=undefined;return new Response(JSON.stringify({ok:true,journal,revision:journal?.revision??0}),{status:200});}
    if(rejectRestore&&path==='/api/journal'&&options.method==='POST'){rejectRestore=false;return new Response(JSON.stringify({ok:false,error:'publication_not_authorized'}),{status:422});}
    const response=await raw(path,options);
    if(loseResponse&&path==='/api/journal'&&options.method==='POST'){loseResponse=false;assert.equal(response.status,200);throw new Error('Synthetic response lost after database commit');}
    return response;
  }});
  t.after(()=>{app.destroy();db.close();globalThis.FormData=oldFD;URL.createObjectURL=oldURL;URL.revokeObjectURL=oldRevoke;});
  const action=async name=>{const target={dataset:{journalAction:name},closest:()=>target};handlers.click({target});await settle();assert.equal(app.status().busy,false);};
  const review=async journal=>{const text=JSON.stringify(journal),form={dataset:{journalForm:'import',deskDirty:'true',deskEditVersion:'1'},values:{file:{size:Buffer.byteLength(text),text:async()=>text}},closest:()=>form};handlers.submit({target:form,preventDefault(){}});await settle();assert.match(app.html('journal'),/Apply reviewed backup/);};
  await app.start();
  return {app,db,requests,action,review,lose(){loseResponse=true;},reject(){rejectRestore=true;},overrideGet(journal){nextGet=journal;},remote:async()=>(await (await raw('/api/journal')).json()).journal,
    failReadback(){db.afterBatch=()=>{const prepare=db.prepare.bind(db);let armed=true;db.prepare=sql=>{const statement=prepare(sql),all=statement.all;statement.all=async function(){const rows=await all.call(this);if(!armed)return rows;armed=false;return {success:false};};return statement;};};},
    appendRemote:async journal=>{const previous=(await (await raw('/api/journal')).json()).journal;return raw('/api/journal',{method:'POST',body:JSON.stringify({journal,expectedRevision:previous?.revision??0})});},
    exported:async()=>{await action('export');return JSON.parse(await blobs.at(-1).text());}};
}

for(const startingState of ['no stored journal','existing empty journal','same journal identity'])for(const failure of ['lost response','server readback unavailable']) {
  test(`${failure}: restore reconciles ${startingState} without duplicate events`,{concurrency:false},async t=>{
    const initial=startingState==='no stored journal'?null:base('independent-original');
    const backup=await withSettings(base(startingState==='same journal identity'?'independent-original':'independent-backup'),'independent-backup-event');
    const h=await harness(t,initial);await h.review(backup);const before=await h.exported();
    failure==='lost response'?h.lose():h.failReadback();await h.action('confirm-import');assert.equal(h.app.status().storage.state,'unsaved');
    assert.deepEqual(await h.remote(),backup,'The restore actually committed despite the lost response');
    assert.deepEqual(await h.exported(),before,'Unconfirmed backup does not project as confirmed');
    const writes=h.db.batchCount;await h.action('sync');
    assert.equal(h.app.status().storage.state,'synced','Sync should recover the exact already-committed restore');
    assert.deepEqual(await h.exported(),backup);assert.equal(h.db.batchCount,writes,'Recovery must not rewrite the restore');
    assert.equal(h.db.sqlite.prepare('select count(*) n from journal_events').get().n,1);
  });
}

test('explicit restore rejection retains original history and a later corrected attempt can succeed',{concurrency:false},async t=>{
  const initial=base('independent-empty-rejected'),backup=await withSettings(base('independent-rejected-backup'),'independent-retry-event');
  const h=await harness(t,initial);await h.review(backup);h.reject();const writes=h.db.batchCount;
  await h.action('confirm-import');assert.equal(h.app.status().storage.state,'unsaved');assert.deepEqual(await h.remote(),initial);assert.deepEqual(await h.exported(),initial);assert.equal(h.db.batchCount,writes);
  await h.action('sync');assert.equal(h.app.status().storage.state,'synced');await h.review(backup);await h.action('confirm-import');
  assert.equal(h.app.status().storage.state,'synced');assert.deepEqual(await h.remote(),backup);assert.deepEqual(await h.exported(),backup);
});

for(const startingState of ['no stored journal','existing empty journal'])test(`${startingState}: uncertain identity adoption rejects unrelated and rewritten remote history, then recovers the exact reviewed backup`,{concurrency:false},async t=>{
  const initial=startingState==='no stored journal'?null:base('independent-guard-original'),backup=await withSettings(base('independent-guard-backup'),'independent-guard-event');
  const h=await harness(t,initial);await h.review(backup);h.lose();await h.action('confirm-import');
  const preserved=await h.exported();
  const wrongIdentity={...backup,journalId:'independent-unrelated-identity'};
  const rewritten=structuredClone(backup);rewritten.events[0].data.settings.paperNotional='999';
  for(const badRemote of [wrongIdentity,rewritten]){
    h.overrideGet(badRemote);const writes=h.db.batchCount;
    await h.action('sync');assert.equal(h.app.status().storage.state,'conflict');assert.deepEqual(await h.exported(),preserved);
    assert.deepEqual(await h.remote(),backup);assert.equal(h.db.batchCount,writes,'Rejected remote state cannot cause a write');
  }
  await h.action('sync');assert.equal(h.app.status().storage.state,'synced');assert.deepEqual(await h.exported(),backup);
});

test('a verified extension of an uncertain restored backup is adopted without dropping another session event',{concurrency:false},async t=>{
  const initial=base('independent-extended-original'),backup=await withSettings(base('independent-extended-backup'),'independent-first-event');
  const h=await harness(t,initial);await h.review(backup);h.lose();await h.action('confirm-import');
  const extended=await withSettings(backup,'independent-other-session-event','225');assert.equal((await h.appendRemote(extended)).status,200);
  const writes=h.db.batchCount;await h.action('sync');assert.equal(h.app.status().storage.state,'synced');assert.deepEqual(await h.exported(),extended);
  assert.equal(h.db.batchCount,writes);assert.equal(h.db.sqlite.prepare('select count(*) n from journal_events').get().n,2);
});
