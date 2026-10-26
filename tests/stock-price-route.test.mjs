import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';
import {createApprovedSlateSlot,renderApprovedResearchView} from '../dist/lib/research-slate-view.js';
import {proposal,at} from './fixtures/research-slate-fixtures.mjs';
import {createDocument} from './helpers/interaction-dom.mjs';
const stock=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
// The 2026-10-16 snapshot, kept as a fixture: its six cases match the desk-tools price roster.
const retained=JSON.parse(await readFile(new URL('./fixtures/stock-evidence-2026-10-16.json',import.meta.url),'utf8'));

function controller(){
  const handlers={};let frames=0,requests=0;
  const document={querySelector:selector=>selector==='#hosted-price-chart'?{replaceChildren(){}}:null,addEventListener:(kind,fn)=>handlers[kind]=fn,removeEventListener(){},createElement(){frames++;return {style:{},setAttribute(){}};}};
  const app=createDeskTools({document,fetch:()=>{requests++;throw Error('No request expected');}});
  return {app,handlers,frames:()=>frames,requests:()=>requests};
}
const selected=html=>createDocument(html).querySelector('#price-symbol option[selected]')?.getAttribute('value');

test('six case cards expose native company-specific price actions only when the host enables its roster',()=>{
  const h=controller(),symbols=h.app.priceSymbols();
  for(const horizon of ['next_day','next_week']){
    const snapshot=buildStockSnapshot(retained,horizon,at),legacy=renderStockView(snapshot),dom=createDocument(renderStockView(snapshot,'',{priceSymbols:symbols}));
    assert.equal(createDocument(legacy).querySelectorAll('[data-price-symbol]').length,0);
    const buttons=dom.querySelectorAll('[data-price-symbol]');assert.equal(buttons.length,6);
    assert.deepEqual(buttons.map(b=>b.dataset.priceSymbol).sort(),[...retained.operating_evidence.hypotheses,...retained.operating_evidence.caution_watch].map(c=>c.ticker).toSorted());
    for(const button of buttons)assert.ok(symbols.includes(button.dataset.priceSymbol),button.dataset.priceSymbol);
    for(const button of buttons){assert.equal(button.tagName,'BUTTON');assert.equal(button.getAttribute('type'),'button');assert.match(button.textContent,new RegExp(`Price chart.*for ${button.dataset.priceSymbol}`));assert.ok(button.closest('.stock-card'));assert.equal(button.closest('details'),null);}
    assert.equal(createDocument(renderStockView(snapshot,'TXN',{priceSymbols:symbols})).querySelector('[data-price-symbol]').dataset.priceSymbol,'TXN');
  }
  assert.equal(h.requests(),0);h.app.destroy();
});

test('approved slate cards offer the same route only for supported companies without expanding authority',async()=>{
  const h=controller(),payload=JSON.parse(proposal().serialized);payload.rows[0].ticker='IBM';payload.rows[1].ticker='UNSUPPORTED';
  const slot=createApprovedSlateSlot({readApprovedBytes:async()=>JSON.stringify(payload),clock:()=>Date.parse(at)});assert.equal(await slot.refresh(),true);
  const dom=createDocument(renderApprovedResearchView(slot,{horizonId:'next_week',priceSymbols:h.app.priceSymbols()}));
  assert.deepEqual(dom.querySelectorAll('[data-price-symbol]').map(n=>n.dataset.priceSymbol),['IBM']);
  assert.equal(dom.querySelectorAll('.stock-card').length,3);assert.match(dom.textContent||dom.body.textContent,/Unvalidated research priorities/);
  assert.equal(renderApprovedResearchView(null,{horizonId:'next_week',priceSymbols:h.app.priceSymbols()}),null);h.app.destroy();
});

test('controller selection uses its own allowlist and never loads a hosted chart or journal request',()=>{
  const h=controller(),copy=h.app.priceSymbols();copy.push('UNKNOWN');
  for(const symbol of h.app.priceSymbols()){
    assert.equal(h.app.selectPriceSymbol(symbol),true);assert.equal(selected(h.app.html('prices')),symbol);h.app.mount('prices');
    assert.match(h.app.html('prices'),/data-hosted-status="idle"/);
  }
  for(const symbol of ['UNKNOWN','SPY','NASDAQ:TSLA','__proto__','TSLA<script>',null,{toString(){throw Error('Do not coerce');}}])assert.equal(h.app.selectPriceSymbol(symbol),false);
  assert.equal(selected(h.app.html('prices')),'TXN');assert.equal(h.frames(),0);assert.equal(h.requests(),0);h.app.destroy();
});

test('a company route cancels an older pending local import and clears a prior hosted request',{concurrency:false},async()=>{
  const h=controller(),old=globalThis.FormData;let resolve,reading=false;
  globalThis.FormData=class{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}};
  try{
    h.handlers.click({target:{closest:selector=>selector==='[data-price-action="load-hosted"]'?{}:null}});h.app.mount('prices');assert.equal(h.frames(),1);
    const form={dataset:{priceForm:'import'},values:{file:{size:2,text(){reading=true;return new Promise(r=>resolve=r);}}}};form.closest=()=>form;
    h.handlers.submit({target:form,preventDefault(){}});assert.equal(reading,true);
    assert.equal(h.app.selectPriceSymbol('TSLA'),true);resolve('malformed stale file');for(let n=0;n<3;n++)await new Promise(r=>setImmediate(r));
    const html=h.app.html('prices');assert.equal(selected(html),'TSLA');assert.match(html,/data-hosted-status="idle"/);assert.doesNotMatch(html,/could not|Invalid price|Chart requested/);h.app.mount('prices');assert.equal(h.frames(),1);assert.equal(h.requests(),0);
  }finally{globalThis.FormData=old;h.app.destroy();}
});

test('actual app routes cards with history/focus restoration and recovers actions after a workspace retry',()=>{
  const run=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/stock-price-route-runtime.mjs',import.meta.url))],{encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,`${run.stdout}\n${run.stderr}`);assert.equal(JSON.parse(run.stdout.trim()).passed,true);
});
