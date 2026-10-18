import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CALENDAR_RECORD, REVIEWED_STATUS, createCalendarReader, readCalendar } from '../server/calendar/calendar.mjs';
import { createJournalObserver } from '../server/journal/observe.mjs';
import { createJournal, validateJournal, checkAppendOnly } from '../dist/lib/journal.js';
import { publication, archive } from './fixtures/journal-observer.mjs';

// Synthetic publications and a test-only reviewed copy of the shipped record.
// No network: the reader is pure and the observer gets function references.
const CREATED='2026-10-18T22:45:00Z',PUBLISHED='2026-10-18T23:00:00Z',AT='2026-10-18T23:30:00Z';
const reviewed=()=>({...structuredClone(CALENDAR_RECORD),status:REVIEWED_STATUS,reviewer:'synthetic-reviewer',reviewedAt:'2026-10-18T22:30:00Z'});
const journal=()=>createJournal({journalId:'synthetic-calendar-chain-journal',at:CREATED});
const request=(j,requestId='calendar-chain',receivedAt=AT)=>({journal:j,receivedAt,requestId,ownerScope:'synthetic-owner'});
const observe=(readers,at=AT)=>createJournalObserver({...readers,clock:()=>at});
const must=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result;};
const publications=cal=>[publication({id:'synthetic-day-1019',horizon:'next_day',symbols:['AAA'],publishedAt:PUBLISHED,cal}),publication({id:'synthetic-week-1019',horizon:'next_week',symbols:['BBB'],publishedAt:PUBLISHED,cal})];
const args=(pubs,frozenIntents=[])=>({ownerScope:'synthetic-owner',at:AT,publications:pubs,frozenIntents});
const intents=result=>result.journal.events.filter(e=>e.kind==='paper_intent');

test('the shipped reader answers unconfigured for the unreviewed record, exactly like a null reader',async()=>{
  assert.equal(readCalendar.state,'unconfigured');assert.deepEqual(readCalendar.reasons,[]);
  const pubs=publications(reviewed());
  assert.deepEqual(await readCalendar(args(pubs)),{status:'unconfigured'});
  const withReader=must(await observe({readPublications:archive(pubs),readCalendar}).observe(request(journal())));
  const withNull=must(await observe({readPublications:archive(pubs),readCalendar:null}).observe(request(journal())));
  assert.deepEqual(withReader.journal,withNull.journal);assert.deepEqual(withReader.automation,withNull.automation);
  assert.ok(withReader.automation.pendingReasons.includes('calendar_unavailable'));
  assert.equal(intents(withReader).length,2);assert.ok(intents(withReader).every(e=>e.data.window===null));
});
test('a reviewed copy resolves the 2026-10-19 windows through the reader, the observer and the journal',async()=>{
  const cal=reviewed(),reader=createCalendarReader({record:cal}),pubs=publications(cal);
  assert.equal(reader.state,'ready');assert.deepEqual(reader.reasons,[]);
  const served=await reader(args(pubs));
  assert.equal(served.status,'ready');assert.deepEqual(served.contexts.map(c=>c.publicationId),pubs.map(p=>p.publicationId));
  const calendar=served.contexts[0].calendar;
  assert.deepEqual(Object.keys(calendar).sort(),['coverageEnd','coverageStart','id','reviewedAt','sessions','source','status','timeZone']);
  assert.deepEqual(Object.keys(calendar.source).sort(),['capturedAt','responseSha256','url']);
  assert.equal(calendar.sessions.length,251);assert.deepEqual(Object.keys(calendar.sessions[0]),['date','openAt','closeAt']);assert.ok(Object.isFrozen(calendar)&&Object.isFrozen(calendar.sessions));
  const result=must(await observe({readPublications:archive(pubs),readCalendar:reader}).observe(request(journal())));
  const frozen=intents(result);assert.equal(frozen.length,2);
  const day=frozen.find(e=>e.data.symbol==='AAA').data.window,week=frozen.find(e=>e.data.symbol==='BBB').data.window;
  assert.equal(day.calendarId,'nyse-regular-sessions-2026');assert.equal(day.calendarSha256,CALENDAR_RECORD.source.responseSha256);
  assert.deepEqual([day.entrySession,day.entryAt,day.exitSession,day.exitAt],['2026-10-19','2026-10-19T13:30:00Z','2026-10-19','2026-10-19T20:00:00Z']);
  assert.deepEqual([week.entryAt,week.exitSession,week.exitAt,week.sessions.length],['2026-10-19T13:30:00Z','2026-10-23','2026-10-23T20:00:00Z',5]);
  assert.equal(result.automation.pendingReasons.some(reason=>/calendar/.test(reason)),false,JSON.stringify(result.automation));
  assert.ok(result.automation.pendingReasons.includes('reviewed_prices_unavailable'),'a calendar never supplies marks');
  assert.equal((await validateJournal(result.journal)).ok,true);
  // A later observation with the shipped unreviewed reader keeps the frozen windows and resolves nothing new.
  const laterAt='2026-10-19T00:30:00Z';
  const later=must(await observe({readPublications:archive(pubs),readCalendar},laterAt).observe(request(result.journal,'calendar-chain-later',laterAt)));
  assert.equal(checkAppendOnly(result.journal,later.journal).ok,true);assert.deepEqual(intents(later),frozen);
  assert.ok(later.automation.pendingReasons.includes('calendar_unavailable'));
});
test('a frozen window bound to another calendar identity is not re-resolved from this record',async()=>{
  const cal=reviewed(),reader=createCalendarReader({record:cal}),pubs=publications(cal);
  const window={calendarId:'other-calendar',calendarSha256:'c'.repeat(64),timeZone:'America/New_York',publishedAt:PUBLISHED,horizonSessions:1,entrySession:'2026-10-19',exitSession:'2026-10-19',entryAt:'2026-10-19T13:30:00Z',exitAt:'2026-10-19T20:00:00Z',sessions:[{date:'2026-10-19',openAt:'2026-10-19T13:30:00Z',closeAt:'2026-10-19T20:00:00Z'}]};
  const foreign={id:'synthetic-intent',publicationEventId:'synthetic:publication',symbol:'AAA',settings:{},date:'2026-10-18',window};
  assert.deepEqual((await reader(args(pubs,[foreign]))).contexts.map(c=>c.publicationId),['synthetic-week-1019']);
  const bound={...foreign,window:{...window,calendarId:cal.id,calendarSha256:cal.source.responseSha256}};
  assert.equal((await reader(args(pubs,[bound]))).contexts.length,2);
  assert.equal((await reader(args(pubs,[{...foreign,window:null}]))).contexts.length,2);
  assert.equal((await reader(args([pubs[0],pubs[0]]))).contexts.length,1,'duplicate requests collapse');
});
test('a reviewed record that fails validation is unavailable and never served',async()=>{
  const broken=reviewed();broken.sessions=broken.sessions.filter(s=>s.date!=='2026-10-19');
  const reader=createCalendarReader({record:broken});
  assert.equal(reader.state,'unavailable');assert.deepEqual(reader.reasons,['calendar_session_missing']);
  assert.deepEqual(await reader(args(publications(reviewed()))),{status:'unavailable'});
  assert.equal(createCalendarReader({record:null}).state,'unconfigured');assert.equal(createCalendarReader().state,'unconfigured');
  const result=must(await observe({readPublications:archive(publications(reviewed())),readCalendar:reader}).observe(request(journal())));
  assert.ok(result.automation.pendingReasons.includes('calendar_unavailable'));assert.ok(intents(result).every(e=>e.data.window===null));
});
test('the record and reader are in the compiled production graph with the unreviewed status',async()=>{
  const root=new URL('../',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('docs/worker-build-manifest.json',root),'utf8'));
  for(const path of ['server/calendar/calendar.mjs','server/calendar/nyse-2026.json'])assert.ok(manifest.sourceFiles[path],`Missing production dependency ${path}`);
  const bundle=await readFile(new URL(manifest.bundle.path,root),'utf8');
  assert.ok(bundle.includes('"nyse-regular-sessions-2026"'));assert.ok(bundle.includes('captured_unreviewed'));
  assert.equal(bundle.includes('synthetic-reviewer'),false);
});
