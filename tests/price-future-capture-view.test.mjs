// Synthetic display fixtures; these are not observed prices or source reviews.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPriceView,normalizePriceSeries} from '../dist/lib/prices.js';
import {renderPriceView} from '../dist/lib/price-view.js';
import {calendar,price} from './fixtures/journal-observer.mjs';

const at='2026-12-01T22:10:00Z',future='2026-12-02T22:00:00Z',cal=calendar();
function supplied(symbol,channel='retained_capture') {
 const series=price(symbol);series.source.channel=channel;
 for(const bar of series.bars)bar.availableAt='2026-12-01T21:00:00Z';
 return series;
}
const view=(target,benchmark,assessmentAt=at)=>buildPriceView(target,{at:assessmentAt,calendar:cal,benchmark});

test('explicit earlier bar availability cannot expose a future primary capture',()=>{
 for(const channel of ['retained_capture','manual_import']) {
  const target=supplied('AAA',channel);target.source.capturedAt=future;const before=structuredClone(target);
  const model=view(target,supplied('SPY'));
  assert.equal(model.status,'unavailable');assert.deepEqual(model.points,[]);assert.equal(model.latest,null);
  assert.equal(model.freshness.captureStatus,'invalid');assert.ok(model.warnings.includes('capture_in_future'));
  assert.equal(model.comparison.status,'unavailable');assert.equal(model.paperMarksEligible,false);assert.equal(model.eligibleForRanking,false);
  const html=renderPriceView(model);assert.doesNotMatch(html,/<svg|Indexed to 100|class="price-value"/);assert.match(html,/Capture clock invalid/);
  assert.deepEqual(target,before);
 }
});

test('a future benchmark capture cannot appear as comparable supplied history',()=>{
 for(const channel of ['retained_capture','manual_import']) {
  const target=supplied('AAA'),benchmark=supplied('SPY',channel);benchmark.source.capturedAt=future;
  const model=view(target,benchmark);
  assert.equal(model.points.length,5);assert.equal(model.freshness.captureStatus,'within_policy');
  assert.equal(model.comparison.status,'unavailable');assert.equal(model.comparison.reason,'benchmark_capture_in_future');assert.deepEqual(model.comparison.points,[]);
  const html=renderPriceView(model);assert.match(html,/<svg/);assert.match(html,/Comparable benchmark history is unavailable/);assert.doesNotMatch(html,/Indexed to 100/);
 }
});

test('malformed capture clocks remain invalid data rather than future observations',()=>{
 const target=supplied('AAA'),benchmark=supplied('SPY');target.source.capturedAt='not-a-clock';
 const invalid=normalizePriceSeries(target,{at});assert.equal(invalid.status,'invalid');assert.ok(invalid.issues.includes('source_capturedAt_invalid'));
 const missing=view(target,benchmark);assert.equal(missing.status,'unavailable');assert.equal(missing.latest,null);assert.ok(missing.issues.includes('source_capturedAt_invalid'));
 benchmark.source.capturedAt='2026-02-30T22:00:00Z';const comparison=view(supplied('AAA'),benchmark).comparison;
 assert.equal(comparison.status,'unavailable');assert.equal(comparison.reason,'benchmark_invalid');
});

test('past, equal and unknown captures preserve descriptive charts without granting price authority',()=>{
 for(const capturedAt of ['2026-12-01T22:00:00Z',at,null]) {
  const target=supplied('AAA'),benchmark=supplied('SPY');target.source.capturedAt=capturedAt;benchmark.source.capturedAt=capturedAt;
  const model=view(target,benchmark);assert.equal(model.points.length,5);assert.equal(model.comparison.status,'available');
  assert.equal(model.latest.availableAt,'2026-12-01T21:00:00Z');assert.equal(model.latest.capturedAt,capturedAt);
  assert.equal(model.paperMarksEligible,false);assert.equal(model.eligibleForRanking,false);assert.equal(model.chartTrust,'unreviewed_source');
  const html=renderPriceView(model);assert.match(html,/Indexed to 100/);assert.match(html,/has not been verified for journal valuation/);
 }
});
