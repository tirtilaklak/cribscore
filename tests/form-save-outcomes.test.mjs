// Independent user outcomes against shipped controller + renderer, synthetic I/O only.
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
async function client(t){
  const oldFD=globalThis.FormData,oldReplace=Element.prototype.replaceWith,oldRemove=Element.prototype.remove;
  globalThis.FormData=class{constructor(form){this.entries=new Map(form.querySelectorAll('input,select,textarea').map(field=>[field.getAttribute('name'),field.value]));}get(key){return this.entries.get(key)??null;}};
  Element.prototype.replaceWith=function(prior){const parent=this.parentElement,index=parent.children.indexOf(this);if(prior.parentElement)prior.parentElement.children.splice(prior.parentElement.children.indexOf(prior),1);parent.children[index]=prior;prior.parentElement=parent;this.parentElement=null;};
  Element.prototype.remove=function(){if(this.parentElement){const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}};
  const doc=createDocument('<body><main id="main" tabindex="-1"><section id="view-content"></section></main></body>');doc.removeEventListener=(kind,fn)=>doc.listeners.set(kind,(doc.listeners.get(kind)||[]).filter(item=>item!==fn));
  const state={view:'journal'},renderContent=new Function('document','state',`let renderedView,renderedContentHTML,lastFocus;const disclosureState=new Map();const $=s=>document.querySelector(s);${renderer};return renderContent;`)(doc,state);
  new Function('document',eventWiring)(doc);
  let remote=domain.createJournal({journalId:'independent-forms',at}),sequence=0,outcome='accept';const writes=[];
  const response=(journal=remote)=>new Response(JSON.stringify({ok:true,journal,revision:journal.revision,automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:['publisher_unconfigured']}}),{status:200});
  const render=()=>{renderContent(app.html('journal'));for(const field of doc.querySelectorAll('input,select,textarea'))if(!field.initialized){field.value=field.tagName==='SELECT'?(field.querySelector('option[selected]')||field.querySelector('option'))?.getAttribute('value')||'':field.getAttribute('value')||'';field.initialized=true;}};
  const app=createDeskTools({document:doc,onChange:render,now:()=>at,uuid:()=>`form-outcome-${++sequence}`,fetch:async(url,options)=>{
    if(url.endsWith('/observe')||options.method==='GET')return response();
    const body=JSON.parse(options.body),chosen=outcome;outcome='accept';writes.push(body);
    if(chosen==='reject')return new Response(JSON.stringify({ok:false,error:'synthetic_server_policy_rejection'}),{status:422});
    if(chosen==='stale-success')return response();
    remote=body.journal;if(chosen==='lost')throw Error('Synthetic response loss after durable save');return response();
  }});
  t.after(()=>{app.destroy();globalThis.FormData=oldFD;if(oldReplace)Element.prototype.replaceWith=oldReplace;else delete Element.prototype.replaceWith;if(oldRemove)Element.prototype.remove=oldRemove;else delete Element.prototype.remove;});
  await app.start();render();
  const query=selector=>doc.querySelector(selector),edit=(selector,value)=>{const field=query(selector);field.value=value;field.focus();field.dispatch({type:'input',target:field});return field;};
  const submit=async form=>{form.dispatch({type:'submit',target:form,preventDefault(){}});await settle();};
  const action=async name=>{const control=query(`[data-journal-action="${name}"]`);assert.ok(control,`Visible action ${name}`);control.dispatch({type:'click',target:control});await settle();};
  return {app,doc,query,edit,submit,action,writes,remote:()=>remote,next:chosen=>{outcome=chosen;}};
}

for(const outcome of ['reject','stale-success'])test(`${outcome}: an unaccepted save retains form values and blocks a blind retry`,{concurrency:false},async t=>{
  const h=await client(t),form=h.query('[data-journal-form="settings"]');form.closest('details').open=true;
  h.edit('#paper-notional','321');const last=h.edit('#paper-commission','2');h.next(outcome);await h.submit(form);
  assert.equal(h.app.status().storage.state,'unsaved');assert.match(h.query('#view-content').textContent,/save unavailable/i);assert.doesNotMatch(h.query('#view-content').textContent,/Paper assumptions saved/);
  assert.equal(h.remote().revision,0);assert.equal(h.writes.length,1);assert.equal(h.query('[data-journal-form="settings"]'),form);
  assert.equal(h.query('#paper-notional').value,'321');assert.equal(h.query('#paper-commission').value,'2');assert.equal(h.doc.activeElement,last);assert.equal(form.closest('details').open,true);
  await h.submit(form);assert.equal(h.writes.length,1,'Retry before reconciliation cannot emit another write');
});

test('reconciliation of an already-saved unchanged form retires its pending submission without another event',{concurrency:false},async t=>{
  const h=await client(t),form=h.query('[data-journal-form="settings"]');h.edit('#paper-notional','521');h.next('lost');await h.submit(form);
  assert.equal(h.remote().revision,1);assert.equal(h.app.status().storage.state,'unsaved');
  await h.action('sync');assert.match(h.query('#view-content').textContent,/Reconcile 0 unsynced event/);await h.action('confirm-import');
  assert.equal(h.app.status().storage.state,'synced');assert.equal(h.remote().revision,1);
  assert.notEqual(h.query('[data-journal-form="settings"]'),form,'A confirmed unchanged submission must stop being preserved as an unsaved form');
  assert.equal(h.query('#paper-notional').value,'521');
});

test('reconciliation preserves edits made after the submitted value, while confirming only the earlier saved event',{concurrency:false},async t=>{
  const h=await client(t),form=h.query('[data-journal-form="settings"]');h.edit('#paper-notional','521');h.next('lost');await h.submit(form);
  h.edit('#paper-notional','722');await h.action('sync');await h.action('confirm-import');
  assert.equal(h.app.status().storage.state,'synced');assert.equal(h.remote().revision,1);assert.equal(h.remote().events[0].data.settings.paperNotional,'521');
  assert.equal(h.query('[data-journal-form="settings"]'),form);assert.equal(h.query('#paper-notional').value,'722');
  await h.submit(form);assert.equal(h.remote().revision,2);assert.equal(h.remote().events[1].data.settings.paperNotional,'722');
});
