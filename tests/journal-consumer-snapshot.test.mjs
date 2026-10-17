import test from 'node:test';
import assert from 'node:assert/strict';
const domain=await import(process.env.JOURNAL_CANDIDATE||'../dist/lib/journal.js');
const {createJournal,validateJournal,appendSettings,DEFAULT_PAPER_SETTINGS,createLocalJournalStore,createHttpJournalStore}=domain;
const at='2026-10-17T12:00:00Z';
const journal=()=>({...createJournal({journalId:'synthetic-consumer',at}),revision:1,events:[{id:'first',kind:'abstain',at,data:{date:'2026-10-17',horizonId:'next_day',unrankedCount:0,reason:'Synthetic',snapshot:{}}}]});
const corrupt=j=>{j.events[0].kind='actual_fill';j.events[0].data={unvalidated:true};};
const fixture=()=>{let raw=null,writes=0;return {storage:{getItem:()=>raw,setItem:(_key,value)=>{writes++;raw=value;}},get raw(){return raw;},get writes(){return writes;},replace:value=>{raw=value;}};};

test('local commit persists exactly the validated snapshot and its returned revision',async()=>{
 const f=fixture(),store=createLocalJournalStore({storage:f.storage});await store.load();
 const input=journal(),before=structuredClone(input),pending=store.commit(input,{expectedRevision:0});corrupt(input);input.revision=99;
 const result=await pending;assert.equal(result.ok,true);assert.deepEqual(result.journal,before);assert.equal(result.revision,1);
 assert.deepEqual(JSON.parse(f.raw),before);assert.deepEqual((await store.load()).journal,before);assert.equal(f.writes,1);
});

test('local append checks the captured history even if the caller edits its original prefix',async()=>{
 const f=fixture(),store=createLocalJournalStore({storage:f.storage});await store.load();const before=journal();await store.commit(before,{expectedRevision:0});
 const next=(await appendSettings(before,{id:'settings',at,settings:{...DEFAULT_PAPER_SETTINGS}})).journal,input=structuredClone(next);
 const pending=store.commit(input,{expectedRevision:1});input.events[0].data.reason='Caller changed after invocation';
 const result=await pending;assert.equal(result.ok,true);assert.deepEqual(JSON.parse(f.raw),next);assert.equal(result.revision,2);
});

test('local compare-and-swap still rejects storage changed during validation with zero extra writes',async()=>{
 const f=fixture(),store=createLocalJournalStore({storage:f.storage});await store.load();const input=journal(),pending=store.commit(input,{expectedRevision:0});
 const competing=JSON.stringify({...input,journalId:'other-valid-owner-local-journal'});f.replace(competing);corrupt(input);
 assert.deepEqual(await pending,{ok:false,error:'revision_conflict',state:'conflict'});assert.equal(f.raw,competing);assert.equal(f.writes,0);
});

test('HTTP commit sends the validated snapshot and compares readback with that same snapshot',async()=>{
 let received,entered,release;const sent=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const store=createHttpJournalStore({fetch:async(_url,options)=>{received=JSON.parse(options.body);entered();await gate;return new Response(JSON.stringify({ok:true,journal:received.journal,revision:received.journal.revision}),{headers:{'content-type':'application/json'}});}});
 const input=journal(),before=structuredClone(input),pending=store.commit(input,{expectedRevision:0,mode:'restore'});corrupt(input);
 await sent;input.journalId='changed-again';input.revision=88;release();const result=await pending;
 assert.deepEqual(received,{expectedRevision:0,journal:before,mode:'restore'});assert.equal(result.ok,true);assert.equal(result.state,'synced');assert.deepEqual(result.journal,before);assert.equal(result.revision,1);
});

test('HTTP conflict response remains a conflict instead of a client mutation error',async()=>{
 const store=createHttpJournalStore({fetch:async()=>new Response(JSON.stringify({ok:false,error:'revision_conflict',revision:2,journal:null}),{status:409,headers:{'content-type':'application/json'}})});
 const input=journal(),pending=store.commit(input,{expectedRevision:0});corrupt(input);
 assert.deepEqual(await pending,{ok:false,error:'revision_conflict',revision:2,journal:null,state:'conflict'});
});

test('append captures both the validated base and pending settings before its first await',async()=>{
 const input=journal(),before=structuredClone(input),settings={...DEFAULT_PAPER_SETTINGS},pending=appendSettings(input,{id:'settings',at,settings});
 corrupt(input);settings.paperNotional='250';settings.slippageBps=99;
 const result=await pending;assert.equal(result.ok,true);assert.deepEqual(result.journal.events[0],before.events[0]);assert.deepEqual(result.journal.events[1].data.settings,DEFAULT_PAPER_SETTINGS);assert.equal((await validateJournal(result.journal)).ok,true);
});

test('append does not accept a later repair to invalid pending settings',async()=>{
 const settings={...DEFAULT_PAPER_SETTINGS,paperNotional:'0'},pending=appendSettings(journal(),{id:'settings',at,settings});settings.paperNotional='100';
 assert.deepEqual(await pending,{ok:false,errors:['nonpositive_decimal']});
});

test('append preserves invalid-base precedence over uncloneable pending additions',async()=>{
 const invalid=journal();invalid.schemaVersion='unknown';const settings={...DEFAULT_PAPER_SETTINGS};settings.cycle=settings;
 assert.deepEqual(await appendSettings(invalid,{id:'settings',at,settings}),{ok:false,errors:['invalid_journal']});
});
