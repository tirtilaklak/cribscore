import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import * as domain from '../dist/lib/journal.js';

const at='2026-10-17T17:50:00Z',createdAt='2026-10-17T17:00:00Z';
const settings=notional=>({...domain.DEFAULT_PAPER_SETTINGS,paperNotional:notional});
const jsonResponse=journal=>({ok:true,status:200,json:async()=>({ok:true,journal,revision:journal?.revision??0,automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:['publisher_unconfigured']}})});
const copy=x=>JSON.parse(JSON.stringify(x));
async function harness({empty=false}={}){
  const handlers={},requests=[],blobs=[];let uid=0,failCommit=false;
  const initial=domain.createJournal({journalId:'synthetic-continuity-journal',at:createdAt});
  let remote=empty?null:(await domain.recordAbstention(initial,{id:'confirmed-abstention',at,date:'2026-10-17',horizonId:'next_day',unrankedCount:6})).journal;
  const document={querySelector:()=>null,addEventListener:(name,fn)=>handlers[name]=fn,removeEventListener(){},body:{append(){}},createElement:()=>({click(){},remove(){}})};
  const oldFormData=globalThis.FormData,oldObjectURL=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
  globalThis.FormData=class{constructor(form){this.values=form.values;}get(k){return this.values[k]??null;}};
  URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic-continuity';};URL.revokeObjectURL=()=>{};
  const app=createDeskTools({document,now:()=>at,uuid:()=>`continuity-${++uid}`,fetch:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;requests.push({url,method:options.method,body});
    if(url==='/api/journal/observe'||options.method==='GET')return jsonResponse(copy(remote));
    if(failCommit)return {ok:false,status:503,json:async()=>({ok:false,error:'synthetic_unavailable'})};
    assert.equal(body.expectedRevision,remote?.revision??0);
    remote=copy(body.journal);return jsonResponse(copy(remote));
  }});
  const flush=async()=>{for(let i=0;i<25;i++)await new Promise(resolve=>setImmediate(resolve));};
  const action=async name=>{const target={dataset:{journalAction:name},closest:()=>target};handlers.click({target});await flush();};
  const submit=async values=>{const form={dataset:{journalForm:'settings'},values,closest:()=>form};handlers.submit({target:form,preventDefault(){}});await flush();};
  const exported=async()=>{await action('export');return JSON.parse(await blobs.at(-1).text());};
  return {app,requests,initial,action,submit,exported,remote:()=>remote,setRemote:x=>remote=x,failCommit:x=>failCommit=x,destroy(){app.destroy();globalThis.FormData=oldFormData;URL.createObjectURL=oldObjectURL;URL.revokeObjectURL=oldRevoke;}};
}

for(const variant of ['null','older','different_identity','replaced_prefix'])test(`sync rejects ${variant} history and recovers on a valid extension`,{concurrency:false},async()=>{
  const h=await harness();try{
    await h.app.start();const confirmed=await h.exported();
    let bad=variant==='null'?null:domain.createJournal({journalId:variant==='different_identity'?'synthetic-other-identity':confirmed.journalId,at:confirmed.createdAt});
    if(variant==='replaced_prefix')bad=(await domain.appendSettings(bad,{id:'replaces-confirmed-prefix',at,settings:settings('200')})).journal;
    h.setRemote(bad);const observations=h.requests.filter(r=>r.url.endsWith('/observe')).length;
    await h.action('sync');assert.equal(h.app.status().storage.state,'conflict');assert.equal(h.app.status().automation.pendingReasons[0],'journal_history_conflict');
    assert.deepEqual(await h.exported(),confirmed);assert.equal(h.app.html('journal').includes('Start your private journal'),false);
    assert.equal(h.requests.filter(r=>r.url.endsWith('/observe')).length,observations);
    const next=(await domain.appendSettings(confirmed,{id:'valid-extension',at,settings:settings('250')})).journal;
    h.setRemote(next);await h.action('sync');assert.equal(h.app.status().storage.state,'synced');assert.deepEqual(await h.exported(),next);
  }finally{h.destroy();}
});

test('rollback cannot replace confirmed baseline during unsynced-draft reconciliation',{concurrency:false},async()=>{
  const h=await harness();try{
    await h.app.start();const confirmed=await h.exported();h.failCommit(true);
    await h.submit({paperNotional:'333',commissionPerFill:'0',slippageBps:'5',benchmarkSymbol:'SPY'});
    const unsynced=await h.exported();assert.equal(h.app.status().storage.state,'unsaved');
    h.setRemote(h.initial);await h.action('sync');assert.equal(h.app.status().storage.state,'conflict');assert.deepEqual(await h.exported(),unsynced);
    assert.equal(h.app.html('journal').includes('Reconcile 1 unsynced event'),false);
    const extended=(await domain.appendSettings(confirmed,{id:'other-device-append',at,settings:settings('444')})).journal;
    h.setRemote(extended);h.failCommit(false);await h.action('sync');assert.match(h.app.html('journal'),/Reconcile 1 unsynced event/);
    assert.deepEqual(await h.exported(),unsynced);await h.action('confirm-import');
    const final=await h.exported();assert.equal(h.app.status().storage.state,'synced');assert.equal(final.events.length,3);
    assert.ok(final.events.some(e=>e.id==='other-device-append'));assert.ok(final.events.some(e=>e.id===unsynced.events.at(-1).id));
  }finally{h.destroy();}
});

test('first empty setup remains possible but later null cannot reset its confirmed identity',{concurrency:false},async()=>{
  const h=await harness({empty:true});try{
    await h.app.start();await h.app.observe();assert.equal(h.requests.length,1);assert.match(h.app.html('journal'),/Start your private journal/);
    await h.action('start');const confirmed=await h.exported();assert.equal(confirmed.revision,0);assert.ok(h.remote());
    h.setRemote(null);await h.action('sync');assert.equal(h.app.status().storage.state,'conflict');assert.deepEqual(await h.exported(),confirmed);assert.equal(h.app.html('journal').includes('Start your private journal'),false);
  }finally{h.destroy();}
});
