import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import * as contract from '../dist/lib/evidence.js';
import * as research from '../dist/data/research.js';
import * as corpusModule from '../dist/data/nobel-corpus.js';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';

const actualStock=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
const source=(await readFile(new URL('../dist/app.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'')
  .replace("import('./data/research.js')",'Promise.resolve(research)')
  .replace("import('./data/nobel-corpus.js')",'Promise.resolve(corpusModule)')
  .replace("import('./lib/evidence.js')",'Promise.resolve(contract)');

// In-memory DOM and fetch mock only; no browser, URL navigation or source fetch.
async function boot({at='2026-10-16T14:00:00Z',records=[],stock=actualStock}={}){
  let now=Date.parse(at),timerId=0;
  const nodes=new Map(),timers=new Map(),intervals=[],listeners=new Map();
  const document={hidden:false,activeElement:{tagName:'BODY'},querySelector:node,querySelectorAll(){return [];},addEventListener(name,callback){listeners.set(name,callback);}};
  function node(key){
    if(!nodes.has(key))nodes.set(key,{textContent:'',html:'',writes:0,get innerHTML(){return this.html;},set innerHTML(value){this.html=value;this.writes++;},value:'',dataset:{},open:false,classList:{toggle(){}},setAttribute(){},removeAttribute(){},addEventListener(){},focus(){},close(){this.open=false;},showModal(){this.open=true;}});
    return nodes.get(key);
  }
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const sandbox={document,location:{href:'https://example.invalid/#evidence',hash:'#evidence',search:'',pathname:'/'},history:{replaceState(){}},window:{addEventListener(){}},URL,URLSearchParams,Intl,Date:Clock,buildStockSnapshot,renderStockView,research,corpusModule,contract,
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},setInterval(fn){intervals.push(fn);return intervals.length;},
    fetch:async url=>({ok:true,json:async()=>url.includes('stock-evidence')?structuredClone(stock):{records:structuredClone(records)}})
  };
  await runInNewContext(`(async()=>{${source}\nglobalThis.api={state,render};})()`,sandbox);
  return {nodes,timers,document,listeners,api:sandbox.api,advanceTo(value){now=Date.parse(value);for(const [id,timer]of [...timers])if(timer.due<=now){timers.delete(id);timer.fn();}for(const fn of intervals)fn();}};
}

function record(){
  const source={url:'https://www.sec.gov/Archives/edgar/data/123456/000012345625000001/synthetic-20241231.htm',indexUrl:'https://www.sec.gov/Archives/edgar/data/123456/000012345625000001/0000123456-25-000001-index.htm',accession:'0000123456-25-000001',form:'10-K',original:true,location:'Synthetic fixture',sha256:'a'.repeat(64),acceptedAt:'2025-02-03T16:30:00Z',publishedAt:'2025-02-03T16:30:00Z',fetchedAt:'2026-10-16T13:00:00Z',ingestedAt:'2026-10-16T13:01:00Z',mode:'reconstructed_public_history',parserVersion:'synthetic/1'};
  const rights={reviewId:'synthetic-audit-1',reviewedAt:'2026-10-16T12:00:00Z',validFrom:'2026-10-16T12:00:00Z',expiresAt:'2026-10-17T00:00:00Z',version:1,termsUrl:'https://www.sec.gov/about/website-policies',purpose:'historical_financial_facts',sourceBinding:{cik:'0000123456',accession:source.accession,urls:[source.url,source.indexUrl]},operations:{fetch:'allowed',store:'allowed',transform:'allowed',display:'allowed'}};
  return {issuer:{name:'SYNTHETIC Company',cik:'0000123456'},metric:{taxonomy:'us-gaap',concept:'Revenues',accountingBasis:'US-GAAP'},value:95000000,unit:'USD',scale:1,period:{start:'2024-01-01',end:'2024-12-31',type:'duration',fiscalYear:2024},scope:'consolidated',dimensions:[],source,rights:[rights]};
}

test('a known future-effective revocation removes an open claim at its effective boundary',async()=>{
  const r=record();
  r.rights.push({...structuredClone(r.rights[0]),reviewId:'synthetic-audit-2',version:2,reviewedAt:'2026-10-16T13:59:00Z',validFrom:'2026-10-16T14:30:00Z',operations:{...r.rights[0].operations,display:'revoked'}});
  const allowed=contract.inspectEvidence(r,{at:'2026-10-16T14:00:00Z',operation:'display'});
  assert.equal(allowed.eligible,true);
  const app=await boot({records:[r]});
  assert.ok(app.nodes.get('#view-content').innerHTML.includes(allowed.claim));
  app.advanceTo('2026-10-16T14:31:00Z');
  const denied=contract.inspectEvidence(r,{at:'2026-10-16T14:31:00Z',operation:'display'});
  assert.equal(denied.eligible,false,'the actual contract sees the now-effective revocation');
  const staleClaim=app.nodes.get('#view-content').innerHTML.includes(allowed.claim);
  const nextTimer=[...app.timers.values()].map(t=>new Date(t.due).toISOString());
  app.api.render();
  assert.equal(app.nodes.get('#view-content').innerHTML.includes(allowed.claim),false,'a manual rerender corrects the display');
  assert.equal(staleClaim,false,JSON.stringify({contractReasons:denied.reasons,staleClaim,nextTimer}));
});

test('malformed stock JSON cannot prevent the independent evidence page from booting',async()=>{
  for(const stock of [{event_evidence:{},operating_evidence:{}},(()=>{const value=structuredClone(actualStock);value.operating_evidence.hypotheses[0].evidence_chain=null;return value;})()]){
    const app=await boot({stock});
    assert.match(app.nodes.get('#view-content').innerHTML,/<h2>Filing facts/);
    app.api.state.view='research';app.api.render();
    assert.match(app.nodes.get('#view-content').innerHTML,/Stock research unavailable/);
  }
});

test('unchanged visibility and minute checks avoid replacing content or moving source focus',async()=>{
  const app=await boot();
  app.api.state.view='research';app.api.render();
  const content=app.nodes.get('#view-content'),writes=content.writes;
  const sourceLink={tagName:'A'};
  app.document.activeElement=sourceLink;
  app.listeners.get('visibilitychange')();
  app.advanceTo('2026-10-16T14:01:00Z');
  assert.equal(content.writes,writes,'unchanged state must not replace the native disclosure DOM');
  assert.equal(app.document.activeElement,sourceLink);
});

test('a visible tab still rerenders once when its holding window changes state',async()=>{
  const app=await boot({at:'2026-10-19T13:29:59Z'});
  app.api.state.view='research';app.api.render();
  const content=app.nodes.get('#view-content'),writes=content.writes;
  assert.match(content.innerHTML,/>Upcoming</);
  app.advanceTo('2026-10-19T13:30:01Z');
  assert.equal(content.writes,writes+1);
  assert.match(content.innerHTML,/Window in progress/);
});
