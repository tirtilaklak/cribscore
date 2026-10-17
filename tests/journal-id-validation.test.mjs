// Synthetic validation histories only; no owner or market data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateJournal,createJournal,appendSettings,checkAppendOnly,DEFAULT_PAPER_SETTINGS} from '../dist/lib/journal.js';

const at='2026-10-17T12:00:00Z';
const setting=id=>({id,kind:'settings',at,data:{settings:{...DEFAULT_PAPER_SETTINGS}}});
const history=events=>({...createJournal({journalId:'synthetic-id-validation',at}),revision:events.length,events});
const error=async(events,expected)=>assert.deepEqual((await validateJournal(history(events))).errors,[expected]);

test('event IDs remain case-sensitive and safe for ordinary prototype-like strings',async()=>{
 const journal=history(['same','Same','constructor','toString'].map(setting)),before=structuredClone(journal);
 const first=await validateJournal(journal),second=await validateJournal(journal);
 assert.equal(first.ok,true);assert.deepEqual(second,first);assert.deepEqual(journal,before);
 assert.equal(Object.isFrozen(first.journal),true);assert.equal(Object.isFrozen(first.journal.events[0].data.settings),true);
 for(const id of ['same','constructor','toString'])await error([...journal.events,setting(id)],'duplicate_event_id');
});

test('duplicates at the beginning, middle and end of a validated prefix stay rejected',async()=>{
 const events=Array.from({length:1000},(_,i)=>setting(`event-${i}`));
 for(const index of [0,499,999])await error([...events,setting(events[index].id)],'duplicate_event_id');
 assert.equal((await validateJournal(history(events))).ok,true);
});

test('event shape and clock errors precede duplicate-ID rejection',async()=>{
 const first=setting('same');
 for(const duplicate of [{...setting('same'),extra:true},{...setting('same'),at:'bad-clock'},{...setting('same'),data:[]}])await error([first,duplicate],'invalid_event');
});

test('a valid-shaped duplicate still precedes event-kind and event-data errors',async()=>{
 await error([setting('same'),{...setting('same'),kind:'unknown-kind'}],'duplicate_event_id');
 await error([setting('same'),{...setting('same'),data:{}}],'duplicate_event_id');
});

test('earlier invalid events remain the first failure rather than a later duplicate',async()=>{
 await error([{...setting('first'),kind:'unknown-kind'},setting('same'),setting('same')],'unknown_event_kind');
 await error([{...setting('first'),data:{}},setting('same'),setting('same')],'invalid_settings_event');
 const bad=history([setting('same'),setting('same')]);bad.revision=1;
 assert.deepEqual((await validateJournal(bad)).errors,['invalid_journal']);
});

test('references remain limited to the validated prefix and do not see future IDs',async()=>{
 const reference={id:'reference',kind:'duplicate',at,data:{targetEventId:'target',date:'2026-10-17',reason:'Synthetic reference validation.'}};
 await error([reference,setting('target')],'invalid_duplicate');
 assert.equal((await validateJournal(history([setting('target'),reference]))).ok,true);
});

test('append validates IDs afresh without rewriting the prior ledger',async()=>{
 const base=createJournal({journalId:'synthetic-append-validation',at});
 const first=await appendSettings(base,{id:'setting',at,settings:DEFAULT_PAPER_SETTINGS});assert.equal(first.ok,true);
 const duplicate=await appendSettings(first.journal,{id:'setting',at,settings:DEFAULT_PAPER_SETTINGS});assert.deepEqual(duplicate.errors,['duplicate_event_id']);
 const next=await appendSettings(first.journal,{id:'second',at,settings:{...DEFAULT_PAPER_SETTINGS,slippageBps:6}});
 assert.equal(next.ok,true);assert.equal(checkAppendOnly(first.journal,next.journal).ok,true);assert.deepEqual(next.journal.events[0],first.journal.events[0]);assert.equal(first.journal.revision,1);
 assert.equal((await validateJournal(first.journal)).ok,true);
});
