// Synthetic offline regressions. No owner journal or market observations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournal,enrollPublication,recordActualConfirmation,recordActualFill,recordActualActionReview,projectJournal,validateJournal,checkAppendOnly} from '../dist/lib/journal.js';
import {resolvePaperWindow} from '../dist/lib/prices.js';
import {calendar,publication,START,PUBLISHED,ENROLL} from './fixtures/journal-observer.mjs';

const entryAt='2026-11-24T14:30:00Z';
const coveredAt='2026-11-24T21:00:00Z';
const markedAt='2026-11-25T21:00:00Z';
const observedAt='2026-11-25T22:00:00Z';
const intentId='coverage:AAA:intent';
const reviewMark={seriesId:'synthetic-AAA',symbol:'AAA',entityId:'synthetic-AAA',currency:'USD',session:'2026-11-25',kind:'close',eventAt:markedAt,availableAt:observedAt,priceTimestamp:null,value:'50',priceBasis:'unadjusted',executionBasis:'daily_bar_paper_reference',source:{provider:'Synthetic',dataset:'offline fixture',url:'https://prices.example/synthetic',capturedAt:observedAt,responseSha256:'a'.repeat(64),priceSession:'regular_daily_aggregate'},reviewId:'synthetic-mark-review'};
const coverage={coverage:'verified_complete',fromSession:'2026-11-24',throughSession:'2026-11-24',items:[]};
async function holding({closed=false}={}) {
  let result=await enrollPublication(createJournal({journalId:'synthetic-coverage',at:START}),{id:'coverage',at:ENROLL,publication:publication(),windowResolution:resolvePaperWindow({publishedAt:PUBLISHED,horizonSessions:1,calendar:calendar(),at:ENROLL})});
  assert.equal(result.ok,true);
  result=await recordActualConfirmation(result.journal,{id:'confirm',at:ENROLL,intentId,confirmed:true});assert.equal(result.ok,true);
  result=await recordActualFill(result.journal,{id:'buy',at:'2026-11-24T22:00:00Z',intentId,side:'buy',occurredAt:entryAt,quantity:'1',price:'100',fee:'0'});assert.equal(result.ok,true);
  if(closed){result=await recordActualFill(result.journal,{id:'sell',at:'2026-11-24T22:01:00Z',intentId,side:'sell',occurredAt:coveredAt,quantity:'1',price:'110',fee:'0'});assert.equal(result.ok,true);}
  result=await recordActualActionReview(result.journal,{id:'short-coverage',at:observedAt,intentId,fromAt:entryAt,throughAt:coveredAt,coverage,reviewMark});
  assert.equal(result.ok,true,'existing saved review shape remains valid');
  return result.journal;
}

test('a later actual price mark cannot value shares beyond reviewed action coverage',async()=>{
  const journal=await holding(),original=JSON.stringify(journal);
  assert.equal((await validateJournal(journal)).ok,true);
  const actual=projectJournal(journal).entries[0].actual;
  assert.equal(actual.quantity,'1.00000000');
  assert.equal(actual.realizedPnl,'0.000000');
  assert.equal(actual.marketValue,null);
  assert.equal(actual.openPnl,null);
  assert.equal(actual.totalPnl,null);
  assert.deepEqual(actual.pendingReasons,['actual_action_coverage_before_mark']);
  assert.equal(JSON.stringify(journal),original);
});

test('an appended review through the mark applies the intervening split and restores valuation',async()=>{
  const journal=await holding();
  const complete={...coverage,throughSession:'2026-11-25',items:[{id:'synthetic-split',type:'split',effectiveSession:'2026-11-25',effectiveAt:'2026-11-25T14:30:00Z',splitRatio:{numerator:'2',denominator:'1'}}]};
  const result=await recordActualActionReview(journal,{id:'complete-coverage',at:'2026-11-25T22:01:00Z',intentId,fromAt:entryAt,throughAt:markedAt,coverage:complete,reviewMark});
  assert.equal(result.ok,true);
  assert.equal(checkAppendOnly(journal,result.journal).ok,true);
  const actual=projectJournal(result.journal).entries[0].actual;
  assert.equal(actual.quantity,'2.00000000');
  assert.equal(actual.marketValue,'100.000000');
  assert.equal(actual.openPnl,'0.000000');
  assert.equal(actual.totalPnl,'0.000000');
  assert.deepEqual(actual.pendingReasons,[]);
});

test('a fully sold position keeps its realized result when coverage reaches all fills',async()=>{
  const actual=projectJournal(await holding({closed:true})).entries[0].actual;
  assert.equal(actual.quantity,'0.00000000');
  assert.equal(actual.realizedPnl,'10.000000');
  assert.equal(actual.openPnl,'0.000000');
  assert.equal(actual.totalPnl,'10.000000');
  assert.deepEqual(actual.pendingReasons,[]);
});
