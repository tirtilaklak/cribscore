// Outcome line placement through the real desk controller: each owner action is pressed or submitted
// on the rendered page in the offline DOM, and the line must then stand right after that control.
// Background work keeps the line at the top. Synthetic journals, files and responses only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import * as J from '../dist/lib/journal.js';
import {createDocument,Element} from './helpers/interaction-dom.mjs';

const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const elements=node=>node.children.filter(child=>typeof child!=='string');
const classes=node=>(node.attrs.class||'').split(/\s+/).filter(Boolean);
const hasClass=(node,name)=>classes(node).includes(name);
const plain=node=>typeof node==='string'?node:node.children.map(plain).join('');
const paths=(node,predicate,trail=[])=>typeof node==='string'?[]:[...(predicate(node)?[[...trail,node]]:[]),...node.children.flatMap(child=>paths(child,predicate,[...trail,node]))];
function lineOf(html){
  const found=paths(parse(html),node=>hasClass(node,'desk-feedback'));
  assert.equal(found.length,1,'exactly one outcome line on the page');
  const path=found[0],line=path.at(-1),parent=path.at(-2),siblings=elements(parent),index=siblings.indexOf(line);
  return {line,parent,previous:siblings[index-1]||null,next:siblings[index+1]||null,ancestors:path.slice(0,-1)};
}
const noLine=html=>assert.equal(paths(parse(html),node=>hasClass(node,'desk-feedback')).length,0,'no outcome line');
// An inline line: right class pair, no tabindex or role, never inside a form.
function inline(found){
  assert.deepEqual(classes(found.line),['desk-feedback','desk-feedback-inline']);
  for(const attribute of ['tabindex','role','aria-live'])assert.equal(found.line.attrs[attribute],undefined,`no ${attribute}`);
  assert.ok(!found.ancestors.some(node=>node.tag==='form'),'never inside a form');
  return found;
}
function top(found){assert.deepEqual(classes(found.line),['desk-feedback']);assert.equal(found.line.attrs.tabindex,'0');return found;}
const isForm=(kind,id,fill)=>node=>node?.tag==='form'&&(node.attrs['data-journal-form']===kind||node.attrs['data-price-form']===kind)&&(id===undefined||node.attrs['data-journal-id']===id)&&(fill===undefined||node.attrs['data-journal-fill-id']===fill);
const holds=predicate=>node=>!!node&&paths(node,predicate).length>0;

const at='2026-10-17T18:00:00Z';
const reply=(body,status=200)=>({ok:status===200,status,json:async()=>body});
// The offline DOM has no FormData; read the rendered fields like the form harnesses do.
globalThis.FormData=class{constructor(form){this.values=new Map(form.querySelectorAll('input,select,textarea').map(field=>[field.getAttribute('name'),field.getAttribute('type')==='file'?field.file:field.value]));}get(name){return this.values.get(name)??null;}};
// Wait on the clock. Journal checks hash on the thread pool, so on a busy machine they can outlast
// any fixed number of event-loop turns. Idle means not busy for 12 timer ticks in a row.
async function settle(app){const deadline=Date.now()+15000;let idle=0;while(idle<12&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1));idle=app.status().busy?0:idle+1;}assert.equal(app.status().busy,false);}
async function until(check,what){const deadline=Date.now()+15000;while(!check()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(check(),what);}

async function desk(t,{view='journal',remote=null,geometry=null}={}){
  const document=createDocument('<body><main id="main" tabindex="-1"><section id="view-content"></section></main></body>');
  document.removeEventListener=(type,fn)=>{document.listeners.set(type,(document.listeners.get(type)||[]).filter(item=>item!==fn));};
  document.createElement=()=>({click(){},remove(){}});document.body.append=()=>{};
  if(geometry)document.defaultView=geometry.window;
  const content=document.querySelector('#view-content'),io={current:remote,commit:'ok',observe:'ok'};let uid=0;
  const app=createDeskTools({document,now:()=>at,uuid:()=>`synthetic-${++uid}`,onChange:()=>render(),fetch:async(url,options={})=>{
    if(url.endsWith('/observe')){
      if(io.observe==='fail')return reply({ok:false,error:'synthetic_unavailable'},503);
      if(io.observe==='conflict')return reply({ok:false,error:'revision_conflict'},409);
      return reply({ok:true,journal:io.current,revision:io.current.revision,automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:['publisher_unconfigured']}});
    }
    if(url==='/api/journal'){
      if(options.method!=='POST')return reply({ok:true,journal:io.current,revision:io.current?.revision??0});
      if(io.commit==='fail')return reply({ok:false,error:'synthetic_save_unavailable'},503);
      io.current=JSON.parse(options.body).journal;return reply({ok:true,journal:io.current,revision:io.current.revision});
    }
    return reply({ok:false,error:'synthetic_unavailable'},503);
  }});
  // Render like app.js: the view's HTML, then mount. Fields start from their rendered values.
  function render(){
    const markup=app.html(view);geometry?.beforeSwap?.();content.innerHTML=markup;
    for(const field of content.querySelectorAll('input,select,textarea'))field.value=field.tagName==='SELECT'?(field.querySelector('option[selected]')||field.querySelector('option'))?.getAttribute('value')||'':field.getAttribute('value')||'';
    if(geometry)app.mount(view);
  }
  t.after(async()=>{await settle(app);app.destroy();});
  await app.start();await settle(app);render();
  const query=selector=>content.querySelector(selector);
  return {app,io,query,
    html:()=>app.html(view),
    async press(element){assert.ok(element,'the control is on the page');element.dispatch({type:'click',target:element});await settle(app);},
    async submit(form){assert.ok(form,'the form is on the page');form.dispatch({type:'submit',target:form,preventDefault(){}});await settle(app);},
    set(selector,value,root=content){const field=root.querySelector(selector);assert.ok(field,selector);field.value=value;},
    file(selector,text){const field=query(selector);assert.ok(field,selector);field.file={size:text.length,text:async()=>text};}};
}
const syntheticBackup=async()=>{
  const recorded=await J.recordAbstention(J.createJournal({journalId:'synthetic-feedback-backup',at}),{id:'synthetic-backup-abstention',at,date:'2026-10-17',horizonId:'next_day',unrankedCount:6,reason:'Synthetic backup fixture.',snapshot:{id:'synthetic-snapshot',reviewedAt:'2026-10-17T02:40:00Z',sourceCutoffAt:null}});
  return (await J.exportJournal(recorded.journal)).text;
};
async function paperJournal({confirm=true,fill=false}={}){
  const publishedAt='2026-10-17T16:00:00Z',payload={schema_version:'synthetic-review-v1',policy_version:'synthetic-review-policy',generated_at:publishedAt,horizon:{id:'next_day',entry_at:'2026-10-19T13:30:00Z',exit_at:'2026-10-19T20:00:00Z'},rows:[{ticker:'AAA',company:'Synthetic feedback fixture only'}]};
  const payloadBytes=JSON.stringify(payload),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payloadBytes));
  const publication={publicationId:'synthetic-feedback-publication',publishedAt,payloadBytes,payloadHash:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),policyVersion:payload.policy_version,snapshotVersion:payload.schema_version,horizonId:'next_day',entities:[{symbol:'AAA',entityId:'synthetic-AAA'}]};
  let journal=(await J.enrollPublication(J.createJournal({journalId:'synthetic-feedback-paper',at:publishedAt}),{id:'synthetic-enrollment',at,publication})).journal;
  const intentId=journal.events.find(event=>event.kind==='paper_intent').id;
  if(confirm)journal=(await J.recordActualConfirmation(journal,{id:'synthetic-confirmation',at,intentId,confirmed:true})).journal;
  if(fill)journal=(await J.recordActualFill(journal,{id:'synthetic-fill',at,intentId,side:'buy',occurredAt:'2026-10-17T17:00:00Z',quantity:'1',price:'100',fee:'0',currency:'USD'})).journal;
  return {journal,intentId};
}
const started=id=>J.createJournal({journalId:id,at});

test('Start: the result stands where the setup card stood; a failed start shows right under the setup card',{concurrency:false},async t=>{
  const h=await desk(t);
  await h.press(h.query('[data-journal-action="start"]'));
  let found=inline(lineOf(h.html()));
  assert.equal(plain(found.line),'Automatic journaling is enabled. Assessments update while the app is open.');
  assert.ok(hasClass(found.parent,'journal-desk'));assert.equal(found.previous,null);assert.ok(hasClass(found.next,'journal-overview'));
  const failed=await desk(t);failed.io.commit='fail';
  await failed.press(failed.query('[data-journal-action="start"]'));
  const html=failed.html();
  assert.ok(hasClass(elements(parse(html))[0],'journal-setup'),'the setup card stays after a failed start');
  found=inline(lineOf(html));
  assert.match(plain(found.line),/^Journal save unavailable: /);
  assert.ok(hasClass(found.parent,'journal-desk'));assert.equal(found.previous,null);assert.ok(hasClass(found.next,'journal-storage'));
});

test('settings: a refused save before start and a rejected or saved change show under the settings form',{concurrency:false},async t=>{
  const fresh=await desk(t);
  await fresh.submit(fresh.query('[data-journal-form="settings"]'));
  let found=inline(lineOf(fresh.html()));
  assert.equal(plain(found.line),'Start automatic journaling or restore a backup before changing assumptions.');assert.ok(isForm('settings')(found.previous));
  const h=await desk(t,{remote:started('synthetic-feedback-settings')});
  h.set('#paper-notional','abc');await h.submit(h.query('[data-journal-form="settings"]'));
  found=inline(lineOf(h.html()));
  assert.match(plain(found.line),/^Nothing saved: .+\. Check the highlighted paper assumptions\.$/);assert.ok(isForm('settings')(found.previous));
  h.set('#paper-notional','300');await h.submit(h.query('[data-journal-form="settings"]'));
  found=inline(lineOf(h.html()));
  assert.equal(plain(found.line),'Paper assumptions saved for future intents. Existing decisions retain their original settings.');assert.ok(isForm('settings')(found.previous));
  // An automatic assessment that succeeds leaves the owner's line where it is.
  await h.app.observe();await settle(h.app);
  assert.ok(isForm('settings')(inline(lineOf(h.html())).previous));
});

test('backup review: a rejected file, a cancelled review and an applied backup all report under the review form',{concurrency:false},async t=>{
  const h=await desk(t),backup=await syntheticBackup();
  h.file('#journal-import-file','{"not":"a journal backup"}');await h.submit(h.query('[data-journal-form="import"]'));
  let found=inline(lineOf(h.html()));
  assert.match(plain(found.line),/^Backup cannot be applied: /);assert.ok(isForm('import')(found.previous));
  h.file('#journal-import-file',backup);await h.submit(h.query('[data-journal-form="import"]'));
  noLine(h.html());assert.match(h.html(),/<h3>Backup ready for review<\/h3>/);
  await h.press(h.query('[data-journal-action="cancel-import"]'));
  found=inline(lineOf(h.html()));
  assert.equal(plain(found.line),'Backup review cancelled.');assert.ok(isForm('import')(found.previous),'where the review stood');assert.equal(found.next,null);
  h.file('#journal-import-file',backup);await h.submit(h.query('[data-journal-form="import"]'));
  await h.press(h.query('[data-journal-action="confirm-import"]'));
  found=inline(lineOf(h.html()));
  assert.equal(plain(found.line),'Reviewed backup saved. Existing records and original decision context remain intact.');assert.ok(isForm('import')(found.previous));
});

test('export: the result shows under the export button row',{concurrency:false},async t=>{
  const h=await desk(t,{remote:started('synthetic-feedback-export')});
  await h.press(h.query('[data-journal-action="export"]'));
  // Export runs outside the busy flag, so wait for its own result.
  await until(()=>h.html().includes('Journal backup exported'),'the export reports its result');
  const found=inline(lineOf(h.html()));
  assert.equal(plain(found.line),'Journal backup exported with its original events and revision history.');
  assert.ok(hasClass(found.previous,'desk-actions'));assert.ok(holds(node=>node.attrs['data-journal-action']==='export')(found.previous));
});

test('sync: its own refusal shows at the sync button; a sync that succeeds clears the line',{concurrency:false},async t=>{
  const remote=started('synthetic-feedback-sync'),h=await desk(t,{remote});
  h.file('#journal-import-file',(await J.exportJournal(remote)).text);await h.submit(h.query('[data-journal-form="import"]'));
  await h.press(h.query('#journal-sync'));
  let found=inline(lineOf(h.html()));
  assert.equal(plain(found.line),'Apply or cancel the reviewed backup before checking sync again.');
  assert.ok(hasClass(found.previous,'journal-storage'));assert.ok(holds(node=>node.attrs.id==='journal-sync')(found.previous));assert.ok(hasClass(found.parent,'journal-overview'));
  await h.press(h.query('[data-journal-action="cancel-import"]'));
  await h.press(h.query('#journal-sync'));noLine(h.html());
  // Before start the sync button sits in the setup card, right above the journal desk.
  const fresh=await desk(t);
  fresh.file('#journal-import-file',await syntheticBackup());await fresh.submit(fresh.query('[data-journal-form="import"]'));
  await fresh.press(fresh.query('#journal-sync'));
  found=inline(lineOf(fresh.html()));
  assert.equal(plain(found.line),'Apply or cancel the reviewed backup before checking sync again.');
  assert.ok(hasClass(found.parent,'journal-desk'));assert.equal(found.previous,null);assert.ok(hasClass(found.next,'journal-storage'));
});

test('fills: a rejected new fill or correction shows under its own form; Record a real trade stands where its prompt stood',{concurrency:false},async t=>{
  const {journal,intentId}=await paperJournal({fill:true}),h=await desk(t,{remote:journal});
  const save=h.query(`[data-journal-form="save-fill"][data-journal-id="${intentId}"]`);assert.ok(save);
  for(const [name,value] of Object.entries({side:'buy',occurredAt:'2026-10-17T17:00',quantity:'abc',price:'100',fee:'0'}))h.set(`[name="${name}"]`,value,save);
  await h.submit(save);
  let found=inline(lineOf(h.html()));
  assert.match(plain(found.line),/^Nothing saved: .+\. Check the highlighted fill details\.$/);assert.ok(isForm('save-fill',intentId)(found.previous));
  const revise=h.query('[data-journal-form="revise-fill"]');assert.ok(revise);
  for(const [name,value] of Object.entries({side:'buy',occurredAt:'2026-10-17T17:00',quantity:'1',price:'100',fee:'0',reason:'   '}))h.set(`[name="${name}"]`,value,revise);
  await h.submit(revise);
  found=inline(lineOf(h.html()));
  assert.match(plain(found.line),/^Nothing saved: /);assert.ok(isForm('revise-fill',intentId,'synthetic-fill')(found.previous));
  const paper=await paperJournal({confirm:false}),c=await desk(t,{remote:paper.journal});
  await c.press(c.query(`[data-journal-action="confirm-actual"][data-journal-id="${paper.intentId}"]`));
  found=inline(lineOf(c.html()));
  assert.equal(plain(found.line),'Your actual-trade confirmation was saved. Fill quantities and prices remain unknown until you supply them.');
  assert.equal(found.parent.attrs['data-journal-entry'],paper.intentId);assert.ok(hasClass(found.next,'journal-actual'),'where the prompt stood, above the new section');
  assert.doesNotMatch(c.html(),/data-journal-action="confirm-actual"/);
});

test('background messages stay at the top and replace an owner line',{concurrency:false},async t=>{
  const reject=async h=>{h.set('#paper-notional','abc');await h.submit(h.query('[data-journal-form="settings"]'));assert.ok(isForm('settings')(inline(lineOf(h.html())).previous));};
  const atTop=(h,text)=>{const found=top(lineOf(h.html()));assert.equal(plain(found.line),text);assert.ok(hasClass(found.previous,'journal-overview'));};
  // Automatic assessment that fails.
  const failing=await desk(t,{remote:started('synthetic-feedback-assess')});await reject(failing);
  failing.io.observe='fail';await failing.app.observe();await settle(failing.app);
  atTop(failing,'Automatic journal update unavailable. No publication, fill or price is assumed.');
  // Automatic assessment that meets a newer revision.
  const conflict=await desk(t,{remote:started('synthetic-feedback-conflict')});await reject(conflict);
  conflict.io.observe='conflict';await conflict.app.observe();await settle(conflict.app);
  atTop(conflict,'The automatic update encountered a newer saved revision. No local history was replaced.');
  // A save that was not confirmed is the owner's own result; the reconcile review that follows is background.
  const reconcile=await desk(t,{remote:started('synthetic-feedback-reconcile')});reconcile.io.commit='fail';
  reconcile.set('#paper-notional','300');await reconcile.submit(reconcile.query('[data-journal-form="settings"]'));
  let found=inline(lineOf(reconcile.html()));assert.match(plain(found.line),/^Journal save unavailable: /);assert.ok(isForm('settings')(found.previous));
  reconcile.io.commit='ok';await reconcile.press(reconcile.query('#journal-sync'));
  atTop(reconcile,'Review the reconciliation before applying it.');
  // Saved history that changed elsewhere.
  const history=await desk(t,{remote:started('synthetic-feedback-history')});await reject(history);
  history.io.current=started('synthetic-feedback-other-history');await history.press(history.query('#journal-sync'));
  atTop(history,'Saved history changed unexpectedly. No local history was replaced.');
  // The first load and an assessment that succeeds write no line.
  noLine((await desk(t,{remote:started('synthetic-feedback-quiet')})).html());
});

test('Prices: import, picker and chart results show at their controls; a successful change clears the line',{concurrency:false},async t=>{
  const h=await desk(t,{view:'prices'}),raw=await readFile(new URL('../docs/examples/synthetic-price-import.json',import.meta.url),'utf8');
  h.file('#price-import-file','{');await h.submit(h.query('[data-price-form="import"]'));
  let found=inline(lineOf(h.html()));
  assert.match(plain(found.line),/import parse failed/);assert.ok(isForm('import')(found.previous));assert.equal(found.parent.attrs['data-state-key'],'prices:import');
  h.file('#price-import-file',raw);await h.submit(h.query('[data-price-form="import"]'));
  found=inline(lineOf(h.html()));
  assert.equal(plain(found.line),'Imported 1 daily series for chart context. These values are unreviewed and cannot supply paper marks.');assert.ok(isForm('import')(found.previous));
  h.set('#price-symbol','IBM');await h.submit(h.query('[data-price-form="selection"]'));
  noLine(h.html());
  h.set('#price-symbol','NOT-A-COMPANY');await h.submit(h.query('[data-price-form="selection"]'));
  found=inline(lineOf(h.html()));
  assert.equal(plain(found.line),'Choose an available company.');assert.ok(isForm('selection')(found.previous));assert.ok(hasClass(found.parent,'desk-controls'));
  await h.press(h.query('[data-price-action="load-hosted"]'));
  found=inline(lineOf(h.html()));
  assert.match(plain(found.line),/^Chart requested\. If it stays blank, open the chart at TradingView using the link below\./);
  assert.equal(found.next.attrs.id,'hosted-price-chart','where the load button stood, just above the box the chart fills');
  await h.press(h.query('[data-price-action="check-setup"]'));noLine(h.html());
  await h.press(h.query('[data-price-action="load-hosted"]'));
  assert.equal(h.app.selectPriceSymbol('TSLA'),true);noLine(h.html());
});

test('a refusal of a form shows under that form',{concurrency:false},async t=>{
  const remote=started('synthetic-feedback-refusal'),h=await desk(t,{remote});
  h.file('#journal-import-file',(await J.exportJournal(remote)).text);await h.submit(h.query('[data-journal-form="import"]'));
  await h.submit(h.query('[data-journal-form="settings"]'));
  const found=inline(lineOf(h.html()));
  assert.equal(plain(found.line),'Apply or cancel the reviewed backup before making another journal change.');assert.ok(isForm('settings')(found.previous));
});

// ---- The app's own render path: disclosures, dirty forms and focus as app.js keeps them ----
// renderContent is sliced from app.js as the form tests slice it. render() below then mounts and applies
// app.js's focus fallback (focus that sat in a replaced view goes to that view's fallback target).
const appSource=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const renderSource=appSource.slice(appSource.indexOf('function disclosureKey('),appSource.indexOf('let rightsExpiryTimer;'));
// renderContent moves dirty forms with remove() and replaceWith(), which the offline DOM lacks, and mount()
// puts the chart frame in with replaceChildren(frame), whose offline version only empties the box. These
// follow the DOM: replaceChildren(...nodes) empties the element, then appends the nodes.
Element.prototype.remove??=function(){if(this.parentElement)this.parentElement.children.splice(this.parentElement.children.indexOf(this),1);this.parentElement=null;};
Element.prototype.replaceWith??=function(previous){const parent=this.parentElement,index=parent.children.indexOf(this),oldParent=previous.parentElement;if(oldParent)oldParent.children.splice(oldParent.children.indexOf(previous),1);parent.children[index]=previous;previous.parentElement=parent;this.parentElement=null;};
const emptyChildren=Element.prototype.replaceChildren;
Element.prototype.replaceChildren=function(...nodes){emptyChildren.call(this);for(const node of nodes)this.append(node);};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function appDesk(t,{view='journal',remote=null,layout=null}={}){
  const document=createDocument('<body><main id="main" tabindex="-1"><section id="view-content"></section></main></body>');
  document.removeEventListener=(type,fn)=>{document.listeners.set(type,(document.listeners.get(type)||[]).filter(item=>item!==fn));};
  document.createElement=tag=>tag==='iframe'?Object.assign(new Element('iframe',document),{style:{}}):({click(){},remove(){}});document.body.append=()=>{};
  if(layout){document.defaultView=layout.window;document.documentElement={};}
  const renderContent=new Function('document','state',`let renderedView,renderedContentHTML,lastFocus;const disclosureState=new Map();const $=s=>document.querySelector(s);${renderSource};return renderContent;`)(document,{view});
  const content=document.querySelector('#view-content'),io={current:remote,commit:'ok',hold:null};let uid=0;
  const app=createDeskTools({document,now:()=>at,uuid:()=>`synthetic-${++uid}`,onChange:()=>render(),fetch:async(url,options={})=>{
    if(url.endsWith('/observe'))return reply({ok:true,journal:io.current,revision:io.current.revision,automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:['publisher_unconfigured']}});
    if(url==='/api/journal'){
      if(options.method!=='POST')return reply({ok:true,journal:io.current,revision:io.current?.revision??0});
      if(io.hold)await io.hold.promise;
      if(io.commit==='fail')return reply({ok:false,error:'synthetic_save_unavailable'},503);
      io.current=JSON.parse(options.body).journal;return reply({ok:true,journal:io.current,revision:io.current.revision});
    }
    return reply({ok:false,error:'synthetic_unavailable'},503);
  }});
  function render(){
    const hadFocus=content.contains(document.activeElement),markup=app.html(view);
    layout?.beforeSwap?.();renderContent(markup);
    for(const field of content.querySelectorAll('input,select,textarea'))if(!field.initialized){field.value=field.tagName==='SELECT'?(field.querySelector('option[selected]')||field.querySelector('option'))?.getAttribute('value')||'':field.getAttribute('value')||'';field.initialized=true;}
    app.mount(view);
    const active=document.activeElement;
    if(hadFocus&&(!active||active.tagName==='BODY'||active.id==='main'||!active.isConnected))content.querySelector('[data-focus-fallback]')?.focus();
  }
  t.after(async()=>{io.hold?.resolve();await settle(app);app.destroy();});
  await app.start();await settle(app);render();
  const query=selector=>content.querySelector(selector);
  return {app,io,query,content,document,html:()=>app.html(view),
    async press(element){assert.ok(element,'the control is on the page');element.focus();element.dispatch({type:'click',target:element});await settle(app);},
    async submit(form){assert.ok(form,'the form is on the page');form.querySelector('button[type="submit"]')?.focus();form.dispatch({type:'submit',target:form,preventDefault(){}});await settle(app);},
    file(selector,text){const field=query(selector);assert.ok(field,selector);field.file={size:text.length,text:async()=>text};}};
}
// A scroll-aware layout for the offline DOM. Each role has a document top; the window scrolls and clamps at 0.
// clear is the page's scroll padding, which marks the sticky phone menu band (106 px at 390 px wide).
function layoutModel({height=800,clear=106,scrollY=600}={}){
  const tops=new Map(),size={line:70,'chart-heading':28,'overview-heading':28},scrolls=[];let y=scrollY;
  const role=element=>{
    const kind=element.getAttribute?.('class')||'';if(/\bdesk-feedback-inline\b/.test(kind))return 'line';
    if(element.id==='hosted-price-heading')return 'chart-heading';if(element.id==='journal-overview-heading')return 'overview-heading';
    const action=element.getAttribute?.('data-journal-action')||element.getAttribute?.('data-price-action');if(action)return `action:${action}`;
    if(['INPUT','SELECT','TEXTAREA'].includes(element.tagName)&&element.getAttribute('name'))return `field:${element.getAttribute('name')}`;
    const form=element.tagName==='BUTTON'&&element.getAttribute('type')==='submit'?element.closest('[data-journal-form],[data-price-form]'):null;
    return form?`submit:${form.getAttribute('data-journal-form')||form.getAttribute('data-price-form')}`:null;
  };
  const model={scrolls,beforeSwap:null,
    window:{innerHeight:height,scrollBy:(dx,dy)=>{const before=y;y=Math.max(0,y+dy);scrolls.push(y-before);},getComputedStyle:()=>({scrollPaddingTop:`${clear}px`})},
    at:name=>tops.get(name)-y,                                        // viewport top now
    put:(name,viewportTop)=>tops.set(name,viewportTop+y),             // place at a viewport top now
    move:(name,dy)=>tops.set(name,tops.get(name)+dy),                 // the page grew above it
    below:(name,above,gap=12)=>tops.set(name,tops.get(above)+(size[above]??44)+gap),
    rect(element){const name=role(element),top=name&&tops.has(name)?tops.get(name)-y:5000;return {top,bottom:top+(size[name]??44),left:0,right:500};}};
  return model;
}
function useLayout(t,model){const original=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){return model.rect(this);};t.after(()=>{Element.prototype.getBoundingClientRect=original;});return model;}
const once=fn=>{let done=false;return ()=>{if(!done){done=true;fn();}};};
const inView=(model,name,clear=106,height=800)=>model.at(name)>=clear&&model.at(name)+(name==='line'?70:name.endsWith('heading')?28:44)<=height;
const exampleFile=await readFile(new URL('../docs/examples/synthetic-price-import.json',import.meta.url),'utf8');
async function priceImport(t,buttonTop){
  const model=useLayout(t,layoutModel()),h=await appDesk(t,{view:'prices',layout:model});
  h.query('details[data-state-key="prices:import"]').open=true;h.file('#price-import-file',exampleFile);
  model.put('submit:import',buttonTop);
  // The import adds a chart, notices and tables above the form: 520 px more page above it.
  model.beforeSwap=once(()=>{model.move('submit:import',520);model.below('line','submit:import');});
  await h.submit(h.query('[data-price-form="import"]'));
  assert.match(plain(lineOf(h.html()).line),/^Imported 1 daily series/);
  return {model,h};
}

test('place keeping: a valid import keeps the pressed button where it was, with its line under it',{concurrency:false},async t=>{
  const {model,h}=await priceImport(t,400);
  assert.deepEqual(model.scrolls,[520],'one move that undoes the growth above the form');
  assert.equal(model.at('submit:import'),400);assert.ok(inView(model,'line'));
  // A change that clears the message keeps the page still, even when the page above the form changes.
  h.query('#price-symbol').value='IBM';model.beforeSwap=once(()=>model.move('submit:import',-300));
  await h.submit(h.query('[data-price-form="selection"]'));
  noLine(h.html());assert.deepEqual(model.scrolls,[520]);
});

test('place keeping: a control pressed at the bottom edge still shows its whole line, and focus stays clear of the band',{concurrency:false},async t=>{
  const {model}=await priceImport(t,750);// button bottom 6 px above the fold
  assert.deepEqual(model.scrolls,[520,84],'keep the place, then bring the line up by its overflow plus 8 px');
  assert.ok(inView(model,'line'),'the whole line is in view');assert.ok(model.at('submit:import')>=106,'the focused button is clear of the band');
});

test('place keeping: an automatic assessment that grows History afterwards moves nothing',{concurrency:false},async t=>{
  const model=useLayout(t,layoutModel()),remote=started('synthetic-feedback-grow'),h=await appDesk(t,{remote,layout:model});
  const form=h.query('[data-journal-form="settings"]');form.closest('details').open=true;form.querySelector('#paper-notional').value='300';
  model.put('submit:settings',500);model.beforeSwap=once(()=>model.below('line','submit:settings'));
  await h.submit(form);
  assert.equal(plain(lineOf(h.html()).line),'Paper assumptions saved for future intents. Existing decisions retain their original settings.');
  assert.deepEqual(model.scrolls,[],'the line fits under the button: nothing to move');
  // Two new entries arrive with the next automatic assessment: History grows 218 px above the form.
  let grown=h.io.current;for(const horizonId of ['next_day','next_week'])grown=(await J.recordAbstention(grown,{id:`synthetic-grow-${horizonId}`,at,date:'2026-10-17',horizonId,unrankedCount:6,reason:'Synthetic growth.',snapshot:{id:'synthetic-snapshot'}})).journal;
  h.io.current=grown;model.beforeSwap=once(()=>{model.move('submit:settings',218);model.move('line',218);});
  await h.app.observe();await settle(h.app);
  assert.equal((h.html().match(/data-journal-entry=/g)||[]).length,2,'History grew');
  assert.deepEqual(model.scrolls,[],'background renders never hold or scroll');assert.equal(model.at('submit:settings'),718);
});

test('place keeping: Load chart near the top puts its line where the button was and keeps the focused heading clear of the band',{concurrency:false},async t=>{
  const model=useLayout(t,layoutModel()),h=await appDesk(t,{view:'prices',layout:model});
  // 390 x 844 style: the button just below the 106 px clear zone, its heading already under the band.
  model.put('action:load-hosted',110);model.put('chart-heading',15);
  model.beforeSwap=once(()=>model.put('line',92));// the line now starts where the chart box began
  await h.press(h.query('[data-price-action="load-hosted"]'));
  assert.ok(!h.query('[data-price-action="load-hosted"]')&&h.query('#hosted-price-chart iframe'),'the chart frame replaced the button');
  assert.equal(h.document.activeElement?.id,'hosted-price-heading','app.js moves focus to the chart heading');
  assert.ok(model.at('chart-heading')>=106,`the focused heading is clear of the band (top ${model.at('chart-heading')})`);
  assert.ok(inView(model,'line'),'the whole line is in view');
  assert.deepEqual(model.scrolls,[-18,-73],'the line takes the button\'s place, then the heading clears the band');
});

test('place keeping: Start puts its line where the button was, and the assessment that follows moves nothing',{concurrency:false},async t=>{
  const model=useLayout(t,layoutModel()),h=await appDesk(t,{layout:model});
  model.put('action:start',300);
  model.beforeSwap=once(()=>{model.put('line',250);model.below('overview-heading','line',36);});
  await h.press(h.query('[data-journal-action="start"]'));
  assert.equal(plain(lineOf(h.html()).line),'Automatic journaling is enabled. Assessments update while the app is open.');
  assert.deepEqual(model.scrolls,[-50]);assert.equal(model.at('line'),300);assert.ok(inView(model,'overview-heading'));
});

test('place keeping: a rejected save whose first invalid field the browser scrolled to still brings its line into view',{concurrency:false},async t=>{
  const model=useLayout(t,layoutModel()),remote=started('synthetic-feedback-invalid'),h=await appDesk(t,{remote,layout:model});
  const form=h.query('[data-journal-form="settings"]');form.closest('details').open=true;form.querySelector('#paper-notional').value='abc';
  // Focusing the first invalid field scrolled the page in the browser: the field is on screen, the button below the fold.
  model.put('field:paperNotional',300);model.put('submit:settings',820);model.beforeSwap=once(()=>model.below('line','submit:settings'));
  await h.submit(form);
  assert.match(plain(lineOf(h.html()).line),/^Nothing saved: .*Check the highlighted paper assumptions\.$/);
  assert.equal(h.document.activeElement?.id,'paper-notional','focus stays on the first invalid field');
  assert.deepEqual(model.scrolls,[154],'the line comes up by its overflow plus 8 px');
  assert.ok(inView(model,'line'));assert.ok(model.at('field:paperNotional')>=106,'the focused field stays clear of the band');
});

test('place keeping: a control the owner scrolled away from is left alone',{concurrency:false},async t=>{
  const model=useLayout(t,layoutModel()),h=await appDesk(t,{view:'prices',layout:model});
  h.query('details[data-state-key="prices:import"]').open=true;h.file('#price-import-file','{');
  model.put('submit:import',1200);model.beforeSwap=once(()=>model.below('line','submit:import'));
  await h.submit(h.query('[data-price-form="import"]'));
  assert.match(plain(lineOf(h.html()).line),/import parse failed/);assert.deepEqual(model.scrolls,[]);
});

test('a result that would land in a closed disclosure opens it, and it stays open',{concurrency:false},async t=>{
  const {journal,intentId}=await paperJournal(),h=await appDesk(t,{remote:journal});
  const form=h.query(`[data-journal-form="save-fill"][data-journal-id="${intentId}"]`);form.closest('details').open=true;
  for(const [name,value] of Object.entries({side:'buy',occurredAt:'2026-10-17T17:00',quantity:'1',price:'100',fee:'0'}))form.querySelector(`[name="${name}"]`).value=value;
  h.io.hold=deferred();h.io.commit='fail';
  form.querySelector('button[type="submit"]').focus();form.dispatch({type:'submit',target:form,preventDefault(){}});
  await until(()=>h.app.status().busy,'the save is in flight');
  form.closest('details').open=false;// the owner closes "Add actual fill" while it saves
  h.io.hold.resolve();await settle(h.app);
  const line=h.content.querySelector('.desk-feedback');
  assert.equal(line?.textContent,'Journal save unavailable: synthetic save unavailable. No synced result is assumed.');
  assert.ok(/\bdesk-feedback-inline\b/.test(line.getAttribute('class')));
  const holder=line.closest('details');assert.ok(holder,'the line sits in the fill disclosure');assert.equal(holder.open,true,'the disclosure opened for the result');
  await h.app.observe();await settle(h.app);
  assert.equal(h.content.querySelector('.desk-feedback').closest('details').open,true,'app.js keeps it open on the next render');
});

test('a render during an owner action keeps the previous message at its own control',{concurrency:false},async t=>{
  const remote=started('synthetic-feedback-midway'),h=await appDesk(t,{remote});
  h.file('#journal-import-file',(await J.exportJournal(remote)).text);await h.submit(h.query('[data-journal-form="import"]'));
  await h.press(h.query('[data-journal-action="export"]'));
  await until(()=>h.html().includes('Journal backup exported'),'the export reports its result');
  h.io.hold=deferred();
  const apply=h.query('[data-journal-action="confirm-import"]');apply.focus();apply.dispatch({type:'click',target:apply});
  await until(()=>h.app.status().busy,'the apply is in flight');
  let found=inline(lineOf(h.html()));
  assert.equal(plain(found.line),'Journal backup exported with its original events and revision history.');
  assert.ok(holds(node=>node.attrs['data-journal-action']==='export')(found.previous),'still under the export button while Apply runs');
  h.io.hold.resolve();await settle(h.app);
  found=inline(lineOf(h.html()));
  assert.equal(plain(found.line),'Reviewed backup saved. Existing records and original decision context remain intact.');assert.ok(isForm('import')(found.previous));
});

// Rules with their nesting at-rules, in file order (as tests/ui-A-shell.test.mjs reads them).
function cssRules(text){
  const source=text.replace(/\/\*[\s\S]*?\*\//g,''),rules=[];let i=0;
  const block=at=>{while(i<source.length){const open=source.indexOf('{',i),close=source.indexOf('}',i);if(close>=0&&(open<0||close<open)){i=close+1;return;}if(open<0){i=source.length;return;}const prelude=source.slice(i,open).trim();i=open+1;if(prelude.startsWith('@'))block([...at,prelude]);else{const end=source.indexOf('}',i);rules.push({at,selectors:prelude.split(/,(?![^(]*\))/).map(value=>value.trim()),body:source.slice(i,end)});i=end+1;}}};
  block([]);return rules;
}
const declaration=(rule,name)=>rule.body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))?.[1]?.trim();
// Can a selector's subject (its last compound) match an outcome line? The line is a <p> with the class
// desk-feedback (plus desk-feedback-inline), no id, and no attribute other than class and tabindex.
// Ancestors, pseudo-classes and :is()/:not() arguments are ignored, so the check never misses a rule.
// A pseudo-element (::before) styles generated content, not the line.
function canMatchLine(selector){
  let depth=0,start=0;
  for(let index=0;index<selector.length;index++){const char=selector[index];if('(['.includes(char))depth++;else if(')]'.includes(char))depth--;else if(!depth&&/[\s>+~]/.test(char))start=index+1;}
  const subject=selector.slice(start).trim();if(!subject||subject.includes('::'))return false;
  const bare=subject.replace(/:{1,2}[a-zA-Z-]+(?:\((?:[^()]|\([^()]*\))*\))?/g,''),outside=bare.replace(/\[[^\]]*\]/g,'');
  const tag=(outside.match(/^(?:[a-zA-Z][a-zA-Z0-9-]*|\*)/)||[''])[0].toLowerCase();
  const names=[...outside.matchAll(/\.([\w-]+)/g)].map(match=>match[1]),attributes=[...bare.matchAll(/\[\s*([\w-]+)/g)].map(match=>match[1]);
  return ['','*','p'].includes(tag)&&!/#[\w-]/.test(outside)&&names.every(name=>['desk-feedback','desk-feedback-inline'].includes(name))&&attributes.every(name=>['class','tabindex'].includes(name));
}
const hides=/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden)/i;
const hidingRules=text=>cssRules(text).filter(rule=>hides.test(rule.body)&&rule.selectors.some(canMatchLine)).map(rule=>`${rule.at.join(' ')} ${rule.selectors.join(',')}`.trim());

test('G13: no rule anywhere, at any width or state, hides an outcome line',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  assert.deepEqual(hidingRules(css),[],'a rule that can match .desk-feedback or .desk-feedback-inline hides it');
  // The scan reads every media query and every selector form that can reach the line.
  assert.deepEqual(hidingRules('@media(max-width:680px){.desk-feedback-inline{display:none}}'),['@media(max-width:680px) .desk-feedback-inline'],'the phone-only hide from the review (mutation M9)');
  for(const selector of ['.desk-feedback','.price-desk .desk-feedback','.journal-desk>.desk-feedback-inline','p.desk-feedback.desk-feedback-inline:focus-visible','.utility-desk :is(.x) ~ .desk-feedback','.desk-feedback[tabindex]','*'])
    assert.equal(hidingRules(`${selector}{visibility:hidden}`).length,1,selector);
  for(const selector of ['[hidden]','.sr-only','.desk-notice','.desk-feedback::before','#workspace-status','.desk-feedback .x','div.desk-feedback','.desk-feedback[role]'])
    assert.equal(hidingRules(`${selector}{display:none}`).length,0,selector);
  assert.equal(hidingRules('@supports(display:grid){@media(min-width:681px){.desk-feedback{content-visibility:hidden}}}').length,1,'nested at-rules too');
});

test('CSS: the inline line is static and whole at every width; the top line keeps its sticky, capped rules',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  const startA=css.indexOf('/* == area:A shell == */'),endA=css.indexOf('/* == end area:A == */'),startD=css.indexOf('/* == area:D journal == */'),endD=css.indexOf('/* == end area:D == */');
  assert.ok(startA>0&&endA>startA&&startD>endA&&endD>startD,'the area markers are in place');
  const outside=cssRules(css.slice(0,startA)+'\n'+css.slice(endA,startD)+'\n'+css.slice(endD));
  assert.equal(outside.filter(rule=>rule.selectors.some(selector=>selector.includes('desk-feedback-inline'))).length,0,'inline rules live only in areas A and D');
  const blockA=cssRules(css.slice(startA,endA)),blockD=cssRules(css.slice(startD,endD));
  const base=blockA.find(rule=>!rule.at.length&&rule.selectors.includes('.desk-feedback.desk-feedback-inline'));
  assert.ok(base,'area A styles the inline variant');
  assert.equal(declaration(base,'position'),'static');assert.equal(declaration(base,'max-height'),'none');
  assert.equal(declaration(base,'overflow'),'visible');assert.equal(declaration(base,'box-shadow'),'none');
  assert.doesNotMatch(base.body,/display\s*:\s*none|visibility\s*:\s*hidden/,'never hidden (G13)');
  // Only the shared rules position, cap or scroll the outcome line, so two classes beat them at every width.
  const all=cssRules(css),touching=rule=>rule.selectors.some(selector=>/\.desk-feedback\b/.test(selector)&&!/:has\(/.test(selector));
  const setters=name=>all.filter(rule=>touching(rule)&&declaration(rule,name)!==undefined).map(rule=>`${rule.at.join(' ')}|${rule.selectors.join(',')}=${declaration(rule,name)}`);
  assert.deepEqual(setters('position'),['|.desk-feedback=sticky','@media(max-width:680px)|.desk-feedback=static','|.desk-feedback.desk-feedback-inline=static']);
  assert.deepEqual(setters('max-height'),['@media(min-width:681px)|.desk-feedback=96px','|.desk-feedback.desk-feedback-inline=none']);
  // The inline line is no scroll box, so the sticky line's keyboard scroll padding does not apply to it.
  const padIndex=blockA.findIndex(rule=>rule.selectors.includes('html:has(.utility-desk>.desk-feedback)')&&declaration(rule,'scroll-padding-top')==='120px');
  const resetIndex=blockA.findIndex(rule=>rule.selectors.includes('html:has(.utility-desk>.desk-feedback-inline)'));
  assert.ok(padIndex>=0&&resetIndex>padIndex,'the reset follows the sticky padding rule');
  assert.equal(declaration(blockA[resetIndex],'scroll-padding-top'),'auto');assert.ok(blockA[resetIndex].at.some(at=>/min-width:\s*681px/.test(at)));
  const gap=blockD.find(rule=>rule.selectors.includes('.journal-desk>.desk-feedback-inline'));
  assert.ok(gap,'area D spaces the line that stands where the setup card stood');assert.equal(declaration(gap,'margin-top'),'0');
});
