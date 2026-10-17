// Synthetic chronology checks only; these assertions do not authenticate JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,window,options} from './fixtures.mjs';
import {scoreResearchCandidate} from './research-score.mjs';
const price=c=>c.research_score_review.components.find(r=>r.id==='price_action');
const score=c=>scoreResearchCandidate(c,window,options);
const clockFields=['target_available_at','target_ingested_at','benchmark_available_at','benchmark_ingested_at','calculated_at'];
const blocked=c=>{
 const result=score(c);assert.equal(result.status,'withheld',JSON.stringify(result));
 assert.ok(result.reasons.includes('price_action_calculation_clock_invalid'),JSON.stringify(result.reasons));
};

test('each leg and calculation requires an explicit strict UTC clock',()=>{
 for(const field of clockFields)for(const value of [undefined,null,0,'','2026-10-16T24:00:00Z','2026-02-30T20:00:00Z']){
  const c=fixture();price(c)[field]=value;blocked(c);
 }
});

test('fresh aggregate clocks and review cannot rescue either stale leg',()=>{
 for(const leg of ['target','benchmark']){
  const c=fixture(),r=price(c);
  r[leg+'_available_at']='2026-10-15T20:01:00Z';
  r[leg+'_ingested_at']='2026-10-15T20:02:00Z';
  // The other leg still exactly supplies the existing fresh aggregate maxima.
  assert.equal(r.source_available_at,r[(leg==='target'?'benchmark':'target')+'_available_at']);
  blocked(c);
 }
});

test('each ingestion follows its own availability even when the other leg sets the aggregate',()=>{
 for(const leg of ['target','benchmark']){
  const c=fixture(),r=price(c);r[leg+'_ingested_at']='2026-10-16T20:00:30Z';blocked(c);
 }
});

test('availability and ingestion aggregates independently equal both-leg maxima',()=>{
 const c=fixture(),r=price(c);
 Object.assign(r,{target_available_at:'2026-10-16T21:01:00.123Z',target_ingested_at:'2026-10-16T21:02:00.234Z',
  benchmark_available_at:'2026-10-16T21:00:00.123Z',benchmark_ingested_at:'2026-10-16T21:04:00.234Z',
  source_available_at:'2026-10-16T21:01:00.123Z',ingested_at:'2026-10-16T21:04:00.234Z',calculated_at:'2026-10-16T21:05:00.345Z'});
 assert.equal(score(c).status,'scored');
 for(const edit of [r=>r.source_available_at=r.benchmark_available_at,r=>r.ingested_at=r.target_ingested_at,
  r=>r.source_available_at='2026-10-16T21:02:00Z',r=>r.ingested_at='2026-10-16T21:04:30Z']){
  const changed=structuredClone(c);edit(price(changed));blocked(changed);
 }
});

test('the real calculation follows both ingestions and precedes its independent review',()=>{
 for(const edit of [r=>r.calculated_at='2026-10-16T20:01:59.999Z',
  r=>{r.calculated_at='2026-10-16T20:04:00Z';r.reviewed_at='2026-10-16T20:03:59.999Z';},
  r=>r.calculated_at='2026-10-17T00:23:39.001Z']){
  const c=fixture();edit(price(c));blocked(c);
 }
});

test('equal close, availability, ingestion, calculation and review instants remain valid',()=>{
 const c=fixture(),r=price(c),close=r.measurement_end_at;
 for(const field of [...clockFields,'source_available_at','ingested_at','reviewed_at'])r[field]=close;
 // Numeric instant equality preserves equivalent recorded precision.
 r.target_available_at=close.replace('Z','.000Z');r.calculated_at=close.replace('Z','.0Z');
 assert.equal(score(c).status,'scored');
});
