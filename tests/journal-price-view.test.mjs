import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderJournalView} from '../dist/lib/journal-view.js';
import {renderPriceView} from '../dist/lib/price-view.js';

// Synthetic test fixtures only. No sample prices or trades ship in either view.
const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const plain=node=>typeof node==='string'?node:node.children.map(plain).join('');
const base=()=>({schemaVersion:'cribscore_journal_view_v1',settings:{paperNotional:'100.000000',commissionPerFill:'0.000000',slippageBps:5,currency:'USD',benchmarkSymbol:'SPY'},storage:{state:'local_only',message:'Saved on this device only.'},summary:{decisions:0,abstentions:0,pending:0,open:0,closed:0,noFill:0,actualConfirmations:0},entries:[],assumptions:[]});
const entry=()=>({id:'test-decision',date:'2026-10-17',status:'pending',symbol:'TEST',company:'Test fixture',horizonId:'next_day',reason:'Prices pending',context:{observedAt:'2026-10-17T10:00:00Z',entryAt:'2026-10-19T13:30:00Z',exitAt:'2026-10-19T20:00:00Z',caseSummary:'Immutable test case',positiveCase:'Test positive',counterCase:'Test counter',invalidationTrigger:'Test invalidation',sourceRefs:[{label:'Test source',url:'https://example.com/source'}]},paper:{status:'pending',quantity:null,entryPrice:null,exitPrice:null,costs:null,realizedPnl:null,openPnl:null,benchmarkPnl:null,excessPnl:null,pendingReasons:['entry_price_missing'],assumptions:{paperNotional:'100.000000',commissionPerFill:'0.000000',slippageBps:5,currency:'USD',benchmarkSymbol:'SPY'}},actual:{confirmed:false,confirmedAt:null,quantity:null,realizedPnl:null,openPnl:null,pendingReasons:[],fills:[]},revisions:[]});
const price=()=>({status:'partial',symbol:'TEST',currency:'USD',priceBasis:'unadjusted',volumeBasis:'shares',points:[{session:'2026-10-14',open:9,high:12,low:8,close:10,volume:null,breakBefore:false,actions:[]},{session:'2026-10-16',open:11,high:13,low:10,close:12,volume:100,breakBefore:true,actions:[]}],source:{provider:'Test fixture',dataset:'Synthetic unit test',url:'https://example.com/prices',capturedAt:'2026-10-17T10:00:00Z',publishedAt:null,channel:'manual_import'},freshness:{captureStatus:'stale',sessionStatus:'calendar_unknown',declaredDelayMinutes:null},gaps:{status:'incomplete',missingSessions:['2026-10-15']},comparison:{status:'unavailable',reason:'matching_basis_required'},chartTrust:'manual_import',issues:[],warnings:[],eligibleForRanking:false,paperMarksEligible:false});

test('empty and abstention states never create trades, zero returns or actual confirmation controls',()=>{
  assert.match(renderJournalView(null),/Journal unavailable/);
  const model=base();let html=renderJournalView(model);
  assert.match(html,/No decisions recorded yet/);
  assert.doesNotMatch(html,/data-journal-entry=|data-journal-action="confirm-actual"|Realized P&amp;L/);
  const row=entry();row.status='abstain';row.symbol=null;row.company=null;row.paper=null;row.reason='No eligible published suggestion';
  model.entries=[row];model.summary.decisions=1;model.summary.abstentions=1;
  html=renderJournalView(model);
  assert.match(html,/<h3>No eligible stock<\/h3>/);assert.match(html,/No eligible published suggestion/);
  assert.doesNotMatch(html,/data-journal-action="confirm-actual"|Realized P&amp;L/);
});

test('pending paper values stay unavailable and saved assumptions are distinct from current settings',()=>{
  const model=base();model.entries=[entry()];model.settings.paperNotional='999.000000';
  const dom=parse(renderJournalView(model)),card=all(dom,node=>node.attrs['data-journal-entry']==='test-decision')[0];
  const text=plain(card);
  assert.ok(text.includes('Realized P&LUnavailable'));
  assert.ok(text.includes('Open P&LUnavailable'));
  assert.ok(text.includes('Saved paper notionalUSD 100'));
  assert.ok(!text.includes('USD 999'));
  assert.equal(all(card,node=>node.attrs['data-journal-action']==='confirm-actual').length,1);
  for(const value of ['Immutable test case','Test positive','Test counter','Test invalidation'])assert.ok(text.includes(value));
  assert.equal(all(card,node=>node.tag==='a')[0].attrs.href,'https://example.com/source');
});

test('losses and no-fill decisions remain visible without mixing actual and paper accounting',()=>{
  const model=base(),closed=entry(),noFill=entry();
  closed.status='closed';closed.paper.status='closed';closed.paper.realizedPnl='-4.250000';closed.paper.openPnl=null;
  closed.actual.confirmed=true;closed.actual.realizedPnl='2.000000';closed.actual.confirmedAt='2026-10-19T14:00:00Z';
  noFill.id='no-fill';noFill.status='no_fill';noFill.paper.status='no_fill';
  model.entries=[closed,noFill];const html=renderJournalView(model),dom=parse(html);
  assert.match(html,/No fill/);assert.match(html,/USD -4.25/);assert.match(html,/USD 2/);
  assert.equal(all(dom,node=>node.attrs['data-journal-entry']).length,2);
  assert.match(html,/Actual · confirmed by you/);
});

test('actual corrections identify the original fill, require a reason and keep labels associated',()=>{
  const model=base(),row=entry();row.actual.confirmed=true;row.actual.fills=[{id:'original-fill',side:'buy',occurredAt:'2026-10-19T13:35:01Z',quantity:'1.000000',price:'10.000000',fee:'0.000000'}];model.entries=[row];
  const dom=parse(renderJournalView(model)),form=all(dom,node=>node.attrs['data-journal-form']==='revise-fill')[0];
  assert.equal(form.attrs['data-journal-fill-id'],'original-fill');assert.equal(form.attrs['data-journal-id'],row.id);
  assert.equal(all(form,node=>node.attrs.name==='occurredAt')[0].attrs.value,'2026-10-19T13:35:01');
  assert.ok(Object.hasOwn(all(form,node=>node.attrs.name==='reason')[0].attrs,'required'));
  for(const label of all(dom,node=>node.tag==='label'))assert.equal(all(dom,node=>node.attrs.id===label.attrs.for).length,1,label.attrs.for);
  const keys=all(dom,node=>node.tag==='details').map(node=>node.attrs['data-state-key']);assert.equal(new Set(keys).size,keys.length);
});

test('storage and backup review stay explicit; text and source links cannot execute markup',()=>{
  const model=base();model.storage={state:'unsaved',message:'Offline <script>bad()</script>'};const row=entry();row.context.positiveCase='<img src=x onerror=alert(1)>';row.context.sourceRefs=[{label:'Unsafe',url:'javascript:alert(1)'}];model.entries=[row];
  let html=renderJournalView(model);assert.match(html,/Not synced/);assert.doesNotMatch(html,/<script>|<img|href="javascript:|data-journal-action="confirm-import"/);
  html=renderJournalView(model,{importPreview:{message:'2 decisions ready for review'}});assert.match(html,/data-journal-action="confirm-import"/);assert.match(html,/data-journal-action="cancel-import"/);
});

test('missing prices draw no series and hosted chart remains a separate user action',()=>{
  const html=renderPriceView(null,{symbol:'TEST',symbolOptions:[{symbol:'TEST',label:'Test fixture'}]}),dom=parse(html);
  assert.match(html,/No imported price history/);assert.doesNotMatch(html,/<svg|<iframe|<script/);
  assert.equal(all(dom,node=>node.attrs['data-price-action']==='load-hosted').length,1);
  assert.equal(all(dom,node=>node.attrs.id==='hosted-price-chart').length,1);
  assert.match(html,/Open chart at TradingView/);
});

test('imported series preserves gaps, exact table data and explicit unreviewed capture status',()=>{
  const model=price(),html=renderPriceView(model),dom=parse(html);
  assert.match(html,/Imported daily prices/);assert.match(html,/not been verified for journal valuation/);assert.match(html,/Source capture is stale/);assert.match(html,/Session-calendar coverage unknown/);assert.match(html,/Declared delay<\/dt><dd>Not specified/);
  const svg=all(dom,node=>node.tag==='svg')[0];assert.equal(svg.attrs.role,'img');assert.ok(svg.attrs['aria-labelledby']);
  assert.equal(all(svg,node=>node.tag==='polyline').length,0,'known gap never joined');
  assert.equal(all(svg,node=>node.tag==='path'&&node.attrs.class==='price-line').length,2);
  const table=all(dom,node=>node.tag==='table')[0];assert.match(plain(table),/2026-10-14/);assert.match(plain(table),/Unavailable/);assert.match(plain(table),/2026-10-16/);
  assert.equal(all(dom,node=>node.attrs.role==='region'&&node.attrs.tabindex==='0').length,1);
  assert.doesNotMatch(html,/live quote|Verified prices|Paper P&amp;L/);
});

test('comparison is displayed only from a complete provided projection and external data is escaped',()=>{
  const model=price();model.comparison={status:'available',benchmarkSymbol:'BENCH',basis:'unadjusted',points:[{session:'2026-10-16',targetIndex:100,benchmarkIndex:100}]};model.source.provider='<img src=x onerror=bad()>';model.source.url='javascript:bad()';
  const html=renderPriceView(model),dom=parse(html);
  assert.equal(all(dom,node=>node.tag==='table').length,2);assert.match(html,/Indexed to 100/);assert.doesNotMatch(html,/<img|href="javascript:/);
  const malicious=price();malicious.points[0].close=Infinity;assert.doesNotMatch(renderPriceView(malicious),/<svg/);
});
