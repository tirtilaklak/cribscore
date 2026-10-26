import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import * as contract from '../dist/lib/evidence.js';
import * as research from '../dist/data/research.js';
import * as corpus from '../dist/data/nobel-corpus.js';
import {at,cutoff,expiry,proposal} from './fixtures/research-slate-fixtures.mjs';
import {createApprovedSlateSlot,renderApprovedResearchView} from '../dist/lib/research-slate-view.js';
import {renderStockView} from '../dist/lib/stock-view.js';
import {renderStockView as originalView} from './fixtures/stock-view-before-slate.mjs';
import {buildStockSnapshot} from '../dist/lib/candidates.js';

const parseHTML=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,tag)=>[...(node.tag===tag?[node]:[]),...(node.children||[]).flatMap(child=>typeof child==='string'?[]:all(child,tag))];
const content=node=>typeof node==='string'?node:node.attrs?.['aria-hidden']==='true'?'':node.children.map(content).join('');
const snapshotData=JSON.parse(await readFile(new URL('./fixtures/stock-evidence-2026-10-16.json',import.meta.url),'utf8'));
const snapshot=id=>buildStockSnapshot(snapshotData,id,at);
async function installed(bytes=proposal().serialized){
  let now=Date.parse(at);const slot=createApprovedSlateSlot({readApprovedBytes:async()=>bytes,clock:()=>now});await slot.refresh();
  return {slot,setTime(value){now=Date.parse(value);}};
}
const view=(slot,id='next_week',query='')=>renderStockView(snapshot(id),query,{slateSlot:slot,horizonId:id});

test('absent slot retains the current six-card unavailable branch in both horizons',()=>{
  for(const id of ['next_day','next_week']){
    const html=view(undefined,id);assert.equal(html,originalView(snapshot(id)));
    const articles=all(parseHTML(html),'article').filter(n=>(n.attrs.class||'').includes('stock-card'));
    assert.equal(articles.length,6);assert.match(html,/Forecast unavailable/);assert.doesNotMatch(html,/approved-research-slate/);
  }
  assert.equal(renderStockView(null),originalView(null));
});
test('canonical serialized bytes render only after the trusted reader is explicitly called',async()=>{
  const bytes=proposal().serialized;let reads=0;
  const slot=createApprovedSlateSlot({readApprovedBytes:async()=>{reads++;return bytes;},clock:()=>Date.parse(at)});
  assert.equal(reads,0);assert.equal(view(slot),originalView(snapshot('next_week')));
  assert.equal(await slot.refresh(),true);assert.equal(reads,1);
  const dom=parseHTML(view(slot)),articles=all(dom,'article');
  assert.equal(articles.length,3);assert.match(content(dom),/Research rank 1 · tied/);assert.match(content(dom),/Research rank 3/);
  assert.match(content(dom),/Research evidence score 75\/100 · Unvalidated/);
  assert.match(content(dom),/Unvalidated research priorities; not a return forecast\./);
  assert.doesNotMatch(content(dom),/Forecast unavailable|No eligible|return estimate|gain probability|Chance of gain|Expected return|Price:/);
  for(const article of articles){
    assert.match(content(article),/Entry · open:/);assert.match(content(article),/Exit · close:/);assert.match(content(article),/Downside:/);
    assert.match(content(article),/Synthetic earnings webcast/);assert.equal(all(article,'time').length,3);
  }
});
test('visible cutoff, expiry and exact time attributes preserve fractional clocks without publication claims',async()=>{
  const {slot}=await installed(),dom=parseHTML(view(slot)),times=all(dom,'time').map(n=>n.attrs.datetime);
  assert.ok(times.includes(cutoff));assert.ok(times.includes(expiry));
  assert.match(content(dom),/Source cutoff:.*2026-10-17 01:00:00\.1 UTC/);
  assert.match(content(dom),/Display expires:.*2026-10-18 00:00:00\.12 UTC/);
  assert.doesNotMatch(content(dom),/Published at|Publication approved/);
});
test('DOM disclosures have unique native names and reachable safe source links',async()=>{
  const {slot}=await installed(),dom=parseHTML(view(slot));
  const details=all(dom,'details'),names=[];
  for(const d of details){
    const children=d.children.filter(c=>typeof c!=='string');assert.equal(children[0].tag,'summary');assert.equal(Object.hasOwn(d.attrs,'open'),false);
    const s=children[0];names.push(content(s));assert.match(content(s),/Evidence & sources for [A-Z]{3}/);
    for(const key of ['role','tabindex','aria-label','aria-expanded','onclick','onkeydown'])assert.equal(Object.hasOwn(s.attrs,key),false);
    assert.ok(all(d,'a').length>=1);
  }
  assert.equal(new Set(names).size,3);
  assert.equal(all(dom,'a').filter(a=>a.attrs.href==='#methodology').length,1);
  for(const a of all(dom,'a').filter(a=>a.attrs.href!=='#methodology')){
    assert.match(a.attrs.href,/^https:\/\/investors\.example\.com\/reports\/\d$/);assert.equal(a.attrs.target,'_blank');
    assert.equal(a.attrs.rel,'noopener noreferrer');assert.match(content(a),/opens in a new tab/);
  }
  assert.equal(all(dom,'button').length,0);assert.equal(all(dom,'script').length,0);
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  assert.match(css,/summary:focus-visible\{outline:3px solid/);assert.match(css,/\.stock-desk summary\{[^}]*min-height:44px/);
  assert.match(css,/@media\(max-width:1100px\)\{\.stock-list\{grid-template-columns:1fr/);
});
test('untrusted payload objects, JSON approval flags and private review wrappers do not enable the branch',async()=>{
  const result=proposal(),payload=JSON.parse(result.serialized);
  for(const attempt of [payload,{...payload,approved:true},{...result,approved:true},result.serialized]){
    assert.equal(renderApprovedResearchView(attempt,{horizonId:'next_week'}),null);
    assert.equal(view(attempt),originalView(snapshot('next_week')));
  }
  for(const bytes of [result,JSON.stringify(result),JSON.stringify({...payload,publication_status:'approved'}),JSON.stringify({...payload,approved:true})]){
    const {slot}=await installed(bytes);assert.equal(view(slot),originalView(snapshot('next_week')));
  }
  const slot=createApprovedSlateSlot();assert.equal(await slot.refresh(),false);assert.equal(view(slot),originalView(snapshot('next_week')));
});
test('stale display expiry, entry boundary, future generation and wrong horizon all fall back exactly',async()=>{
  const {slot,setTime}=await installed();assert.match(view(slot),/approved-research-slate/);
  assert.equal(view(slot,'next_day'),originalView(snapshot('next_day')));
  setTime(expiry);assert.equal(view(slot),originalView(snapshot('next_week')));assert.equal(slot.stateKey('next_week'),'fallback');
  const p=JSON.parse(proposal().serialized);p.display_expires_at=p.horizon.exit_at;
  const entry=await installed(JSON.stringify(p));entry.setTime(p.horizon.entry_at);assert.equal(view(entry.slot),originalView(snapshot('next_week')));
  entry.setTime('2026-10-16T00:00:00Z');assert.equal(view(entry.slot),originalView(snapshot('next_week')));
});
test('same bytes do not change state key; expiry and explicit clear invalidate it without inventing an asset',async()=>{
  const {slot,setTime}=await installed(),key=slot.stateKey('next_week');
  assert.equal(slot.nextBoundaryAt('next_week'),Date.parse(expiry));await slot.refresh();assert.equal(slot.stateKey('next_week'),key);
  setTime('2026-10-17T02:00:00Z');assert.equal(slot.stateKey('next_week'),key);
  setTime(expiry);assert.equal(slot.stateKey('next_week'),'fallback');assert.equal(slot.nextBoundaryAt('next_week'),null);
  setTime(at);assert.equal(slot.stateKey('next_week'),'fallback');
  slot.clear();setTime(at);assert.equal(slot.stateKey('next_week'),'fallback');
});
test('future or stale deliveries are discarded, not installed for automatic later activation',async()=>{
  for(const value of ['2026-10-16T00:00:00Z',expiry]){
    let now=Date.parse(value);const slot=createApprovedSlateSlot({readApprovedBytes:async()=>proposal().serialized,clock:()=>now});
    assert.equal(await slot.refresh(),false);now=Date.parse(at);assert.equal(view(slot),originalView(snapshot('next_week')));
  }
});
test('reader failure clears old bytes, and an older pending response cannot overwrite a newer result',async()=>{
  let fail=false,now=Date.parse(at);
  const slot=createApprovedSlateSlot({readApprovedBytes:async()=>{if(fail)throw new Error('denied');return proposal().serialized;},clock:()=>now});
  await slot.refresh();assert.match(view(slot),/approved-research-slate/);fail=true;assert.equal(await slot.refresh(),false);assert.equal(view(slot),originalView(snapshot('next_week')));
  const pending=[];const racing=createApprovedSlateSlot({readApprovedBytes:()=>new Promise(resolve=>pending.push(resolve)),clock:()=>now});
  const old=racing.refresh(),fresh=racing.refresh();pending[1](null);await fresh;pending[0](proposal().serialized);assert.equal(await old,false);
  assert.equal(view(racing),originalView(snapshot('next_week')));
  const cleared=racing.refresh();racing.clear();pending[2](proposal().serialized);await cleared;assert.equal(view(racing),originalView(snapshot('next_week')));
});
test('malformed and extra fields at every level withhold the whole branch without leaking sentinels',async()=>{
  const change=[p=>p.raw={close:'RAW_SENTINEL'},p=>p.rows[0].adjusted={volume:'RAW_SENTINEL'},p=>p.rows[0].catalyst.token='RAW_SENTINEL',
    p=>p.rows[0].sources[0].entitlement='RAW_SENTINEL',p=>p.horizon.private_holdings=['RAW_SENTINEL'],
    p=>Object.defineProperty(p.rows[0],'__proto__',{value:{token:'RAW_SENTINEL'},enumerable:true}),p=>p.rows[0].research_score=73,
    p=>p.rows[1].research_rank=2,p=>p.rows[0].ticker=p.rows[1].ticker,p=>p.rows[0].catalyst.window_position='before_window',
    p=>p.policy_version='unknown',p=>p.audience='public',p=>p.predictive_status='validated',p=>p.generated_at='2026-02-30T01:00:00Z',
    p=>p.generated_at='2026-10-17T01:00:00.1234Z',p=>p.source_cutoff_at='2026-10-18T00:00:00Z',p=>p.rows[0].thesis='<img src=x onerror=alert(1)>',
    p=>p.rows[0].sources[0].url+='?token=RAW_SENTINEL',p=>p.rows[0].sources[0].url='https://investors.example.com/api_key/RAW_SENTINEL',
    p=>p.rows[0].sources[0].url='javascript:alert(1)',p=>p.rows[0].sources[0].url='https://user:RAW_SENTINEL@investors.example.com/report'];
  for(const mutate of change){const p=JSON.parse(proposal().serialized);mutate(p);const {slot}=await installed(JSON.stringify(p));const html=view(slot);assert.equal(html,originalView(snapshot('next_week')));assert.doesNotMatch(html,/RAW_SENTINEL/);}
  for(const bytes of ['{','null','[]',proposal().serialized.replace('"owner_private"','"owner_private","audience":"owner_private"')]){
    const {slot}=await installed(bytes);assert.equal(view(slot),originalView(snapshot('next_week')));
  }
});
test('search preserves ranks and tie labels; no match is not a fallback or backfilled candidate',async()=>{
  const {slot}=await installed();let dom=parseHTML(view(slot,'next_week','BBB'));
  assert.equal(all(dom,'article').length,1);assert.match(content(dom),/Research rank 1 · tied/);assert.doesNotMatch(content(dom),/Synthetic Company 0/);
  dom=parseHTML(view(slot,'next_week','notpresent'));assert.equal(all(dom,'article').length,0);assert.match(content(dom),/No matching research priorities/);assert.doesNotMatch(content(dom),/IBM/);
});
test('empty slates fall back; canonical withheld rank gaps do not force five rows',async()=>{
  const empty=await installed(proposal([]).serialized);assert.equal(view(empty.slot),originalView(snapshot('next_week')));
  const p=JSON.parse(proposal().serialized);p.rows=p.rows.slice(2);p.withheld_count=2;
  const {slot}=await installed(JSON.stringify(p));const dom=parseHTML(view(slot));assert.equal(all(dom,'article').length,1);assert.match(content(dom),/Research rank 3/);
});
test('one-day canonical slate preserves its exact exit and labels its later catalyst',async()=>{
  const {slot}=await installed(proposal([75],'next_day').serialized),dom=parseHTML(view(slot,'next_day'));
  assert.match(content(dom),/1 trading day/);assert.match(content(dom),/After this holding window/);
  assert.ok(all(dom,'time').some(n=>n.attrs.datetime==='2026-10-19T20:00:00Z'));
});
test('plain text ampersands and quotes are escaped while preserving their accessible text',async()=>{
  const p=JSON.parse(proposal().serialized);p.rows[0].company='Synthetic "A&B"';p.rows[0].thesis='Demand & pricing could improve.';
  const {slot}=await installed(JSON.stringify(p)),html=view(slot),dom=parseHTML(html);
  assert.match(html,/Synthetic &quot;A&amp;B&quot;/);assert.match(content(dom),/Synthetic "A&B"/);assert.match(content(dom),/Demand & pricing/);
});
test('dormant actual-app hook preserves initial fallback, unchanged visibility and expiry/entry rerender',async()=>{
  let now=Date.parse(at),writes=0,nextTimer=1;
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const nodes=new Map(),listeners=new Map(),timers=new Map();
  function node(key){
    if(!nodes.has(key)){
      let html='';nodes.set(key,{textContent:'',value:'',dataset:{},attributes:{},open:false,classList:{toggle(){}},
        get innerHTML(){return html;},set innerHTML(value){html=value;if(key==='#view-content')writes++;},
        setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},addEventListener(k,v){this[k]=v;},
        focus(){document.activeElement=this;},close(){this.open=false;},showModal(){this.open=true;}});
    }return nodes.get(key);
  }
  const horizons=['next_day','next_week'].map(id=>{const n=node(id);n.dataset.horizon=id;return n;});
  const navigation=['research','evidence','library','methodology'].map(id=>{const n=node(id);n.dataset.view=id;return n;});
  const document={hidden:false,activeElement:{tagName:'BODY'},querySelector:node,
    querySelectorAll(selector){return selector==='[data-horizon]'?horizons:selector==='.nav-item'?navigation:[];},addEventListener(k,v){listeners.set(k,v);}};
  const sandbox={document,location:{href:'https://example.invalid/',hash:'',search:'',pathname:'/'},history:{replaceState(){}},window:{addEventListener(){}},
    URL,URLSearchParams,Intl,Date:ClockDate,buildStockSnapshot,renderStockView,research,corpusModule:corpus,contract,
    setTimeout(callback,delay){const id=nextTimer++;timers.set(id,{callback,at:now+delay});return id;},clearTimeout(id){timers.delete(id);},setInterval(){return 1;},
    fetch:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url.includes('stock-evidence')?new URL('./fixtures/stock-evidence-2026-10-16.json',import.meta.url):new URL('../dist/'+url.replace('./',''),import.meta.url),'utf8'))})};
  const source=(await readFile(new URL('../dist/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'')
    .replace("import('./data/research.js')",'Promise.resolve(research)').replace("import('./data/nobel-corpus.js')",'Promise.resolve(corpusModule)')
    .replace("import('./lib/evidence.js')",'Promise.resolve(contract)');
  await runInNewContext(`(async()=>{${source}\nglobalThis.testSetSlot=slot=>{state.approvedSlateSlot=slot;state.horizon='next_week';render();};})()`,sandbox);
  assert.match(node('#view-content').innerHTML,/Forecast unavailable/);assert.doesNotMatch(node('#view-content').innerHTML,/approved-research-slate/);
  const slot=createApprovedSlateSlot({readApprovedBytes:async()=>proposal().serialized,clock:()=>now});await slot.refresh();sandbox.testSetSlot(slot);
  assert.equal(all(parseHTML(node('#view-content').innerHTML),'article').length,3);
  const stableWrites=writes;listeners.get('visibilitychange')();assert.equal(writes,stableWrites);
  assert.ok([...timers.values()].some(t=>t.at===Date.parse(expiry)));
  now=Date.parse(expiry);for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}
  assert.ok(writes>stableWrites);assert.match(node('#view-content').innerHTML,/Forecast unavailable/);assert.doesNotMatch(node('#view-content').innerHTML,/approved-research-slate/);
  const afterExpiry=writes;listeners.get('visibilitychange')();assert.equal(writes,afterExpiry);
  now=Date.parse(at);const p=JSON.parse(proposal().serialized);p.display_expires_at=p.horizon.exit_at;
  const later=createApprovedSlateSlot({readApprovedBytes:async()=>JSON.stringify(p),clock:()=>now});await later.refresh();sandbox.testSetSlot(later);
  assert.ok([...timers.values()].some(t=>t.at===Date.parse(p.horizon.entry_at)));
  now=Date.parse(p.horizon.entry_at);listeners.get('visibilitychange')();
  assert.match(node('#view-content').innerHTML,/Window in progress/);assert.doesNotMatch(node('#view-content').innerHTML,/approved-research-slate/);
});
