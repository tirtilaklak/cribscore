import test from 'node:test';
import assert from 'node:assert/strict';
import {priceActionFixture,price} from '../../price-action/tests/fixtures.mjs';
import {calculatePriceActionDraft} from '../../price-action/price-action.mjs';
import {inspectMarketSnapshot,commitMarketSnapshot} from '../../market-ingestion/market-ingestion.mjs';
import {fixture} from '../../market-ingestion/tests/fixtures.mjs';
test('generic and calculator reject a date label disconnected from its session instants',()=>{
 const f=priceActionFixture(),s=f.calendar.sessions.find(s=>s.date==='2026-10-16');s.openAt='2026-10-15T21:00:00Z';s.closeAt='2026-10-15T22:00:00Z';
 const x=inspectMarketSnapshot(f.target.snapshot,{at:f.at,cutoffAt:f.cutoffAt,calendar:f.calendar,policy:f.target.policy,rightsReviews:f.target.rightsReviews});assert.equal(x.eligible,false);assert.equal(calculatePriceActionDraft(f).status,'withheld');
});
test('calculator independently rejects contemporaneous request-start fetch disagreement',()=>{
 const f=priceActionFixture(),a=f.target.rightsReviews[0],b=structuredClone(a),later=structuredClone(a);b.id='SYNTHETIC-conflict';b.operations.fetch='denied';later.id='SYNTHETIC-later';later.version=2;later.reviewedAt=later.validFrom='2026-10-17T09:59:45Z';later.termsEvidence[0].observedAt='2026-10-17T09:59:44Z';f.target.rightsReviews=[a,b,later];assert.equal(calculatePriceActionDraft(f).status,'withheld');
});
test('ETF generic policy requires explicit benchmark usage',()=>{const f=fixture();f.snapshot.security.instrumentType='etf';f.options.policy.instrumentType='etf';assert.equal(inspectMarketSnapshot(f.snapshot,f.options).eligible,false);f.options.policy.usage='candidate';assert.equal(inspectMarketSnapshot(f.snapshot,f.options).eligible,false);f.options.policy.usage='benchmark';assert.equal(inspectMarketSnapshot(f.snapshot,f.options).eligible,true);});
for(const sign of[1,-1])test(`exact spread neutrality boundary remains mixed after subtraction: sign ${sign}`,()=>{
 const f=priceActionFixture();f.toleranceBps=0;
 for(const leg of[f.target,f.benchmark])for(const b of leg.snapshot.bars){price(b,1e12);b.volume=1;}
 price(f.target.snapshot.bars.at(-1),1e12+sign*1000);price(f.benchmark.snapshot.bars.at(-1),1e12+sign*999);
 const r=calculatePriceActionDraft(f);assert.equal(r.status,'review_required',JSON.stringify(r));assert.equal(r.historicalGrade,'mixed');assert.equal(r.gradeRule.roundoffMultiplier,4);
 price(f.benchmark.snapshot.bars.at(-1),1e12+sign*998);assert.equal(calculatePriceActionDraft(f).historicalGrade,sign===1?'supportive':'weak');
});
test('archive retains request clock and explicit same-day dividend basis',()=>{
 const f=fixture();f.snapshot.source.requestStartedAt='2026-10-17T09:59:30Z';f.snapshot.actions.items=[{id:'SYNTHETIC-cash',securityId:f.options.policy.securityId,type:'cash_dividend',effectiveSession:f.snapshot.priceSession,cashPerShare:1,currency:'USD',perShareBasis:'post_split'}];
 const r=commitMarketSnapshot(f.archive,f.event,f.options);assert.equal(r.accepted,true,JSON.stringify(r.reasons));assert.equal(r.archive.snapshots[0].source.requestStartedAt,f.snapshot.source.requestStartedAt);assert.equal(r.archive.snapshots[0].actions.items[0].perShareBasis,'post_split');
});
