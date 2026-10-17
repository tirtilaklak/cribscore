import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import {createJournal,enrollPublication,recordActualConfirmation,recordActualFill,validateJournal} from '../dist/lib/journal.js';
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


async function validFixture({intentIds=['journal:intent','journal:intent:part'],fillIds=['part:fill','fill']}={}){
  const publishedAt='2026-10-17T16:00:00Z';
  const payload={schema_version:'synthetic-form-identity-v1',policy_version:'synthetic-form-identity-policy',generated_at:publishedAt,horizon:{id:'next_day',entry_at:'2026-10-19T13:30:00Z',exit_at:'2026-10-19T20:00:00Z'},rows:[{ticker:'AAA',company:'Synthetic A'},{ticker:'BBB',company:'Synthetic B'}]};
  const payloadBytes=JSON.stringify(payload),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payloadBytes));
  const publication={publicationId:'synthetic-form-identity-publication',publishedAt,payloadBytes,payloadHash:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),policyVersion:payload.policy_version,snapshotVersion:payload.schema_version,horizonId:'next_day',entities:[{symbol:'AAA',entityId:'synthetic-AAA'},{symbol:'BBB',entityId:'synthetic-BBB'}]};
  const enrolled=await enrollPublication(createJournal({journalId:'synthetic-form-identity',at:publishedAt}),{id:'synthetic-enrollment',at,publication});
  assert.equal(enrolled.ok,true,JSON.stringify(enrolled.errors));
  // Both IDs are permitted by the unchanged domain schema. The two pairs
  // intentionally differ but collide when concatenated with a colon.
  const journal=structuredClone(enrolled.journal),intents=journal.events.filter(e=>e.kind==='paper_intent');
  assert.equal(intents.length,2);intents[0].id=intentIds[0];intents[1].id=intentIds[1];
  let checked=await validateJournal(journal);assert.equal(checked.ok,true,JSON.stringify(checked.errors));
  for(const [i,fillId] of fillIds.entries()){
    checked=await recordActualConfirmation(checked.journal,{id:`synthetic-confirm-${i}`,at,intentId:intents[i].id,confirmed:true});assert.equal(checked.ok,true,JSON.stringify(checked.errors));
    checked=await recordActualFill(checked.journal,{id:fillId,at,intentId:intents[i].id,side:'buy',occurredAt:'2026-10-17T17:00:00Z',quantity:'1',price:'100',fee:'0'});assert.equal(checked.ok,true,JSON.stringify(checked.errors));
  }
  checked=await recordActualFill(checked.journal,{id:'new',at,intentId:intents[0].id,side:'buy',occurredAt:'2026-10-17T17:00:00Z',quantity:'1',price:'100',fee:'0'});assert.equal(checked.ok,true,JSON.stringify(checked.errors));
  checked=await validateJournal(checked.journal);assert.equal(checked.ok,true,JSON.stringify(checked.errors));
  return checked.journal;
}
const formFor=(h,fillId)=>h.query(`[data-journal-form="revise-fill"][data-journal-fill-id="${fillId}"]`);
const change=(form,name,value)=>{const field=form.querySelector(`[name="${name}"]`);field.value=value;field.dispatch({type:'input',target:field});return field;};

test('distinct valid correction forms retain simultaneous drafts across navigation',{concurrency:false},async t=>{
  const h=await harness(t,{initial:await validFixture()});
  const first=formFor(h,'part:fill'),second=formFor(h,'fill');assert.ok(first);assert.ok(second);assert.ok(first!==second);
  change(first,'quantity','11');change(first,'reason','First synthetic correction');
  change(second,'quantity','22');change(second,'reason','Second synthetic correction');
  const beforeWrites=h.requests.filter(r=>r.method==='POST'&&!r.url.endsWith('/observe')).length;
  h.state.view='prices';h.render();h.state.view='journal';h.render();
  assert.ok(formFor(h,'part:fill')===first,'First correction draft must not be dropped by a different valid form identity');
  assert.ok(formFor(h,'fill')===second);assert.equal(first.querySelector('[name="quantity"]').value,'11');assert.equal(second.querySelector('[name="quantity"]').value,'22');
  assert.equal(first.querySelector('[name="reason"]').value,'First synthetic correction');assert.equal(second.querySelector('[name="reason"]').value,'Second synthetic correction');
  assert.equal(h.requests.filter(r=>r.method==='POST'&&!r.url.endsWith('/observe')).length,beforeWrites);
});

test('distinct valid correction controls have unique IDs and labels resolve within their own form',{concurrency:false},async t=>{
  const h=await harness(t,{initial:await validFixture()});
  const forms=[formFor(h,'part:fill'),formFor(h,'fill')];
  const controls=forms.flatMap(form=>form.querySelectorAll('input,select,textarea').filter(control=>control.id));
  assert.equal(new Set(controls.map(control=>control.id)).size,controls.length,'Every correction field must have a unique DOM ID');
  for(const form of forms)for(const label of form.querySelectorAll('label')){
    const target=label.getAttribute('for');assert.ok(target);
    const matches=h.document.querySelectorAll('input,select,textarea').filter(control=>control.id===target);
    assert.equal(matches.length,1);assert.ok(matches[0].closest('[data-journal-form]')===form);
  }
});


test('a valid fill ID named new does not share controls with Add actual fill',{concurrency:false},async t=>{
  const h=await harness(t,{initial:await validFixture()});
  const addition=h.query('[data-journal-form="save-fill"][data-journal-id="journal:intent"]'),correction=formFor(h,'new');
  assert.ok(addition);assert.ok(correction);assert.ok(addition!==correction);
  const controls=[addition,correction].flatMap(form=>form.querySelectorAll('input,select,textarea').filter(control=>control.id));
  assert.equal(new Set(controls.map(control=>control.id)).size,controls.length,'An existing fill called new must not collide with a new-fill form');
  for(const form of [addition,correction])for(const label of form.querySelectorAll('label')){
    const target=label.getAttribute('for'),matches=h.document.querySelectorAll('input,select,textarea').filter(control=>control.id===target);
    assert.equal(matches.length,1);assert.ok(matches[0].closest('[data-journal-form]')===form);
  }
});


test('valid disclosure identities retain independent open state through an automatic render',{concurrency:false},async t=>{
  const initial=await validFixture({intentIds:['journal:fill:part','journal'],fillIds:['tail','part:fill:tail']});
  const h=await harness(t,{initial});
  const first=formFor(h,'tail').closest('details'),second=formFor(h,'part:fill:tail').closest('details');
  first.open=true;second.open=false;
  const keys=[...h.document.querySelectorAll('details')].map(detail=>detail.dataset.stateKey).filter(Boolean);
  assert.equal(new Set(keys).size,keys.length,'Each journal disclosure needs an unambiguous identity');
  await h.tools.observe();
  assert.deepEqual([formFor(h,'tail').closest('details').open,formFor(h,'part:fill:tail').closest('details').open],[true,false]);
  h.state.view='prices';h.render();h.state.view='journal';h.render();
  assert.deepEqual([formFor(h,'tail').closest('details').open,formFor(h,'part:fill:tail').closest('details').open],[true,false]);
  assert.equal(h.requests.filter(r=>r.method==='POST'&&!r.url.endsWith('/observe')).length,0);
});
