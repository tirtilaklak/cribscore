import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePriceActionDraft,projectPriceActionComparison} from '../price-action.mjs';
import {priceActionFixture,price,action} from './fixtures.mjs';
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);

test('six exact completed closes produce a five-interval historical review draft',()=>{
  const f=priceActionFixture(),before=structuredClone(f);price(f.target.snapshot.bars.at(-1),105);
  const r=calculatePriceActionDraft(f);assert.equal(r.status,'review_required',JSON.stringify(r));close(r.internalComparison.targetReturn,.05);close(r.internalComparison.benchmarkReturn,0);
  assert.equal(r.window.sessionEndpoints.length,6);assert.equal(r.window.completedReturnIntervals,5);assert.equal(r.historicalGrade,'supportive');assert.equal(r.scoreReviewPassed,false);assert.equal(r.candidateGatePassed,false);assert.equal(r.eligibleForRanking,false);
  assert.deepEqual(f.target.snapshot.bars.slice(0,-1),before.target.snapshot.bars.slice(0,-1));
});
test('input objects remain immutable',()=>{const f=priceActionFixture(),before=structuredClone(f);calculatePriceActionDraft(f);projectPriceActionComparison(f);assert.deepEqual(f,before);});
test('a 2-for-1 split with reciprocal price change leaves wealth and comparison invariant',()=>{
  const f=priceActionFixture(),date=f.target.snapshot.bars.at(-3).session;
  f.target.snapshot.actions.items=[action(f.target,'split',date,{splitRatio:2})];
  for(const b of f.target.snapshot.bars.slice(-3))price(b,50);
  const r=calculatePriceActionDraft(f);assert.equal(r.status,'review_required',JSON.stringify(r));close(r.internalComparison.targetReturn,0);assert.equal(r.internalComparison.target.terminalShares,2);assert.equal(r.historicalGrade,'mixed');
});
test('reverse split preserves wealth under reciprocal closing prices',()=>{
  const f=priceActionFixture(),date=f.target.snapshot.bars.at(-2).session;
  f.target.snapshot.actions.items=[action(f.target,'split',date,{splitRatio:.1})];
  for(const b of f.target.snapshot.bars.slice(-2))price(b,1000);
  close(calculatePriceActionDraft(f).internalComparison.targetReturn,0);
});
test('a cash dividend offsets an ex-dividend price reduction without reinvestment',()=>{
  const f=priceActionFixture(),date=f.target.snapshot.bars.at(-3).session;
  f.target.snapshot.actions.items=[action(f.target,'cash_dividend',date,{cashPerShare:2,currency:'USD'})];
  for(const b of f.target.snapshot.bars.slice(-3))price(b,98);
  const r=calculatePriceActionDraft(f);close(r.internalComparison.targetReturn,0);assert.equal(r.internalComparison.target.cashEntitlements,2);assert.equal(r.internalComparison.target.terminalShares,1);
});
test('cash remains cash when later prices move, with no fabricated reinvestment',()=>{
  const f=priceActionFixture(),date=f.target.snapshot.bars.at(-3).session;
  f.target.snapshot.actions.items=[action(f.target,'cash_dividend',date,{cashPerShare:10,currency:'USD'})];
  price(f.target.snapshot.bars.at(-3),90);price(f.target.snapshot.bars.at(-1),180);
  const r=calculatePriceActionDraft(f);close(r.internalComparison.targetReturn,.9);assert.equal(r.internalComparison.target.terminalShares,1);
});
test('same-day split plus dividend uses explicit post-split per-share entitlement',()=>{
  const f=priceActionFixture(),date=f.target.snapshot.bars.at(-3).session;
  f.target.snapshot.actions.items=[action(f.target,'split',date,{splitRatio:2}),action(f.target,'cash_dividend',date,{cashPerShare:1,currency:'USD',perShareBasis:'post_split'})];
  for(const b of f.target.snapshot.bars.slice(-3))price(b,50);
  const r=calculatePriceActionDraft(f);assert.equal(r.status,'review_required',JSON.stringify(r));close(r.internalComparison.targetReturn,.02);assert.equal(r.internalComparison.target.cashEntitlements,2);
});
test('ambiguous same-day split/dividend basis withholds the calculation',()=>{
  const f=priceActionFixture(),date=f.target.snapshot.bars.at(-3).session;
  f.target.snapshot.actions.items=[action(f.target,'split',date,{splitRatio:2}),action(f.target,'cash_dividend',date,{cashPerShare:1,currency:'USD'})];
  const r=calculatePriceActionDraft(f);assert.equal(r.status,'withheld');assert.ok(r.reasons.includes('target_same_day_distribution_basis_ambiguous'));
});
test('initial-endpoint split and dividend are excluded from the holding convention',()=>{
  const f=priceActionFixture(),date=f.target.snapshot.bars.at(-6).session;
  f.target.snapshot.actions.items=[action(f.target,'split',date,{splitRatio:2}),action(f.target,'cash_dividend',date,{cashPerShare:2,currency:'USD'})];
  const r=calculatePriceActionDraft(f);close(r.internalComparison.targetReturn,0);assert.equal(r.internalComparison.target.adjustments.length,0);
});
test('actions on the final endpoint are included',()=>{
  const f=priceActionFixture(),date=f.target.snapshot.bars.at(-1).session;
  f.target.snapshot.actions.items=[action(f.target,'cash_dividend',date,{cashPerShare:1,currency:'USD'})];
  close(calculatePriceActionDraft(f).internalComparison.targetReturn,.01);
});
test('benchmark actions use the identical convention',()=>{
  const f=priceActionFixture(),date=f.benchmark.snapshot.bars.at(-2).session;
  f.benchmark.snapshot.actions.items=[action(f.benchmark,'split',date,{splitRatio:2})];
  for(const b of f.benchmark.snapshot.bars.slice(-2))price(b,50);
  const r=calculatePriceActionDraft(f);close(r.internalComparison.benchmarkReturn,0);close(r.internalComparison.targetMinusBenchmark,0);
});
for(const [name,targetEnd,benchmarkEnd,grade]of[
  ['absolute and relative positive',103,101,'supportive'],['absolute and relative negative',97,99,'weak'],
  ['absolute gain but relative lag',101,103,'mixed'],['absolute loss but relative lead',99,97,'mixed'],
  ['inside tolerance',100.05,100,'mixed'],['flat',100,100,'mixed']
  ,['positive spread on decimal tolerance boundary',100.3,100.2,'mixed'],['negative spread on decimal tolerance boundary',99.7,99.8,'mixed']
])test(`coarse grade: ${name}`,()=>{const f=priceActionFixture();price(f.target.snapshot.bars.at(-1),targetEnd);price(f.benchmark.snapshot.bars.at(-1),benchmarkEnd);assert.equal(calculatePriceActionDraft(f).historicalGrade,grade);});

for(const [name,change]of[
  ['missing endpoint',f=>f.target.snapshot.bars.pop()],['zero endpoint price',f=>price(f.target.snapshot.bars.at(-1),0)],
  ['zero traded volume',f=>f.target.snapshot.bars.at(-1).volume=0],['nonfinite close',f=>f.target.snapshot.bars.at(-1).close=Infinity],
  ['benchmark missing endpoint',f=>f.benchmark.snapshot.bars.pop()],['benchmark endpoint shifted',f=>f.benchmark.snapshot.bars.at(-1).session='2026-10-15'],
  ['benchmark identity replaced',f=>f.benchmark.snapshot.security.id='OTHER'],['benchmark single-venue volume',f=>f.benchmark.snapshot.basis.coverage='single_venue'],
  ['benchmark unreviewed ETF identity',f=>{f.benchmark.snapshot.security.instrumentType='etf';f.benchmark.policy.instrumentType='etf';}],
  ['history gap',f=>f.target.snapshot.bars.splice(20,1)],['unknown actions',f=>f.target.snapshot.actions.complete=false],
  ['unsupported action',f=>f.target.snapshot.actions.items=[action(f.target,'merger',f.target.snapshot.bars.at(-1).session)]],
  ['negative split',f=>f.target.snapshot.actions.items=[action(f.target,'split',f.target.snapshot.bars.at(-1).session,{splitRatio:-2})]],
  ['negative cash dividend',f=>f.target.snapshot.actions.items=[action(f.target,'cash_dividend',f.target.snapshot.bars.at(-1).session,{cashPerShare:-1,currency:'USD'})]],
  ['capture after cutoff',f=>f.target.snapshot.source.ingestedAt='2026-10-17T11:01:00Z'],
  ['stale actual read',f=>f.at='2026-10-20T12:00:00Z'],['expired target rights',f=>f.target.rightsReviews[0].expiresAt='2026-10-17T11:59:59Z'],
  ['expired benchmark rights',f=>f.benchmark.rightsReviews[0].expiresAt='2026-10-17T11:59:59Z'],
  ['derive denied',f=>f.target.rightsReviews[0].operations.derive='denied'],
  ['missing latest check',f=>delete f.target.latestCheck],['latest failed check',f=>f.target.latestCheck.status='failed'],
  ['latest pending check',f=>f.target.latestCheck.status='pending'],['check bound to another snapshot',f=>f.target.latestCheck.snapshotId='OTHER'],
  ['unknown request start',f=>delete f.target.snapshot.source.requestStartedAt],['request starts after completion',f=>f.target.snapshot.source.requestStartedAt='2026-10-17T10:00:01Z'],
  ['missing convention',f=>delete f.conventionVersion],['unknown convention',f=>f.conventionVersion='price-only'],
  ['negative tolerance',f=>f.toleranceBps=-1],['missing tolerance',f=>delete f.toleranceBps],['invalid time',f=>f.at='2026-02-30T12:00:00Z']
])test(`withholds ${name}`,()=>{const f=priceActionFixture();change(f);const r=calculatePriceActionDraft(f);assert.equal(r.status,'withheld',JSON.stringify(r));assert.equal(r.internalComparison,null);assert.equal(r.historicalGrade,null);});

test('a review observed after the request began cannot authorize that request',()=>{
  const f=priceActionFixture(),r=f.target.rightsReviews[0];r.reviewedAt=r.validFrom='2026-10-17T09:59:45Z';r.termsEvidence[0].observedAt='2026-10-17T09:59:00Z';
  const d=calculatePriceActionDraft(f);assert.equal(d.status,'withheld');assert.deepEqual(d.reasons,['target_fetch_rights_unknown']); // Generic admission now rejects the unauthorized request start first.
});
test('multiple split records on one session are ambiguous',()=>{
  const f=priceActionFixture(),date=f.target.snapshot.bars.at(-1).session;
  f.target.snapshot.actions.items=[action(f.target,'split',date,{splitRatio:2}),{...action(f.target,'split',date,{splitRatio:3}),id:'SYNTHETIC-another-split'}];
  assert.ok(calculatePriceActionDraft(f).reasons.includes('target_multiple_splits_same_session'));
});
test('derived-only rights permit the public coarse comparison while prices stay private',()=>{
  const f=priceActionFixture();for(const leg of[f.target,f.benchmark])leg.rightsReviews[0].operations.display='denied';price(f.target.snapshot.bars.at(-1),105);
  const p=projectPriceActionComparison(f);assert.equal(p.status,'review_required');assert.equal(p.historicalGrade,'supportive');
  for(const forbidden of['internalComparison','targetReturn','benchmarkReturn','targetMinusBenchmark','initialValue','terminalEquityValue','cashEntitlements','terminalShares','priceReference','value'])assert.equal(Object.hasOwn(p,forbidden),false);
  const encoded=JSON.stringify(p);assert.doesNotMatch(encoded,/"targetReturn"|"benchmarkReturn"|"targetMinusBenchmark"|"initialValue"|"terminalEquityValue"/);
  assert.equal(p.expectedReturn,null);assert.equal(p.gainProbability,null);assert.equal(p.scoreReviewPassed,false);
});
test('internal-use permission alone does not publish the coarse grade',()=>{
  const f=priceActionFixture();f.benchmark.rightsReviews[0].operations.derived_display='denied';
  assert.equal(calculatePriceActionDraft(f).status,'review_required');const p=projectPriceActionComparison(f);assert.equal(p.status,'rights_blocked');assert.equal(p.historicalGrade,null);
});
test('future opens, candidate labels and supplied grades cannot affect the calculation',()=>{
  const f=priceActionFixture();f.nextEntryPrice=9999;f.historicalGrade='supportive';f.scoreReviewPassed=true;
  f.target.snapshot.expectedReturn=9;f.target.snapshot.futureOpeningGap=.8;
  const d=calculatePriceActionDraft(f),p=projectPriceActionComparison(f);close(d.internalComparison.targetReturn,0);assert.equal(p.historicalGrade,'mixed');assert.equal(p.expectedReturn,null);assert.equal(p.scoreReviewPassed,false);
});
test('projection recomputes against a new revocation instead of trusting an old draft',()=>{
  const f=priceActionFixture(),d=calculatePriceActionDraft(f);assert.equal(d.status,'review_required');
  const revoked=structuredClone(f.target.rightsReviews[0]);revoked.id='SYNTHETIC-revocation';revoked.version=2;revoked.reviewedAt=revoked.validFrom='2026-10-17T11:00:00Z';revoked.termsEvidence[0].observedAt='2026-10-17T10:59:00Z';revoked.operations.derive='revoked';f.target.rightsReviews.push(revoked);
  const p=projectPriceActionComparison(f);assert.equal(p.status,'withheld');assert.equal(p.historicalGrade,null);assert.equal(d.status,'review_required');
});
test('malformed requests fail closed',()=>{for(const value of[null,[],{},'invalid'])assert.equal(calculatePriceActionDraft(value).status,'withheld');});
