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

test('price absence and invalid identity/values cannot create chart points or eligibility',()=>{
  assert.equal(buildPriceView(null,{at}).status,'unavailable');
  assert.deepEqual(buildPriceView(null,{at}).points,[]);
  const mutations=[s=>s.currency='',s=>s.sessionTimezone='Nowhere/Unknown',s=>s.bars[0].close=Infinity,s=>s.bars[0].low='104',s=>s.bars[0].session='2026-02-30',s=>s.bars.push({...s.bars[0]}),s=>s.bars[0].volume=-1,s=>s.source.capturedAt='2026-02-30T01:00:00Z'];
  for(const edit of mutations){const s=series();edit(s);const result=normalizePriceSeries(s,{at});assert.equal(result.status,'invalid');assert.equal(result.series,null);assert.equal(result.eligibleForRanking,false);assert.equal(result.paperMarksEligible,false);}
});

test('JSON/CSV manual import is atomic, bounded and cannot claim retained-capture authority',()=>{
  const s=series(),before=structuredClone(s);
  const json=parsePriceImport(JSON.stringify(s),{at});
  assert.equal(json.series[0].source.channel,'manual_import');
  assert.equal(buildPriceView(json.series[0],{at}).chartTrust,'manual_import');
  assert.equal(mark(json.series[0]).status,'blocked');
  const metadata={...s,bars:undefined};
  const csv=parsePriceImport('\uFEFFsession,open,high,low,close,volume\r\n"2026-11-24",1.0000001,1.1,0.9,1.05,\r\n',{at,format:'csv',metadata});
  assert.equal(csv.series[0].bars[0].volume,null);
  assert.equal(csv.series[0].bars[0].decimals.open,'1.0000001');
  assert.equal(buildPriceView(csv.series[0],{at}).points.length,1);
  const tiny={...s,bars:[{session:'2026-11-24',open:'0.0000001',high:'0.0000002',low:'0.0000001',close:'0.0000001',volume:0}]};
  assert.equal(buildPriceView(parsePriceImport(JSON.stringify(tiny),{at}).series[0],{at}).points[0].close,1e-7);
  const bad=structuredClone(s);bad.id='bad';bad.symbol='BAD';bad.bars[0].high=-1;
  assert.deepEqual(parsePriceImport(JSON.stringify({schemaVersion:'cribscore-price-import-v1',series:[s,bad]}),{at}).series,[]);
  assert.equal(parsePriceImport('x'.repeat(2*1024*1024+1),{at}).issues[0],'import_size_invalid');
  assert.equal(parsePriceImport('session,open,high,low,close,volume\n2026-11-24,1,2,1,2,1',{at,format:'csv'}).issues[0],'csv_metadata_required');
  assert.deepEqual(s,before);
  const adjusted=series();adjusted.volumeBasis='split_adjusted_shares';adjusted.bars[0].volume=1000.5;
  assert.equal(normalizePriceSeries(adjusted,{at}).series.bars[0].volume,1000.5);
  adjusted.volumeBasis='shares';assert.equal(normalizePriceSeries(adjusted,{at}).status,'invalid');
});

test('verified session windows use strict publication ordering and exact early closes without weekday arithmetic',()=>{
  const next=resolvePaperWindow({publishedAt:'2026-11-25T21:01:00Z',horizonSessions:1,calendar:calendar(),at:'2026-11-25T21:01:00Z'});
  assert.equal(next.window.entrySession,'2026-11-27');assert.equal(next.window.exitAt,'2026-11-27T18:00:00Z');
  assert.equal(window(1,'2026-11-24T14:30:00Z').entrySession,'2026-11-25');
  assert.deepEqual(window().sessions.map(s=>s.date),['2026-11-24','2026-11-25','2026-11-27','2026-11-30','2026-12-01']);
  assert.equal(window().exitAt,'2026-12-01T21:00:00Z');
  const missing=calendar();missing.coverageEnd='2026-11-25';missing.sessions=missing.sessions.slice(0,3);
  assert.equal(resolvePaperWindow({publishedAt:'2026-11-24T13:00:00Z',horizonSessions:5,calendar:missing,at}).status,'pending');
});

test('calendar provenance, timezone, duplicate sessions and original publication clocks fail explicitly',()=>{
  for(const edit of [c=>c.status='unreviewed',c=>c.source.responseSha256='bad',c=>c.sessions[1].date=c.sessions[0].date,c=>c.sessions[0].openAt='2026-11-23T01:00:00Z',c=>c.reviewedAt='2026-12-03T00:00:00Z']){
    const c=calendar();edit(c);assert.notEqual(resolvePaperWindow({publishedAt:'2026-11-24T13:00:00Z',horizonSessions:1,calendar:c,at}).status,'resolved');
  }
  assert.equal(resolvePaperWindow({publishedAt:'2026-02-30T13:00:00Z',horizonSessions:1,calendar:calendar(),at}).status,'blocked');
});

test('recent capture cannot hide missing sessions and split or gap boundaries break chart lines',()=>{
  const s=series();s.bars=s.bars.filter(b=>!['2026-11-25','2026-12-02'].includes(b.session));
  s.actions.items=[{id:'split',type:'split',effectiveSession:'2026-11-27',splitRatio:{numerator:'2',denominator:'1'}}];
  const view=buildPriceView(s,{at,calendar:calendar(),rangeSessions:'all'});
  assert.equal(view.freshness.captureStatus,'within_policy');
  assert.equal(view.freshness.sessionStatus,'behind_completed_session');
  assert.deepEqual(view.gaps.missingSessions,['2026-11-25','2026-12-02']);
  const split=view.points.find(p=>p.session==='2026-11-27');assert.equal(split.breakBefore,true);assert.deepEqual(split.missingSessionsBefore,['2026-11-25']);
  assert.equal(view.points.some(p=>p.session==='2026-11-25'),false);
  assert.equal(buildPriceView(s,{at}).gaps.status,'unknown');
  assert.equal(buildPriceView(s,{at:'2026-12-03T22:00:00Z',calendar:calendar()}).freshness.captureStatus,'within_policy');
  assert.equal(buildPriceView(s,{at:'2026-12-03T22:00:00.001Z',calendar:calendar()}).freshness.captureStatus,'stale');
});

test('future captures and bars stay unavailable rather than becoming historical observations',()=>{
  const s=series();
  const result=buildPriceView(s,{at:'2026-12-02T21:59:59Z',calendar:calendar()});
  assert.equal(result.points.length,0);assert.equal(result.freshness.captureStatus,'invalid');
  assert.equal(result.latest,null);
  s.source.capturedAt=null;s.source.publishedAt='2026-12-03T22:00:00Z';
  assert.equal(buildPriceView(s,{at,calendar:calendar()}).points.length,0);
});

test('benchmark comparison needs the same sessions, currency and action/adjustment basis',()=>{
  const s=series(),b=series();b.id='benchmark';b.symbol='BENCH';
  const view=buildPriceView(s,{at,calendar:calendar(),benchmark:b});
  assert.equal(view.comparison.status,'available');assert.equal(view.comparison.points[0].targetIndex,100);assert.equal(view.comparison.points[0].benchmarkIndex,100);
  for(const edit of [x=>x.currency='EUR',x=>x.bars.pop(),x=>x.priceBasis='split_adjusted',x=>x.actions.status='unknown',x=>x.actions.items.push({id:'dividend',type:'cash_dividend',effectiveSession:'2026-11-27',cashPerShare:'1',currency:'USD',perShareBasis:'current_shares'})]){
    const changed=structuredClone(b);edit(changed);assert.equal(buildPriceView(s,{at,calendar:calendar(),benchmark:changed}).comparison.status,'unavailable');
  }
  assert.equal(view.eligibleForRanking,false);assert.equal(view.paperMarksEligible,false);
  s.bars=s.bars.filter(p=>p.session!=='2026-11-25');b.bars=b.bars.filter(p=>p.session!=='2026-11-25');
  assert.equal(buildPriceView(s,{at,calendar:calendar(),benchmark:b}).comparison.reason,'benchmark_session_gaps');
});

test('later verified daily bars settle the frozen opening reference without previous-close gap credit',()=>{
  const s=series(),before=structuredClone(s);
  const entry=mark(s);assert.equal(entry.status,'available');assert.equal(entry.mark.value,'101');
  assert.equal(entry.mark.entityId,s.entityId);assert.equal(entry.mark.executionBasis,'daily_bar_paper_reference');assert.equal(entry.mark.priceTimestamp,null);assert.equal(entry.mark.eventAt,'2026-11-24T14:30:00Z');assert.equal(entry.mark.availableAt,s.source.capturedAt);
  assert.notEqual(entry.mark.value,s.bars[0].close);
  const exit=mark(s,{session:'2026-12-01',kind:'close'});assert.equal(exit.mark.value,'107');
  assert.equal(exit.mark.eventAt,'2026-12-01T21:00:00Z');
  const wrong=window();wrong.entryAt='2026-11-23T21:00:00Z';assert.equal(mark(s,{window:wrong}).status,'blocked');
  assert.deepEqual(s,before);assert.equal(entry.automaticTrading,false);assert.equal(entry.eligibleForRanking,false);
  assert.equal(Object.hasOwn(entry,'paperMarksEligible'),false,'paper resolver uses explicit available/pending/blocked, not the chart-only eligibility flag');
});

test('paper marks require identity-bound raw capture, review, prices and supported precision',()=>{
  assert.equal(mark(null).status,'pending');
  const s=series();
  for(const edit of [x=>x.priceBasis='split_adjusted',x=>x.source.channel='manual_import',x=>x.entityId=null,x=>x.source.paginationComplete=false]){const changed=structuredClone(s);edit(changed);assert.equal(mark(changed).status,'blocked');}
  assert.equal(mark(s,{review:null}).status,'pending');
  const wrong=review(s);wrong.responseSha256='d'.repeat(64);assert.equal(mark(s,{review:wrong}).status,'blocked');
  const absent=structuredClone(s);absent.bars=absent.bars.filter(b=>b.session!=='2026-11-24');assert.equal(mark(absent).reasons[0],'session_price_missing');
  const precise=structuredClone(s);precise.bars[1].open='101.0000001';assert.equal(mark(precise).reasons[0],'paper_price_precision_unsupported');
  const premature=structuredClone(s);premature.bars[1].availableAt='2026-11-24T15:00:00Z';assert.equal(mark(premature).reasons[0],'daily_bar_availability_before_close');
});

test('actions remain explicit: unknown coverage waits; same-session split distributions need post-split basis',()=>{
  const s=series();s.actions.status='unknown';assert.equal(mark(s).status,'pending');
  const complete=series();complete.actions.items=[{id:'split',type:'split',effectiveSession:'2026-11-27',splitRatio:{numerator:'3',denominator:'2'}},{id:'div',type:'cash_dividend',effectiveSession:'2026-11-27',cashPerShare:'1.25',currency:'USD',perShareBasis:'current_shares'}];
  assert.equal(mark(complete,{session:'2026-12-01',kind:'close'}).reasons[0],'distribution_basis_unsupported');
  complete.actions.items[1].perShareBasis='post_split';const result=mark(complete,{session:'2026-12-01',kind:'close'});
  assert.equal(result.status,'available');assert.deepEqual(result.actions.items[0].splitRatio,{numerator:'3',denominator:'2'});
  assert.equal(result.actions.items[1].entitlementAt,'2026-11-27T14:30:00Z');assert.equal(result.actions.items[1].cashPerShare,'1.25');
  complete.actions.items.push({id:'spin',type:'spin_off',effectiveSession:'2026-11-30'});assert.equal(mark(complete,{session:'2026-12-01',kind:'close'}).reasons[0],'corporate_action_unsupported');
  const none=mark(series());assert.deepEqual(none.actions.items,[]);assert.equal(none.actions.coverage,'verified_complete');
  const prefix=series();prefix.actions.throughSession='2026-11-24';
  assert.equal(mark(prefix).status,'available');assert.equal(mark(prefix).actions.throughSession,'2026-11-24');
  assert.equal(mark(prefix,{session:'2026-12-01',kind:'close'}).reasons[0],'corporate_action_coverage_missing');
});

function alpaca(){
  const request={symbols:['TEST'],feed:'sip',timeframe:'1Day',adjustment:'raw',asof:'2026-12-02',currency:'USD',start:'2026-11-23T00:00:00Z',end:'2026-12-02T21:45:00Z'};
  const url=new URL('https://data.alpaca.markets/v2/stocks/bars');for(const [k,v]of Object.entries(request))url.searchParams.set(k,Array.isArray(v)?v.join(','):v);
  return {body:{bars:{TEST:[{t:'2026-11-24T05:00:00Z',o:100,h:102,l:99,c:101,v:1000}]},next_page_token:null},options:{request,capture:{id:'synthetic-alpaca',url:url.href,requestStartedAt:'2026-12-02T22:00:00Z',capturedAt:'2026-12-02T22:00:01Z',responseSha256:sha},security:{symbol:'TEST',originalSymbol:'TEST',entityId:'synthetic-entity',currency:'USD',exchange:'SYNTHETIC',sessionTimezone:'America/New_York'},at}};
}
test('offline Alpaca adapter preserves feed, asof, raw adjustment, delayed provenance and partial pages',()=>{
  const {body,options}=alpaca(),before=structuredClone({body,options});
  const result=adaptAlpacaDailyBars(body,options);assert.ok(result.series);
  assert.equal(result.series.bars[0].session,'2026-11-24');assert.equal(result.series.bars[0].availableAt,options.capture.capturedAt);
  assert.equal(result.series.source.publishedAt,null);assert.equal(result.series.source.feed,'sip');assert.equal(result.series.source.symbolAsOf,'2026-12-02');
  assert.equal(result.series.source.volumeSession,'daily_including_extended_hours');assert.equal(result.accessVerified,false);assert.equal(result.paperMarksEligible,false);
  body.next_page_token='opaque-next';const partial=adaptAlpacaDailyBars(body,options);assert.equal(partial.series.source.paginationComplete,false);assert.ok(partial.warnings.includes('pagination_incomplete'));
  assert.deepEqual(options,before.options);
  body.next_page_token=null;const suffix=structuredClone(options);suffix.capture.url+='&page_token=opaque-previous';
  assert.equal(adaptAlpacaDailyBars(body,suffix).series.source.paginationComplete,false);
  delete body.next_page_token;assert.equal(adaptAlpacaDailyBars(body,options).series.source.paginationComplete,false);
});
test('Alpaca context cannot silently switch feed, symbol, time window, URL, adjustment or publication clocks',()=>{
  for(const edit of [x=>x.options.request.feed='iex',x=>x.options.request.end='2026-12-02T21:45:00.001Z',x=>x.options.capture.url+='&api_key=secret',x=>x.body.bars.TEST[0].t='2026-11-24T14:30:00Z',x=>x.body.bars.WRONG=[],x=>delete x.options.request.adjustment]){
    const x=alpaca();edit(x);assert.equal(adaptAlpacaDailyBars(x.body,x.options).status,'invalid');
  }
  const x=alpaca();x.options.request.adjustment='all';const url=new URL(x.options.capture.url);url.searchParams.set('adjustment','all');x.options.capture.url=url.href;
  const adjusted=adaptAlpacaDailyBars(x.body,x.options);assert.equal(adjusted.series.priceBasis,'unknown');assert.ok(adjusted.warnings.includes('provider_adjustment_not_total_return'));
});

test('paper completeness requires affirmative true rather than missing, null or truthy pagination metadata',()=>{
  for(const paginationComplete of [undefined,null,false,'true',1]){
    const s=series();if(paginationComplete===undefined)delete s.source.paginationComplete;else s.source.paginationComplete=paginationComplete;
    assert.notEqual(mark(s).status,'available',String(paginationComplete));
  }
  assert.equal(mark(series()).status,'available');
});

test('ambiguous JSON member names are rejected atomically, including escaped duplicates and nested metadata',()=>{
  const text=JSON.stringify(series());
  for(const raw of [text.replace('"open":"100"','"open":"1","open":"100"'),text.replace('"open":"100"','"op\\u0065n":"1","open":"100"'),text.replace('"currency":"USD"','"currency":"EUR","currency":"USD"')]){
    const result=parsePriceImport(raw,{at});assert.equal(result.status,'invalid');assert.deepEqual(result.series,[]);assert.deepEqual(result.issues,['import_duplicate_key']);
  }
  const valid=series();valid.source.dataset='JSON punctuation: { "key": [true, false, null] } \\ still a string';
  assert.equal(parsePriceImport(JSON.stringify(valid),{at}).series.length,1);
  assert.equal(parsePriceImport('['.repeat(66)+'0'+']'.repeat(66),{at}).issues[0],'import_nesting_too_deep');
});

test('exact decimal accounting survives repeated normalization and rejects conflicting numeric projections',()=>{
  const s=series();s.bars[1]={...s.bars[1],open:'999999999999.123456',high:'1000000000000',low:'999999999998',close:'999999999999.123455'};
  const before=structuredClone(s),once=normalizePriceSeries(s,{at}),twice=normalizePriceSeries(once.series,{at});
  assert.equal(once.series.bars[1].decimals.open,'999999999999.123456');
  assert.deepEqual(twice.series,once.series);assert.equal(mark(twice.series).mark.value,'999999999999.123456');
  assert.equal(parsePriceImport(JSON.stringify(twice.series),{at}).series[0].bars[1].decimals.open,'999999999999.123456');
  const mismatch=structuredClone(twice.series);mismatch.bars[1].open=1;assert.equal(normalizePriceSeries(mismatch,{at}).status,'invalid');
  const exactMismatch=structuredClone(s);exactMismatch.bars[1].high='999999999999.123455';
  assert.equal(Number(exactMismatch.bars[1].high),Number(exactMismatch.bars[1].open),'fixture proves float projection cannot distinguish this ordering');
  assert.ok(normalizePriceSeries(exactMismatch,{at}).issues.includes('bar_ohlc_inconsistent'));
  const tooLarge=structuredClone(s);tooLarge.bars[1].high='1000000000000.000001';assert.equal(normalizePriceSeries(tooLarge,{at}).status,'invalid');
  assert.deepEqual(s,before);
});
