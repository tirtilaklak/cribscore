import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {capturedFixture} from './capture-fixtures.mjs';
import {bridgeTiingoCapturedEnvelope} from './tiingo-observed-bridge.mjs';
import {inspectMarketSnapshot,commitMarketSnapshot} from '../market-ingestion/market-ingestion.mjs';
import {calculatePriceActionDraft,PRICE_ACTION_CONVENTION} from '../price-action/price-action.mjs';
const bridge=f=>bridgeTiingoCapturedEnvelope(f.envelope,f.options);
function archive(f,b){
 const r=commitMarketSnapshot({revision:0,snapshots:[],runs:[]},{runId:'SYNTHETIC-check-'+f.options.usage,expectedRevision:0,outcome:'snapshot',startedAt:f.envelope.capture.requestStartedAt,checkedAt:'2026-10-17T10:03:00Z',snapshot:b.snapshot},f.options);
 assert.equal(r.accepted,true,JSON.stringify(r.reasons));
 return {snapshot:r.archive.snapshots[0],policy:f.options.policy,rightsReviews:f.options.rightsReviews,latestCheck:{runId:r.archive.runs[0].runId,snapshotId:r.archive.activeSnapshotId,status:'succeeded',checkedAt:r.archive.lastSuccessfulCheckAt}};
}
test('actual collector envelope joins only an explicit host ingestion record, preserving byte hash and clocks',async()=>{
 const f=await capturedFixture(),before=structuredClone(f.envelope),b=bridge(f);
 assert.equal(f.fetchCalls,1);assert.equal(b.ok,true,JSON.stringify(b));
 assert.equal(b.snapshot.source.sha256,createHash('sha256').update(f.bytes).digest('hex'));
 assert.equal(b.snapshot.source.requestStartedAt,f.envelope.capture.requestStartedAt);
 assert.equal(b.snapshot.source.fetchedAt,f.envelope.capture.responseCompletedAt);
 assert.equal(b.snapshot.source.ingestedAt,f.options.ingestionRecord.ingestedAt);
 assert.equal(b.snapshot.id,f.options.ingestionRecord.captureId);assert.equal(b.provenance.ingestionRecordId,f.options.ingestionRecord.id);
 assert.equal(b.provenance.responseByteLength,f.bytes.length);assert.equal(b.provenance.authorizationReviewId,'SYNTHETIC transport review');
 assert.equal(b.snapshot.source.publishedAt,null);assert.equal(b.snapshot.source.publicationPrecision,'unknown');assert.equal(b.provenance.backtestAvailabilityProven,false);
 assert.deepEqual(f.envelope,before);assert.equal(f.envelope.capture.ingestedAt,null);assert.equal(Object.hasOwn(f.envelope.capture,'captureId'),false);
 assert.equal(inspectMarketSnapshot(b.snapshot,f.options).eligible,true);
});
test('successful fetch alone cannot manufacture accepted ingestion or capture identity',async()=>{
 for(const edit of [o=>delete o.ingestionRecord,o=>delete o.ingestionRecord.captureId,o=>o.ingestionRecord.state='pending',o=>o.ingestionRecord.ingestedAt=null,o=>o.ingestionRecord.captureIdSource='derived_from_hash']){
  const f=await capturedFixture();edit(f.options);const b=bridge(f);assert.equal(b.ok,false);assert.equal(b.snapshot,null);
 }
});
test('ingestion record must bind exact capture bytes, clocks, security and authorization review',async()=>{
 for(const edit of [r=>r.responseSha256='a'.repeat(64),r=>r.securityId='OTHER',r=>r.requestStartedAt='2026-10-17T09:59:58Z',r=>r.responseCompletedAt='2026-10-17T10:00:00Z',r=>r.authorizationReviewId='OTHER',r=>r.requestURL+='&extra=1',r=>r.reviewedAt='2026-10-17T09:00:00Z',r=>r.ingestedAt='2026-10-17T12:00:00Z']){
  const f=await capturedFixture();edit(f.options.ingestionRecord);assert.equal(bridge(f).ok,false);
 }
});
test('transport mode, unresolved ingestion state and publication semantics cannot be silently rewritten',async()=>{
 for(const edit of [c=>c.mode='manually_inferred',c=>c.ingestedAt='2026-10-17T10:02:00Z',c=>c.providerPublishedAt='2026-10-16T00:00:00Z',c=>c.correctionPossible=false,c=>c.httpStatus=403,c=>c.responseByteLength=0]){
  const f=await capturedFixture();edit(f.envelope.capture);assert.equal(bridge(f).ok,false);
 }
 const f=await capturedFixture();f.options.capture={authenticated:true};assert.equal(bridge(f).ok,false);
});
test('archive preserves actual request start and reviewed same-day dividend share basis',async()=>{
 const f=await capturedFixture({sameDayActions:true}),b=bridge(f),leg=archive(f,b);
 assert.equal(leg.snapshot.source.requestStartedAt,f.envelope.capture.requestStartedAt);
 assert.equal(leg.snapshot.actions.items.find(a=>a.type==='cash_dividend').perShareBasis,'post_split');
 delete f.options.actionsReview.sameDayDistributionShareBasisBySession;assert.equal(bridge(f).ok,false);
});
test('generic request-start rights cannot be approved retroactively by capture completion',async()=>{
 const f=await capturedFixture(),b=bridge(f),r=f.options.rightsReviews[0];r.reviewedAt=r.validFrom='2026-10-17T10:00:00Z';r.termsEvidence[0].observedAt='2026-10-17T09:59:00Z';
 const inspected=inspectMarketSnapshot(b.snapshot,f.options);assert.equal(inspected.eligible,false);assert.ok(inspected.reasons.includes('fetch_rights_unknown'));
});
test('ETF benchmark has explicit role and policy; it cannot enter the candidate bridge',async()=>{
 const f=await capturedFixture({etf:true}),b=bridge(f);assert.equal(b.ok,true);assert.equal(b.provenance.usage,'benchmark');assert.equal(b.snapshot.security.instrumentType,'etf');
 assert.equal(inspectMarketSnapshot(b.snapshot,f.options).eligible,true);
 for(const edit of [o=>o.usage='candidate',o=>delete o.policy.usage,o=>delete o.policy.instrumentType,o=>o.identityReview.security.instrumentType='common_equity',o=>o.policy.instrumentType='option']){
  const options=structuredClone(f.options);edit(options);assert.equal(bridgeTiingoCapturedEnvelope(f.envelope,options).ok,false);
 }
});
test('US session date must equal both actual open/close dates, including fractional clocks',async()=>{
 const f=await capturedFixture(),s=f.options.calendar.sessions.find(s=>s.date==='2026-10-16');
 s.openAt='2026-10-15T21:00:00.123Z';s.closeAt='2026-10-15T22:00:00.456Z';
 assert.deepEqual(bridge(f).reasons,['calendar_sessions_invalid']);
});
test('captured and archived common-equity target plus explicit ETF benchmark reach calculator only as an unapproved draft',async()=>{
 const t=await capturedFixture({sameDayActions:true}),b=await capturedFixture({etf:true});
 const target=archive(t,bridge(t)),benchmark=archive(b,bridge(b));
 const draft=calculatePriceActionDraft({at:t.options.at,cutoffAt:t.options.cutoffAt,calendar:t.options.calendar,target,benchmark,conventionVersion:PRICE_ACTION_CONVENTION,toleranceBps:0});
 assert.equal(draft.status,'review_required',JSON.stringify(draft.reasons));assert.equal(draft.candidateGatePassed,false);assert.equal(draft.scoreReviewPassed,false);assert.equal(draft.eligibleForRanking,false);
 assert.equal(draft.lineage.target.requestStartedAt,t.envelope.capture.requestStartedAt);
 assert.equal(draft.internalComparison.target.adjustments.find(a=>a.type==='cash_dividend').perShareBasis,'post_split');
 assert.equal(draft.lineage.benchmark.securityId,b.options.policy.securityId);
});
