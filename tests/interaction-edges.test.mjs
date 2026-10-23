// Independent interaction outcomes. All requests and input files are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDocument,Element} from './helpers/interaction-dom.mjs';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import * as domain from '../dist/lib/journal.js';
const appURL=new URL('../dist/app.js',import.meta.url);
const source=await readFile(appURL,'utf8'),at='2026-10-17T18:00:00Z';
const renderer=source.slice(source.indexOf('function disclosureKey('),source.indexOf('let rightsExpiryTimer;'));
const eventWiring=source.slice(source.indexOf("for(const type of ['input','change'])"),source.indexOf("$('#workspace-date').textContent"));
const settle=async()=>{for(let n=0;n<30;n++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const syntheticSeries=symbol=>({schemaVersion:'cribscore-price-series-v1',id:`synthetic-${symbol}`,symbol,currency:'USD',sessionTimezone:'America/New_York',interval:'1d',priceBasis:'split_adjusted',volumeBasis:'shares',source:{provider:'Synthetic',dataset:'Independent outcome fixture only',url:'https://prices.example/fixture',capturedAt:'2026-10-16T22:00:00Z',publishedAt:null,responseSha256:'a'.repeat(64),channel:'retained_capture'},bars:['2026-10-15','2026-10-16'].map(session=>({session,open:'10',high:'11',low:'9',close:'10',volume:null}))});
const priceText=symbol=>JSON.stringify({schemaVersion:'cribscore-price-import-v1',series:[syntheticSeries(symbol)]});
async function client(t){
  const oldFD=globalThis.FormData,oldReplace=Element.prototype.replaceWith,oldRemove=Element.prototype.remove;
  globalThis.FormData=class{constructor(form){this.entries=form.syntheticValues?new Map(Object.entries(form.syntheticValues)):new Map(form.querySelectorAll('input,select,textarea').map(field=>[field.getAttribute('name'),field.value]));}get(key){return this.entries.get(key)??null;}};
  Element.prototype.replaceWith=function(prior){const parent=this.parentElement,index=parent.children.indexOf(this);if(prior.parentElement)prior.parentElement.children.splice(prior.parentElement.children.indexOf(prior),1);parent.children[index]=prior;prior.parentElement=parent;this.parentElement=null;};
  Element.prototype.remove=function(){if(this.parentElement){const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}};
  const doc=createDocument('<body><main id="main" tabindex="-1"><section id="view-content"></section></main></body>');doc.removeEventListener=(kind,fn)=>doc.listeners.set(kind,(doc.listeners.get(kind)||[]).filter(item=>item!==fn));
  const state={view:'journal'},renderContent=new Function('document','state',`let renderedView,renderedContentHTML,lastFocus;const disclosureState=new Map();const $=s=>document.querySelector(s);${renderer};return renderContent;`)(doc,state);
  new Function('document',eventWiring)(doc);
  let remote=domain.createJournal({journalId:'independent-interaction-edges',at}),sequence=0,observation=null,commitResponse=null;const writes=[],requests=[];
  const response=(journal=remote)=>new Response(JSON.stringify({ok:true,journal,revision:journal.revision,automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:['publisher_unconfigured']}}),{status:200});
  const render=()=>{renderContent(app.html(state.view));for(const field of doc.querySelectorAll('input,select,textarea'))if(!field.initialized){field.value=field.tagName==='SELECT'?(field.querySelector('option[selected]')||field.querySelector('option'))?.getAttribute('value')||'':field.getAttribute('value')||'';field.initialized=true;}};
  const app=createDeskTools({document:doc,onChange:render,now:()=>at,uuid:()=>`interaction-edge-${++sequence}`,fetch:async(url,options)=>{
    requests.push({url,method:options.method});
    if(url.endsWith('/observe')){if(observation){const held=observation;observation=null;return held.promise;}return response();}
    if(options.method==='GET')return response();
    const body=JSON.parse(options.body);writes.push(body);remote=body.journal;if(commitResponse){const held=commitResponse;commitResponse=null;await held.promise;}return response();
  }});
  t.after(()=>{app.destroy();globalThis.FormData=oldFD;if(oldReplace)Element.prototype.replaceWith=oldReplace;else delete Element.prototype.replaceWith;if(oldRemove)Element.prototype.remove=oldRemove;else delete Element.prototype.remove;});
  await app.start();render();
  const query=selector=>doc.querySelector(selector),edit=(selector,value)=>{const field=query(selector);field.value=value;field.focus();field.dispatch({type:'input',target:field});return field;};
  const submit=async form=>{form.dispatch({type:'submit',target:form,preventDefault(){}});await settle();};
  const action=async name=>{const control=query(`[data-journal-action="${name}"]`);assert.ok(control,`Visible action ${name}`);control.dispatch({type:'click',target:control});await settle();};
  const syntheticSubmit=async(kind,type,values)=>{const form=query(`[data-${type}-form="${kind}"]`);assert.ok(form);form.syntheticValues=values;await submit(form);};
  return {app,doc,query,edit,submit,action,syntheticSubmit,writes,requests,remote:()=>remote,navigate(view){state.view=view;render();},holdObservation(){observation=deferred();return observation;},holdCommit(){commitResponse=deferred();return commitResponse;}};
}

for(const rejected of [false,true])test(`navigation away and back preserves ${rejected?'rejected':'unsubmitted'} settings`,{concurrency:false},async t=>{
  const h=await client(t),form=h.query('[data-journal-form="settings"]');form.closest('details').open=true;
  h.edit('#paper-notional','643');h.edit('#paper-commission',rejected?'invalid':'3');
  if(rejected){await h.submit(form);assert.match(h.query('#view-content').textContent,/Nothing saved: invalid decimal/);}
  h.navigate('prices');h.navigate('journal');
  assert.equal(h.writes.length,0,'Navigation and validation rejection must not save');
  assert.equal(h.query('#paper-notional').value,'643','Returning to the journal must not silently discard the user draft');
  assert.equal(h.query('#paper-commission').value,rejected?'invalid':'3');
  assert.equal(h.query('[data-journal-form="settings"]').closest('details').open,true);
});

for(const lateFailure of [false,true])test(`late ${lateFailure?'failed':'successful'} price read cannot replace a newer accepted import`,{concurrency:false},async t=>{
  const h=await client(t);h.navigate('prices');const first=deferred();
  await h.syntheticSubmit('import','price',{file:{size:1,text:()=>first.promise}});
  await h.syntheticSubmit('import','price',{file:{size:1,text:async()=>priceText('TSLA')}});
  if(lateFailure)first.reject(Error('Late synthetic file read failed'));else first.resolve(priceText('IBM'));
  await settle();
  assert.match(h.app.html('prices'),/TSLA/);assert.match(h.app.html('prices'),/value="TSLA" selected/);
  assert.doesNotMatch(h.app.html('prices'),/Late synthetic file read failed/);
  assert.match(h.app.html('prices'),/Imported 1 daily series/);assert.equal(h.writes.length,0);
});

test('stock-card selection supersedes an unfinished price import',{concurrency:false},async t=>{
  const h=await client(t);h.navigate('prices');const first=deferred();
  await h.syntheticSubmit('import','price',{file:{size:1,text:()=>first.promise}});
  assert.equal(h.app.selectPriceSymbol('NFLX'),true);first.resolve(priceText('IBM'));await settle();
  assert.match(h.app.html('prices'),/value="NFLX" selected/);assert.doesNotMatch(h.app.html('prices'),/Imported 1 daily series/);assert.equal(h.writes.length,0);
});

test('a second journal backup cannot replace an in-progress review and can be reviewed after cancellation',{concurrency:false},async t=>{
  const h=await client(t),original=h.remote();
  const firstJournal=await domain.appendSettings(original,{id:'backup-settings-first',at,settings:{...domain.DEFAULT_PAPER_SETTINGS,paperNotional:'701'}});assert.equal(firstJournal.ok,true);
  const secondJournal=await domain.appendSettings(firstJournal.journal,{id:'backup-settings-second',at,settings:{...domain.DEFAULT_PAPER_SETTINGS,paperNotional:'702'}});assert.equal(secondJournal.ok,true);
  const firstExport=await domain.exportJournal(firstJournal.journal),secondExport=await domain.exportJournal(secondJournal.journal),first=deferred();let secondReads=0;
  const secondFile={size:secondExport.text.length,text:async()=>{secondReads++;return secondExport.text;}};
  await h.syntheticSubmit('import','journal',{file:{size:firstExport.text.length,text:()=>first.promise}});
  await h.syntheticSubmit('import','journal',{file:secondFile});assert.equal(secondReads,0);assert.match(h.app.html('journal'),/operation is still in progress/);
  first.resolve(firstExport.text);await settle();assert.match(h.app.html('journal'),/1 new event\(s\)/);assert.equal(h.writes.length,0);
  await h.action('cancel-import');await h.syntheticSubmit('import','journal',{file:secondFile});assert.equal(secondReads,1);assert.match(h.app.html('journal'),/2 new event\(s\)/);assert.equal(h.writes.length,0);
});

test('sync requested during an automatic observation is visibly unavailable or performed after completion',{concurrency:false},async t=>{
  const h=await client(t),held=h.holdObservation(),getsBefore=h.requests.filter(item=>item.method==='GET').length;
  const observing=h.app.observe();await settle();assert.equal(h.app.status().busy,true);
  const control=h.query('[data-journal-action="sync"]'),disabled=control.getAttribute('aria-disabled')==='true';
  if(!disabled)await h.action('sync');
  held.resolve(new Response(JSON.stringify({ok:false,error:'journal_revision_conflict'}),{status:409}));await observing;await settle();
  assert.ok(disabled||h.requests.filter(item=>item.method==='GET').length>getsBefore,'An enabled sync action must not silently disappear while the observation becomes stale');
  assert.equal(h.writes.length,0);
});

for(const newerEdit of [false,true])test(`a save confirmed while away ${newerEdit?'preserves later typing':'retires the accepted form'}`,{concurrency:false},async t=>{
  const h=await client(t),form=h.query('[data-journal-form="settings"]'),held=h.holdCommit();
  h.edit('#paper-notional','811');await h.submit(form);assert.equal(h.app.status().busy,true);assert.equal(h.writes.length,1);
  if(newerEdit)h.edit('#paper-notional','912');h.navigate('prices');held.resolve();await settle();h.navigate('journal');
  assert.equal(h.app.status().storage.state,'synced');assert.equal(h.remote().revision,1);assert.equal(h.remote().events[0].data.settings.paperNotional,'811');
  assert.equal(h.query('#paper-notional').value,newerEdit?'912':'811');
  if(newerEdit)assert.equal(h.query('[data-journal-form="settings"]'),form);
  else assert.notEqual(h.query('[data-journal-form="settings"]'),form,'Detached accepted form must not resurrect as unsaved');
  assert.equal(h.writes.length,1,'Return navigation cannot repeat the save');
});
