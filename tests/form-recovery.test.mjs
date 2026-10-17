import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import {createJournal,enrollPublication,recordActualConfirmation} from '../dist/lib/journal.js';
import {createDocument,Element} from './helpers/interaction-dom.mjs';

// Execute the shipped renderer, form-event wiring and controller against an
// offline DOM. Every journal response below is synthetic; no listener or API.
const appSource=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const renderSource=appSource.slice(appSource.indexOf('function disclosureKey('),appSource.indexOf('let rightsExpiryTimer;'));
const priceClick=appSource.slice(appSource.indexOf("  const price=event.target.closest('[data-price-symbol]');"),appSource.indexOf("  const nav=event.target.closest('[data-view],[data-go]');"));
const formEvents=appSource.slice(appSource.indexOf("for(const type of ['input','change'])"),appSource.indexOf("$('#workspace-date').textContent"));
const at='2026-10-17T18:00:00Z';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));};

async function harness(t,{view='journal',initial=null}={}){
  const originalFormData=globalThis.FormData,originalReplace=Element.prototype.replaceWith,originalRemove=Element.prototype.remove;
  Element.prototype.remove=function(){if(this.parentElement)this.parentElement.children.splice(this.parentElement.children.indexOf(this),1);this.parentElement=null;};
  Element.prototype.replaceWith=function(previous){
    const parent=this.parentElement,index=parent.children.indexOf(this),oldParent=previous.parentElement;
    if(oldParent)oldParent.children.splice(oldParent.children.indexOf(previous),1);
    parent.children[index]=previous;previous.parentElement=parent;this.parentElement=null;
  };
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
  t.after(async()=>{observationHold?.resolve();commitHold?.resolve();await flush();tools.destroy();globalThis.FormData=originalFormData;if(originalReplace)Element.prototype.replaceWith=originalReplace;else delete Element.prototype.replaceWith;if(originalRemove)Element.prototype.remove=originalRemove;else delete Element.prototype.remove;});
  await tools.start();render();
  const query=selector=>document.querySelector(selector);
  const edit=(selector,value)=>{const field=query(selector);field.value=value;field.focus();field.dispatch({type:'input',target:field});return field;};
  const submit=async form=>{form.dispatch({type:'submit',target:form,preventDefault(){}});await flush();};
  return {tools,state,document,query,edit,submit,requests,render,remote:()=>remote,
    selectPrice(symbol){shell.selectPrice({target:{closest:()=>({dataset:{priceSymbol:symbol}})}},tools,view=>{state.view=view;render();});},
    loseNextCommit(){loseNextCommit=true;},
    holdObservation(){return observationHold=deferred();},holdCommit(){return commitHold=deferred();}};
}

test('validation rejection preserves all entered values and focus for correction',{concurrency:false},async t=>{
  const h=await harness(t),form=h.query('[data-journal-form="settings"]');form.closest('details').open=true;
  h.edit('#paper-notional','333');const invalid=h.edit('#paper-commission','invalid');
  await h.submit(form);
  assert.match(h.query('#view-content').textContent,/Nothing saved/);
  assert.equal(h.requests.filter(request=>request.method==='POST'&&!request.url.endsWith('/observe')).length,0);
  assert.ok(h.query('[data-journal-form="settings"]')===form,'rejected submission must retain its live form');
  assert.equal(h.query('#paper-notional').value,'333');assert.equal(h.query('#paper-commission').value,'invalid');
  assert.ok(h.document.activeElement===invalid);assert.equal(form.closest('details').open,true);
  h.edit('#paper-commission','1');await h.submit(form);
  assert.match(h.query('#view-content').textContent,/Paper assumptions saved/);
  assert.ok(h.query('[data-journal-form="settings"]')!==form,'confirmed submission can use saved values');
  assert.equal(h.query('#paper-notional').value,'333');assert.equal(h.query('#paper-commission').value,'1');
});

test('submitting during an automatic update keeps the draft available to retry',{concurrency:false},async t=>{
  const h=await harness(t),hold=h.holdObservation();
  const observing=h.tools.observe();await flush();assert.equal(h.tools.status().busy,true);
  const form=h.query('[data-journal-form="settings"]');
  h.edit('#paper-notional','444');await h.submit(form);
  assert.match(h.query('#view-content').textContent,/operation is still in progress/);
  assert.ok(h.query('[data-journal-form="settings"]')===form);assert.equal(h.query('#paper-notional').value,'444');
  hold.resolve();await observing;
  assert.equal(h.query('#paper-notional').value,'444');
  await h.submit(form);assert.match(h.query('#view-content').textContent,/Paper assumptions saved/);
  assert.equal(h.query('#paper-notional').value,'444');
});

test('a successful save cannot discard newer typing while its request was pending',{concurrency:false},async t=>{
  const h=await harness(t),form=h.query('[data-journal-form="settings"]'),hold=h.holdCommit();
  h.edit('#paper-notional','555');await h.submit(form);assert.equal(h.tools.status().busy,true);
  h.edit('#paper-notional','666');hold.resolve();await flush();
  assert.equal(h.remote().events.at(-1).data.settings.paperNotional,'555');
  assert.ok(h.query('[data-journal-form="settings"]')===form);assert.equal(h.query('#paper-notional').value,'666');
  await h.submit(form);assert.equal(h.remote().events.at(-1).data.settings.paperNotional,'666');
});

test('failed price import preserves the selected file for retry',{concurrency:false},async t=>{
  const h=await harness(t,{view:'prices'}),form=h.query('[data-price-form="import"]'),field=h.query('#price-import-file');
  const file={size:1,text:async()=>'{'};field.file=file;field.dispatch({type:'change',target:field});
  await h.submit(form);assert.ok(h.query('[data-price-form="import"]')===form);assert.equal(h.query('#price-import-file').file,file);
  assert.match(h.query('#view-content').textContent,/import parse failed/);
});

for(const newerEdits of [false,true])test(`reconciled committed fill ${newerEdits?'preserves newer typing':'retires unchanged input without duplicate fill'}`,{concurrency:false},async t=>{
  const publishedAt='2026-10-17T16:00:00Z',payload={schema_version:'synthetic-review-v1',policy_version:'synthetic-review-policy',generated_at:publishedAt,horizon:{id:'next_day',entry_at:'2026-10-19T13:30:00Z',exit_at:'2026-10-19T20:00:00Z'},rows:[{ticker:'AAA',company:'Synthetic recovery fixture only'}]};
  const payloadBytes=JSON.stringify(payload),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payloadBytes));
  const publication={publicationId:'synthetic-recovery-publication',publishedAt,payloadBytes,payloadHash:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),policyVersion:payload.policy_version,snapshotVersion:payload.schema_version,horizonId:'next_day',entities:[{symbol:'AAA',entityId:'synthetic-AAA'}]};
  const enrolled=await enrollPublication(createJournal({journalId:'synthetic-form-recovery',at:publishedAt}),{id:'synthetic-enrollment',at,publication});
  assert.equal(enrolled.ok,true);const intent=enrolled.journal.events.find(e=>e.kind==='paper_intent');
  const confirmed=await recordActualConfirmation(enrolled.journal,{id:'synthetic-confirmation',at,intentId:intent.id,confirmed:true});assert.equal(confirmed.ok,true);
  const h=await harness(t,{initial:confirmed.journal}),form=h.query('[data-journal-form="save-fill"]');assert.ok(form);
  const settled=async()=>{for(let i=0;i<500&&h.tools.status().busy;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(h.tools.status().busy,false);};
  const editField=(name,value)=>{const field=form.querySelector(`[name="${name}"]`);field.value=value;field.dispatch({type:'input',target:field});};
  for(const [name,value] of Object.entries({side:'buy',occurredAt:'2026-10-17T17:00',quantity:'1',price:'100',fee:'0'}))editField(name,value);
  const hold=newerEdits?h.holdCommit():null;
  h.loseNextCommit();await h.submit(form);
  if(hold){assert.equal(h.tools.status().busy,true);editField('quantity','2');hold.resolve();}
  await settled();
  assert.equal(h.tools.status().storage.state,'unsaved');assert.equal(h.remote().events.filter(e=>e.kind==='actual_fill').length,1);
  const action=async name=>{const target=h.query(`[data-journal-action="${name}"]`);assert.ok(target);target.dispatch({type:'click',target});await settled();};
  await action('sync');assert.match(h.query('#view-content').textContent,/Reconcile 0 unsynced event/);
  await action('confirm-import');assert.equal(h.tools.status().storage.state,'synced');
  assert.equal(h.remote().events.filter(e=>e.kind==='actual_fill').length,1);
  const remaining=h.query('[data-journal-form="save-fill"]');
  if(newerEdits){
    assert.equal(remaining.querySelector('[name="quantity"]').value,'2','Unsubmitted newer typing must survive confirmed reconciliation');
    assert.equal(h.remote().events.filter(e=>e.kind==='actual_fill')[0].data.fill.quantity,'1');
    return;
  }
  if(remaining.querySelector('[name="quantity"]').value){
    await h.submit(remaining);await settled();
    assert.equal(h.remote().events.filter(e=>e.kind==='actual_fill').length,1,'Reconciled stale form was accepted as a second identical actual fill');
  }
  assert.equal(remaining.querySelector('[name="quantity"]').value,'','The unchanged already-committed fill should no longer be offered as a new fill');
});


for(const rejected of [false,true])test(`view navigation retains ${rejected?'rejected':'unsubmitted'} settings and disclosure`,{concurrency:false},async t=>{
  const h=await harness(t),form=h.query('[data-journal-form="settings"]');form.closest('details').open=true;
  h.edit('#paper-notional','643');h.edit('#paper-commission',rejected?'invalid':'3');
  if(rejected)await h.submit(form);
  h.state.view='prices';h.render();
  assert.equal(form.parentElement,null,'cached form must not retain its discarded view tree');
  h.state.view='journal';h.render();
  assert.equal(h.query('[data-journal-form="settings"]'),form);
  assert.equal(h.query('#paper-notional').value,'643');assert.equal(h.query('#paper-commission').value,rejected?'invalid':'3');
  assert.equal(form.closest('details').open,true);
  assert.equal(h.requests.filter(r=>r.method==='POST'&&!r.url.endsWith('/observe')).length,0);
});

test('navigation retains a selected price file separately from the journal backup form',{concurrency:false},async t=>{
  const h=await harness(t,{view:'prices'}),form=h.query('[data-price-form="import"]'),field=h.query('#price-import-file');
  form.closest('details').open=true;const file={size:1,text:async()=>'{'};field.file=file;field.dispatch({type:'change',target:field});
  await h.submit(form);h.state.view='journal';h.render();
  assert.notEqual(h.query('[data-journal-form="import"]'),form);
  h.state.view='prices';h.render();
  assert.equal(h.query('[data-price-form="import"]'),form);assert.equal(h.query('#price-import-file').file,file);assert.equal(form.closest('details').open,true);
});

for(const newerEdits of [false,true])test(`successful save while away ${newerEdits?'preserves newer edits':'retires its detached submitted form'}`,{concurrency:false},async t=>{
  const h=await harness(t),form=h.query('[data-journal-form="settings"]'),hold=h.holdCommit();
  h.edit('#paper-notional','811');await h.submit(form);assert.equal(h.tools.status().busy,true);
  if(newerEdits)h.edit('#paper-notional','912');
  h.state.view='prices';h.render();hold.resolve();
  for(let i=0;i<500&&h.tools.status().busy;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(h.tools.status().busy,false);
  assert.equal(h.remote().events.at(-1).data.settings.paperNotional,'811');
  h.state.view='journal';h.render();
  assert.equal(h.query('#paper-notional').value,newerEdits?'912':'811');
  assert.equal(h.query('[data-journal-form="settings"]')===form,newerEdits);
  h.state.view='prices';h.render();h.state.view='journal';h.render();
  assert.equal(h.query('#paper-notional').value,newerEdits?'912':'811');
});

test('automatic updates disable sync visibly until the request completes',{concurrency:false},async t=>{
  const h=await harness(t),hold=h.holdObservation(),observing=h.tools.observe();await flush();
  assert.equal(h.tools.status().busy,true);
  assert.notEqual(h.query('[data-journal-action="sync"]').getAttribute('disabled'),null);
  assert.equal(h.query('[data-journal-action="sync"]').textContent,'Working…');
  hold.resolve();await observing;
  assert.equal(h.query('[data-journal-action="sync"]').getAttribute('disabled'),null);
  assert.equal(h.query('[data-journal-action="sync"]').textContent,'Check journal sync');
});


test('an explicit stock selection replaces cached price selection but preserves the chosen import file',{concurrency:false},async t=>{
  const h=await harness(t,{view:'prices'}),fileForm=h.query('[data-price-form="import"]'),field=h.query('#price-import-file');
  const file={size:1,text:async()=>'{'};field.file=file;field.dispatch({type:'change',target:field});h.edit('#price-symbol','TSLA');
  h.state.view='research';h.render();h.selectPrice('NFLX');
  assert.equal(h.state.view,'prices');assert.equal(h.query('#price-symbol').value,'NFLX');
  assert.equal(h.query('[data-price-form="import"]'),fileForm);assert.equal(h.query('#price-import-file').file,file);
});
