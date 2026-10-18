import record from './nyse-2026.json' with {type:'json'};

// Reviewed exchange calendar reader for server/journal/observe.mjs. Pure: no
// clock, network or storage. The record ships captured and unreviewed, so the
// reader serves nothing until the owner marks it reviewed (see README.md).
// Shape validity is not a review; it only proves the record is self-consistent.
export const CALENDAR_READER_VERSION='calendar-reader-v1';
export const CALENDAR_RECORD_VERSION='cribscore-trading-calendar-v1';
export const REVIEWED_STATUS='verified_complete';
export const UNREVIEWED_STATUS='captured_unreviewed';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,names)=>object(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const nonblank=value=>typeof value==='string'&&value.trim().length>0&&value.length<=500;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const clock=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const instant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)+'Z'===value;
const https=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash;}catch{return false;}};
const zone=value=>{try{return typeof value==='string'&&value.includes('/')&&!!new Intl.DateTimeFormat('en-US',{timeZone:value});}catch{return false;}};
const weekend=date=>[0,6].includes(new Date(date+'T00:00:00Z').getUTCDay());
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
function* dates(from,through){for(let at=Date.parse(from+'T00:00:00Z');at<=Date.parse(through+'T00:00:00Z');at+=86_400_000)yield new Date(at).toISOString().slice(0,10);}
function wallClock(at,timeZone){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(at));
  const get=type=>parts.find(part=>part.type===type).value;
  return {date:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`};
}
/** UTC instant of a wall-clock time in a zone. Exchange opens and closes never
 * fall inside a transition gap, so one offset correction round-trips exactly. */
export function zonedInstant(date,time,timeZone){
  const guess=Date.parse(`${date}T${time}:00Z`),shown=wallClock(guess,timeZone);
  const at=new Date(guess-(Date.parse(`${shown.date}T${shown.time}:00Z`)-guess)).toISOString().replace('.000Z','Z');
  const check=wallClock(at,timeZone);if(check.date!==date||check.time!==time)throw Error('calendar_wall_clock_unresolved');
  return at;
}
/** Every weekday in coverage that is not a listed holiday, opening and closing
 * at the record's local times. Early closes use the early local close. */
export function generateSessions({timeZone,coverageStart,coverageEnd,holidays,earlyCloses,regularSession}){
  const closed=new Set(holidays.map(item=>item.date)),early=new Set(earlyCloses.map(item=>item.date)),sessions=[];
  for(const date of dates(coverageStart,coverageEnd)){
    if(weekend(date)||closed.has(date))continue;
    sessions.push({date,openAt:zonedInstant(date,regularSession.openLocal,timeZone),closeAt:zonedInstant(date,early.has(date)?regularSession.earlyCloseLocal:regularSession.closeLocal,timeZone)});
  }
  return sessions;
}
/** Pure record check: identity, capture provenance, review fields, ordered
 * weekday sessions, holidays absent, local open/close on every session date. */
export function validateCalendarRecord(record){
  const reasons=new Set(),fail=code=>reasons.add(code),done=()=>({valid:!reasons.size,reasons:[...reasons].sort()});
  if(!object(record)){fail('calendar_record_invalid');return done();}
  const {source,regularSession:local}=record,timeZone=zone(record.timeZone)?record.timeZone:null;
  if(record.schemaVersion!==CALENDAR_RECORD_VERSION||!nonblank(record.id)||!nonblank(record.exchange)||!timeZone||!day(record.coverageStart)||!day(record.coverageEnd)||record.coverageStart>record.coverageEnd)fail('calendar_identity_invalid');
  if(!object(local)||![local.openLocal,local.earlyCloseLocal,local.closeLocal].every(clock)||!(local.openLocal<local.earlyCloseLocal&&local.earlyCloseLocal<local.closeLocal))fail('calendar_regular_session_invalid');
  if(record.sourceCaptureStatus!=='captured'||!object(source)||!https(source.url)||!hash(source.responseSha256)||!instant(source.capturedAt))fail('calendar_source_capture_invalid');
  if(record.status===REVIEWED_STATUS){if(!nonblank(record.reviewer)||!instant(record.reviewedAt)||object(source)&&instant(source.capturedAt)&&Date.parse(record.reviewedAt)<Date.parse(source.capturedAt))fail('calendar_review_invalid');}
  else if(record.status!==UNREVIEWED_STATUS||record.reviewer!==null||record.reviewedAt!==null)fail('calendar_status_invalid');
  const covered=date=>day(date)&&day(record.coverageStart)&&day(record.coverageEnd)&&date>=record.coverageStart&&date<=record.coverageEnd;
  const listed=(items,code)=>{if(!Array.isArray(items)||items.some((item,i)=>!keys(item,['date','name'])||!covered(item.date)||!nonblank(item.name)||weekend(item.date)||i>0&&item.date<=items[i-1].date)){fail(code);return new Set();}return new Set(items.map(item=>item.date));};
  const holidays=listed(record.holidays,'calendar_holidays_invalid'),early=listed(record.earlyCloses,'calendar_early_closes_invalid');
  if([...early].some(date=>holidays.has(date)))fail('calendar_early_close_on_holiday');
  if(!Array.isArray(record.sessions)||record.sessions.length>400){fail('calendar_sessions_invalid');return done();}
  const seen=new Set();
  record.sessions.forEach((session,i)=>{
    if(!keys(session,['date','openAt','closeAt'])||!covered(session.date)||!instant(session.openAt)||!instant(session.closeAt)){fail('calendar_sessions_invalid');return;}
    if(weekend(session.date))fail('calendar_weekend_session');
    if(holidays.has(session.date))fail('calendar_holiday_session');
    if(seen.has(session.date)||i>0&&(session.date<=record.sessions[i-1].date||Date.parse(session.openAt)<=Date.parse(record.sessions[i-1].closeAt)))fail('calendar_sessions_unordered');
    seen.add(session.date);
    if(!timeZone||!object(local))return;
    const open=wallClock(session.openAt,timeZone),close=wallClock(session.closeAt,timeZone);
    if(open.date!==session.date||close.date!==session.date||open.time!==local.openLocal||close.time!==(early.has(session.date)?local.earlyCloseLocal:local.closeLocal))fail('calendar_session_clock_mismatch');
  });
  if(day(record.coverageStart)&&day(record.coverageEnd))for(const date of dates(record.coverageStart,record.coverageEnd))if(!weekend(date)&&!holidays.has(date)&&!seen.has(date))fail('calendar_session_missing');
  return done();
}
// The price domain reads exactly this shape (docs/price-domain-contract.md).
const serve=record=>freeze({id:record.id,timeZone:record.timeZone,coverageStart:record.coverageStart,coverageEnd:record.coverageEnd,status:record.status,reviewedAt:record.reviewedAt,
  source:{url:record.source.url,capturedAt:record.source.capturedAt,responseSha256:record.source.responseSha256},sessions:record.sessions.map(s=>({date:s.date,openAt:s.openAt,closeAt:s.closeAt}))});
const scheduleKey=(publishedAt,horizonSessions)=>`${publishedAt}|${horizonSessions}`;
/** readCalendar for the observer. An unreviewed record answers unconfigured,
 * the same result as a null reader. A reviewed record that fails validation
 * answers unavailable. A publication whose frozen window names another
 * calendar identity is left out, so a newer capture never replaces it. */
export function createCalendarReader({record}={}){
  const check=validateCalendarRecord(record);
  const state=!object(record)||record.status!==REVIEWED_STATUS?'unconfigured':check.valid?'ready':'unavailable';
  const calendar=state==='ready'?serve(record):null;
  const reader=async({publications=[],frozenIntents=[]}={})=>{
    if(state!=='ready')return {status:state};
    const foreign=new Set();
    for(const intent of frozenIntents){const window=intent?.window;if(object(window)&&(window.calendarId!==calendar.id||window.calendarSha256!==calendar.source.responseSha256))foreign.add(scheduleKey(window.publishedAt,window.horizonSessions));}
    const contexts=[],seen=new Set();
    for(const publication of publications){
      if(!object(publication)||seen.has(publication.publicationId)||foreign.has(scheduleKey(publication.publishedAt,publication.horizonId==='next_week'?5:1)))continue;
      seen.add(publication.publicationId);contexts.push({publicationId:publication.publicationId,calendar});
    }
    return {status:'ready',contexts};
  };
  return Object.freeze(Object.assign(reader,{state,reasons:Object.freeze([...check.reasons])}));
}
export const CALENDAR_RECORD=freeze(record);
export const readCalendar=createCalendarReader({record:CALENDAR_RECORD});
