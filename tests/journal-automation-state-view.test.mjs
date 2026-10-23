import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderJournalView} from '../dist/lib/journal-view.js';

const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const plain=node=>typeof node==='string'?node:node.children.map(plain).join('');
const hasClass=(node,name)=>(node.attrs.class||'').split(/\s+/).includes(name);
const model=()=>({settings:{paperNotional:'100.000000',commissionPerFill:'0.000000',slippageBps:5,currency:'USD',benchmarkSymbol:'SPY'},storage:{state:'unsaved',message:'Synthetic view test'},summary:{decisions:0,abstentions:0,pending:0,open:0,closed:0,noFill:0,actualConfirmations:0},entries:[],assumptions:[]});
const clock='2026-10-17T17:40:12.123Z';

test('absent automation status preserves the current unconfigured default and invents no check clock',()=>{
  const html=renderJournalView(model());
  assert.match(html,/Automatic paper tracking needs a reviewed research source and a reviewed price feed\. Neither is connected yet\./);
  assert.doesNotMatch(html,/data-publisher-state|Last checked:|Research source checked/);
  assert.equal(html,renderJournalView(model(),{automation:null}));
  assert.doesNotMatch(html,/class="journal-account|data-journal-entry/);
});

test('ready, empty and unavailable describe archive checks without implying tradable positions or no eligible records after failure',()=>{
  const states={ready:'Research source checked',empty:'No new research in this check',unavailable:'Research source not checked',unconfigured:'Automatic paper tracking is off'};
  for(const [publisherState,label] of Object.entries(states)){
    const html=renderJournalView(model(),{automation:{publisherState,checkedAt:clock,pendingReasons:[]}}),dom=parse(html);
    const status=all(dom,node=>node.attrs['data-publisher-state']===publisherState)[0];
    assert.ok(status);assert.ok(plain(status).includes(label));assert.match(plain(status),/2026-10-17 17:40:12.123 UTC/);
    assert.equal(all(status,node=>node.tag==='time')[0].attrs.datetime,clock);
    assert.equal(all(dom,node=>node.attrs['data-journal-entry']).length,0);
    assert.doesNotMatch(html,/USD 0|trade available|Tracking active|eligible selections: 0/i);
    if(publisherState==='unavailable')assert.doesNotMatch(plain(status),/No new research|No published/);
    if(publisherState==='ready')assert.doesNotMatch(html,/Neither is connected yet/);
  }
});

test('pending input reasons are plain, bounded to known meanings, and invalid check clocks never normalize into a date',()=>{
  const html=renderJournalView(model(),{automation:{publisherState:'ready',checkedAt:'2026-02-30T01:00:00Z',pendingReasons:['entry_mark_pending','calendar_unavailable','action_coverage_missing','entry_mark_pending','<img src=x onerror=bad()>',{unknown:true}]}});
  const dom=parse(html),status=all(dom,node=>node.attrs['data-publisher-state']==='ready')[0];
  assert.match(plain(status),/Evaluation inputs still needed/);assert.match(plain(status),/The entry price is pending/);assert.match(plain(status),/Trading-session dates are awaiting review/);assert.match(plain(status),/Split and dividend coverage is awaiting review/);
  assert.equal(all(status,node=>node.tag==='li').length,4,'known and generic duplicate reasons are grouped');
  assert.match(plain(status),/Check time unavailable/);assert.doesNotMatch(html,/2026-03-02|<img|entry_mark_pending|calendar_unavailable/);
  for(const checkedAt of [undefined,'2026-10-17','2026-10-17T17:40:12+00:00','not a clock']){
    const output=renderJournalView(model(),{automation:{publisherState:'ready',checkedAt}});assert.match(output,/Check time unavailable/);assert.doesNotMatch(output,/<time datetime=/);
  }
  assert.match(renderJournalView(model(),{automation:{publisherState:'unknown'}}),/data-publisher-state="unavailable"/);
});

test('automation status leaves saved entries, counts, forms and disclosure identities unchanged',()=>{
  const saved=model();saved.summary={decisions:1,abstentions:0,pending:1,open:0,closed:0,noFill:0,actualConfirmations:1};
  saved.entries=[{id:'fixture',date:'2026-10-17',symbol:'TEST',status:'pending',horizonId:'next_day',reason:'entry_mark_pending',context:{},paper:{status:'pending',realizedPnl:null,openPnl:null,dividendAccrual:null,totalPnl:null,pendingReasons:[]},actual:{confirmed:true,confirmedAt:clock,fills:[{id:'fill-1',side:'buy',occurredAt:clock,quantity:'1.00000000',price:'10.000000',fee:'0.000000',currency:'USD'}]},revisions:[]}];
  const before=structuredClone(saved),baseline=parse(renderJournalView(saved));
  for(const publisherState of ['unconfigured','unavailable','empty','ready']){
    const dom=parse(renderJournalView(saved,{automation:{publisherState,checkedAt:clock,pendingReasons:['entry_mark_pending']}}));
    assert.deepEqual(all(dom,node=>node.tag==='form'),all(baseline,node=>node.tag==='form'));
    assert.deepEqual(all(dom,node=>node.tag==='details'),all(baseline,node=>node.tag==='details'));
    assert.deepEqual(all(dom,node=>node.attrs['data-journal-entry']),all(baseline,node=>node.attrs['data-journal-entry']));
    assert.deepEqual(all(dom,node=>hasClass(node,'journal-counts')),all(baseline,node=>hasClass(node,'journal-counts')));
  }
  assert.deepEqual(saved,before);
});
