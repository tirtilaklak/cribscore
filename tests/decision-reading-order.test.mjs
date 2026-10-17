import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';

const payload=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const plain=node=>typeof node==='string'?node:node.children.map(plain).join('');
const hasClass=(node,name)=>(node.attrs.class||'').split(/\s+/).includes(name);
const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));

for(const horizon of ['next_day','next_week'])test(`${horizon}: invalidation and concrete blockers precede the long evidence chain for all six cases`,()=>{
  const snapshot=buildStockSnapshot(payload,horizon,'2026-10-17T16:32:30Z');
  const dom=parse(renderStockView(snapshot));
  const cards=all(dom,node=>node.tag==='article'&&hasClass(node,'stock-card'));
  assert.equal(cards.length,6);
  for(const card of cards){
    const ticker=plain(all(card,node=>hasClass(node,'ticker'))[0]);
    const item=snapshot.hypotheses.find(row=>row.ticker===ticker);
    const details=all(card,node=>hasClass(node,'stock-details'))[0];
    assert.equal(Object.hasOwn(details.attrs,'open'),false);
    const expanded=all(details,node=>hasClass(node,'expanded-stock'))[0];
    const headings=all(expanded,node=>node.tag==='h4').map(plain);
    assert.deepEqual(headings.slice(0,6),[
      'What changed','Why this window','Favorable test · analyst interpretation',
      'DOWNSIDE / COUNTER-CASE','What would invalidate the thesis?','Inputs blocking ranking',
    ],ticker);
    const content=plain(expanded);
    assert.ok(content.includes(item.invalidation_trigger),`${ticker} retains exact invalidation`);
    assert.ok(content.includes(item.counter_case),`${ticker} retains exact downside`);
    const missing=all(expanded,node=>hasClass(node,'missing-inputs'));
    assert.equal(missing.length,1,`${ticker} has one concrete blocker list`);
    assert.equal(all(missing[0],node=>node.tag==='li').length,item.gate_reasons.length);
    assert.equal(headings.filter(h=>h==='What would invalidate the thesis?').length,1);
    assert.ok(headings.indexOf('Inputs blocking ranking')<headings.findIndex(h=>h.startsWith('Macro →')));
    assert.ok(headings.indexOf('Inputs blocking ranking')<headings.indexOf('How the retained research affects this case'));
  }
});
