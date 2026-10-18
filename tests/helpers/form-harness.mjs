// Shared offline harness for the desk forms. It executes the shipped renderer,
// form-event wiring and controller against the offline DOM. Every journal
// response is synthetic; nothing listens on a port or reaches an API.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createDocument} from './interaction-dom.mjs';

export const at='2026-10-17T18:00:00Z';
export const deferred=()=>{let release;const promise=new Promise(done=>release=done);const hold={promise,released:false,resolve(value){hold.released=true;release(value);}};return hold;};
export const flush=async()=>{for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));};
const SETTLE_MS=5000;

// root may point at another checkout of the same source; the default is this one.
export async function createFormHarness({root=new URL('../../',import.meta.url)}={}){
  const base=root instanceof URL?root:pathToFileURL(String(root).endsWith('/')?String(root):`${root}/`);
  const [{createDeskTools},{createJournal},appSource]=await Promise.all([
    import(new URL('dist/lib/desk-tools.js',base).href),import(new URL('dist/lib/journal.js',base).href),readFile(new URL('dist/app.js',base),'utf8')]);
  const slice=(start,end)=>{const from=appSource.indexOf(start),to=appSource.indexOf(end);assert.ok(from>=0&&to>from,`app.js boundary not found: ${start}`);return appSource.slice(from,to);};
  const renderSource=slice('function disclosureKey(','let rightsExpiryTimer;');
  const priceClick=slice("  const price=event.target.closest('[data-price-symbol]');","  const nav=event.target.closest('[data-view],[data-go]');");
  const formEvents=slice("for(const type of ['input','change'])","$('#workspace-date').textContent");

  return async function harness(t,{view='journal',initial=null}={}){
    const originalFormData=globalThis.FormData;
    globalThis.FormData=class{
      constructor(form){this.values=new Map(form.querySelectorAll('input,select,textarea').map(field=>[field.getAttribute('name'),field.getAttribute('type')==='file'?field.file:field.value]));}
      get(name){return this.values.get(name)??null;}
    };
    const document=createDocument('<body><main id="main" tabindex="-1"><section id="view-content"></section></main></body>');
    document.removeEventListener=(type,fn)=>{document.listeners.set(type,(document.listeners.get(type)||[]).filter(item=>item!==fn));};
    const state={view};
    const shell=new Function('document','state',`let renderedView,renderedContentHTML,lastFocus;const disclosureState=new Map();const $=s=>document.querySelector(s);${renderSource};return {renderContent,selectPrice:(event,deskTools,navigate)=>{${priceClick}}};`)(document,state);
    const renderContent=shell.renderContent;
    new Function('document',formEvents)(document);
    let remote=initial||createJournal({journalId:'synthetic-form-recovery',at}),uid=0,observationHold=null,commitHold=null,loseNextCommit=false;
    const requests=[];
    const response=journal=>({ok:true,status:200,json:async()=>({ok:true,journal,revision:journal.revision,automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:['publisher_unconfigured']}})});
    const render=()=>{
      renderContent(tools.html(state.view));
      for(const field of document.querySelectorAll('input,select,textarea'))if(!field.initialized){
        field.value=field.tagName==='SELECT'?(field.querySelector('option[selected]')||field.querySelector('option'))?.getAttribute('value')||'':field.getAttribute('value')||'';field.initialized=true;
      }
    };
    const tools=createDeskTools({document,onChange:render,now:()=>at,uuid:()=>`form-${++uid}`,fetch:async(url,options)=>{
      const body=options.body?JSON.parse(options.body):null;requests.push({url,body,method:options.method});
      if(url.endsWith('/observe')){if(observationHold)await observationHold.promise;return response(remote);}
      if(options.method==='POST'){if(commitHold)await commitHold.promise;remote=body.journal;if(loseNextCommit){loseNextCommit=false;return {ok:false,status:503,json:async()=>({ok:false,error:'journal_commit_uncertain'})};}return response(remote);}
      return response(remote);
    }});
    // The controller marks itself busy synchronously when it accepts work and
    // clears the flag in its finally block after the last render.
    const idle=async()=>{const until=Date.now()+SETTLE_MS;while(tools.status().busy&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,1));return !tools.status().busy;};
    const settled=async()=>{assert.equal(await idle(),true,`journal work did not settle within ${SETTLE_MS} ms`);await flush();};
    const pending=()=>[observationHold,commitHold].some(hold=>hold&&!hold.released);
    t.after(async()=>{observationHold?.resolve();commitHold?.resolve();await idle();await flush();tools.destroy();globalThis.FormData=originalFormData;});
    await tools.start();render();
    const query=selector=>document.querySelector(selector);
    const edit=(selector,value)=>{const field=query(selector);field.value=value;field.focus();field.dispatch({type:'input',target:field});return field;};
    // A held request keeps the controller busy on purpose; otherwise submit
    // returns only after the work it started has finished.
    const submit=async form=>{form.dispatch({type:'submit',target:form,preventDefault(){}});await flush();if(!pending())await settled();};
    return {tools,state,document,query,edit,submit,settled,requests,render,remote:()=>remote,
      selectPrice(symbol){shell.selectPrice({target:{closest:()=>({dataset:{priceSymbol:symbol}})}},tools,view=>{state.view=view;render();});},
      loseNextCommit(){loseNextCommit=true;},
      holdObservation(){return observationHold=deferred();},holdCommit(){return commitHold=deferred();}};
  };
}
