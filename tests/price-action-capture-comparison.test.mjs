// Synthetic display fixtures; no observed market prices or action reviews.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPriceView} from '../dist/lib/prices.js';
import {renderPriceView} from '../dist/lib/price-view.js';
import {calendar,price} from './fixtures/journal-observer.mjs';

const at='2026-12-01T22:10:00Z',cal=calendar();
const view=(target,benchmark)=>buildPriceView(target,{at,calendar:cal,benchmark});

for(const side of ['primary','benchmark'])test(`future ${side} action coverage cannot authorize a raw comparison`,()=>{
 const target=price('AAA'),benchmark=price('SPY'),baseline=view(target,benchmark);
 (side==='primary'?target:benchmark).actions.source.capturedAt='2026-12-01T22:10:00.001Z';
 const inputBefore=JSON.stringify({target,benchmark}),model=view(target,benchmark);
 assert.deepEqual(model.points,baseline.points);assert.deepEqual(model.latest,baseline.latest);
 assert.equal(model.comparison.status,'unavailable');assert.equal(model.comparison.reason,'unadjusted_action_capture_in_future');assert.deepEqual(model.comparison.points,[]);
 assert.equal(model.paperMarksEligible,false);assert.equal(model.eligibleForRanking,false);
 const html=renderPriceView(model);assert.match(html,/<svg/);assert.match(html,/Comparable benchmark history is unavailable/);assert.doesNotMatch(html,/Indexed to 100/);
 assert.equal(JSON.stringify({target,benchmark}),inputBefore);
});

test('exact-at, past and missing action capture clocks preserve existing raw comparison behavior',()=>{
 for(const capturedAt of [at,'2026-12-01T22:00:00Z',null,undefined]) {
  const target=price('AAA'),benchmark=price('SPY');
  for(const series of [target,benchmark])if(capturedAt===undefined)delete series.actions.source;else series.actions.source.capturedAt=capturedAt;
  const model=view(target,benchmark);assert.equal(model.points.length,5);assert.equal(model.comparison.status,'available');assert.equal(model.comparison.points.length,5);
  assert.equal(model.paperMarksEligible,false);assert.equal(model.eligibleForRanking,false);
 }
});

test('adjusted descriptive comparisons do not acquire a new raw-action coverage dependency',()=>{
 for(const priceBasis of ['split_adjusted','total_return_adjusted']) {
  const target=price('AAA'),benchmark=price('SPY');
  for(const series of [target,benchmark]){series.priceBasis=priceBasis;series.actions.source.capturedAt='2026-12-02T22:00:00Z';}
  const model=view(target,benchmark);assert.equal(model.points.length,5);assert.equal(model.comparison.status,'available');
  assert.equal(model.paperMarksEligible,false);assert.equal(model.eligibleForRanking,false);
 }
});

test('malformed action capture remains invalid source data rather than a future-coverage state',()=>{
 const target=price('AAA'),benchmark=price('SPY');target.actions.source.capturedAt='not-a-clock';
 const invalid=view(target,benchmark);assert.equal(invalid.status,'unavailable');assert.ok(invalid.issues.includes('action_source_invalid'));
 benchmark.actions.source.capturedAt='2026-02-30T22:00:00Z';const comparison=view(price('AAA'),benchmark).comparison;
 assert.equal(comparison.status,'unavailable');assert.equal(comparison.reason,'benchmark_invalid');
});
