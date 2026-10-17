import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const {validateJournal,createJournal,DEFAULT_PAPER_SETTINGS,projectJournal} = await import(process.env.JOURNAL_CANDIDATE || '../dist/lib/journal.js');
const at='2026-10-17T12:00:00Z',entry='2026-10-19T13:30:00Z',posted='2026-10-19T21:00:00Z';
const abstain=id=>({id,kind:'abstain',at,data:{date:'2026-10-17',horizonId:'next_day',unrankedCount:0,reason:'Synthetic observation',snapshot:{retained:'original'}}});
const journal=(events=[abstain('first')])=>({...createJournal({journalId:'synthetic-snapshot',at}),events:structuredClone(events),revision:events.length});
async function stableResult(result,expected){assert.deepEqual(result,{ok:true,journal:expected});assert.equal(Object.isFrozen(result.journal.events[0].data),true);assert.deepEqual(await validateJournal(result.journal),result);}

test('already checked event cannot be replaced with an unvalidated actual fill before acceptance',async()=>{
 const input=journal(),before=structuredClone(input),pending=validateJournal(input);
 input.events[0].kind='actual_fill';input.events[0].data={unvalidated:true};
 await stableResult(await pending,before);
 assert.deepEqual((await validateJournal(input)).errors,['actual_confirmation_missing']);
});

test('caller array append, removal and replacement after the first await cannot change the captured journal',async()=>{
 for(const mutate of [j=>{j.events.push({id:'unvalidated',kind:'actual_fill',at,data:{}});j.revision++;},j=>{j.events.splice(0,2);j.revision=0;},j=>{j.events=[{id:'injected',kind:'actual_fill',at,data:{}}];j.revision=1;j.journalId='changed';}]){
  const input=journal([abstain('first'),abstain('second')]),before=structuredClone(input),pending=validateJournal(input);mutate(input);await stableResult(await pending,before);
 }
});

test('a later malformed event cannot be repaired after validation starts to erase its first error',async()=>{
 const input=journal([abstain('first'),{...abstain('second'),data:{...abstain('second').data,unrankedCount:-1}}]);
 const pending=validateJournal(input);input.events[1].data.unrankedCount=0;
 assert.deepEqual(await pending,{ok:false,errors:['invalid_abstention']});assert.equal((await validateJournal(input)).ok,true);
});

test('a later valid event cannot be corrupted while an earlier event is awaiting acceptance',async()=>{
 const input=journal([abstain('first'),abstain('second')]),before=structuredClone(input),pending=validateJournal(input);
 input.events[1].data.unrankedCount=-1;input.events[0].id='same';input.events[1].id='same';
 await stableResult(await pending,before);
});

function accountingJournal(){
 const payloadBytes=JSON.stringify({schema_version:'synthetic',policy_version:'synthetic',generated_at:at,horizon:{id:'next_day',entry_at:entry,exit_at:'2026-10-19T20:00:00Z'},rows:[{ticker:'AAA',company:'Synthetic'}]});
 return journal([
  {id:'pub',kind:'publication',at,data:{publicationId:'synthetic-pub',publishedAt:at,payloadHash:createHash('sha256').update(payloadBytes).digest('hex'),payloadBytes,policyVersion:'synthetic',snapshotVersion:'synthetic',horizonId:'next_day',entities:[{symbol:'AAA',entityId:'synthetic-AAA'}]}},
  {id:'intent',kind:'paper_intent',at,data:{publicationEventId:'pub',symbol:'AAA',settings:{...DEFAULT_PAPER_SETTINGS},window:null,date:'2026-10-17'}},
  {id:'confirmation',kind:'actual_confirmation',at:posted,data:{intentId:'intent',confirmed:true}},
  {id:'fill',kind:'actual_fill',at:posted,data:{intentId:'intent',fill:{side:'buy',occurredAt:entry,quantity:'3',price:'100',fee:'0',currency:'USD'}}},
  {id:'sale',kind:'actual_fill',at:posted,data:{intentId:'intent',fill:{side:'sell',occurredAt:entry,quantity:'1',price:'101',fee:'0',currency:'USD'}}},
 ]);
}

test('publication hashing holds one stable snapshot of payload, settings, fills and event identities',async t=>{
 const input=accountingJournal(),before=structuredClone(input),expected=await validateJournal(before);assert.equal(expected.ok,true);
 const nativeDigest=crypto.subtle.digest.bind(crypto.subtle);let entered,release;
 const hashing=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 t.mock.method(crypto.subtle,'digest',async(...args)=>{const digest=await nativeDigest(...args);entered();await gate;return digest;});
 const pending=validateJournal(input);await hashing;
 input.events[0].data.payloadBytes='{}';input.events[0].data.payloadHash='0'.repeat(64);input.events[1].data.settings.paperNotional='0';input.events[3].data.fill.side='sell';input.events[3].data.fill.quantity='99';input.events[4].id='fill';input.events.push({id:'tail',kind:'actual_fill',at:posted,data:{}});input.revision++;
 release();const result=await pending;
 assert.deepEqual(result,expected);assert.deepEqual(projectJournal(result.journal),projectJournal(expected.journal));
});

test('separate concurrent calls capture their own invocation-time input without cached acceptance',async()=>{
 const input=journal(),before=structuredClone(input),first=validateJournal(input);
 input.events[0].data.unrankedCount=-1;const second=validateJournal(input);input.events[0].data.unrankedCount=4;
 await stableResult(await first,before);assert.deepEqual(await second,{ok:false,errors:['invalid_abstention']});
 const third=await validateJournal(input);assert.equal(third.ok,true);assert.equal(third.journal.events[0].data.unrankedCount,4);
});

test('stable input retains schema, capacity, safe-JSON, duplicate-ID and event-error precedence',async()=>{
 const invalidSchema=journal();invalidSchema.schemaVersion='unknown';invalidSchema.events[0].data.unrankedCount=-1;
 assert.deepEqual((await validateJournal(invalidSchema)).errors,['invalid_journal']);
 const overCapacity=journal(Array(20_001).fill(abstain('same')));overCapacity.events[0].kind='unknown';
 assert.deepEqual((await validateJournal(overCapacity)).errors,['journal_capacity_exceeded']);
 const unsafe=journal();unsafe.events[0].data.snapshot={constructor:'forbidden'};unsafe.events[0].kind='unknown';assert.deepEqual((await validateJournal(unsafe)).errors,['journal_limits']);
 const duplicate=journal([abstain('same'),abstain('same')]);duplicate.events[1].data.unrankedCount=-1;assert.deepEqual((await validateJournal(duplicate)).errors,['duplicate_event_id']);
 const firstBad=journal([abstain('first'),abstain('second')]);firstBad.events[0].data.unrankedCount=-1;firstBad.events[1].kind='unknown';assert.deepEqual((await validateJournal(firstBad)).errors,['invalid_abstention']);
});
