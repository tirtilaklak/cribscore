// Synthetic review transitions; no owner, provider, network or persisted records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as domain from '../dist/lib/journal.js';
const {validateJournal,projectJournal,DEFAULT_PAPER_SETTINGS}=domain;
const created='2026-10-17T12:00:00Z',entry='2026-10-19T13:30:00Z',exit='2026-10-19T20:00:00Z',posted='2026-10-20T12:00:00Z';
const time=minute=>new Date(Date.parse(entry)+minute*60000).toISOString();
const event=(id,kind,data)=>({id,kind,at:posted,data});
function base(){
 const events=[];
 for(let n=0;n<2;n++){
  const symbol=['AAA','BBB'][n],payloadBytes=JSON.stringify({schema_version:'synthetic',policy_version:'synthetic',generated_at:created,horizon:{id:'next_day',entry_at:entry,exit_at:exit},rows:[{ticker:symbol,company:'Synthetic'}]});
  events.push(event(`p${n}`,'publication',{publicationId:`publication${n}`,publishedAt:created,payloadHash:createHash('sha256').update(payloadBytes).digest('hex'),payloadBytes,policyVersion:'synthetic',snapshotVersion:'synthetic',horizonId:'next_day',entities:[{symbol,entityId:`entity${n}`}]}));
  events.push({...event(`i${n}`,'paper_intent',{publicationEventId:`p${n}`,symbol,settings:{...DEFAULT_PAPER_SETTINGS},window:null,date:created.slice(0,10)}),at:created});
  events.push(event(`c${n}`,'actual_confirmation',{intentId:`i${n}`,confirmed:true}));
 }
 return {schemaVersion:domain.JOURNAL_SCHEMA,journalId:'synthetic-review-proof',createdAt:created,revision:events.length,events};
}
const fill=(id,{intent=0,side='buy',quantity='1',minute=0,price='100',fee='0'}={})=>event(id,'actual_fill',{intentId:`i${intent}`,fill:{side,occurredAt:time(minute),quantity,price,fee,currency:'USD'}});
const revision=(id,f,patch={})=>event(id,'fill_revision',{fillId:f.id,replacement:{...f.data.fill,...patch},reason:'Synthetic correction'});
const split=(id,minute,numerator='2',denominator='1')=>({id,type:'split',effectiveSession:'2026-10-19',effectiveAt:time(minute),splitRatio:{numerator,denominator}});
const dividend=(id,minute,perShareBasis='post_split',cashPerShare='0.000001')=>({id,type:'cash_dividend',effectiveSession:'2026-10-19',effectiveAt:time(minute),cashPerShare,currency:'USD',perShareBasis});
function review(id,{intent=0,from=0,through=390,items=[],value='110'}={}){
 return event(id,'actual_action_review',{intentId:`i${intent}`,fromAt:time(from),throughAt:time(through),coverage:{coverage:'verified_complete',fromSession:'2026-10-19',throughSession:'2026-10-19',items},reviewMark:{seriesId:`series${intent}`,symbol:['AAA','BBB'][intent],entityId:`entity${intent}`,currency:'USD',session:'2026-10-19',kind:'close',eventAt:exit,availableAt:posted,priceTimestamp:null,value,priceBasis:'unadjusted',executionBasis:'daily_bar_paper_reference',source:{provider:'Synthetic',dataset:'offline',url:'https://example.invalid',capturedAt:posted,responseSha256:'a'.repeat(64),priceSession:'regular_daily_aggregate'},reviewId:`review-${id}`}});
}
const withEvents=events=>{const j=base();return {...j,events:[...j.events,...structuredClone(events)],revision:j.events.length+events.length};};
const buy=fill('buy'),last=fill('last',{minute:30});
const cases=[
 ['unchanged empty reviews still detect overselling',[buy,review('r1'),review('r2'),fill('sell',{side:'sell',quantity:'2',minute:10})],'oversell'],
 ['same actions with a new mark update the projected value',[review('r1',{items:[split('double',5)]}),buy,revision('m1',buy,{price:'99'}),review('r2',{items:[split('double',5)],value:'125'}),revision('m2',buy,{fee:'0.000001'})],null],
 ['ineligible from boundary must be reconsidered after time correction',[buy,review('late',{from:5,items:[split('third',20,'1','3')]}),revision('money',buy,{price:'99'}),revision('move',buy,{occurredAt:time(10)})],'split_quantity_precision_unsupported'],
 ['ineligible through boundary must be reconsidered after time correction',[fill('buy',{minute:30}),review('short',{through:20,items:[split('third',15,'1','3')]}),revision('money',fill('buy',{minute:30}),{price:'99'}),revision('move',buy,{occurredAt:time(10)})],'split_quantity_precision_unsupported'],
 ['retained narrow review must lose selection when a new fill exceeds cutoff',[review('broad',{items:[split('third',30,'1','3')]}),review('short',{through:20}),buy,review('short-new',{through:20}),fill('late',{minute:40})],'split_quantity_precision_unsupported'],
 ['unchanged ineligible reviews do not supply future coverage',[buy,last,review('short',{through:20,items:[split('third',15,'1','3')]}),review('late',{from:5,items:[split('third',15,'1','3')]}),revision('money',buy,{price:'99'}),fill('sell',{side:'sell',quantity:'2',minute:40})],null],
 ['another intent review cannot hide its later accounting failure',[buy,fill('other',{intent:1}),review('other-r',{intent:1,items:[split('third',5,'1','3')]}),revision('money',buy,{price:'99'}),revision('other-money',fill('other',{intent:1}),{price:'98'}),fill('invalid',{price:'0'})],'split_quantity_precision_unsupported'],
 ['same-time reordered splits preserve their first precision failure',[buy,review('ordered',{items:[split('triple',10,'3'),split('third',10,'1','3')]}),revision('proof',buy,{price:'99'}),review('reversed',{items:[split('third',10,'1','3'),split('triple',10,'3')]}),revision('again',buy,{fee:'0.000001'})],'split_quantity_precision_unsupported'],
 ['new ambiguous dividend invalidates otherwise identical split proof',[buy,review('split',{items:[split('double',10)]}),revision('proof',buy,{price:'99'}),review('dividend',{items:[split('double',10),dividend('dividend',10,'current_shares')]}),revision('again',buy,{fee:'0.000001'})],'dividend_share_basis_ambiguous'],
 ['cutoff-excluded action changes become relevant only on coverage expansion',[buy,review('short',{through:20,items:[split('third',30,'1','3')]}),revision('proof',buy,{price:'99'}),review('short-new',{through:20,items:[split('seventh',30,'1','7')]}),revision('money',buy,{fee:'0.000001'}),review('expanded',{through:40,items:[split('seventh',30,'1','7')]}),revision('again',buy,{price:'98'})],'split_quantity_precision_unsupported'],
 ['identical reviews retain exact quantities beyond individual input width',[fill('max',{quantity:'999999999999999.99999999'}),fill('max2',{quantity:'999999999999999.99999999'}),review('r1'),review('r2'),fill('sell',{side:'sell',quantity:'999999999999999.99999999',minute:10})],null],
 ['same-time actions precede all fills after repeated reviews',[review('r1',{items:[split('third',0,'1','3'),dividend('dividend',0,'current_shares')]}),buy,review('r2',{items:[split('third',0,'1','3'),dividend('dividend',0,'current_shares')]}),fill('sell',{side:'sell'})],null],
];
for(const [name,events,expected] of cases)test(name,async()=>{
 const j=withEvents(events),before=structuredClone(j),r=await validateJournal(j);
 assert.deepEqual(r.ok?null:r.errors[0],expected);assert.deepEqual(j,before);
 if(r.ok){assert.equal(Object.isFrozen(r.journal.events.at(-1).data),true);assert.deepEqual(projectJournal(r.journal),projectJournal(before));}
 if(name.startsWith('same actions')){const actual=projectJournal(r.journal).entries.find(entry=>entry.id==='i0').actual;assert.equal(actual.quantity,'2.00000000');assert.equal(actual.marketValue,'250.000000');}
});
test('an invalid review reports its own first error before subsequent accounting',async()=>{
 const malformed=review('bad');malformed.data.reviewMark.value='0';malformed.data.coverage.items=[{id:'also-bad'}];
 assert.deepEqual((await validateJournal(withEvents([buy,review('valid'),malformed,fill('sell',{side:'sell',quantity:'2'})]))).errors,['nonpositive_decimal']);
});
// Shared data is cloned at the validation boundary, including every review.
test('caller edits cannot change retained review proof across an await',async()=>{
 const j=withEvents([buy,review('r1'),review('r2'),fill('sell',{side:'sell'})]),expected=structuredClone(j),pending=validateJournal(j);
 j.events.find(e=>e.id==='r2').data.coverage.items=[split('third',5,'1','3')];j.events.find(e=>e.id==='sell').data.fill.quantity='2';
 const r=await pending;assert.equal(r.ok,true);assert.deepEqual(r.journal,expected);assert.deepEqual((await validateJournal(j)).errors,['oversell']);
});
