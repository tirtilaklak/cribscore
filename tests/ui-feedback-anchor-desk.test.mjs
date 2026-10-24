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

test('the pressed control keeps its place on screen when the view above it grows',{concurrency:false},async t=>{
  // Offline geometry: the import form and the start button sit where the test says; an inline line at lineTop.
  const original=Element.prototype.getBoundingClientRect,place={form:400,start:300,line:null};
  Element.prototype.getBoundingClientRect=function(){
    const top=this.getAttribute('data-price-form')==='import'?place.form:this.getAttribute('data-journal-action')==='start'?place.start:/\bdesk-feedback-inline\b/.test(this.getAttribute('class')||'')&&place.line!==null?place.line:2000;
    return {top,bottom:top+60,left:0,right:500};
  };
  t.after(()=>{Element.prototype.getBoundingClientRect=original;});
  const scrolls=[],window={innerHeight:800,scrollBy:(x,y)=>scrolls.push([x,y])};
  const raw=await readFile(new URL('../docs/examples/synthetic-price-import.json',import.meta.url),'utf8');
  const geometry={window,beforeSwap:null};
  const h=await desk(t,{view:'prices',geometry});
  assert.deepEqual(scrolls,[],'no scroll without an owner message');
  // The import adds a chart above the form: 520 px more page above it.
  geometry.beforeSwap=()=>{place.form=920;};
  h.file('#price-import-file',raw);await h.submit(h.query('[data-price-form="import"]'));
  assert.deepEqual(scrolls,[[0,520]],'the form and its line stay where the owner pressed');
  // A change that clears the message keeps the page still.
  geometry.beforeSwap=()=>{place.form=1400;};
  h.set('#price-symbol','IBM');await h.submit(h.query('[data-price-form="selection"]'));
  assert.deepEqual(scrolls,[[0,520]]);
  // A control the owner scrolled away from is left alone.
  place.form=900;geometry.beforeSwap=()=>{place.form=300;};
  h.file('#price-import-file','{');await h.submit(h.query('[data-price-form="import"]'));
  assert.deepEqual(scrolls,[[0,520]]);
  // Start removes its own button: the line takes the spot where the button was.
  const jGeometry={window,beforeSwap:()=>{place.line=100;}};
  const j=await desk(t,{geometry:jGeometry});scrolls.length=0;
  await j.press(j.query('[data-journal-action="start"]'));
  assert.deepEqual(scrolls,[[0,-200]],'one move, then the line stays put through the assessment that follows');
  // Without a window (the other tests) nothing is measured or scrolled.
  assert.equal(typeof globalThis.scrollBy,'undefined');
});

// Rules with their nesting at-rules, in file order (as tests/ui-A-shell.test.mjs reads them).
function cssRules(text){
  const source=text.replace(/\/\*[\s\S]*?\*\//g,''),rules=[];let i=0;
  const block=at=>{while(i<source.length){const open=source.indexOf('{',i),close=source.indexOf('}',i);if(close>=0&&(open<0||close<open)){i=close+1;return;}if(open<0){i=source.length;return;}const prelude=source.slice(i,open).trim();i=open+1;if(prelude.startsWith('@'))block([...at,prelude]);else{const end=source.indexOf('}',i);rules.push({at,selectors:prelude.split(/,(?![^(]*\))/).map(value=>value.trim()),body:source.slice(i,end)});i=end+1;}}};
  block([]);return rules;
}
const declaration=(rule,name)=>rule.body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))?.[1]?.trim();

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
