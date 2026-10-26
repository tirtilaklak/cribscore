import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';

const retained=JSON.parse(await readFile(new URL('./fixtures/stock-evidence-2026-10-16.json',import.meta.url),'utf8'));
const current=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
// The retained snapshot keeps its original clock and six cards. The current snapshot is read an hour
// before its own entry, and its card count comes from its own cases.
const before=payload=>new Date(Date.parse(payload.event_evidence.horizons.entry_at_utc)-3600000).toISOString();
const runs=[
  {name:'retained 2026-10-16',payload:retained,clock:'2026-10-17T16:32:30Z',count:6,research:true},
  {name:'current',payload:current,clock:before(current),count:current.operating_evidence.hypotheses.length+current.operating_evidence.caution_watch.length,research:false},
];
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const plain=node=>typeof node==='string'?node:node.children.map(plain).join('');
const hasClass=(node,name)=>(node.attrs.class||'').split(/\s+/).includes(name);
const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));

for(const {name,payload,clock,count,research} of runs)for(const horizon of ['next_day','next_week'])test(`${name} ${horizon}: invalidation and concrete blockers precede the long evidence chain for all ${count} cases`,()=>{
  const snapshot=buildStockSnapshot(payload,horizon,clock);
  assert.equal(snapshot.status,'upcoming');
  const dom=parse(renderStockView(snapshot));
  const cards=all(dom,node=>node.tag==='article'&&hasClass(node,'stock-card'));
  assert.ok(count>0);assert.equal(cards.length,count);assert.equal(snapshot.hypotheses.length,count);
  for(const card of cards){
    const ticker=plain(all(card,node=>hasClass(node,'ticker'))[0]);
    const item=snapshot.hypotheses.find(row=>row.ticker===ticker);
    const details=all(card,node=>hasClass(node,'stock-details'))[0];
    assert.equal(Object.hasOwn(details.attrs,'open'),false);
    const expanded=all(details,node=>hasClass(node,'expanded-stock'))[0];
    const headings=all(expanded,node=>node.tag==='h4').map(plain);
    assert.deepEqual(headings.slice(0,6),[
      'What changed','Event timing','The case for · analyst interpretation',
      'The case against · analyst interpretation','What would prove this case wrong?','What blocks ranking',
    ],ticker);
    const content=plain(expanded);
    for(const field of ['invalidation_trigger','counter_case'])assert.ok(typeof item[field]==='string'&&item[field].trim().length>20,`${ticker} has its own ${field}`);
    assert.ok(content.includes(item.invalidation_trigger),`${ticker} retains exact invalidation`);
    assert.ok(content.includes(item.counter_case),`${ticker} retains exact downside`);
    const missing=all(expanded,node=>hasClass(node,'missing-inputs'));
    assert.equal(missing.length,1,`${ticker} has one concrete blocker list`);
    assert.equal(all(missing[0],node=>node.tag==='li').length,item.gate_reasons.length);
    assert.equal(headings.filter(h=>h==='What would prove this case wrong?').length,1);
    assert.ok(headings.indexOf('What blocks ranking')<headings.findIndex(h=>h.startsWith('Macro →')));
    // The October 16 cases each carry a research application. The current cases have none, so the
    // order check applies where the section exists.
    if(research)assert.ok(item.research_application,`${ticker} has its research application`);
    if(item.research_application)assert.ok(headings.indexOf('What blocks ranking')<headings.indexOf('How the research notes shape this case'));
  }
});
