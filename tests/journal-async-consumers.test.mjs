import test from 'node:test';
import assert from 'node:assert/strict';
import * as J from '../dist/lib/journal.js';
import { createJournalObserver } from '../server/journal/observe.mjs';
import { base, publication, calendar, ENROLL, SETTLED } from './fixtures/journal-observer.mjs';
import { resolvePaperWindow, resolvePriceMark } from '../dist/lib/prices.js';
const clone=structuredClone;
const options=()=>({id:'synthetic-enroll',at:ENROLL,publication:publication(),settings:{...J.DEFAULT_PAPER_SETTINGS},windowResolution:resolvePaperWindow({publishedAt:publication().publishedAt,horizonSessions:1,calendar:calendar(),at:ENROLL})});
async function abstained(){return clone((await J.recordAbstention(base(),{id:'synthetic-abstain',at:ENROLL,date:ENROLL.slice(0,10),horizonId:'next_day',reason:'Synthetic',snapshot:{}})).journal);}
async function enrolled(){const result=await J.enrollPublication(base(),options());assert.equal(result.ok,true,JSON.stringify(result));return result.journal;}

test('export filename and bytes describe the same invocation snapshot',async()=>{
 const input=await abstained(),expected=clone(input),pending=J.exportJournal(input);input.journalId='later-name';input.revision=999;
 const result=await pending;assert.equal(result.ok,true);assert.deepEqual(JSON.parse(result.text),expected);assert.equal(result.filename,`cribscore-journal-${expected.journalId}-r${expected.revision}.json`);
});

test('enrollment captures its base, publication, settings and resolved window before await',async()=>{
 const input=clone(base()),args=options(),expected=await J.enrollPublication(clone(input),clone(args));
 const pending=J.enrollPublication(input,args);input.journalId='later-base';args.publication.payloadBytes='{}';args.publication.payloadHash='0'.repeat(64);args.settings.paperNotional='900';args.windowResolution.window.entryAt='2026-11-24T15:00:00Z';
 assert.deepEqual(await pending,expected);
});

test('invalid enrollment settings cannot be repaired after invocation and base error still wins',async()=>{
 const args=options();args.settings.paperNotional='0';const pending=J.enrollPublication(base(),args);args.settings.paperNotional='100';
 assert.deepEqual(await pending,{ok:false,errors:['nonpositive_decimal']});
 const invalid={...base(),schemaVersion:'invalid'},cyclic=options();cyclic.publication.self=cyclic.publication;
 assert.deepEqual(await J.enrollPublication(invalid,cyclic),{ok:false,errors:['invalid_journal']});
});

test('duplicate enrollment returns a checked snapshot rather than the mutable caller history',async()=>{
 const once=await enrolled(),twice=await J.enrollPublication(once,options());assert.equal(twice.ok,true);
 const input=clone(twice.journal),expected=clone(input),pending=J.enrollPublication(input,options());input.revision=0;input.events=[];
 const result=await pending;assert.equal(result.ok,true);assert.equal(result.duplicate,true);assert.deepEqual(result.journal,expected);assert.equal(Object.isFrozen(result.journal),true);
});

test('evaluation iterates captured intents even when caller replaces its original event list',async()=>{
 const input=clone(await enrolled()),args={at:SETTLED,eventIdPrefix:'synthetic-eval',calendar:calendar(),resolvers:{resolvePaperWindow,resolvePriceMark}},expected=await J.evaluatePaper(clone(input),args);
 const pending=J.evaluatePaper(input,args);input.events=[];input.revision=0;
 const result=await pending;assert.deepEqual(result,expected);assert.equal(result.journal.events.filter(e=>e.kind==='paper_evaluation').length,1);
});

test('restore emptiness is checked against the invocation snapshot',async()=>{
 const input=await abstained(),pending=J.previewImport(input,JSON.stringify(base()),{mode:'restore'});input.events=[];input.revision=0;
 assert.deepEqual(await pending,{ok:false,errors:['restore_requires_empty_journal']});
});

test('a local change during merge validation makes import preview stale instead of being silently dropped',async t=>{
 const input=clone(await enrolled());
 const incoming=(await J.appendSettings(input,{id:'synthetic-import-settings',at:SETTLED,settings:{...J.DEFAULT_PAPER_SETTINGS,slippageBps:10}})).journal;
 const original=clone(input),nativeDigest=crypto.subtle.digest.bind(crypto.subtle);let calls=0,entered,release;
 const hashing=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 t.mock.method(crypto.subtle,'digest',async(...args)=>{const result=await nativeDigest(...args);if(++calls===3){entered();await gate;}return result;});
 const pending=J.previewImport(input,JSON.stringify(incoming));await hashing;
 input.events.push({id:'synthetic-local-settings',kind:'settings',at:SETTLED,data:{settings:{...J.DEFAULT_PAPER_SETTINGS,slippageBps:20}}});input.revision++;
 release();const reviewed=await pending;assert.equal(reviewed.ok,true);assert.equal(reviewed.preview.canApply,true);assert.equal(reviewed.preview.baseRevision,original.revision);
 assert.deepEqual(await J.applyImport(input,reviewed.preview),{ok:false,errors:['stale_import_preview']});
 const applied=await J.applyImport(original,reviewed.preview);assert.equal(applied.ok,true);assert.deepEqual(applied.journal,incoming);
});

test('direct observer request captures owner scope and receipt time before validating its journal',async()=>{
 const seen=[],observer=createJournalObserver({readPublications:async args=>{seen.push(args);return {status:'unconfigured'};},clock:()=>ENROLL});
 const input={journal:base(),receivedAt:ENROLL,requestId:'synthetic-request',ownerScope:'synthetic-owner-a'},pending=observer.observe(input);
 input.ownerScope='synthetic-owner-b';input.receivedAt='2027-01-01T00:00:00Z';input.requestId='later-request';
 const result=await pending;assert.equal(result.ok,true);assert.equal(seen[0].ownerScope,'synthetic-owner-a');assert.equal(result.observedAt,ENROLL);
});
