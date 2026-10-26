import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {SourceTextModule,createContext} from 'node:vm';
import {createDocument,Element} from './interaction-dom.mjs';
const project=process.env.CRIBSCORE_PROJECT_ROOT||fileURLToPath(new URL('../../',import.meta.url));
const appPath=process.env.APP_SOURCE||`${project}/dist/app.js`;
const sourceHelper=process.env.SOURCE_FRESHNESS_MODULE||`${project}/dist/lib/source-freshness.js`;
const readJSON=async path=>JSON.parse(await readFile(`${project}/${path}`,'utf8'));
const stock=await readJSON('dist/data/stock-evidence.json');
const retained=await readJSON('tests/fixtures/stock-evidence-2026-10-16.json');
const evidence=await readJSON('dist/data/sec-evidence.json');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function boot({at='2026-10-17T04:00:00Z',requests={},failImport,moduleTransform,stockPayload=stock,evidencePayload=evidence}={}){
  let now=Date.parse(at),mono=0,nextID=0;
  const timers=new Map(),windowListeners=new Map(),requestsSeen=[],modules=new Map(),unhandled=[];
  let index=await readFile(`${project}/dist/index.html`,'utf8');
  // The companion index overlay supplies this persistent live region. Exercise
  // the exact runtime against that agreed integration contract when on baseline.
  if(!index.includes('id="workspace-status"'))index=index.replace('<section id="view-content"','<p id="workspace-status" role="status" aria-live="polite" aria-atomic="true"></p><section id="view-content"');
  const document=createDocument(index), location={href:'https://offline.invalid/',hash:'',search:'',pathname:'/'};
  const setLocation=value=>{const url=new URL(value,location.href);Object.assign(location,{href:url.href,hash:url.hash,search:url.search,pathname:url.pathname});};
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const add=(fn,delay,repeat=0)=>{const id=++nextID;timers.set(id,{fn,due:mono+Number(delay),repeat});return id;};
  const context=createContext({document,location,history:{replaceState:(_,__,url)=>setLocation(url),pushState:(_,__,url)=>setLocation(url)},window:{addEventListener:(name,fn)=>windowListeners.set(name,fn)},URL,URLSearchParams,Intl,Date:Clock,AbortController,console,
    setTimeout:(fn,ms)=>add(fn,ms),clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>add(fn,ms,ms),clearInterval:id=>timers.delete(id),
    fetch:async(url,options)=>{const kind=url.includes('/api/journal')?'journal':url.includes('stock-evidence')?'stocks':'evidence';const attempt=requestsSeen.filter(x=>x.kind===kind).length+1;requestsSeen.push({kind,attempt,options});const reply=requests[kind]?.[attempt-1];if(reply)return typeof reply==='function'?reply():await reply;if(kind==='journal')return {ok:false,status:503,json:async()=>({ok:false,error:'offline_journal_unconfigured'})};return {ok:true,json:async()=>structuredClone(kind==='stocks'?stockPayload:evidencePayload)};}});
  const load=async(url)=>{
    if(modules.has(url))return modules.get(url);
    const pending=(async()=>{if(failImport?.(url))throw new Error('offline module failure');const path=fileURLToPath(url),code=await readFile(path.endsWith('/dist/app.js')?appPath:path.endsWith('/dist/lib/source-freshness.js')?sourceHelper:path.endsWith('/dist/lib/stock-view.js')?(process.env.STOCK_VIEW_SOURCE||path):path,'utf8');
      // Corrupt only fixture module exports; the production app and its loader run unchanged.
      const fixtureCode=moduleTransform?moduleTransform(url,code):code;
      const module=new SourceTextModule(fixtureCode,{context,identifier:url,importModuleDynamically:async(spec,parent)=>{const child=await load(new URL(spec,parent.identifier).href);if(child.status==='linked')await child.evaluate();return child;}});
      await module.link((spec,parent)=>load(new URL(spec,parent.identifier).href));return module;})();
    modules.set(url,pending);return pending;
  };
  const module=await load(pathToFileURL(`${project}/dist/app.js`).href);let settled=false,error;
  const completion=module.evaluate();completion.then(()=>settled=true,e=>{error=e;settled=true;});
  const flush=async()=>{for(let i=0;i<6;i++){await Promise.allSettled([...modules.values()]);await tick();}if(error)throw error;};
  await flush();
  const query=s=>document.querySelector(s), queryAll=s=>document.querySelectorAll(s);
  const click=element=>{assert.ok(element,'control exists');element.focus();element.dispatch({type:'click',target:element});};
  const key=(element,value,extra={})=>{let prevented=false;element.dispatch({type:'keydown',target:element,key:value,preventDefault(){prevented=true;},...extra});return prevented;};
  const input=value=>{const field=query('#research-search');field.value=value;field.dispatch({type:'input',target:field});};
  const advance=async(ms)=>{const end=mono+ms;let count=0;while(true){const due=[...timers].sort((a,b)=>a[1].due-b[1].due)[0];if(!due||due[1].due>end)break;assert.ok(count++<1000);const [id,timer]=due;now+=timer.due-mono;mono=timer.due;if(timer.repeat)timer.due+=timer.repeat;else timers.delete(id);timer.fn();await flush();}now+=end-mono;mono=end;await flush();};
  const visibility=()=>{document.hidden=false;document.dispatch({type:'visibilitychange'});};
  return {namespace:async relative=>{const child=await load(new URL(relative,pathToFileURL(`${project}/dist/app.js`)).href);if(child.status==='linked')await child.evaluate();return child.namespace;},query,queryAll,document,click,key,input,flush,advance,visibility,requestsSeen,modules,settled:()=>settled,setTime:value=>{now=Date.parse(value);},location,route(url,event='popstate'){setLocation(url);windowListeners.get(event)?.();},html:()=>query('#view-content').innerHTML,text:()=>query('#view-content').textContent,live:()=>query('#workspace-status').textContent};
}

export {boot,stock,retained};
