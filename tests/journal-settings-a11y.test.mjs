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
async function client(t,{initialSettings=null}={}){
  const oldFD=globalThis.FormData,oldReplace=Element.prototype.replaceWith,oldRemove=Element.prototype.remove;
  globalThis.FormData=class{constructor(form){this.entries=new Map(form.querySelectorAll('input,select,textarea').map(field=>[field.getAttribute('name'),field.value]));}get(key){return this.entries.get(key)??null;}};
  Element.prototype.replaceWith=function(prior){const parent=this.parentElement,index=parent.children.indexOf(this);if(prior.parentElement)prior.parentElement.children.splice(prior.parentElement.children.indexOf(prior),1);parent.children[index]=prior;prior.parentElement=parent;this.parentElement=null;};
  Element.prototype.remove=function(){if(this.parentElement){const parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}};
  const doc=createDocument('<body><main id="main" tabindex="-1"><section id="view-content"></section></main></body>');doc.removeEventListener=(kind,fn)=>doc.listeners.set(kind,(doc.listeners.get(kind)||[]).filter(item=>item!==fn));
  const state={view:'journal'},renderContent=new Function('document','state',`let renderedView,renderedContentHTML,lastFocus;const disclosureState=new Map();const $=s=>document.querySelector(s);${renderer};return renderContent;`)(doc,state);
  new Function('document',eventWiring)(doc);
  let remote=domain.createJournal({journalId:'independent-forms',at}),sequence=0,outcome='accept';const writes=[];
  if(initialSettings)remote=(await domain.appendSettings(remote,{id:'synthetic-initial-settings',at,settings:initialSettings})).journal;
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
  return {app,doc,query,edit,submit,action,writes,navigate:view=>{state.view=view;renderContent(app.html(view));},remote:()=>remote,next:chosen=>{outcome=chosen;}};
}

test('settings validation associates errors, focuses first invalid field and retains abc / QQQ draft across navigation',{concurrency:false},async t=>{
 const h=await client(t),form=h.query('[data-journal-form="settings"]');
 h.edit('#paper-notional','abc');h.edit('#paper-benchmark','QQQ');await h.submit(form);
 const notional=h.query('#paper-notional');assert.equal(notional.getAttribute('aria-invalid'),'true');assert.equal(notional.getAttribute('aria-describedby'),'paper-notional-error');assert.equal(notional.getAttribute('aria-labelledby'),'paper-notional-label');assert.equal(h.query('#paper-notional-label').textContent,'Paper notional (USD)');
 assert.match(h.query('#paper-notional-error').textContent,/positive amount/);assert.equal(h.query('#paper-notional-error').getAttribute('hidden'),null);
 assert.equal(h.query('#paper-benchmark').getAttribute('aria-invalid'),null);assert.equal(h.doc.activeElement,notional);assert.equal(form.closest('details').open,true);
 assert.equal(h.writes.length,0);assert.equal(h.remote().revision,0);assert.equal(notional.value,'abc');
 h.navigate('prices');h.navigate('journal');assert.equal(h.query('[data-journal-form="settings"]'),form);assert.equal(h.query('#paper-notional').value,'abc');assert.equal(h.query('#paper-benchmark').value,'QQQ');assert.equal(h.query('#paper-notional').getAttribute('aria-describedby'),'paper-notional-error');
 h.edit('#paper-notional','250');assert.equal(notional.getAttribute('aria-invalid'),null);assert.equal(notional.getAttribute('aria-describedby'),null);assert.equal(h.query('#paper-notional-error').getAttribute('hidden'),'');
 await h.submit(form);assert.equal(h.writes.length,1);assert.equal(h.remote().events[0].data.settings.benchmarkSymbol,'QQQ');
});

test('all invalid settings fields receive independent descriptions; blank slippage cannot silently become zero',{concurrency:false},async t=>{
 const h=await client(t),form=h.query('[data-journal-form="settings"]');
 for(const [id,value] of [['paper-notional','0'],['paper-commission','-1'],['paper-slippage',''],['paper-benchmark','?']])h.edit('#'+id,value);
 await h.submit(form);
 for(const id of ['paper-notional','paper-commission','paper-slippage','paper-benchmark']){
  const field=h.query('#'+id);assert.equal(field.getAttribute('aria-invalid'),'true');assert.equal(field.getAttribute('aria-describedby'),id+'-error');assert.ok(h.query('#'+id+'-error').textContent.length>10);
 }
 assert.equal(h.writes.length,0);assert.equal(h.doc.activeElement,h.query('#paper-notional'));
});

test('notional/commission relationship revalidates both fields while editing',{concurrency:false},async t=>{
 const h=await client(t),form=h.query('[data-journal-form="settings"]');h.edit('#paper-notional','2');h.edit('#paper-commission','2');await h.submit(form);
 assert.equal(h.query('#paper-notional').getAttribute('aria-invalid'),'true');assert.equal(h.query('#paper-commission').getAttribute('aria-invalid'),'true');
 h.edit('#paper-commission','1');for(const id of ['paper-notional','paper-commission'])assert.equal(h.query('#'+id).getAttribute('aria-invalid'),null);
 await h.submit(form);assert.equal(h.writes.length,1);assert.equal(h.remote().revision,1);
});

test('field diagnostics use the domain decimal rules',async()=>{
 for(const field of ['paperNotional','commissionPerFill'])for(const value of ['1e2','01','1.0000001','1000000000000000']){
  const settings={...domain.DEFAULT_PAPER_SETTINGS,[field]:value},result=domain.validatePaperSettings(settings);assert.equal(result.ok,false);assert.ok(result.fieldErrors[field]);
 }
 assert.equal(domain.validatePaperSettings(domain.DEFAULT_PAPER_SETTINGS).ok,true);
});

test('a server save rejection is not mislabeled as a settings field error',{concurrency:false},async t=>{
 const h=await client(t),form=h.query('[data-journal-form="settings"]');h.edit('#paper-notional','200');h.next('reject');await h.submit(form);
 assert.equal(h.writes.length,1);assert.equal(h.app.status().storage.state,'unsaved');assert.match(h.query('#view-content').textContent,/save unavailable/);
 for(const field of form.querySelectorAll('input'))assert.equal(field.getAttribute('aria-invalid'),null);
});

test('field revalidation preserves the latest benchmark identity only while its symbol is unchanged',{concurrency:false},async t=>{
 const h=await client(t,{initialSettings:{...domain.DEFAULT_PAPER_SETTINGS,benchmarkEntityId:'synthetic-SPY'}});
 let form=h.query('[data-journal-form="settings"]');h.edit('#paper-notional','abc');await h.submit(form);h.edit('#paper-notional','200');await h.submit(form);
 assert.equal(h.remote().events.at(-1).data.settings.benchmarkEntityId,'synthetic-SPY');
 form=h.query('[data-journal-form="settings"]');h.edit('#paper-benchmark','qqq');await h.submit(form);
 assert.equal(h.remote().events.at(-1).data.settings.benchmarkSymbol,'QQQ');assert.equal(h.remote().events.at(-1).data.settings.benchmarkEntityId,null);
});
