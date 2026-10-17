import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parsePriceImport,buildPriceView} from '../dist/lib/prices.js';
import {renderPriceView} from '../dist/lib/price-view.js';

// Synthetic schema fixtures, never market observations.
const at='2026-10-17T10:00:00Z';
const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const plain=node=>typeof node==='string'?node:node.children.map(plain).join('');
const hasClass=(node,name)=>(node.attrs.class||'').split(/\s+/).includes(name);
const raw=prices=>({schemaVersion:'cribscore-price-series-v1',id:'synthetic-display-view',symbol:'TEST',currency:'USD',sessionTimezone:'America/New_York',interval:'1d',priceBasis:'unadjusted',volumeBasis:'shares',source:{provider:'Synthetic',dataset:'Exact rendering fixture',url:'https://prices.example/fixture',capturedAt:'2026-10-16T22:00:00Z',publishedAt:null,responseSha256:'a'.repeat(64),channel:'manual_import'},bars:[{session:'2026-10-16',...prices,volume:null}]});
const modelFor=prices=>{
  const imported=parsePriceImport(JSON.stringify(raw(prices)),{at});
  assert.equal(imported.series.length,1);
  return buildPriceView(imported.series[0],{at});
};
const priceCells=dom=>all(all(dom,node=>node.tag==='table')[0],node=>node.tag==='td').slice(0,4).map(plain);
const headline=dom=>plain(all(all(dom,node=>hasClass(node,'price-value'))[0],node=>node.tag==='strong')[0]);

test('tiny imported OHLC prices retain decimal text in headline and table without fabricated zero',()=>{
  const prices={open:'0.0000001',high:'0.0000002',low:'0.00000001',close:'0.00000015'};
  const model=modelFor(prices),html=renderPriceView(model),dom=parse(html);
  assert.equal(headline(dom),prices.close);assert.deepEqual(priceCells(dom),Object.values(prices));
  const axis=all(dom,node=>hasClass(node,'price-axis'))[0];
  assert.ok(all(axis,node=>node.tag==='span').every(node=>Number(plain(node))>0));
  assert.match(plain(axis),/E-/);assert.match(html,/Plot positions and axis labels are approximate/);
  assert.doesNotMatch(html,/The exact daily values/);assert.equal(model.paperMarksEligible,false);
});

test('large imported fractional prices bypass Number roundtrip and retain readable headline break opportunities',()=>{
  const prices={open:'999999999999.123456',high:'999999999999.123457',low:'999999999999.123454',close:'999999999999.123455'};
  const model=modelFor(prices);assert.notEqual(String(model.points[0].close),prices.close);
  const html=renderPriceView(model),dom=parse(html);
  assert.equal(headline(dom),prices.close);assert.deepEqual(priceCells(dom),Object.values(prices));
  const strong=all(all(dom,node=>hasClass(node,'price-value'))[0],node=>node.tag==='strong')[0];
  assert.ok(all(strong,node=>node.tag==='wbr').length>0);
  assert.match(plain(all(dom,node=>hasClass(node,'price-axis'))[0]),/E/);
});

test('missing or invalid exact strings remain unavailable without reconstructing them from approximate numbers',()=>{
  const model=modelFor({open:'0.0000001',high:'0.0000002',low:'0.00000001',close:'0.00000015'});
  delete model.points[0].decimals;
  let dom=parse(renderPriceView(model));assert.equal(headline(dom),'Unavailable');assert.deepEqual(priceCells(dom),Array(4).fill('Unavailable'));
  assert.equal(all(dom,node=>node.tag==='svg').length,1,'numeric plot remains explicitly approximate');
  model.points[0].decimals={open:'<img src=x onerror=bad()>',high:'NaN',low:'0',close:'Infinity'};
  const html=renderPriceView(model);dom=parse(html);
  assert.equal(headline(dom),'Unavailable');assert.deepEqual(priceCells(dom),Array(4).fill('Unavailable'));assert.doesNotMatch(html,/<img/);
});

test('small positive benchmark index projections use approximate scientific display instead of zero',()=>{
  const model=modelFor({open:'1',high:'2',low:'1',close:'2'});
  model.comparison={status:'available',benchmarkSymbol:'BENCH',basis:'unadjusted',points:[{session:'2026-10-16',targetIndex:0.0000001,benchmarkIndex:0.0000002}]};
  const html=renderPriceView(model),dom=parse(html),comparison=all(dom,node=>node.attrs['data-state-key']==='prices:comparison')[0];
  const values=all(comparison,node=>node.tag==='td').map(plain);
  assert.equal(values.length,2);assert.ok(values.every(value=>Number(value)>0));
  assert.match(plain(comparison),/Displayed index values are approximate/);
});
