import test from 'node:test';
import assert from 'node:assert/strict';
import {PRICE_SERIES_VERSION,normalizePriceSeries,parsePriceImport,buildPriceView,resolvePaperWindow,resolvePriceMark,adaptAlpacaDailyBars} from '../dist/lib/prices.js';

// Deliberately synthetic domain fixtures. These are not observed market prices,
// a verified exchange calendar, an account entitlement, or a real publication.
const at='2026-12-02T22:10:00Z',sha='a'.repeat(64),actionSha='b'.repeat(64);
const days=['2026-11-23','2026-11-24','2026-11-25','2026-11-27','2026-11-30','2026-12-01','2026-12-02','2026-12-03','2026-12-04'];
function calendar(){return {id:'synthetic-calendar',timeZone:'America/New_York',coverageStart:'2026-11-23',coverageEnd:'2026-12-04',status:'verified_complete',reviewedAt:'2026-11-20T22:01:00Z',source:{url:'https://calendar.example/fixture',capturedAt:'2026-11-20T22:00:00Z',responseSha256:'c'.repeat(64)},sessions:days.map(date=>({date,openAt:date+'T14:30:00Z',closeAt:date+(date==='2026-11-27'?'T18:00:00Z':'T21:00:00Z')}))};}
function series(){return {schemaVersion:PRICE_SERIES_VERSION,id:'synthetic-prices',symbol:'TEST',originalSymbol:'TEST',entityId:'synthetic-entity',currency:'USD',exchange:'SYNTHETIC',sessionTimezone:'America/New_York',interval:'1d',priceBasis:'unadjusted',volumeBasis:'shares',source:{provider:'Synthetic fixture',dataset:'not market observations',url:'https://prices.example/fixture',capturedAt:'2026-12-02T22:00:00Z',publishedAt:null,responseSha256:sha,channel:'retained_capture',declaredDelayMinutes:15,paginationComplete:true,priceSession:'regular_daily_aggregate'},bars:days.slice(0,7).map((session,i)=>({session,open:String(100+i),high:String(103+i),low:String(99+i),close:String(102+i),volume:1000+i})),actions:{status:'complete',fromSession:'2026-11-23',throughSession:'2026-12-02',source:{url:'https://prices.example/actions',capturedAt:'2026-12-02T22:00:00Z',responseSha256:actionSha},items:[]}};}
function review(s=series()){return {id:'synthetic-review',status:'verified',allowedUse:'paper_marks',seriesId:s.id,symbol:s.symbol,entityId:s.entityId,currency:s.currency,sessionTimezone:s.sessionTimezone,provider:s.source.provider,dataset:s.source.dataset,sourceUrl:s.source.url,capturedAt:s.source.capturedAt,responseSha256:s.source.responseSha256,priceBasis:'unadjusted',priceSession:'regular_daily_aggregate',actionsSha256:actionSha,reviewedAt:'2026-12-02T22:01:00Z'};}
function window(horizonSessions=5,publishedAt='2026-11-24T13:00:00Z'){return resolvePaperWindow({publishedAt,horizonSessions,calendar:calendar(),at:publishedAt}).window;}
function mark(s=series(),options={}){return resolvePriceMark(s,{session:'2026-11-24',kind:'open',calendar:calendar(),review:s?review(s):null,window:window(),at,...options});}

// The journal API persists canonical JSON by sorting each record's keys.
const persisted=value=>JSON.parse(JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item));

test('canonical JSON persistence changes key order without invalidating exact frozen price windows',()=>{
  const original=window(),restored=persisted(original),before=structuredClone(restored);
  assert.notEqual(JSON.stringify(restored.sessions),JSON.stringify(original.sessions),'reproduces API record-key ordering');
  assert.deepEqual(restored,original);
  for(const options of [{session:original.entrySession,kind:'open'},{session:original.exitSession,kind:'close'}]){
    const direct=mark(series(),{...options,window:original}),roundTrip=mark(series(),{...options,window:restored});
    assert.equal(direct.status,'available');assert.equal(roundTrip.status,'available',JSON.stringify(roundTrip));
    assert.deepEqual(roundTrip,direct);assert.equal(roundTrip.mark.eventAt,options.kind==='open'?original.entryAt:original.exitAt);
  }
  assert.deepEqual(restored,before);
});

test('structural window equality still rejects missing, extra, reordered and changed fields after restore',()=>{
  const mutations=[
    w=>delete w.calendarId,
    w=>w.extra='not part of the frozen contract',
    w=>delete w.sessions[0].openAt,
    w=>w.sessions[0].extra='not a session field',
    w=>[w.sessions[0],w.sessions[1]]=[w.sessions[1],w.sessions[0]],
    w=>w.sessions.pop(),
    w=>w.sessions.push({...w.sessions.at(-1)}),
    w=>w.sessions[0].closeAt='2026-11-24T21:00:00.001Z',
    w=>w.calendarSha256='d'.repeat(64),
    w=>w.horizonSessions='5',
    w=>w.publishedAt='2026-11-23T13:00:00Z'
  ];
  for(const mutate of mutations){
    const restored=persisted(window());mutate(restored);const before=structuredClone(restored),result=mark(series(),{window:restored});
    assert.equal(result.status,'blocked',mutate.toString());assert.deepEqual(result.reasons,['frozen_window_calendar_mismatch']);assert.deepEqual(restored,before);
  }
});
