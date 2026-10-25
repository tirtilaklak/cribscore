// Controlled local promises only. Secondary loads intentionally remain pending;
// no browser, network, elapsed-time sleeps, or production state edits are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.env.CRIBSCORE_PROJECT_ROOT||fileURLToPath(new URL('../',import.meta.url));
const load=name=>import(pathToFileURL(`${root}/${name}`));
const [{buildStockSnapshot},{renderStockView},contract,research,corpusModule]=await Promise.all([
  load('dist/lib/candidates.js'),load('dist/lib/stock-view.js'),load('dist/lib/evidence.js'),load('dist/data/research.js'),load('dist/data/nobel-corpus.js')]);
const stock=JSON.parse(await readFile(`${root}/dist/data/stock-evidence.json`,'utf8'));
const appSource=await readFile(process.env.APP_SOURCE||`${root}/dist/app.js`,'utf8');
const source=appSource.replace(/^import .*;\n/gm,'')
  .replace("import('./data/research.js')",'researchImport')
  .replace("import('./data/nobel-corpus.js')",'Promise.resolve(corpusModule)')
  .replace("import('./lib/evidence.js')",'Promise.resolve(contract)')
  .replace("$('#workspace-date').textContent='Private preview of unvalidated research. Nothing here is a forecast or a recommendation.';", "$('#workspace-date').textContent='Private preview of unvalidated research. Nothing here is a forecast or a recommendation.';globalThis.api={state,render,navigate,stockSnapshot};");
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

function boot({at='2026-10-17T04:00:00Z',stockDeferred=false,stockFailed=false,secPending=false,researchPending=false}={}){
  let now=Date.parse(at),timerId=0,settled=false,error=null;
  const stockResponse=deferred(),secResponse=deferred(),researchModule=deferred(),nodes=new Map(),listeners=new Map(),timers=new Map(),intervals=[];
  const node=key=>{
    if(!nodes.has(key))nodes.set(key,{textContent:'',html:'',writes:0,value:'',dataset:{},open:false,
      get innerHTML(){return this.html;},set innerHTML(value){this.html=value;this.writes++;},
      classList:{toggle(){}},setAttribute(){},removeAttribute(){},addEventListener(name,fn){this[name]=fn;},
      focus(){document.activeElement=this;},close(){this.open=false;},showModal(){this.open=true;}});
    return nodes.get(key);
  };
  const document={hidden:false,activeElement:{tagName:'BODY'},querySelector:node,querySelectorAll(){return [];},addEventListener(name,fn){listeners.set(name,fn);}};
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const response=()=>({ok:!stockFailed,json:async()=>structuredClone(stock)});
  if(!stockDeferred)stockResponse.resolve(response());
  if(!secPending)secResponse.resolve({ok:true,json:async()=>({records:[]})});
  if(!researchPending)researchModule.resolve(research);
  const sandbox={document,location:{href:'https://example.invalid/',hash:'',search:'',pathname:'/'},history:{replaceState(){}},window:{addEventListener(){}},
    URL,URLSearchParams,Intl,Date:Clock,buildStockSnapshot,renderStockView,contract,corpusModule,researchImport:researchModule.promise,
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,due:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    setInterval(fn,delay){intervals.push({fn,delay});return ++timerId;},
    fetch:url=>url.includes('stock-evidence')?stockResponse.promise:secResponse.promise};
  const completion=runInNewContext(`(async()=>{${source}})()`,sandbox);
  completion.then(()=>{settled=true;},e=>{error=e;settled=true;});
  assert.ok(sandbox.api,'test hook runs before the startup await');
  const flushUntil=async(predicate,label)=>{for(let i=0;i<80&&!predicate()&&!error;i++)await Promise.resolve();if(error)throw error;assert.ok(predicate(),label);};
  return {node,document,listeners,timers,intervals,api:sandbox.api,flushUntil,settled:()=>settled,
    releaseStocks(){stockResponse.resolve(response());},setTime(value){now=Date.parse(value);},
    releaseSEC(){secResponse.resolve({ok:true,json:async()=>({records:[]})});},
    releaseSecondaries(){secResponse.resolve({ok:true,json:async()=>({records:[]})});researchModule.resolve(research);},
    async stocksSettled(){await flushUntil(()=>sandbox.api.state.stockState!=='loading','stock request reaches its own terminal state');},
    visibility(hidden){document.hidden=hidden;const fn=listeners.get('visibilitychange');assert.equal(typeof fn,'function','visibility recovery must register before unrelated loads settle');fn();},
    query(value){const input=node('#research-search');input.value=value;input.input({target:input});},
    html:()=>node('#view-content').innerHTML};
}

test('stock desk becomes visible while SEC fetch or research import remains unresolved',async()=>{
  const outcomes=[];
  for(const pending of ['sec','research']){
    const app=boot({secPending:pending==='sec',researchPending:pending==='research'});await app.stocksSettled();
    assert.equal(app.api.state.stockState,'ready');assert.equal(app.settled(),false,'do not resolve the held secondary promise');
    outcomes.push({pending,cards:(app.html().match(/class="card stock-card"/g)||[]).length,unavailable:app.html().includes('Stock research unavailable')});
    assert.equal(app.api.state.approvedSlateSlot,null);
    assert.equal(JSON.stringify(app.api.state.stockPayload.operating_evidence.source_checks),JSON.stringify(stock.operating_evidence.source_checks));
  }
  assert.ok(outcomes.every(x=>x.cards===6&&!x.unavailable),JSON.stringify(outcomes));
});

test('failed stock load does not block independently ready secondary views or invent stock cards',async()=>{
  const app=boot({stockFailed:true});await app.flushUntil(()=>app.settled(),'all independent successful/failed tasks settle');
  assert.equal(app.api.state.stockState,'unavailable');assert.equal(app.api.state.stockPayload,null);
  assert.equal(app.api.state.evidenceState,'ready');assert.equal(app.api.state.dataState,'ready');
  assert.match(app.html(),/Stock research unavailable/);assert.doesNotMatch(app.html(),/class="card stock-card"/);
  app.api.navigate('evidence');assert.match(app.html(),/<h2>Filing facts/);
  app.api.navigate('library');assert.equal((app.html().match(/class="card library-card"/g)||[]).length,16);
  assert.equal(app.api.state.approvedSlateSlot,null);
});

test('late stock completion keeps the selected view, query, horizon and source focus',async()=>{
  const search=boot({stockDeferred:true,secPending:true});search.api.state.horizon='next_week';search.query(' pg ');
  const field=search.node('#research-search');search.document.activeElement=field;
  search.releaseStocks();await search.stocksSettled();
  assert.equal(search.settled(),false);assert.equal(search.api.state.query,'pg');assert.equal(field.value,' pg ');
  assert.equal(search.api.state.horizon,'next_week');assert.equal(search.document.activeElement,field);
  assert.match(search.html(),/>PG</);assert.doesNotMatch(search.html(),/>NFLX</);assert.match(search.html(),/2026-10-23 20:00 UTC/);

  const evidence=boot({stockDeferred:true,secPending:true});await evidence.flushUntil(()=>evidence.api.state.dataState==='ready','independent source registry ready');
  evidence.api.navigate('evidence');const focus={tagName:'A'};evidence.document.activeElement=focus;
  const before=evidence.html(),writes=evidence.node('#view-content').writes;
  evidence.releaseStocks();await evidence.stocksSettled();
  assert.equal(evidence.settled(),false);
  assert.equal(evidence.api.state.view,'evidence');assert.equal(evidence.html(),before);
  assert.equal(evidence.node('#view-content').writes,writes,'stock completion must not replace another view');
  assert.equal(evidence.document.activeElement,focus);
});

test('stock arriving after entry uses actual clock and retains deadline/visibility recovery despite a hung secondary',async()=>{
  const app=boot({at:'2026-10-19T13:29:59Z',stockDeferred:true,secPending:true});
  app.setTime('2026-10-19T13:30:01Z');app.releaseStocks();await app.stocksSettled();
  assert.equal(app.settled(),false);assert.match(app.html(),/>Window in progress</);assert.doesNotMatch(app.html(),/>Upcoming</);
  assert.ok([...app.timers.values()].some(t=>t.due===Date.parse('2026-10-19T20:00:00Z')));
  assert.ok(app.intervals.some(t=>t.delay===60000),'periodic recovery must not wait for unrelated loads');
  assert.equal(app.api.state.stockPayload.operating_evidence.checked_at_utc,stock.operating_evidence.checked_at_utc);
  app.visibility(true);app.setTime('2026-10-19T20:00:01Z');app.visibility(false);
  assert.match(app.html(),/>Archived snapshot</);assert.equal(app.settled(),false);
  assert.equal(app.api.state.approvedSlateSlot,null);
});

test('late completion of both secondary loaders preserves already shown stock disclosures and source focus',async()=>{
  const app=boot({secPending:true,researchPending:true});await app.stocksSettled();
  assert.equal(app.settled(),false);assert.equal((app.html().match(/class="card stock-card"/g)||[]).length,6);
  app.query('PG');const visible=app.html(),writes=app.node('#view-content').writes,focus={tagName:'A'};
  app.document.activeElement=focus;
  // Any innerHTML assignment would recreate the user's native disclosure tree.
  app.releaseSecondaries();await app.flushUntil(()=>app.settled(),'held secondaries eventually settle');
  assert.equal(app.api.state.dataState,'ready');assert.equal(app.api.state.evidenceState,'ready');
  assert.equal(app.html(),visible);assert.equal(app.node('#view-content').writes,writes);
  assert.equal(app.document.activeElement,focus);assert.equal(app.api.state.query,'PG');
});

test('a genuinely hung stock request does not block independently completing evidence and library views',async()=>{
  for(const view of ['evidence','library']){
    const app=boot({stockDeferred:true,secPending:true,researchPending:true});
    app.api.navigate(view);assert.equal(app.api.state.stockState,'loading');
    app.releaseSecondaries();await app.flushUntil(()=>app.api.state.dataState==='ready'&&app.api.state.evidenceState==='ready','secondary loaders finish independently');
    assert.equal(app.settled(),false,'stock promise is never resolved in this test');assert.equal(app.api.state.stockState,'loading');
    assert.equal(app.api.state.view,view);
    if(view==='library')assert.equal((app.html().match(/class="card library-card"/g)||[]).length,16);
    else {assert.match(app.html(),/<h2>Filing facts/);assert.ok((app.html().match(/class="card registry-card"/g)||[]).length>0);}
    assert.equal(app.api.state.approvedSlateSlot,null);
  }
});
