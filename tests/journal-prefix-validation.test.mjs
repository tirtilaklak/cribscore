// Synthetic prefix accounting regressions; no owner or provider data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createJournal,validateJournal,projectJournal,DEFAULT_PAPER_SETTINGS} from '../dist/lib/journal.js';
const createdAt='2026-10-17T12:00:00Z',entryAt='2026-10-19T13:30:00Z',exitAt='2026-10-19T20:00:00Z',closedAt='2026-10-19T21:00:00Z';
function base(){
 const journal={...createJournal({journalId:'synthetic-prefix-proof',at:createdAt}),events:[]};
 const payloadBytes=JSON.stringify({schema_version:'synthetic-v1',policy_version:'synthetic-v1',generated_at:createdAt,horizon:{id:'next_day',entry_at:entryAt,exit_at:exitAt},rows:[{ticker:'AAA',company:'Synthetic AAA'}]});
 journal.events.push(
  {id:'publication-0',kind:'publication',at:createdAt,data:{publicationId:'synthetic-publication',publishedAt:createdAt,payloadHash:createHash('sha256').update(payloadBytes).digest('hex'),payloadBytes,policyVersion:'synthetic-v1',snapshotVersion:'synthetic-v1',horizonId:'next_day',entities:[{symbol:'AAA',entityId:'synthetic-AAA'}]}},
  {id:'intent-0',kind:'paper_intent',at:createdAt,data:{publicationEventId:'publication-0',symbol:'AAA',settings:{...DEFAULT_PAPER_SETTINGS},window:null,date:'2026-10-17'}},
  {id:'confirmation-0',kind:'actual_confirmation',at:closedAt,data:{intentId:'intent-0',confirmed:true}});
 journal.revision=journal.events.length;return journal;
}
const mark=()=>({seriesId:'synthetic-AAA',symbol:'AAA',entityId:'synthetic-AAA',currency:'USD',session:'2026-10-19',kind:'close',eventAt:exitAt,availableAt:closedAt,priceTimestamp:null,value:'110',priceBasis:'unadjusted',executionBasis:'daily_bar_paper_reference',source:{provider:'Synthetic',dataset:'offline',url:'https://example.invalid/synthetic',capturedAt:closedAt,responseSha256:'a'.repeat(64),priceSession:'regular_daily_aggregate'},reviewId:'synthetic-review'});
const add=(j,...events)=>({...j,events:[...j.events,...structuredClone(events)],revision:j.events.length+events.length});
const fill=(id,{side='buy',quantity='1',occurredAt=entryAt,price='100',fee='0'}={})=>({id,kind:'actual_fill',at:closedAt,data:{intentId:'intent-0',fill:{side,quantity,occurredAt,price,fee,currency:'USD'}}});
const revision=(id,original,patch={})=>({id,kind:'fill_revision',at:closedAt,data:{fillId:original.id,replacement:{...original.data.fill,...patch},reason:'Synthetic edge correction.'}});
const split=(id,effectiveAt,{numerator='2',denominator='1'}={})=>({id,type:'split',effectiveSession:'2026-10-19',effectiveAt,splitRatio:{numerator,denominator}});
const dividend=(id,effectiveAt,perShareBasis='post_split')=>({id,type:'cash_dividend',effectiveSession:'2026-10-19',effectiveAt,cashPerShare:'0.000001',currency:'USD',perShareBasis});
const review=(id,throughAt=exitAt,items=[])=>({id,kind:'actual_action_review',at:closedAt,data:{intentId:'intent-0',fromAt:entryAt,throughAt,coverage:{coverage:'verified_complete',fromSession:'2026-10-19',throughSession:'2026-10-19',items},reviewMark:mark()}});
const t=n=>`2026-10-19T${n}:00Z`;
const buy=fill('buy'),buy3=fill('buy3',{quantity:'3'}),sale=fill('sale',{side:'sell',occurredAt:t('14:00')});
const cases=[
 ['review cutoff switches back to broader coverage',[review('broad'),review('narrow',t('14:00'),[split('split',t('13:45'))]),buy,fill('buy2',{occurredAt:t('13:50')}),fill('sale3',{side:'sell',quantity:'3',occurredAt:t('15:00')})],'oversell'],
 ['chronological relative to fills but before included future action',[buy,review('review',exitAt,[split('split',t('15:00'))]),revision('money',buy,{price:'99'}),fill('sale2',{side:'sell',quantity:'2',occurredAt:t('14:00')})],'oversell'],
 ['review invalidates monetary correction proof',[buy,revision('money',buy,{price:'99'}),review('review',exitAt,[split('reverse',t('15:00'),{numerator:'1',denominator:'3'})]),revision('money2',buy,{price:'98'})],'split_quantity_precision_unsupported'],
 ['review invalidates dividend proof',[buy,review('review',exitAt,[split('split',t('15:00')),dividend('dividend',t('15:00'),'current_shares')]),revision('money',buy,{fee:'0.000001'})],'dividend_share_basis_ambiguous'],
 ['equal time actions precede fills, old fills precede new fills',[review('review',exitAt,[split('split',entryAt),dividend('dividend',entryAt)]),buy,fill('buy2'),fill('sell2',{quantity:'2',side:'sell'}),revision('money',buy,{fee:'0.000001',price:'0.000001'})],null],
 ['numeric quantity equality with distinct precision falls back',[buy3,review('review',exitAt,[split('reverse',t('15:00'),{numerator:'1',denominator:'3'})]),revision('text-quantity',buy3,{quantity:'3.00000000'}),fill('sell',{side:'sell',occurredAt:t('16:00')})],null],
 ['quantity correction breaks earlier sale',[buy,sale,revision('reduce',buy,{quantity:'0.5'}),revision('repair',buy)],'oversell'],
 ['time correction breaks earlier sale',[buy,sale,revision('later',buy,{occurredAt:t('15:00')}),revision('repair',buy)],'oversell'],
 ['side correction creates oversell',[buy,fill('buy2'),revision('sell',buy,{side:'sell'}),revision('repair',buy)],'oversell'],
 ['aggregate quantity exceeds input width',[fill('max',{quantity:'999999999999999.99999999'}),fill('max2',{quantity:'999999999999999.99999999'}),review('review'),revision('money',fill('max',{quantity:'999999999999999.99999999'}),{price:'999999999999999.999999'}),fill('max3',{quantity:'999999999999999.99999999'}),fill('sale',{side:'sell',quantity:'999999999999999.99999999'})],null],
 ['empty quantity across ambiguous dividends remains valid',[review('review',exitAt,[split('split',entryAt),dividend('dividend',entryAt,'current_shares')]),buy,fill('sale',{side:'sell'}),revision('money',buy,{price:'99'})],null],
 ['split cutoff excludes future invalid precision',[review('review',t('14:00'),[split('split',t('15:00'),{numerator:'1',denominator:'3'})]),buy,revision('money',buy,{price:'99'}),fill('sale',{side:'sell',occurredAt:t('13:59')})],null],
 ['out of order buy allows later sale but not prior invalid prefix',[fill('buy-later',{occurredAt:t('15:00')}),fill('buy-early',{occurredAt:entryAt}),fill('sale',{side:'sell',quantity:'2',occurredAt:t('16:00')}),revision('move',fill('buy-early'),{occurredAt:t('17:00')})],'oversell'],
];
for(const [name,events,error] of cases)test(name,async()=>{
 const journal=add(base(),...events),before=structuredClone(journal),result=await validateJournal(journal);
 assert.deepEqual(result.ok?null:result.errors[0],error);assert.deepEqual(journal,before);
 if(result.ok){assert.equal(Object.isFrozen(result.journal),true);assert.equal(Object.isFrozen(result.journal.events.at(-1).data),true);assert.deepEqual(projectJournal(result.journal),projectJournal(journal));}
});

test('a failed prefix stays failed even when followed by a shape error and a repair',async()=>{
 const journal=add(base(),buy,sale,revision('bad',buy,{quantity:'0.5'}),revision('malformed',buy,{price:'0'}),revision('repair',buy));
 assert.deepEqual((await validateJournal(journal)).errors,['oversell']);
 const earlierMalformed=add(base(),buy,revision('malformed',buy,{quantity:'0',price:'0'}),fill('oversell',{side:'sell',quantity:'2'}));
 assert.deepEqual((await validateJournal(earlierMalformed)).errors,['nonpositive_decimal']);
});

test('proof state never crosses validation calls or changes full monetary projection',async()=>{
 const first=add(base(),review('review'),buy,fill('sale',{side:'sell',quantity:'0.5',price:'120',fee:'0.000001'}),revision('correction',buy,{price:'99',fee:'0.000001'}));
 const before=structuredClone(first),checked=await validateJournal(first);assert.equal(checked.ok,true);
 const actual=projectJournal(checked.journal).entries[0].actual;
 assert.equal(actual.quantity,'0.50000000');assert.equal(actual.costBasis,'49.500000');assert.equal(actual.realizedPnl,'10.499998');assert.equal(actual.fees,'0.000002');
 const changed=structuredClone(first);changed.events[4].data.fill.quantity='0.25';
 assert.deepEqual((await validateJournal(changed)).errors,['oversell']);
 assert.equal((await validateJournal(first)).ok,true);assert.deepEqual(first,before);
});


test('validation indexes cannot resolve references to later unaccepted events',async()=>{
 const journal=base(),confirmation=journal.events.pop();journal.revision--;
 const prematureFill=add(journal,buy,confirmation);
 assert.deepEqual((await validateJournal(prematureFill)).errors,['actual_confirmation_missing']);
 const prematureRevision=add(base(),revision('too-early',buy,{price:'99'}),buy);
 assert.deepEqual((await validateJournal(prematureRevision)).errors,['invalid_fill_revision']);
 const outOfOrder=base();[outOfOrder.events[0],outOfOrder.events[1]]=[outOfOrder.events[1],outOfOrder.events[0]];
 assert.deepEqual((await validateJournal(outOfOrder)).errors,['invalid_intent_context']);
 // A previous successful call cannot supply the missing confirmation/target.
 assert.equal((await validateJournal(add(base(),buy))).ok,true);
 assert.deepEqual((await validateJournal(prematureFill)).errors,['actual_confirmation_missing']);
 assert.deepEqual((await validateJournal(prematureRevision)).errors,['invalid_fill_revision']);
});
