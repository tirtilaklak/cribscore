import test from 'node:test';
import assert from 'node:assert/strict';
import { createJournalObserver } from '../server/journal/observe.mjs';
import { createJournal, validateJournal, checkAppendOnly, projectJournal, appendSettings } from '../dist/lib/journal.js';
import { resolvePaperWindow } from '../dist/lib/prices.js';
import { base,calendar,publication,archive,observationContext,readers,request,ENROLL,SETTLED } from './fixtures/journal-observer.mjs';
const observer=(config,at=ENROLL)=>createJournalObserver({...config,clock:()=>at});
const must=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result;};

test('unconfigured, complete empty and unavailable publisher states remain distinct; no missed-day backfill',async()=>{
  const original=base(),frozen=JSON.stringify(original);
  const unconfigured=must(await observer({readObservationContext:observationContext}).observe(request(original)));
  assert.equal(unconfigured.automation.publisherState,'unconfigured');assert.equal(unconfigured.journal.events.length,2);assert.ok(unconfigured.journal.events.every(e=>e.kind==='abstain'&&e.data.date==='2026-11-24'&&e.data.reason.includes('not configured')));assert.equal(unconfigured.journal.events[0].data.snapshot.id,'saved-next_day');
  const retry=must(await observer({readObservationContext:observationContext}).observe(request(unconfigured.journal)));assert.equal(retry.changed,false);
  const empty=must(await observer({readPublications:archive([]),readObservationContext:observationContext}).observe(request()));assert.equal(empty.automation.publisherState,'empty');assert.ok(empty.journal.events.every(e=>e.data.reason.includes('complete checked archive')));
  const unavailable=must(await observer({readPublications:async()=>{throw Error('offline private details');},readObservationContext:observationContext}).observe(request()));assert.equal(unavailable.automation.publisherState,'unavailable');assert.equal(unavailable.changed,false);assert.equal(unavailable.journal.events.length,0);assert.equal(JSON.stringify(unavailable).includes('private details'),false);assert.equal(JSON.stringify(original),frozen);
});
test('every published row and both horizons enroll with frozen benchmark identity; duplicate reads do not add positions',async()=>{
  const publications=[publication({symbols:['AAA','BBB']}),publication({id:'synthetic-week',horizon:'next_week',symbols:['AAA']})],o=observer(readers(publications));
  const first=must(await o.observe(request()));assert.equal(first.journal.events.filter(e=>e.kind==='paper_intent').length,3);assert.ok(first.journal.events.filter(e=>e.kind==='paper_intent').every(e=>e.data.settings.benchmarkEntityId==='synthetic-SPY'));assert.equal(first.journal.events.some(e=>e.kind==='actual_confirmation'),false);
  const second=must(await o.observe(request(first.journal,ENROLL,'second-request')));assert.equal(second.changed,false);assert.equal(second.journal.revision,first.journal.revision);
  const repeated=must(await observer(readers([publications[0],publications[0]],{marks:false})).observe(request()));assert.equal(repeated.journal.events.filter(e=>e.kind==='paper_intent').length,2);
  assert.equal(checkAppendOnly(first.journal,second.journal).ok,true);assert.equal((await validateJournal(second.journal)).ok,true);
});
test('a complete archive with one horizon still records the other observed horizon as empty',async()=>{
  const result=must(await observer({...readers([publication()]),readObservationContext:observationContext}).observe(request()));
  assert.equal(result.journal.events.filter(e=>e.kind==='abstain').length,1);assert.equal(result.journal.events.find(e=>e.kind==='abstain').data.horizonId,'next_week');
});
test('asynchronous publication/calendar/price readers cannot backdate an intent across entry',async()=>{
  for(const target of ['readPublications','readCalendar','readReviewedPrices']){
    let clock=ENROLL;const config=readers([publication()]),read=config[target];config[target]=async args=>{const result=await read(args);clock='2026-11-24T14:30:00Z';return result;};
    const result=must(await createJournalObserver({...config,clock:()=>clock}).observe(request()));assert.equal(result.observedAt,clock);assert.equal(result.journal.events.some(e=>e.kind==='paper_intent'),false);assert.equal(result.journal.events.filter(e=>e.kind==='no_fill').length,1);assert.equal(result.journal.events[0].data.publishedAt,'2026-11-24T13:00:00Z');
  }
});
test('clock rollback cannot reduce receipt time; invalid and future-before-history clocks fail explicitly',async()=>{
  const result=must(await observer(readers([publication()]),ENROLL).observe(request(base(),'2026-11-24T14:30:00.001Z')));assert.equal(result.observedAt,'2026-11-24T14:30:00.001Z');assert.equal(result.journal.events.at(-1).kind,'no_fill');
  const bad=await createJournalObserver({clock:()=> '2026-02-30T00:00:00Z'}).observe(request());assert.deepEqual(bad.errors,['server_clock_unavailable']);
  const future=createJournal({journalId:'future-journal',at:'2026-11-25T00:00:00Z'});assert.deepEqual((await observer({}).observe(request(future))).errors,['server_clock_before_history']);
});
test('verified exchange holiday and early close define five sessions; no weekday arithmetic',async()=>{
  const p=publication({horizon:'next_week'}),result=must(await observer(readers([p])).observe(request()));const w=result.journal.events.find(e=>e.kind==='paper_intent').data.window;
  assert.deepEqual(w.sessions.map(s=>s.date),['2026-11-24','2026-11-25','2026-11-27','2026-11-30','2026-12-01']);assert.equal(w.sessions[2].closeAt,'2026-11-27T18:00:00Z');assert.equal(w.exitAt,'2026-12-01T21:00:00Z');
});
test('New York DST transition uses reviewed UTC open; inconsistent calendar timezone cannot establish a window',async()=>{
  const cal=calendar();cal.coverageStart='2026-10-30';cal.coverageEnd='2026-11-02';cal.reviewedAt='2026-10-29T12:01:00Z';cal.source.capturedAt='2026-10-29T12:00:00Z';cal.sessions=[{date:'2026-10-30',openAt:'2026-10-30T13:30:00Z',closeAt:'2026-10-30T20:00:00Z'},{date:'2026-11-02',openAt:'2026-11-02T14:30:00Z',closeAt:'2026-11-02T21:00:00Z'}];
  const publishedAt='2026-10-30T20:01:00Z',p=publication({publishedAt,cal}),j=createJournal({journalId:'synthetic-dst-journal',at:'2026-10-30T12:00:00Z'}),at='2026-10-30T21:00:00Z';const result=must(await observer(readers([p],{cal}),at).observe(request(j,at)));assert.equal(result.journal.events.find(e=>e.kind==='paper_intent').data.window.entryAt,'2026-11-02T14:30:00Z');
  const wrong=structuredClone(cal);wrong.timeZone='Pacific/Auckland';const bad=must(await observer(readers([p],{cal:wrong}),at).observe(request(j,at)));assert.equal(bad.journal.events.find(e=>e.kind==='paper_intent').data.window,null);assert.ok(bad.automation.pendingReasons.includes('calendar_session_timezone_mismatch'));
});
test('delayed reviewed bars settle only existing intents; default costs, benchmark and immutable history remain',async()=>{
  const p=publication({horizon:'next_week'}),first=must(await observer(readers([p])).observe(request()));const before=JSON.stringify(first.journal);
  const result=must(await observer(readers([p],{marks:true}),SETTLED).observe(request(first.journal,SETTLED,'settlement')));const row=projectJournal(result.journal).entries[0];assert.equal(row.status,'closed');assert.notEqual(row.paper.realizedPnl,null);assert.notEqual(row.paper.benchmarkPnl,null);assert.equal(row.paper.assumptions.slippageBps,5);assert.equal(row.actual.confirmed,false);assert.equal(JSON.stringify(first.journal),before);assert.equal(checkAppendOnly(first.journal,result.journal).ok,true);
  const late=must(await observer(readers([p],{marks:true}),SETTLED).observe(request(base(),SETTLED)));assert.equal(late.journal.events.some(e=>e.kind==='paper_evaluation'),false);assert.equal(projectJournal(late.journal).entries[0].status,'no_fill');
});
test('missing, manually imported and incomplete-action prices stay pending rather than zero',async()=>{
  const p=publication(),first=must(await observer(readers([p])).observe(request()));
  for(const change of [s=>{s.bars=[];},s=>{s.source.channel='manual_import';},s=>{s.actions.status='unknown';}]){
    const result=must(await observer(readers([p],{marks:true,changePrice:change}),SETTLED).observe(request(first.journal,SETTLED,'pending')));const row=projectJournal(result.journal).entries[0];assert.equal(row.status,'pending');assert.equal(row.paper.realizedPnl,null);assert.equal(row.paper.openPnl,null);assert.equal(row.paper.benchmarkPnl,null);assert.ok(result.automation.pendingReasons.length);
  }
});
test('separate same-time publications dispatch target contexts without unrelated null collisions',async()=>{
  const pubs=[publication({id:'one',symbols:['AAA']}),publication({id:'two',symbols:['BBB']})],first=must(await observer(readers(pubs)).observe(request()));const result=must(await observer(readers(pubs,{marks:true}),SETTLED).observe(request(first.journal,SETTLED,'both')));assert.deepEqual(projectJournal(result.journal).entries.map(e=>e.status),['closed','closed']);
});
test('malformed/incomplete/conflicting source records retain the input journal; no silent replacement',async()=>{
  const j=base(),before=JSON.stringify(j),p=publication();
  const incomplete=async()=>({status:'ready',coverage:{fromAt:j.createdAt,throughAt:ENROLL,horizonIds:['next_day'],complete:true},publications:[p]});assert.deepEqual((await observer({readPublications:incomplete}).observe(request(j))).errors,['publication_coverage_incomplete']);
  const changed=structuredClone(p);changed.payloadBytes+=' ';assert.deepEqual((await observer({readPublications:archive([changed])}).observe(request(j))).errors,['publication_hash_mismatch']);
  const forged=await observer({}).observe({...request(j),authority:{publication:true}});assert.deepEqual(forged.errors,['invalid_observation_request']);assert.equal(JSON.stringify(j),before);
});
test('benchmark identity cannot change under a frozen intent or contradictory current binding',async()=>{
  const p=publication(),initial=must(await observer(readers([p])).observe(request()));const changed=(await appendSettings(initial.journal,{id:'new-assumptions',at:ENROLL,settings:{...projectJournal(initial.journal).settings,benchmarkEntityId:'other-SPY'}})).journal;
  const result=must(await observer(readers([p],{marks:true}),SETTLED).observe(request(changed,SETTLED,'frozen')));assert.equal(projectJournal(result.journal).entries[0].paper.assumptions.benchmarkEntityId,'synthetic-SPY');
  const nextPublication=publication({id:'new-publication'});assert.deepEqual((await observer(readers([p,nextPublication])).observe(request(changed))).errors,['benchmark_identity_conflict']);
});
