import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import {createJournal} from '../dist/lib/journal.js';

// Execute the shipped renderContent function, not a rewritten renderer. The
// narrow DOM adapter models live innerHTML and subtree removal: a detached
// iframe no longer has the browsing context that was attached to its document.
const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const renderSource=source.slice(source.indexOf('function disclosureKey('),source.indexOf('let rightsExpiryTimer;'));
function harness(){
  const handlers={},frames=[];let container=null,changes=0,observations=0;
  const state={view:'prices'},document={activeElement:null,
    addEventListener:(name,fn)=>{handlers[name]=fn;},removeEventListener:name=>{delete handlers[name];},
    createElement(tag){assert.equal(tag,'iframe');const frame={style:{},attributes:{},parentElement:null,isConnected:false,setAttribute(key,value){this.attributes[key]=value;}};frames.push(frame);return frame;},
  };
  const content={writes:0,template:'',querySelectorAll:()=>[],contains:()=>false,
    get innerHTML(){return this.template+(container?.frame?`<iframe src="${container.frame.src}"></iframe>`:'');},
    set innerHTML(html){
      this.writes++;this.template=html;if(container?.frame)container.frame.isConnected=false;
      container=html.includes('id="hosted-price-chart"')?{frame:null,replaceChildren(frame){this.frame=frame;frame.parentElement=this;frame.isConnected=true;}}:null;
    },
  };
  document.querySelector=selector=>selector==='#view-content'?content:selector==='#hosted-price-chart'?container:selector==='#main'?{focus(){}}:null;
  const renderContent=new Function('document','state',`let renderedView,renderedContentHTML,lastFocus;const disclosureState=new Map();const $=s=>document.querySelector(s);${renderSource};return renderContent;`)(document,state);
  let tools;const render=()=>{changes++;renderContent(state.view==='prices'?tools.html('prices'):'<p>Other view</p>');tools.mount(state.view);};
  const journal=createJournal({journalId:'synthetic-chart-lifecycle',at:'2026-10-17T18:00:00Z'});
  tools=createDeskTools({document,onChange:render,now:()=> '2026-10-17T18:10:00Z',fetch:async(url)=>{
    if(url==='/api/journal/observe'){observations++;return {ok:true,status:200,json:async()=>({ok:true,journal,revision:0,automation:{publisherState:'unconfigured',checkedAt:'2026-10-17T18:10:00Z',pendingReasons:['publisher_unconfigured']}})};}
    return {ok:true,status:200,json:async()=>({ok:true,journal,revision:0})};
  }});
  const click=()=>handlers.click({target:{closest:selector=>selector==='[data-price-action="load-hosted"]'?{}:null}});
  return {tools,render,click,state,content,frames,current:()=>container?.frame,observations:()=>observations,changes:()=>changes};
}

test('ordinary observer completions preserve the connected chart without repeated DOM replacement',async()=>{
  const h=harness();await h.tools.start();h.click();const original=h.current(),writes=h.content.writes,updates=h.changes();
  assert.ok(original?.isConnected);assert.notEqual(h.content.innerHTML,h.tools.html('prices'),'mounted DOM differs from its original template');
  for(let n=0;n<3;n++)await h.tools.observe();
  assert.ok(h.observations()>=4);assert.ok(h.changes()>updates,'real asynchronous controller completions occurred');
  assert.equal(h.content.writes,writes,'unchanged output does not detach the iframe');assert.equal(h.current(),original);assert.equal(original.isConnected,true);assert.equal(h.frames.length,1);h.tools.destroy();
});

test('same-view navigation preserves the mounted chart, while leaving and returning creates a new context',async()=>{
  const h=harness();await h.tools.start();h.click();const original=h.current();h.render();assert.equal(h.current(),original);assert.equal(h.frames.length,1);
  h.state.view='research';h.render();assert.equal(original.isConnected,false);
  h.state.view='prices';h.render();assert.notEqual(h.current(),original,'detached iframe must never be reused');assert.equal(h.current().isConnected,true);assert.equal(h.frames.length,2);h.tools.destroy();
});

test('an explicitly renewed chart request replaces the frame even when its template is unchanged',async()=>{
  const h=harness();await h.tools.start();h.click();const original=h.current();h.click();
  assert.notEqual(h.current(),original);assert.equal(h.frames.length,2);assert.equal(h.current().isConnected,true);h.tools.destroy();
});
