// Synthetic offline action-cutoff regressions; no provider or owner data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournal,enrollPublication,recordActualConfirmation,recordActualFill,recordActualActionReview,reviseActualFill,projectJournal,validateJournal,checkAppendOnly} from '../dist/lib/journal.js';
import {resolvePaperWindow} from '../dist/lib/prices.js';
import {calendar,publication,START,PUBLISHED,ENROLL} from './fixtures/journal-observer.mjs';

const intentId='cutoff:AAA:intent',entryAt='2026-11-24T14:30:00Z',closeAt='2026-11-24T21:00:00Z',at='2026-11-24T22:00:00Z';
const nextOpen='2026-11-25T14:30:00Z',nextClose='2026-11-25T21:00:00Z',nextAt='2026-11-25T22:00:00Z';
const split={id:'scheduled-reverse-split',type:'split',effectiveSession:'2026-11-25',effectiveAt:nextOpen,splitRatio:{numerator:'1',denominator:'3'}};
function mark(eventAt=closeAt,availableAt=at,value='110') {return {seriesId:'synthetic-AAA',symbol:'AAA',entityId:'synthetic-AAA',currency:'USD',session:eventAt.slice(0,10),kind:'close',eventAt,availableAt,priceTimestamp:null,value,priceBasis:'unadjusted',executionBasis:'daily_bar_paper_reference',source:{provider:'Synthetic',dataset:'offline',url:'https://prices.example/synthetic',capturedAt:availableAt,responseSha256:'a'.repeat(64),priceSession:'regular_daily_aggregate'},reviewId:'synthetic-review'};}
const buy=(quantity='1',price='100')=>({side:'buy',occurredAt:entryAt,quantity,price,fee:'0',currency:'USD'});
async function addReview(journal,{id='review',throughAt=closeAt,observedAt=at,actions=[split],reviewMark=mark()}={}) {
 const result=await recordActualActionReview(journal,{id,at:observedAt,intentId,fromAt:entryAt,throughAt,coverage:{coverage:'verified_complete',fromSession:'2026-11-24',throughSession:'2026-11-25',items:actions},reviewMark});assert.equal(result.ok,true,JSON.stringify(result));return result.journal;
}
async function setup(quantity=null) {
 let result=await enrollPublication(createJournal({journalId:'synthetic-cutoff-journal',at:START}),{id:'cutoff',at:ENROLL,publication:publication(),windowResolution:resolvePaperWindow({publishedAt:PUBLISHED,horizonSessions:1,calendar:calendar(),at:ENROLL})});assert.equal(result.ok,true);
 result=await recordActualConfirmation(result.journal,{id:'confirm',at:ENROLL,intentId,confirmed:true});assert.equal(result.ok,true);
 if(quantity){result=await recordActualFill(result.journal,{id:'buy',at,intentId,...buy(quantity)});assert.equal(result.ok,true);}
 return addReview(result.journal);
}

test('recording a current fill ignores reviewed actions after the actual cutoff',async()=>{
 const journal=await setup(),before=JSON.stringify(journal);
 const result=await recordActualFill(journal,{id:'buy',at,intentId,...buy()});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal((await validateJournal(result.journal)).ok,true);
 const actual=projectJournal(result.journal).entries[0].actual;
 assert.equal(actual.quantity,'1.00000000');assert.equal(actual.marketValue,'110.000000');assert.equal(actual.totalPnl,'10.000000');
 assert.equal(JSON.stringify(journal),before);assert.equal(checkAppendOnly(journal,result.journal).ok,true);
});

test('a future reverse split cannot block correcting an already completed fill price',async()=>{
 const journal=await setup('1');
 const result=await reviseActualFill(journal,{id:'correct-price',at,fillId:'buy',replacement:buy('1','99'),reason:'Synthetic completed-fill correction.'});
 assert.equal(result.ok,true,JSON.stringify(result));
 const actual=projectJournal(result.journal).entries[0].actual;
 assert.equal(actual.quantity,'1.00000000');assert.equal(actual.costBasis,'99.000000');assert.equal(actual.totalPnl,'11.000000');
 assert.equal(journal.events.find(e=>e.id==='buy').data.fill.price,'100');
 assert.equal(checkAppendOnly(journal,result.journal).ok,true);
});

test('a current partial sale preserves realized and remaining basis before a scheduled split',async()=>{
 const journal=await setup('3');
 const result=await recordActualFill(journal,{id:'partial-sale',at,intentId,side:'sell',occurredAt:closeAt,quantity:'1',price:'120',fee:'0'});
 assert.equal(result.ok,true,JSON.stringify(result));
 const actual=projectJournal(result.journal).entries[0].actual;
 assert.equal(actual.quantity,'2.00000000');assert.equal(actual.costBasis,'200.000000');assert.equal(actual.realizedPnl,'20.000000');assert.equal(actual.openPnl,'20.000000');assert.equal(actual.totalPnl,'40.000000');
});

test('an action exactly at the reviewed cutoff still applies before a same-time sale',async()=>{
 let journal=await setup('1');
 journal=await addReview(journal,{id:'inclusive-cutoff',throughAt:nextOpen,observedAt:nextAt,reviewMark:mark(nextClose,nextAt,'50'),actions:[{...split,id:'forward-split',splitRatio:{numerator:'2',denominator:'1'}}]});
 const result=await recordActualFill(journal,{id:'sell-at-split',at:nextAt,intentId,side:'sell',occurredAt:nextOpen,quantity:'2',price:'50',fee:'0'});
 assert.equal(result.ok,true,JSON.stringify(result));
 const actual=projectJournal(result.journal).entries[0].actual;
 assert.equal(actual.quantity,'0.00000000');assert.equal(actual.realizedPnl,'0.000000');assert.equal(actual.totalPnl,'0.000000');
});

test('unsupported split precision inside the cutoff still blocks an invalid correction',async()=>{
 let journal=await setup('1');
 journal=await addReview(journal,{id:'includes-reverse-split',throughAt:nextClose,observedAt:nextAt,reviewMark:mark(nextClose,nextAt,'330')});
 const result=await reviseActualFill(journal,{id:'correct-after-split',at:nextAt,fillId:'buy',replacement:buy('1','99'),reason:'Synthetic precision control.'});
 assert.equal(result.ok,false);assert.deepEqual(result.errors,['split_quantity_precision_unsupported']);
});
