import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createJournal,recordAbstention,projectJournal} from '../dist/lib/journal.js';
import {renderJournalView} from '../dist/lib/journal-view.js';
import {renderPriceView} from '../dist/lib/price-view.js';
const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const plain=node=>typeof node==='string'?node:node.children.map(plain).join('');
const hasClass=(node,name)=>(node.attrs.class||'').split(/\s+/).includes(name);
const settings={paperNotional:'100.000000',commissionPerFill:'1.000000',slippageBps:5,currency:'USD',benchmarkSymbol:'SPY'};
const base=entries=>({settings,storage:{state:'unsaved',message:'Synthetic unit fixture'},summary:{decisions:entries.length,abstentions:0,pending:0,open:0,closed:1,noFill:0,actualConfirmations:0},entries,assumptions:[]});
const metrics=section=>Object.fromEntries(all(section,node=>node.tag==='dl'&&hasClass(node,'journal-pnl')).flatMap(dl=>dl.children.filter(child=>typeof child!=='string').map(div=>[plain(all(div,node=>node.tag==='dt')[0]),plain(all(div,node=>node.tag==='dd')[0])])));

test('settled domain dividend and cost fields keep realized, open, accrual and total distinct',()=>{
  const entry={id:'fixture',date:'2026-10-17',symbol:'TEST',status:'closed',horizonId:'next_day',reason:'',context:{},paper:{status:'closed',realizedPnl:'7.000000',realizedTradingPnl:'7.000000',openPnl:'0.000000',dividendAccrual:'2.000000',totalPnl:'9.000000',benchmarkPnl:'3.000000',excessPnl:'6.000000',commissionCosts:'2.000000',slippageCosts:'1.000000',costs:'3.000000',assumptions:settings},actual:{confirmed:false},revisions:[]};
  const dom=parse(renderJournalView(base([entry]))),paper=all(dom,node=>node.attrs['aria-label']==='Paper result for TEST')[0];
  assert.deepEqual(metrics(paper),{'Realized P&L':'USD 7','Open P&L':'USD 0','Dividend accrual':'USD 2','Total P&L':'USD 9','Same-window benchmark':'USD 3','Difference from benchmark':'USD 6'});
  const facts=plain(all(paper,node=>node.tag==='dl'&&hasClass(node,'desk-facts'))[0]);
  assert.ok(facts.includes('CommissionsUSD 2'));assert.ok(facts.includes('Estimated slippageUSD 1'));assert.ok(facts.includes('Total estimated costsUSD 3'));
  assert.ok(plain(paper).includes('Realized P&L covers completed sales'));
  assert.ok(!plain(paper).includes('Realized P&L includes earned dividend accruals'));
});

test('actual results keep the same components; pending coverage is not mislabeled as missing prices',()=>{
  const entry={id:'fixture',date:'2026-10-17',symbol:'TEST',status:'pending',horizonId:'next_week',reason:'action_coverage_missing',context:{},paper:{status:'pending',pendingReasons:['action_coverage_missing'],assumptions:settings},actual:{confirmed:true,realizedPnl:'-1.000000',openPnl:'3.000000',dividendAccrual:'0.500000',totalPnl:'2.500000',fills:[{id:'fill-1',side:'buy',occurredAt:'2026-10-17T10:00:00Z',quantity:'1.00000000',price:'10.000000',fee:'0.000000',currency:'USD'}]},revisions:[]};
  const html=renderJournalView(base([entry])),dom=parse(html),actual=all(dom,node=>hasClass(node,'journal-actual'))[0];
  assert.deepEqual(metrics(actual),{'Realized P&L':'USD -1','Open P&L':'USD 3','Dividend accrual':'USD 0.5','Total P&L':'USD 2.5'});
  assert.match(html,/>Pending<\/span>/);assert.doesNotMatch(html,/Awaiting prices/);
  const slippage=all(dom,node=>node.attrs.name==='slippageBps')[0];assert.equal(slippage.attrs.max,'1000');
  const saveForm=all(dom,node=>node.attrs['data-journal-form']==='save-fill')[0],reviseForm=all(dom,node=>node.attrs['data-journal-form']==='revise-fill')[0];
  assert.equal(all(saveForm,node=>node.attrs.name==='reason').length,0);assert.doesNotMatch(plain(saveForm),/Fill note/);
  const reason=all(reviseForm,node=>node.attrs.name==='reason')[0];assert.equal(reason.attrs.maxlength,'500');assert.ok(Object.hasOwn(reason.attrs,'required'));
});

test('actual abstention projection shows only saved date, horizon and snapshot context without a publication claim',async()=>{
  const snapshot={id:'recorded-snapshot',methodVersion:'recorded-method',reviewedAt:'2026-10-17T10:00:00.123Z',sourceCutoffAt:null,window:{horizon_id:'next_week',entry_at:'2026-10-19T13:30:00Z',exit_at:'2026-10-23T20:00:00Z',timezone:'America/New_York'},unexpected:'DO-NOT-RENDER'};
  const journal=createJournal({journalId:'view-test',at:'2026-10-17T11:00:00Z'});
  const result=await recordAbstention(journal,{id:'observed',at:'2026-10-17T12:00:00Z',date:'2026-10-17',horizonId:'next_week',unrankedCount:6,snapshot});assert.equal(result.ok,true);
  snapshot.id='changed-current-payload';snapshot.window.exit_at='2026-10-30T20:00:00Z';
  const html=renderJournalView(projectJournal(result.journal)),dom=parse(html),context=all(dom,node=>node.attrs['data-state-key']===JSON.stringify(['journal','context','observed',null]))[0],copy=plain(context);
  assert.ok(copy.includes('Why there was no trade'));assert.ok(copy.includes('Date checked (UTC)2026-10-17'));assert.ok(copy.includes('Window5-day window'));assert.ok(copy.includes('Stocks reviewed (not ranked)6'));
  assert.ok(copy.includes('recorded-snapshot'));assert.ok(copy.includes('2026-10-23 20:00:00 UTC'));assert.ok(copy.includes('2026-10-17 10:00:00.123 UTC'));
  assert.ok(!copy.includes('Published at'));assert.ok(!copy.includes('reviewed case and planned window stay attached'));assert.doesNotMatch(html,/changed-current-payload|2026-10-30|DO-NOT-RENDER|confirm-actual/);
});

test('retained source label and distinct price-volume sessions survive projection without verification promotion',()=>{
  const model={status:'partial',symbol:'TEST',currency:'USD',priceBasis:'unadjusted',volumeBasis:'shares',points:[{session:'2026-10-16',open:10,high:12,low:9,close:11,volume:100,actions:[]}],source:{channel:'retained_capture',provider:'Synthetic',dataset:'Synthetic test data',priceSession:'regular_daily_aggregate',volumeSession:'daily_including_extended_hours',feed:'iex',symbolAsOf:'2026-10-16'},freshness:{captureStatus:'unknown',sessionStatus:'calendar_unknown',declaredDelayMinutes:null},gaps:{status:'unknown'},comparison:{status:'unavailable'},chartTrust:'unreviewed_source',issues:[],warnings:[]};
  const html=renderPriceView(model);assert.match(html,/Retained daily prices/);assert.match(html,/Retained daily values/);assert.doesNotMatch(html,/<h2[^>]*>Imported daily prices/);
  assert.match(html,/Price session<\/dt><dd>regular daily aggregate/);assert.match(html,/Volume session<\/dt><dd>daily including extended hours/);assert.match(html,/Feed<\/dt><dd>iex/);
  assert.match(html,/has not been verified for journal valuation/);assert.match(html,/Paper marks remain unavailable/);
});
