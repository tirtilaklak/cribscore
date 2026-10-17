import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import * as contract from '../dist/lib/evidence.js';
import * as research from '../dist/data/research.js';
import * as corpus from '../dist/data/nobel-corpus.js';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';

test('actual app boots, loads retained stocks, switches horizon and opens secondary method',async()=>{
 const nodes=new Map(),listeners=new Map(),windowListeners=new Map();
 function node(key){if(!nodes.has(key))nodes.set(key,{textContent:'',innerHTML:'',value:'',dataset:{},attributes:{},open:false,classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},addEventListener(k,v){this[k]=v;},focus(){document.activeElement=this;},close(){this.open=false;},showModal(){this.open=true;}});return nodes.get(key);}
 const horizons=['next_day','next_week'].map(id=>{const n=node(id);n.dataset.horizon=id;return n;});
 const navigation=['research','evidence','library','methodology'].map(id=>{const n=node(id);n.dataset.view=id;return n;});
 const document={hidden:false,activeElement:{tagName:'BODY'},querySelector:node,querySelectorAll(selector){return selector==='[data-horizon]'?horizons:selector==='.nav-item'?navigation:[];},addEventListener(k,v){listeners.set(k,v);}};
 const location={href:'https://example.invalid/',hash:'',search:'',pathname:'/'};
 const sandbox={document,location,history:{replaceState(){}},window:{addEventListener(k,v){windowListeners.set(k,v);}},URL,URLSearchParams,Intl,Date,buildStockSnapshot,renderStockView,research,corpusModule:corpus,contract,setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},fetch:async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('../dist/'+url.replace('./',''),import.meta.url),'utf8'))})};
 const source=(await readFile(new URL('../dist/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace("import('./data/research.js')",'Promise.resolve(research)').replace("import('./data/nobel-corpus.js')",'Promise.resolve(corpusModule)').replace("import('./lib/evidence.js')",'Promise.resolve(contract)');
 await runInNewContext(`(async()=>{${source}})()`,sandbox);
 assert.match(node('#view-content').innerHTML,/JNJ/);
 assert.match(node('#view-content').innerHTML,/Outside the day window/);
 assert.equal(horizons[0].attributes['aria-pressed'],'true');
 const click=element=>listeners.get('click')({target:{closest(selector){if(selector==='[data-horizon]'&&element.dataset.horizon)return element;if(selector==='[data-view],[data-go]'&&element.dataset.view)return element;return null;}}});
 click(horizons[1]);assert.equal(horizons[1].attributes['aria-pressed'],'true');assert.match(node('#view-content').innerHTML,/Within the selected window/);assert.match(node('#view-content').innerHTML,/2026-10-23 20:00 UTC/);
 node('#research-search').input({target:{value:'TXN'}});assert.match(node('#view-content').innerHTML,/>TXN</);assert.doesNotMatch(node('#view-content').innerHTML,/>NFLX</);
 click(navigation[3]);assert.match(node('#view-content').innerHTML,/From the economy to each share/);assert.match(node('#view-content').innerHTML,/Mechanisms, not return coefficients/);
 node('#research-search').input({target:{value:''}});click(navigation[2]);assert.equal((node('#view-content').innerHTML.match(/class="card library-card"/g)||[]).length,16);
 assert.ok(windowListeners.has('hashchange'));
});
