import test from 'node:test';
import assert from 'node:assert/strict';
import { CALENDAR_RECORD, CALENDAR_RECORD_VERSION, REVIEWED_STATUS, UNREVIEWED_STATUS, generateSessions, validateCalendarRecord, zonedInstant } from '../server/calendar/calendar.mjs';
import { resolvePaperWindow } from '../dist/lib/prices.js';

// The shipped record is real capture metadata plus generated sessions. The
// reviewed copies below are test-only: nothing here reviews the record.
const record=()=>structuredClone(CALENDAR_RECORD);
const reviewed=(reviewedAt='2026-10-18T22:30:00Z')=>({...record(),status:REVIEWED_STATUS,reviewer:'synthetic-reviewer',reviewedAt});
const HOLIDAYS=['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25'];
const session=date=>CALENDAR_RECORD.sessions.find(s=>s.date===date);
const insert=(r,s)=>{const i=r.sessions.findIndex(x=>x.date>s.date);r.sessions.splice(i<0?r.sessions.length:i,0,s);};

test('shipped record is captured, unreviewed and reproduces from its own holiday and early-close lists',()=>{
  const r=CALENDAR_RECORD;
  assert.equal(r.schemaVersion,CALENDAR_RECORD_VERSION);assert.equal(r.status,UNREVIEWED_STATUS);assert.equal(r.reviewer,null);assert.equal(r.reviewedAt,null);
  assert.equal(r.sourceCaptureStatus,'captured');assert.match(r.source.responseSha256,/^[a-f0-9]{64}$/);assert.match(r.source.url,/^https:\/\/www\.nyse\.com\//);assert.ok(Date.parse(r.source.capturedAt)<Date.parse('2026-10-19T00:00:00Z'));
  assert.equal(r.timeZone,'America/New_York');assert.equal(r.coverageStart,'2026-01-01');assert.equal(r.coverageEnd,'2026-12-31');
  assert.deepEqual(validateCalendarRecord(r),{valid:true,reasons:[]});
  assert.deepEqual(r.holidays.map(h=>h.date),HOLIDAYS);
  assert.deepEqual(r.earlyCloses.map(e=>e.date),['2026-11-27','2026-12-24']);
  assert.equal(r.sessions.length,251);
  assert.deepEqual(r.sessions,generateSessions(r));
  assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.sessions)&&Object.isFrozen(r.sessions[0]));
});
test('sessions skip weekends and holidays and carry New York instants across both DST changes',()=>{
  for(const date of HOLIDAYS)assert.equal(session(date),undefined,date);
  assert.ok(CALENDAR_RECORD.sessions.every(s=>![0,6].includes(new Date(s.date+'T00:00:00Z').getUTCDay())));
  assert.ok(CALENDAR_RECORD.sessions.every((s,i,all)=>!i||Date.parse(s.openAt)>Date.parse(all[i-1].closeAt)));
  assert.deepEqual(session('2026-03-06'),{date:'2026-03-06',openAt:'2026-03-06T14:30:00Z',closeAt:'2026-03-06T21:00:00Z'});
  assert.deepEqual(session('2026-03-09'),{date:'2026-03-09',openAt:'2026-03-09T13:30:00Z',closeAt:'2026-03-09T20:00:00Z'});
  assert.deepEqual(session('2026-10-19'),{date:'2026-10-19',openAt:'2026-10-19T13:30:00Z',closeAt:'2026-10-19T20:00:00Z'});
  assert.deepEqual(session('2026-10-30'),{date:'2026-10-30',openAt:'2026-10-30T13:30:00Z',closeAt:'2026-10-30T20:00:00Z'});
  assert.deepEqual(session('2026-11-02'),{date:'2026-11-02',openAt:'2026-11-02T14:30:00Z',closeAt:'2026-11-02T21:00:00Z'});
  assert.deepEqual(session('2026-11-27'),{date:'2026-11-27',openAt:'2026-11-27T14:30:00Z',closeAt:'2026-11-27T18:00:00Z'});
  assert.deepEqual(session('2026-12-24'),{date:'2026-12-24',openAt:'2026-12-24T14:30:00Z',closeAt:'2026-12-24T18:00:00Z'});
  assert.equal(CALENDAR_RECORD.sessions.filter(s=>s.closeAt.endsWith('T18:00:00Z')).length,2);
  assert.equal(zonedInstant('2026-03-08','09:30','America/New_York'),'2026-03-08T13:30:00Z');
  assert.equal(zonedInstant('2026-11-01','09:30','America/New_York'),'2026-11-01T14:30:00Z');
});
test('the price domain refuses the unreviewed record and resolves the 2026-10-19 windows from a reviewed copy',()=>{
  const publishedAt='2026-10-18T23:00:00Z',at='2026-10-18T23:30:00Z';
  const refused=resolvePaperWindow({publishedAt,horizonSessions:1,calendar:CALENDAR_RECORD,at});
  assert.equal(refused.status,'pending');assert.deepEqual(refused.reasons,['verified_calendar_missing']);assert.equal(refused.window,null);
  const day=resolvePaperWindow({publishedAt,horizonSessions:1,calendar:reviewed(),at});
  assert.equal(day.status,'resolved',JSON.stringify(day));
  assert.deepEqual([day.window.entrySession,day.window.entryAt,day.window.exitSession,day.window.exitAt],['2026-10-19','2026-10-19T13:30:00Z','2026-10-19','2026-10-19T20:00:00Z']);
  assert.equal(day.window.calendarId,'nyse-regular-sessions-2026');assert.equal(day.window.calendarSha256,CALENDAR_RECORD.source.responseSha256);assert.equal(day.window.timeZone,'America/New_York');
  const week=resolvePaperWindow({publishedAt,horizonSessions:5,calendar:reviewed(),at});
  assert.equal(week.status,'resolved');assert.equal(week.window.entryAt,'2026-10-19T13:30:00Z');assert.equal(week.window.exitSession,'2026-10-23');assert.equal(week.window.exitAt,'2026-10-23T20:00:00Z');
  assert.deepEqual(week.window.sessions.map(s=>s.date),['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23']);
  assert.equal(resolvePaperWindow({publishedAt:'2026-10-19T13:30:00Z',horizonSessions:1,calendar:reviewed(),at:'2026-10-19T14:00:00Z'}).window.entrySession,'2026-10-20','publication at the open misses that session');
  assert.equal(resolvePaperWindow({publishedAt,horizonSessions:1,calendar:reviewed('2026-10-19T00:00:00Z'),at}).status,'pending','review after the observation clock is not usable yet');
});
test('a reviewed copy resolves across the November DST change, Good Friday, Thanksgiving and the early close',()=>{
  const cal=reviewed();
  const dst=resolvePaperWindow({publishedAt:'2026-10-30T22:00:00Z',horizonSessions:1,calendar:cal,at:'2026-10-30T23:00:00Z'});
  assert.deepEqual([dst.window.entryAt,dst.window.exitAt],['2026-11-02T14:30:00Z','2026-11-02T21:00:00Z']);
  const easter=resolvePaperWindow({publishedAt:'2026-04-02T22:00:00Z',horizonSessions:1,calendar:cal,at:'2026-10-18T23:30:00Z'});
  assert.equal(easter.window.entrySession,'2026-04-06');
  assert.equal(resolvePaperWindow({publishedAt:'2026-04-02T22:00:00Z',horizonSessions:1,calendar:cal,at:'2026-04-02T23:00:00Z'}).status,'pending','a review cannot be used before it happened');
  const week=resolvePaperWindow({publishedAt:'2026-11-20T22:00:00Z',horizonSessions:5,calendar:cal,at:'2026-11-20T23:00:00Z'});
  assert.deepEqual(week.window.sessions.map(s=>s.date),['2026-11-23','2026-11-24','2026-11-25','2026-11-27','2026-11-30']);
  assert.equal(week.window.sessions[3].closeAt,'2026-11-27T18:00:00Z');assert.equal(week.window.exitAt,'2026-11-30T21:00:00Z');
  const end=resolvePaperWindow({publishedAt:'2026-12-31T22:00:00Z',horizonSessions:1,calendar:cal,at:'2026-12-31T23:00:00Z'});
  assert.equal(end.status,'pending');assert.deepEqual(end.reasons,['calendar_future_sessions_missing']);
});
test('validator names each defect and review fields cannot be half set',()=>{
  const cases=[
    ['calendar_record_invalid',()=>null],
    ['calendar_identity_invalid',r=>{r.timeZone='Nowhere';return r;}],
    ['calendar_identity_invalid',r=>{r.schemaVersion='other';return r;}],
    ['calendar_regular_session_invalid',r=>{r.regularSession.earlyCloseLocal='17:00';return r;}],
    ['calendar_source_capture_invalid',r=>{r.sourceCaptureStatus='unavailable';return r;}],
    ['calendar_source_capture_invalid',r=>{r.source.responseSha256=r.source.responseSha256.toUpperCase();return r;}],
    ['calendar_source_capture_invalid',r=>{r.source.url='http://www.nyse.com/trade/hours-calendars';return r;}],
    ['calendar_review_invalid',r=>({...r,status:REVIEWED_STATUS,reviewer:null,reviewedAt:'2026-10-18T22:30:00Z'})],
    ['calendar_review_invalid',r=>({...r,status:REVIEWED_STATUS,reviewer:'synthetic-reviewer',reviewedAt:null})],
    ['calendar_review_invalid',r=>({...r,status:REVIEWED_STATUS,reviewer:'synthetic-reviewer',reviewedAt:'2026-10-18T22:00:00Z'})],
    ['calendar_status_invalid',r=>({...r,reviewer:'synthetic-reviewer'})],
    ['calendar_status_invalid',r=>({...r,status:'reviewed'})],
    ['calendar_holidays_invalid',r=>{r.holidays.push({date:'2026-07-04',name:'Weekend date'});return r;}],
    ['calendar_holidays_invalid',r=>{r.holidays.reverse();return r;}],
    ['calendar_early_closes_invalid',r=>{r.earlyCloses[0]={date:'2026-11-27'};return r;}],
    ['calendar_early_close_on_holiday',r=>{r.earlyCloses.unshift({date:'2026-11-26',name:'Holiday date'});return r;}],
    ['calendar_sessions_invalid',r=>{r.sessions[0]={...r.sessions[0],earlyClose:false};return r;}],
    ['calendar_sessions_invalid',r=>{r.sessions[0].openAt='2026-01-02T14:30:00.000Z';return r;}],
    ['calendar_weekend_session',r=>{insert(r,{date:'2026-10-17',openAt:'2026-10-17T13:30:00Z',closeAt:'2026-10-17T20:00:00Z'});return r;}],
    ['calendar_holiday_session',r=>{insert(r,{date:'2026-11-26',openAt:'2026-11-26T14:30:00Z',closeAt:'2026-11-26T21:00:00Z'});return r;}],
    ['calendar_session_clock_mismatch',r=>{Object.assign(r.sessions.find(s=>s.date==='2026-11-02'),{openAt:'2026-11-02T13:30:00Z',closeAt:'2026-11-02T20:00:00Z'});return r;}],
    ['calendar_session_clock_mismatch',r=>{r.sessions.find(s=>s.date==='2026-11-27').closeAt='2026-11-27T21:00:00Z';return r;}],
    ['calendar_session_clock_mismatch',r=>{r.sessions.find(s=>s.date==='2026-10-19').closeAt='2026-10-19T19:59:00Z';return r;}],
    ['calendar_session_clock_mismatch',r=>{r.timeZone='Pacific/Auckland';return r;}],
    ['calendar_sessions_unordered',r=>{[r.sessions[10],r.sessions[11]]=[r.sessions[11],r.sessions[10]];return r;}],
    ['calendar_sessions_unordered',r=>{r.sessions.splice(10,0,{...r.sessions[10]});return r;}],
    ['calendar_session_missing',r=>{r.sessions=r.sessions.filter(s=>s.date!=='2026-10-19');return r;}],
    ['calendar_session_missing',r=>{r.holidays.pop();return r;}],
  ];
  for(const [code,mutate] of cases){
    const result=validateCalendarRecord(mutate(record()));
    assert.equal(result.valid,false,code);assert.ok(result.reasons.includes(code),`${code}: ${JSON.stringify(result.reasons)}`);
  }
  assert.deepEqual(validateCalendarRecord(reviewed()),{valid:true,reasons:[]});
  assert.deepEqual(validateCalendarRecord(CALENDAR_RECORD),{valid:true,reasons:[]},'checks do not mutate the shipped record');
});
