// SYNTHETIC INTEGRATION ONLY: no symbol, permission, gate review or score here is
// production evidence. Never import this file/fixture into a served bundle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeFixture} from './fixtures.mjs';
import {bridgeTiingoObservedCapture} from './tiingo-observed-bridge.mjs';
import {inspectMarketSnapshot} from '../market-ingestion/market-ingestion.mjs';
import {fixture as candidateFixture,window} from '../research-score/fixtures.mjs';
import {rankResearchCandidates} from '../research-score/research-score.mjs';
import {horizonWindow} from '../../dist/lib/candidates.js';
import {calculatePriceActionDraft,PRICE_ACTION_CONVENTION} from '../price-action/price-action.mjs';

function syntheticChain({benchmarkLate=false}={}) {
 const target=bridgeFixture(),benchmark=bridgeFixture();
 const benchmarkId='SYNTHETIC-benchmark-1',ticker='SYNBENCH';
 benchmark.options.policy.securityId=benchmarkId;
 benchmark.normalized.data.securityId=benchmarkId;benchmark.normalized.data.ticker=ticker;
 for(const key of ['identityReview','basisReview','actionsReview'])benchmark.options[key].securityId=benchmarkId;
 Object.assign(benchmark.options.identityReview.security,{id:benchmarkId,ticker});
 benchmark.marketOptions.rightsReviews[0].securityIds=[benchmarkId];
 for(const f of ['sourceUrl','actionsUrl'])benchmark.options.policy[f]=benchmark.options.policy[f].replace('/SYNTHETIC/','/SYNBENCH/');
 benchmark.options.capture.requestURL=benchmark.options.capture.requestURL.replace('/SYNTHETIC/','/SYNBENCH/');
 benchmark.normalized.data.sourceURL=benchmark.options.capture.requestURL;
 benchmark.options.capture.captureId='SYNTHETIC-benchmark-capture';benchmark.options.capture.responseSha256='b'.repeat(64);
 for(const key of ['identityReview','basisReview','actionsReview'])benchmark.options[key].responseSha256='b'.repeat(64);
 benchmark.marketOptions.rightsReviews[0].urls=[benchmark.options.policy.sourceUrl];
 for(const b of benchmark.normalized.data.bars){b.raw={open:100,high:101,low:99,close:100,volume:100000};b.adjusted={...b.raw};}
 if(benchmarkLate){
  benchmark.options.capture.responseCompletedAt='2026-10-17T10:04:00.123Z';
  benchmark.options.capture.ingestedAt='2026-10-17T10:05:00.234Z';
  benchmark.normalized.data.observedAt=benchmark.options.capture.responseCompletedAt;
  for(const key of ['identityReview','basisReview','actionsReview'])benchmark.options[key].reviewedAt='2026-10-17T10:04:30.000Z';
 }
 const targetBridge=bridgeTiingoObservedCapture(target.normalized,target.options),benchmarkBridge=bridgeTiingoObservedCapture(benchmark.normalized,benchmark.options);
 assert.equal(targetBridge.ok,true);assert.equal(benchmarkBridge.ok,true);
 for(const [b,f] of [[targetBridge,target],[benchmarkBridge,benchmark]]){
  const inspection=inspectMarketSnapshot(b.snapshot,f.marketOptions);
  assert.equal(inspection.eligible,true);assert.equal(inspection.derivedDisplayAllowed,true);assert.equal(inspection.priceDisplayAllowed,false);
 }
 const {policy,at,cutoffAt,calendar}=target.options;
 const computedWindow=horizonWindow(calendar.sessions.map(s=>({open:s.openAt,close:s.closeAt})),cutoffAt,'next_week');
 assert.deepEqual({horizon_id:computedWindow.horizon_id,entry_at:computedWindow.entry_at,exit_at:computedWindow.exit_at},window);
 const completed=calendar.sessions.filter(s=>Date.parse(s.closeAt)<=Date.parse(cutoffAt));
 const six=completed.slice(-6),start=six[0].closeAt,end=six.at(-1).closeAt;
 // Move the whole late-benchmark calculation/review forward; never backdate it.
 const checkedAt=benchmarkLate?'2026-10-17T10:05:30.000Z':'2026-10-17T10:03:00Z';
 const calculatedAt=benchmarkLate?'2026-10-17T10:06:00.345Z':'2026-10-17T10:03:30Z';
 const reviewedAt=benchmarkLate?'2026-10-17T10:07:00.456Z':'2026-10-17T10:04:00Z';
 const leg=(bridged,f,label)=>({snapshot:bridged.snapshot,policy:f.options.policy,rightsReviews:f.marketOptions.rightsReviews,latestCheck:{runId:'SYNTHETIC-'+label+'-check',snapshotId:bridged.snapshot.id,status:'succeeded',checkedAt}});
 const priceDraft=calculatePriceActionDraft({at:calculatedAt,cutoffAt:checkedAt,calendar,conventionVersion:PRICE_ACTION_CONVENTION,toleranceBps:0,target:leg(targetBridge,target,'target'),benchmark:leg(benchmarkBridge,benchmark,'benchmark')});
 assert.equal(priceDraft.status,'review_required',JSON.stringify(priceDraft.reasons));
 const priceRating=priceDraft.historicalGrade;
 // This trusted synthetic mapper takes clocks from the actual calculated draft
 // and the exact snapshots used by its legs, never from candidate-fixture defaults.
 const targetSource=targetBridge.snapshot.source,benchmarkSource=benchmarkBridge.snapshot.source;
 const later=(a,b)=>Date.parse(a)>=Date.parse(b)?a:b;
 const priceClocks={calculated_at:priceDraft.assessedAt,
  target_available_at:targetSource.availabilityObservedAt,target_ingested_at:targetSource.ingestedAt,
  benchmark_available_at:benchmarkSource.availabilityObservedAt,benchmark_ingested_at:benchmarkSource.ingestedAt,
  source_available_at:later(targetSource.availabilityObservedAt,benchmarkSource.availabilityObservedAt),
  ingested_at:later(targetSource.ingestedAt,benchmarkSource.ingestedAt)};
 const registry=new Map([
  ['SYNTHETIC-target-price',{providerId:'tiingo',snapshotId:targetBridge.snapshot.id,securityId:policy.securityId}],
  ['SYNTHETIC-benchmark-price',{providerId:'tiingo',snapshotId:benchmarkBridge.snapshot.id,securityId:benchmarkId}],
  ['SYNTHETIC-company-file',{providerId:'SYNTHETIC-primary',snapshotId:'SYNTHETIC-company-capture',securityId:policy.securityId}],
  ['SYNTHETIC-event-file',{providerId:'SYNTHETIC-primary',snapshotId:'SYNTHETIC-event-capture',securityId:policy.securityId}],
  ['SYNTHETIC-macro-file',{providerId:'SYNTHETIC-macro',snapshotId:'SYNTHETIC-macro-capture',securityId:null}]
 ]);
 const candidate=candidateFixture(policy.securityId);candidate.cik=policy.cik;
 for(const gate of candidate.gates){gate.reviewed_at=cutoffAt;gate.source_refs=['SYNTHETIC-reviewed-gate-record'];}
 const refs={fundamentals:['SYNTHETIC-company-file'],catalyst:['SYNTHETIC-event-file'],price_action:['SYNTHETIC-target-price','SYNTHETIC-benchmark-price'],macro:['SYNTHETIC-macro-file']};
 for(const r of candidate.research_score_review.components){
  r.source_refs=refs[r.id];assert.ok(r.source_refs.every(ref=>registry.has(ref)));
  r.source_ids=[...new Set(r.source_refs.map(ref=>registry.get(ref).providerId))];
  r.source_cutoff_at=cutoffAt;r.reviewed_at=reviewedAt;
  r.evidence_snapshot_id=registry.get(r.source_refs[0]).snapshotId;
  if(r.id==='price_action')Object.assign(r,{...priceClocks,calculation_convention:priceDraft.convention.version,grade_rule_version:priceDraft.gradeRule.version,numerical_neutrality_version:priceDraft.gradeRule.numericalNeutralityVersion,tolerance_bps:priceDraft.toleranceBps,rating:priceRating,calculated_grade:priceRating,calculation_record_id:'SYNTHETIC-reviewed-price-calculation',target_snapshot_id:targetBridge.snapshot.id,benchmark_snapshot_id:benchmarkBridge.snapshot.id,target_source_ids:['tiingo'],benchmark_source_ids:['tiingo'],measurement_start_at:start,measurement_end_at:end,
   observation_at:end,
   source_availability_basis:'observed_capture',provider_publication_time:null,publication_precision:'unknown',correction_possible:true,
   benchmark_id:benchmarkId,benchmark_evidence_snapshot_id:benchmarkBridge.snapshot.id});
 }
 Object.assign(candidate.research_score_review.publication_rights_review,{source_ids:['tiingo','SYNTHETIC-primary','SYNTHETIC-macro'],reviewed_at:cutoffAt});
 const options={at,cutoff:cutoffAt,priceSession:targetBridge.snapshot.priceSession,priceCalendar:targetBridge.scorerCalendar,audience:'owner_private'};
 return {candidate,options,targetBridge,benchmarkBridge,registry,priceDraft};
}
test('synthetic normalize → observed bridge → generic rights → reviewed components → owner-private score',()=>{
 const f=syntheticChain(),ranked=rankResearchCandidates([f.candidate],window,f.options,5);
 assert.equal(ranked.eligible_count,1,JSON.stringify(ranked.withheld));assert.equal(ranked.rows[0].score,87.5);
 assert.equal(ranked.rows[0].research_rank,1);assert.equal(ranked.rows[0].audience,'owner_private');
 assert.equal(ranked.rows[0].expected_return,null);assert.equal(ranked.rows[0].gain_probability,null);
 assert.doesNotMatch(JSON.stringify(ranked.rows),/raw|responseSha256|providerPublishedAt|rationale|cashPerShare/);
});
test('synthetic successful feeds do not rescue a blocked company/financing gate',()=>{
 for(const gateId of ['company_evidence','financing']){
  const f=syntheticChain();f.candidate.gates.find(g=>g.id===gateId).state='blocked';
  assert.equal(rankResearchCandidates([f.candidate],window,f.options).eligible_count,0);
 }
});
test('the declared market-data provider cannot be omitted from synthetic score rights',()=>{
 const f=syntheticChain();f.candidate.research_score_review.publication_rights_review.source_ids=['SYNTHETIC-primary','SYNTHETIC-macro'];
 assert.equal(rankResearchCandidates([f.candidate],window,f.options).eligible_count,0);
});
test('the reviewed five-session event does not silently become a next-day selection',()=>{
 const f=syntheticChain(),day={horizon_id:'next_day',entry_at:window.entry_at,exit_at:'2026-10-19T20:00:00Z'};
 assert.equal(rankResearchCandidates([f.candidate],day,f.options).eligible_count,0);
});

test('late benchmark provenance advances the calculation and review with exact combined clocks',()=>{
 const f=syntheticChain({benchmarkLate:true}),r=f.candidate.research_score_review.components.find(r=>r.id==='price_action');
 assert.equal(r.target_available_at,f.targetBridge.snapshot.source.availabilityObservedAt);
 assert.equal(r.target_ingested_at,f.targetBridge.snapshot.source.ingestedAt);
 assert.equal(r.benchmark_available_at,f.benchmarkBridge.snapshot.source.availabilityObservedAt);
 assert.equal(r.benchmark_ingested_at,f.benchmarkBridge.snapshot.source.ingestedAt);
 assert.equal(r.source_available_at,r.benchmark_available_at);assert.equal(r.ingested_at,r.benchmark_ingested_at);
 assert.equal(r.calculated_at,f.priceDraft.assessedAt);
 assert.ok(Date.parse(r.reviewed_at)>Date.parse(r.calculated_at));
 assert.equal(rankResearchCandidates([f.candidate],window,f.options,5).eligible_count,1);
});
test('late benchmark cannot inherit target-only clocks or a review before the real calculation',()=>{
 for(const edit of [r=>{r.source_available_at=r.target_available_at;r.ingested_at=r.target_ingested_at;},r=>{r.reviewed_at='2026-10-17T10:05:30.000Z';}]){
  const f=syntheticChain({benchmarkLate:true}),r=f.candidate.research_score_review.components.find(r=>r.id==='price_action');edit(r);
  const result=rankResearchCandidates([f.candidate],window,f.options,5);
  assert.equal(result.eligible_count,0);assert.ok(result.withheld[0].reasons.includes('price_action_calculation_clock_invalid'));
 }
});
