// Synthetic correction histories; no real owner, market or provider data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createJournal,validateJournal,projectJournal,checkAppendOnly,DEFAULT_PAPER_SETTINGS} from '../dist/lib/journal.js';
const createdAt='2026-10-17T12:00:00Z',at='2026-10-19T21:00:00Z',occurredAt='2026-10-19T13:30:00Z';
const fill={side:'buy',occurredAt,quantity:'1',price:'100',fee:'0',currency:'USD'};
const event=(id,kind,data,time=at)=>({id,kind,at:time,data});
function base(){
 const journal={...createJournal({journalId:'synthetic-fill-history',at:createdAt}),events:[]};
 const payloadBytes=JSON.stringify({schema_version:'synthetic-v1',policy_version:'synthetic-v1',generated_at:createdAt,horizon:{id:'next_day',entry_at:occurredAt,exit_at:'2026-10-19T20:00:00Z'},rows:[{ticker:'AAA',company:'Synthetic AAA'}]});
 for(const id of ['one','two'])journal.events.push(
  event(`pub-${id}`,'publication',{publicationId:`publication-${id}`,publishedAt:createdAt,payloadHash:createHash('sha256').update(payloadBytes).digest('hex'),payloadBytes,policyVersion:'synthetic-v1',snapshotVersion:'synthetic-v1',horizonId:'next_day',entities:[{symbol:'AAA',entityId:'synthetic-AAA'}]},createdAt),
  event(`intent-${id}`,'paper_intent',{publicationEventId:`pub-${id}`,symbol:'AAA',settings:{...DEFAULT_PAPER_SETTINGS},window:null,date:'2026-10-17'},createdAt),
  event(`confirm-${id}`,'actual_confirmation',{intentId:`intent-${id}`,confirmed:true}),
  event(`fill-${id}`,'actual_fill',{intentId:`intent-${id}`,fill:{...fill}}));
 journal.revision=journal.events.length;return journal;
}
const add=(j,...events)=>({...j,events:[...j.events,...events],revision:j.events.length+events.length});
const correction=(id,fillId,price,time=at)=>event(id,'fill_revision',{fillId,replacement:{...fill,price},reason:'Synthetic correction.'},time);
const actual=(j,id)=>projectJournal(j).entries.find(e=>e.id===`intent-${id}`).actual;

test('latest correction follows append order, preserves originals and isolates intents',async()=>{
 const prior=base(),before=structuredClone(prior),next=add(prior,correction('later-clock','fill-one','99','2026-10-19T22:00:00Z'),correction('other-intent','fill-two','88'),correction('later-ledger','fill-one','97'));
 const checked=await validateJournal(next);assert.equal(checked.ok,true,JSON.stringify(checked.errors));
 assert.equal(actual(checked.journal,'one').fills[0].price,'97');assert.equal(actual(checked.journal,'two').fills[0].price,'88');
 assert.equal(checked.journal.events.find(e=>e.id==='fill-one').data.fill.price,'100');assert.deepEqual(prior,before);assert.equal(checkAppendOnly(prior,checked.journal).ok,true);
 assert.equal(actual(checked.journal,'one').realizedPnl,null);assert.deepEqual(actual(checked.journal,'one').pendingReasons,['actual_action_coverage_missing']);
});

test('a later repair cannot conceal an earlier correction that oversells its prefix',async()=>{
 const prior=base(),sell=event('sell-one','actual_fill',{intentId:'intent-one',fill:{...fill,side:'sell',occurredAt:'2026-10-19T14:00:00Z'}});
 const bad=correction('bad','fill-one','100');bad.data.replacement.quantity='0.5';
 const next=add(prior,sell,bad,correction('repair','fill-one','100'));
 assert.deepEqual((await validateJournal(next)).errors,['oversell']);
});

test('replacement lookup is fresh for every projection and validation',async()=>{
 const prior=base(),next=add(prior,correction('change','fill-one','99'));
 assert.equal((await validateJournal(next)).ok,true);assert.equal(actual(next,'one').fills[0].price,'99');
 assert.equal((await validateJournal(prior)).ok,true);assert.equal(actual(prior,'one').fills[0].price,'100');
 assert.equal(actual(next,'one').fills[0].price,'99');assert.equal(Object.hasOwn(next,'replacements'),false);
});

test('missing targets and malformed replacements keep their validation errors',async()=>{
 const prior=base();assert.deepEqual((await validateJournal(add(prior,correction('missing','unknown-fill','99')))).errors,['invalid_fill_revision']);
 const malformed=correction('malformed','fill-one','99');malformed.data.replacement=null;
 assert.deepEqual((await validateJournal(add(prior,malformed))).errors,['invalid_fill']);
});
