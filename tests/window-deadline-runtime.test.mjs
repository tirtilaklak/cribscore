// Independent offline regression: timers use monotonic deadlines; Date uses a
// separately movable wall clock. No browser, network, app or canonical writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.env.CRIBSCORE_PROJECT_ROOT||fileURLToPath(new URL('../',import.meta.url));
const moduleAt=name=>import(pathToFileURL(`${root}/${name}`));
const [{buildStockSnapshot},{renderStockView},{createApprovedSlateSlot},{proposal},contract,research,corpusModule]=await Promise.all([
  moduleAt('dist/lib/candidates.js'),moduleAt('dist/lib/stock-view.js'),moduleAt('dist/lib/research-slate-view.js'),
  moduleAt('tests/fixtures/research-slate-fixtures.mjs'),moduleAt('dist/lib/evidence.js'),moduleAt('dist/data/research.js'),moduleAt('dist/data/nobel-corpus.js')]);
const payload=JSON.parse(await readFile(`${root}/dist/data/stock-evidence.json`,'utf8'));
const sourcePath=process.env.APP_SOURCE||`${root}/dist/app.js`;
const source=(await readFile(sourcePath,'utf8')).replace(/^import .*;\n/gm,'')
  .replace("import('./data/research.js')",'Promise.resolve(research)')
  .replace("import('./data/nobel-corpus.js')",'Promise.resolve(corpusModule)')
  .replace("import('./lib/evidence.js')",'Promise.resolve(contract)');

async function boot(at,horizon='next_day'){
  let wall=Date.parse(at),mono=0,nextId=0;
  const nodes=new Map(),tasks=new Map(),listeners=new Map();
  const node=key=>{
    if(!nodes.has(key))nodes.set(key,{textContent:'',html:'',writes:0,get innerHTML(){return this.html;},
      set innerHTML(value){this.html=value;this.writes++;},value:'',dataset:{},open:false,
      classList:{toggle(){}},setAttribute(){},removeAttribute(){},addEventListener(){},
      focus(){document.activeElement=this;},close(){this.open=false;},showModal(){this.open=true;}});
    return nodes.get(key);
  };
  const document={hidden:false,activeElement:{tagName:'BODY'},querySelector:node,querySelectorAll(){return [];},addEventListener(name,fn){listeners.set(name,fn);}};
  class Clock extends Date{constructor(...args){super(...(args.length?args:[wall]));}static now(){return wall;}}
  function add(fn,delay,period=0){const id=++nextId;tasks.set(id,{fn,due:mono+Number(delay),period});return id;}
  const sandbox={document,location:{hash:'',search:`?horizon=${horizon}`,pathname:'/',href:`https://example.invalid/?horizon=${horizon}`},history:{replaceState(){}},window:{addEventListener(){}},
    URL,URLSearchParams,Intl,Date:Clock,buildStockSnapshot,renderStockView,contract,research,corpusModule,
    setTimeout:(fn,ms)=>add(fn,ms),clearTimeout:id=>tasks.delete(id),setInterval:(fn,ms)=>add(fn,ms,ms),clearInterval:id=>tasks.delete(id),
    fetch:async url=>({ok:true,json:async()=>url.includes('stock-evidence')?structuredClone(payload):{records:[]}})};
  await runInNewContext(`(async()=>{${source}\nglobalThis.api={state,render,refreshTimeSensitiveView};})()`,sandbox);
  function due(){return [...tasks.entries()].filter(([,v])=>v.due<=mono).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0]);}
  function flush(){let n=0;while(due().length){assert.ok(++n<1000,'timer callback loop');const [id,t]=due()[0];if(t.period)t.due=mono+t.period;else tasks.delete(id);t.fn();}}
  function advance(ms,{deliver=true}={}){
    const end=mono+ms;
    if(!deliver){mono=end;wall+=ms;return;}
    let n=0;
    while(true){const next=Math.min(...[...tasks.values()].map(t=>t.due));if(next>end)break;
      assert.ok(++n<10000,'scheduler loop');const step=Math.max(0,next-mono);mono+=step;wall+=step;flush();}
    wall+=end-mono;mono=end;
  }
  function state(){const html=node('#view-content').innerHTML;return {wall:new Date(wall).toISOString(),mono,
    badge:html.includes('>Upcoming<')?'upcoming':html.includes('>Window in progress<')?'in_progress':html.includes('>Archived snapshot<')?'archived':'other',
    approved:html.includes('approved-research-slate'),writes:node('#view-content').writes};}
  return {state,node,document,advance,flush,jumpWall:ms=>{wall+=ms;},timers:()=>[...tasks.values()].map(t=>({due:t.due,period:t.period})),
    visibility:hidden=>{document.hidden=hidden;listeners.get('visibilitychange')();},
    horizon:id=>{sandbox.api.state.horizon=id;sandbox.api.render();},
    async approved({expiry,entry}={}){
      const p=JSON.parse(proposal().serialized);if(expiry)p.display_expires_at=expiry;if(entry)p.horizon.entry_at=entry;
      const slot=createApprovedSlateSlot({readApprovedBytes:async()=>JSON.stringify(p),clock:()=>wall});
      assert.equal(await slot.refresh(),true);sandbox.api.state.approvedSlateSlot=slot;sandbox.api.state.horizon='next_week';sandbox.api.render();
      assert.equal(state().approved,true);return slot;
    }};
}

test('actual retained badges change at entry/day-exit/week-exit without firing an early interval',async()=>{
  const observed=[];
  for(const [horizon,boundary,want] of [['next_day','2026-10-19T13:30:00Z','in_progress'],['next_week','2026-10-19T13:30:00Z','in_progress'],['next_day','2026-10-19T20:00:00Z','archived'],['next_week','2026-10-23T20:00:00Z','archived']]){
    const app=await boot(new Date(Date.parse(boundary)-1000).toISOString(),horizon);
    app.advance(999);const before=app.state();app.advance(1);
    observed.push({horizon,boundary,before:before.badge,actual:app.state().badge,want,elapsed:app.state().mono});
  }
  assert.ok(observed.every(x=>x.actual===x.want),JSON.stringify(observed));
});

test('approved slate expiry and entry already have exact deadlines and do not revive after observed expiry',async()=>{
  const cases=[{boundary:'2026-10-18T00:00:00.120Z',expiry:'2026-10-18T00:00:00.120Z'},
    {boundary:'2026-10-19T13:30:00.000Z',expiry:'2026-10-23T20:00:00Z'}];
  for(const c of cases){
    const app=await boot(new Date(Date.parse(c.boundary)-1000).toISOString(),'next_week');await app.approved(c);
    app.advance(999);assert.equal(app.state().approved,true);app.advance(1);assert.equal(app.state().approved,false);
    app.jumpWall(-10000);app.visibility(false);assert.equal(app.state().approved,false);
  }
});

test('an early callback after wall-clock rollback rearms the real deadline without unchanged DOM writes',async()=>{
  const observed=[];
  for(const approved of [false,true]){
    const boundary=approved?'2026-10-18T00:00:00.120Z':'2026-10-19T13:30:00Z';
    const app=await boot(new Date(Date.parse(boundary)-1000).toISOString(),'next_week');
    if(approved)await app.approved({expiry:boundary});
    const writes=app.state().writes;app.jumpWall(-10000);app.advance(1000);
    assert.equal(app.state().writes,writes,'clock rollback alone must not replace unchanged content');
    app.advance(9999);assert.equal(app.state().writes,writes);
    app.advance(1);observed.push({approved,wall:app.state().wall,display:app.state().approved,badge:app.state().badge,writes:app.state().writes-writes});
  }
  assert.ok(observed.every(x=>x.approved?!x.display:x.badge==='in_progress'),JSON.stringify(observed));
});

test('suspended hidden-tab deadlines are checked on visibility, then unchanged visibility preserves focus',async()=>{
  for(const approved of [false,true]){
    const boundary=approved?'2026-10-18T00:00:00.120Z':'2026-10-19T20:00:00Z';
    const app=await boot(new Date(Date.parse(boundary)-1000).toISOString());if(approved)await app.approved({expiry:boundary});
    app.visibility(true);app.advance(2000,{deliver:false});app.visibility(false);
    assert.equal(approved?app.state().approved:app.state().badge,approved?false:'archived');
    const writes=app.state().writes,focus={tagName:'A'};app.document.activeElement=focus;
    app.flush();app.visibility(false);assert.equal(app.state().writes,writes);assert.equal(app.document.activeElement,focus);
  }
});

test('changing day to week cancels the day-exit deadline and schedules the selected week exit',async()=>{
  const start='2026-10-19T19:59:59Z',app=await boot(start);
  app.horizon('next_week');const deadlines=app.timers().filter(t=>!t.period).map(t=>t.due);
  assert.ok(deadlines.includes(Date.parse('2026-10-23T20:00:00Z')-Date.parse(start)),JSON.stringify(deadlines));
  assert.ok(!deadlines.includes(1000));app.advance(1000);assert.equal(app.state().badge,'in_progress');
});
