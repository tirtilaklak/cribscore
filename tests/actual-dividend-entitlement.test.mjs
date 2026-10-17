// Synthetic offline dividend-entitlement regressions; no provider or owner data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournal,enrollPublication,recordActualConfirmation,recordActualFill,recordActualActionReview,reviseActualFill,calculateLongPosition,projectJournal,validateJournal,checkAppendOnly} from '../dist/lib/journal.js';
import {resolvePaperWindow} from '../dist/lib/prices.js';
import {calendar,publication,START,PUBLISHED,ENROLL} from './fixtures/journal-observer.mjs';

const intentId='range:AAA:intent',entryAt='2026-11-24T14:30:00Z',closeAt='2026-11-24T21:00:00Z',at='2026-11-24T22:00:00Z';
function actions(effectiveSession='2026-11-23') {const effectiveAt=effectiveSession+'T14:30:00Z';return [
 {id:'split',type:'split',effectiveSession,effectiveAt,splitRatio:{numerator:'2',denominator:'1'}},
 {id:'dividend',type:'cash_dividend',effectiveSession,effectiveAt,cashPerShare:'1',currency:'USD',perShareBasis:'current_shares'}
];}
function mark(eventAt=closeAt,availableAt=at,value='110') {return {seriesId:'synthetic-AAA',symbol:'AAA',entityId:'synthetic-AAA',currency:'USD',session:eventAt.slice(0,10),kind:'close',eventAt,availableAt,priceTimestamp:null,value,priceBasis:'unadjusted',executionBasis:'daily_bar_paper_reference',source:{provider:'Synthetic',dataset:'offline',url:'https://prices.example/synthetic',capturedAt:availableAt,responseSha256:'a'.repeat(64),priceSession:'regular_daily_aggregate'},reviewId:'synthetic-review'};}
const buy=(price='100')=>({side:'buy',occurredAt:entryAt,quantity:'1',price,fee:'0',currency:'USD'});
async function setup({fill=false,items=actions(),throughAt=closeAt,observedAt=at}={}) {
 let result=await enrollPublication(createJournal({journalId:'synthetic-range-journal',at:START}),{id:'range',at:ENROLL,publication:publication(),windowResolution:resolvePaperWindow({publishedAt:PUBLISHED,horizonSessions:1,calendar:calendar(),at:ENROLL})});assert.equal(result.ok,true);
 result=await recordActualConfirmation(result.journal,{id:'confirm',at:ENROLL,intentId,confirmed:true});assert.equal(result.ok,true);
 if(fill){result=await recordActualFill(result.journal,{id:'buy',at,intentId,...buy()});assert.equal(result.ok,true);}
 result=await recordActualActionReview(result.journal,{id:'review',at:observedAt,intentId,fromAt:entryAt,throughAt,coverage:{coverage:'verified_complete',fromSession:'2026-11-23',throughSession:throughAt.slice(0,10),items},reviewMark:mark(throughAt,observedAt)});
 assert.equal(result.ok,true,JSON.stringify(result));return result.journal;
}
function assertCurrentPosition(journal) {
 const actual=projectJournal(journal).entries[0].actual;
 assert.equal(actual.quantity,'1.00000000');assert.equal(actual.marketValue,'110.000000');assert.equal(actual.totalPnl,'10.000000');assert.deepEqual(actual.pendingReasons,[]);
}

test('actions before the reviewed holding interval do not suppress actual valuation',async()=>{
 const journal=await setup({fill:true}),before=JSON.stringify(journal);
 assertCurrentPosition(journal);assert.equal((await validateJournal(journal)).ok,true);
 assert.equal(JSON.stringify(journal),before);assert.equal(journal.events.at(-1).data.coverage.items.length,2);
});

test('wider source coverage before fromAt cannot block a current actual fill',async()=>{
 const journal=await setup(),result=await recordActualFill(journal,{id:'buy',at,intentId,...buy()});
 assert.equal(result.ok,true,JSON.stringify(result));assertCurrentPosition(result.journal);
 assert.equal(checkAppendOnly(journal,result.journal).ok,true);
});

test('wider source coverage before fromAt cannot block correcting a current fill',async()=>{
 const journal=await setup({fill:true}),result=await reviseActualFill(journal,{id:'correction',at,fillId:'buy',replacement:buy('99'),reason:'Synthetic completed-fill correction.'});
 assert.equal(result.ok,true,JSON.stringify(result));
 const actual=projectJournal(result.journal).entries[0].actual;
 assert.equal(actual.quantity,'1.00000000');assert.equal(actual.costBasis,'99.000000');assert.equal(actual.totalPnl,'11.000000');
 assert.equal(checkAppendOnly(journal,result.journal).ok,true);
});

test('ambiguous split and dividend inside the reviewed holding interval still block accounting',async()=>{
 const journal=await setup({fill:true,items:actions('2026-11-25'),throughAt:'2026-11-25T21:00:00Z',observedAt:'2026-11-25T22:00:00Z'});
 assert.deepEqual(projectJournal(journal).entries[0].actual.pendingReasons,['dividend_share_basis_ambiguous']);
 const result=await reviseActualFill(journal,{id:'correction',at:'2026-11-25T22:00:00Z',fillId:'buy',replacement:buy('99'),reason:'Synthetic in-range ambiguity control.'});
 assert.equal(result.ok,false);assert.deepEqual(result.errors,['dividend_share_basis_ambiguous']);
});

const directFill=(id,side,occurredAt,quantity='1',price='100')=>({id,side,occurredAt,quantity,price,fee:'0',currency:'USD'});
function accounting(fills,items=actions('2026-11-25')) {return calculateLongPosition({fills,actions:items,mark:{eventAt:'2026-11-25T21:00:00Z',value:'110',currency:'USD'}});}

test('a same-session split/dividend pair before or exactly at the first buy has no entitlement',()=>{
 for(const occurredAt of ['2026-11-25T14:30:00Z','2026-11-25T15:00:00Z']) {
  const result=accounting([directFill('buy','buy',occurredAt)]);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.quantity,'1.00000000');
  assert.equal(result.dividendAccrual,'0.000000');assert.equal(result.totalPnl,'10.000000');
 }
});

test('split/dividend ambiguity while a position is closed cannot affect a later reopening',()=>{
 const fills=[directFill('buy','buy',entryAt),directFill('close','sell',closeAt,'1','105')];
 for(const reopen of [false,true]) {
  const result=accounting(reopen?[...fills,directFill('reopen','buy','2026-11-25T15:00:00Z')]:fills);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.quantity,reopen?'1.00000000':'0.00000000');
  assert.equal(result.realizedPnl,'5.000000');assert.equal(result.dividendAccrual,'0.000000');assert.equal(result.totalPnl,reopen?'15.000000':'5.000000');
 }
});

test('a partial sale retains held-share ambiguity at the subsequent dividend',()=>{
 const result=accounting([directFill('buy','buy',entryAt,'2'),directFill('partial','sell',closeAt)]);
 assert.equal(result.ok,false);assert.deepEqual(result.errors,['dividend_share_basis_ambiguous']);
});

test('a same-time exit still holds the shares when split and dividend events occur',()=>{
 const fills=[directFill('buy','buy',entryAt),directFill('exit','sell','2026-11-25T14:30:00Z','2','55')];
 assert.deepEqual(accounting(fills).errors,['dividend_share_basis_ambiguous']);
 const result=accounting(fills,actions('2026-11-25').map(action=>action.type==='cash_dividend'?{...action,perShareBasis:'post_split'}:action));
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.quantity,'0.00000000');assert.equal(result.realizedPnl,'10.000000');assert.equal(result.dividendAccrual,'2.000000');assert.equal(result.totalPnl,'12.000000');
});

test('partial sales before and at ex-time preserve split basis and dividend entitlement',()=>{
 const items=actions('2026-11-25').map(action=>action.type==='cash_dividend'?{...action,perShareBasis:'post_split'}:action);
 const fills=[directFill('buy','buy',entryAt,'3'),directFill('partial-before','sell',closeAt,'1','120'),directFill('partial-at','sell','2026-11-25T14:30:00Z','1','55')];
 const result=calculateLongPosition({fills,actions:items,mark:{eventAt:'2026-11-25T21:00:00Z',value:'55',currency:'USD'}});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.quantity,'3.00000000');assert.equal(result.costBasis,'150.000000');
 assert.equal(result.realizedPnl,'25.000000');assert.equal(result.dividendAccrual,'4.000000');assert.equal(result.openPnl,'15.000000');assert.equal(result.totalPnl,'44.000000');
});

test('zero entitlement does not bypass dividend schema or duplicate validation',()=>{
 const [split,dividend]=actions('2026-11-25');
 for(const [items,expected] of [[[split,{...dividend,cashPerShare:'bad'}],'invalid_decimal'],[[split,{...dividend,perShareBasis:'unknown'}],'invalid_dividend_basis'],[[dividend,dividend],'duplicate_action']]) {
  const result=accounting([],items);assert.equal(result.ok,false);assert.deepEqual(result.errors,[expected]);
 }
});
