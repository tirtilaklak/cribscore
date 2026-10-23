// Area D (journal) presentation contracts. Synthetic models and synthetic I/O only; nothing is saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderJournalView} from '../dist/lib/journal-view.js';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import * as domain from '../dist/lib/journal.js';
import {createDocument} from './helpers/interaction-dom.mjs';

const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const plain=node=>typeof node==='string'?node:node.children.map(plain).join('');
const elements=node=>node.children.filter(child=>typeof child!=='string');
const hasClass=(node,name)=>(node.attrs.class||'').split(/\s+/).includes(name);
const byClass=(node,name)=>all(node,child=>hasClass(child,name));
const at='2026-10-17T18:00:00Z';
const settings={paperNotional:'100.000000',commissionPerFill:'0.000000',slippageBps:5,currency:'USD',benchmarkSymbol:'SPY'};
const model=(entries=[],summary={},storage={state:'synced',message:'Synthetic storage message'})=>({settings,storage,summary,entries,assumptions:[]});
const SYNC='<button type="button" id="journal-sync" class="desk-button desk-button-secondary" data-journal-action="sync">Check journal sync</button>';
const ACCRUAL='Total P&L counts dividends that are owed. Some may not be paid yet.';
const NO_ORDER='This records your completed trade. It does not send an order.';
const FILL_INTRO={'save-fill':'Record a trade you already made at your broker. Cribscore never sends orders.','revise-fill':'Correct the details of a trade you already recorded. Cribscore never sends orders.'};
const WINDOW_NOTE='Card labels show a 1-day or 5-day window (the trading days this research covers).';
const paperEntry=(id,status,horizonId='next_day')=>({id,date:'2026-10-17',status,symbol:'TEST',company:'Synthetic fixture',horizonId,reason:'Synthetic reason',context:{},paper:{status,quantity:'1',entryPrice:'10',exitPrice:null,realizedPnl:'-1.500000',openPnl:'2.000000',dividendAccrual:'0.250000',totalPnl:'0.750000',benchmarkPnl:'1.000000',excessPnl:'-0.250000',pendingReasons:[],assumptions:settings},actual:{confirmed:false,fills:[]},revisions:[]});
const plainEntry=(id,status,horizonId=null)=>({id,date:'2026-10-17',status,symbol:null,company:null,horizonId,reason:'Synthetic reason',context:{},paper:null,actual:{confirmed:false},revisions:[]});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settle=async app=>{for(let n=0;n<60;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(app.status().busy,false);};

test('before start only the storage line, feedback, settings and backup render',()=>{
  const automation={publisherState:'unavailable',checkedAt:null,pendingReasons:['observation_not_checked']};
  const html=renderJournalView(model(),{setupPending:true,feedback:'Synthetic outcome',automation,syncControl:SYNC,importPreview:{message:'1 new event(s) ready for review'}}),dom=parse(html);
  const desk=byClass(dom,'journal-desk')[0];
  const kinds=elements(desk).map(node=>hasClass(node,'journal-storage')?'storage':hasClass(node,'desk-feedback')?'feedback':node.attrs['data-state-key']);
  assert.deepEqual(kinds,['storage','feedback',JSON.stringify(['journal','settings',null,null]),JSON.stringify(['journal','backup',null,null])]);
  assert.equal(all(dom,node=>node.attrs['data-journal-form']==='settings').length,1);
  assert.equal(all(dom,node=>node.attrs['data-journal-form']==='import').length,1);
  assert.match(html,/data-journal-action="confirm-import"/,'a backup can still be reviewed and applied before start');
  assert.doesNotMatch(html,/journal-counts|data-publisher-state|journal-overview|journal-history-heading|data-journal-entry|No decisions recorded yet|Check time unavailable|Some required information is unavailable|id="journal-sync"/);
  assert.equal(plain(byClass(dom,'journal-storage')[0]),'Not startedSynthetic storage message');
  assert.equal(plain(all(dom,node=>node.tag==='label'&&node.attrs.for==='journal-import-file')[0]),'Journal backup file');
  assert.doesNotMatch(html,/JSON/,'the backup form names no unexplained file format');
  for(const [state,label] of [['local_only','Not started'],['unsaved','Not synced'],['conflict','Sync conflict'],['unavailable','Storage unavailable']]){
    const storage=byClass(parse(renderJournalView(model([],{},{state,message:'Synthetic'}),{setupPending:true})),'journal-storage')[0];
    assert.equal(storage.attrs['data-storage-state'],state);assert.ok(plain(storage).startsWith(label),state);
    if(state!=='synced')assert.match(plain(storage),/Keep a backup of device-only or unsynced records\./);
  }
});

test('setupPending defaults to false, and false renders the started journal',()=>{
  for(const sample of [model(),model([paperEntry('default','open')],{decisions:1,open:1})]){
    assert.equal(renderJournalView(sample),renderJournalView(sample,{setupPending:false}));
    assert.equal(renderJournalView(sample,{syncControl:SYNC}),renderJournalView(sample,{setupPending:false,syncControl:SYNC}));
    assert.match(renderJournalView(sample),/<h2 id="journal-overview-heading" tabindex="-1" data-focus-fallback>Daily record<\/h2>/);
  }
});

test('after start with no entries there is no summary or counter, and the storage line holds the sync control',()=>{
  const html=renderJournalView(model(),{syncControl:SYNC}),dom=parse(html);
  assert.equal(byClass(dom,'journal-counts').length,0);assert.equal(byClass(dom,'journal-summary').length,0);
  const overview=byClass(dom,'journal-overview')[0],storage=byClass(overview,'journal-storage')[0];
  assert.ok(storage,'the storage line stays in the overview');
  assert.equal(all(storage,node=>node.attrs.id==='journal-sync').length,1);assert.equal(all(dom,node=>node.attrs.id==='journal-sync').length,1);
  assert.match(html,/<h2 id="journal-history-heading">History<\/h2><span>Real trades you confirmed: 0<\/span>/);
  assert.match(html,/No decisions recorded yet/);assert.match(html,/Missing prices stay pending\./);
  assert.equal(byClass(dom,'journal-history-note').length,0,'no window gloss without a card that names a window');
  assert.doesNotMatch(html,/0 entries|are abstentions|Decision history|actual confirmations|DAILY DECISION RECORD|Assessment record/);
});

test('entries add a counted summary and six labelled counters from the saved summary',()=>{
  assert.match(renderJournalView(model([plainEntry('one','abstain','next_day')],{decisions:1,abstentions:1})),/<p class="journal-summary">1 entry so far\. 1 is an abstention\.<\/p>/);
  assert.match(renderJournalView(model([plainEntry('a','abstain','next_day'),plainEntry('b','abstain','next_week'),paperEntry('c','pending')],{decisions:3,abstentions:2,pending:1})),/<p class="journal-summary">3 entries so far\. 2 are abstentions\.<\/p>/);
  const entries=['pending','open','open','closed','no_fill'].map((status,index)=>paperEntry(`entry-${index}`,status));
  const html=renderJournalView(model(entries,{decisions:5,abstentions:0,pending:1,open:2,closed:1,noFill:1,actualConfirmations:2})),dom=parse(html);
  assert.equal(plain(byClass(dom,'journal-summary')[0]),'5 entries so far.','no abstention sentence when there are none');
  const counts=byClass(dom,'journal-counts')[0];
  assert.deepEqual(elements(counts).map(row=>elements(row).map(plain)),[['Entries','5'],['Abstentions','0'],['Pending','1'],['Paper open','2'],['Paper closed','1'],['No fill','1']]);
  assert.match(html,/Real trades you confirmed: 2/);
});

test('cards name paper states and the research window in plain words',()=>{
  const cases={abstain:'Abstained',pending:'Pending',open:'Paper open',closed:'Paper closed',no_fill:'No fill',duplicate:'Duplicate decision'};
  for(const [status,badge] of Object.entries(cases)){
    const entry=['abstain','duplicate'].includes(status)?plainEntry(status,status,status==='abstain'?'next_week':null):paperEntry(status,status);
    const card=all(parse(renderJournalView(model([entry],{decisions:1}))),node=>node.attrs['data-journal-entry']===status)[0];
    assert.equal(plain(byClass(card,'desk-badge')[0]),badge);
  }
  const html=renderJournalView(model([plainEntry('week','abstain','next_week'),paperEntry('day','open','next_day'),plainEntry('other','duplicate')],{decisions:2})),dom=parse(html);
  assert.deepEqual(byClass(dom,'eyebrow').map(plain),['2026-10-17 · 5-day window','2026-10-17 · 1-day window','2026-10-17 · Journal event']);
  assert.equal(plain(all(all(dom,node=>node.attrs['data-journal-entry']==='week')[0],node=>node.tag==='h3')[0]),'No eligible stock');
  assert.doesNotMatch(html,/TARGET|target|Context observation|>Open<|>Closed<|>Abstain</);
  // MK11.11 (reworded with R70): the abstention context keeps "recorded", the journal's own knowledge.
  assert.match(html,/<summary>Why there was no trade<\/summary><p>No eligible published research was recorded for this date and window\.<\/p>/);
  const facts=byClass(all(dom,node=>node.attrs['data-journal-entry']==='week')[0],'desk-facts')[0];
  assert.deepEqual(elements(facts).map(row=>plain(elements(row)[0])).filter(label=>/window/i.test(label)),['Window','Snapshot window start','Snapshot window end']);
  // The window gloss sits once, before the first card that names a window.
  const history=all(dom,node=>node.attrs['aria-labelledby']==='journal-history-heading')[0],parts=elements(history);
  assert.equal(byClass(dom,'journal-history-note').length,1);assert.equal(plain(parts[1]),WINDOW_NOTE);assert.ok(hasClass(parts[2],'journal-list'));
});

test('every P&L list is followed by the accrual line and every sign stays in the text',()=>{
  const entry=paperEntry('pnl','closed');entry.actual={confirmed:true,confirmedAt:at,realizedPnl:'-2.000000',openPnl:null,dividendAccrual:'0.500000',totalPnl:'-1.500000',fills:[]};
  const dom=parse(renderJournalView(model([entry],{decisions:1,closed:1,actualConfirmations:1})));
  const lists=all(dom,node=>node.tag==='dl'&&hasClass(node,'journal-pnl'));assert.equal(lists.length,2);
  for(const section of byClass(dom,'journal-account')){
    const children=elements(section),index=children.findIndex(node=>hasClass(node,'journal-pnl'));
    assert.ok(index>0);assert.ok(hasClass(children[index+1],'journal-accrual'));assert.equal(plain(children[index+1]),ACCRUAL);
  }
  assert.equal(byClass(dom,'journal-accrual').length,lists.length);
  const [paper,actual]=lists.map(plain);
  assert.match(paper,/Realized P&LUSD -1\.5/);assert.match(paper,/Difference from benchmarkUSD -0\.25/);assert.match(actual,/Total P&LUSD -1\.5/);
});

test('fill forms open with a plain intro and keep the no-order line at their button',()=>{
  const entry=paperEntry('fills','open');entry.actual={confirmed:true,confirmedAt:at,fills:[{id:'fill-1',side:'buy',occurredAt:at,quantity:'1',price:'10',fee:'0'}]};
  const dom=parse(renderJournalView(model([entry],{decisions:1,open:1,actualConfirmations:1})));
  const forms=all(dom,node=>['save-fill','revise-fill'].includes(node.attrs['data-journal-form']));assert.equal(forms.length,2);
  for(const form of forms){
    const children=elements(form),intro=children.findIndex(node=>hasClass(node,'journal-fill-intro')),grid=children.findIndex(node=>hasClass(node,'desk-form-grid'));
    assert.ok(intro>=0&&intro<grid,'the intro sits above the fields');assert.equal(plain(children[intro]),FILL_INTRO[form.attrs['data-journal-form']]);
    assert.equal(children.at(-2).tag,'button');assert.equal(children.at(-2).attrs.type,'submit');assert.equal(plain(children.at(-1)),NO_ORDER);
    assert.equal(all(form,node=>node.tag==='button')[0],children.at(-2),'the submit stays the first button in the form');
    assert.equal(all(form,node=>Object.hasOwn(node.attrs,'aria-describedby')).length,0,'the intro is not wired to the fields');
  }
});

test('the confirm step says that no order is placed and keeps its action',()=>{
  const html=renderJournalView(model([paperEntry('confirm','pending')],{decisions:1,pending:1})),confirm=byClass(parse(html),'journal-confirm')[0];
  const [question,button,note]=elements(confirm);
  assert.equal(plain(question),'Did you make a real trade for this case?');
  assert.equal(button.attrs['data-journal-action'],'confirm-actual');assert.equal(button.attrs['data-journal-id'],'confirm');assert.equal(plain(button),'Record a real trade');
  assert.equal(plain(note),'Saving this does not place an order. It records a trade you already made. Fill details can follow.');
  assert.doesNotMatch(html,/I took this trade|Did you take this trade/);
});

test('first-run and unconfirmed check codes read as plain sentences',()=>{
  const html=renderJournalView(model(),{automation:{publisherState:'unavailable',checkedAt:null,pendingReasons:['observation_not_checked','observation_not_confirmed','publisher_unconfigured','publisher_unavailable']}});
  const status=all(parse(html),node=>node.attrs['data-publisher-state']==='unavailable')[0];
  assert.equal(plain(elements(status)[0]),'Research source not checked');
  assert.deepEqual(all(status,node=>node.tag==='li').map(plain),['The first check has not run yet.','The last check was not confirmed.','The research source is not connected.','The research source is not responding.']);
  assert.doesNotMatch(html,/observation_not|observation not|publisher_un|Some required information is unavailable|suggestion/i);
});

function controller(t,{remote=null,failLoad=false}={}){
  const handlers={},held={get:null};let current=remote;
  const doc={querySelector:()=>null,addEventListener:(name,fn)=>{handlers[name]=fn;},removeEventListener(){}};
  const reply=(body,status=200)=>({ok:status===200,status,json:async()=>body});
  const app=createDeskTools({document:doc,now:()=>at,uuid:()=>'synthetic-ui-d',fetch:async(url,options)=>{
    if(url.endsWith('/observe'))return reply({ok:true,journal:current,revision:current.revision,automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:['publisher_unconfigured']}});
    if(options.method==='GET'){if(held.get)await held.get.promise;return failLoad?reply({ok:false,error:'authentication_required'},401):reply({ok:true,journal:current,revision:current?.revision??0});}
    current=JSON.parse(options.body).journal;return reply({ok:true,journal:current,revision:current.revision});
  }});
  t.after(async()=>{held.get?.resolve();await settle(app);app.destroy();});
  return {app,held,click:name=>{const target={dataset:{journalAction:name},closest:()=>target};handlers.click({target});}};
}

test('first run: one action row holds Start and the only sync button; nothing else is shown before start',{concurrency:false},async t=>{
  const h=controller(t);await h.app.start();
  const html=h.app.html('journal'),dom=parse(html);
  assert.deepEqual(elements(dom).map(node=>node.attrs.class),['card desk-panel journal-setup','journal-desk utility-desk']);
  const setup=byClass(dom,'journal-setup')[0];
  assert.equal(plain(all(setup,node=>node.tag==='h2')[0]),'Start your private journal');
  assert.match(plain(setup),/Cribscore never places orders\./);assert.match(plain(setup),/practice trades with no real money/);
  const row=byClass(setup,'desk-actions')[0];
  assert.deepEqual(elements(row).map(node=>[node.attrs['data-journal-action'],plain(node)]),[['start','Start automatic journal'],['sync','Check journal sync']]);
  assert.equal(all(dom,node=>node.attrs.id==='journal-sync').length,1);
  assert.doesNotMatch(html,/journal-counts|data-publisher-state|journal-history-heading|Daily record|Check time unavailable|Some required information is unavailable/);
  assert.ok(byClass(dom,'journal-storage')[0],'the storage line stays visible before start');
});

test('after Start the setup card is gone and the overview carries the focus fallback and the sync button',{concurrency:false},async t=>{
  const h=controller(t);await h.app.start();h.click('start');await settle(h.app);
  const html=h.app.html('journal'),dom=parse(html);
  assert.doesNotMatch(html,/Start your private journal|journal-setup/);
  assert.match(html,/<h2 id="journal-overview-heading" tabindex="-1" data-focus-fallback>Daily record<\/h2>/);
  assert.equal(byClass(dom,'journal-counts').length,0,'no counters while the journal holds no entries');
  assert.equal(all(byClass(dom,'journal-storage')[0],node=>node.attrs.id==='journal-sync').length,1);
  assert.equal((html.match(/id="journal-sync"/g)||[]).length,1);
});

test('the sync button keeps its id and uses aria-disabled while busy, never disabled',{concurrency:false},async t=>{
  const h=controller(t,{remote:domain.createJournal({journalId:'synthetic-ui-d-sync',at})});await h.app.start();
  assert.match(h.app.html('journal'),/<button type="button" id="journal-sync" class="desk-button desk-button-secondary" data-journal-action="sync">Check journal sync<\/button>/);
  h.held.get=deferred();h.click('sync');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.app.status().busy,true);
  const busy=h.app.html('journal');
  assert.match(busy,/<button type="button" id="journal-sync" class="desk-button desk-button-secondary" data-journal-action="sync" aria-disabled="true" aria-busy="true">Working…<\/button>/);
  assert.doesNotMatch(busy,/ disabled[ >=]/);
  h.held.get.resolve();h.held.get=null;await settle(h.app);
  assert.doesNotMatch(h.app.html('journal'),/aria-disabled|aria-busy/);
});

test('loading and failure panels expose their state; failure offers Try again and never sounds ready',{concurrency:false},async t=>{
  const h=controller(t,{failLoad:true});
  const loading=parse(h.app.html('journal'));
  assert.equal(all(loading,node=>node.attrs['data-desk-state']==='loading').length,1);assert.equal(plain(all(loading,node=>node.tag==='h2')[0]),'Loading the journal');
  await h.app.start();
  const html=h.app.html('journal'),panel=all(parse(html),node=>node.attrs['data-desk-state']==='unavailable')[0];assert.ok(panel);
  assert.equal(plain(all(panel,node=>node.tag==='h2')[0]),'The journal did not load');
  const text=plain(panel);assert.doesNotMatch(text,/ready/i);
  assert.match(text,/No records are shown, and nothing was changed\./);assert.match(text,/Details: Private journal unavailable: authentication required\./);
  const button=all(panel,node=>node.attrs.id==='journal-sync')[0];assert.equal(button.attrs['data-journal-action'],'sync');assert.equal(plain(button),'Try again');
  assert.doesNotMatch(html,/Check journal sync/);
  h.held.get=deferred();h.click('sync');await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.app.html('journal'),/data-desk-state="loading"[\s\S]*id="journal-sync"[^>]*aria-disabled="true" aria-busy="true">Working…/);
  h.held.get.resolve();h.held.get=null;await settle(h.app);
});

test('keyboard focus stays on the sync button through Working… and back',{concurrency:false},async t=>{
  const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
  const renderer=source.slice(source.indexOf('function disclosureKey('),source.indexOf('let rightsExpiryTimer;'));
  const doc=createDocument('<body><main id="main" tabindex="-1"><section id="view-content"></section></main></body>');
  doc.removeEventListener=(kind,fn)=>doc.listeners.set(kind,(doc.listeners.get(kind)||[]).filter(item=>item!==fn));
  const renderContent=new Function('document','state',`let renderedView,renderedContentHTML,lastFocus;const disclosureState=new Map();const $=s=>document.querySelector(s);${renderer};return renderContent;`)(doc,{view:'journal'});
  const remote=domain.createJournal({journalId:'synthetic-ui-d-focus',at});let hold=null;
  const app=createDeskTools({document:doc,now:()=>at,uuid:()=>'synthetic-ui-d-focus',onChange:()=>renderContent(app.html('journal')),fetch:async(url,options)=>{
    if(options.method==='GET'&&hold)await hold.promise;
    return new Response(JSON.stringify({ok:true,journal:remote,revision:remote.revision,automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:['publisher_unconfigured']}}),{status:200});
  }});
  t.after(async()=>{hold?.resolve();await settle(app);app.destroy();});
  await app.start();await settle(app);renderContent(app.html('journal'));
  const first=doc.querySelector('#journal-sync');first.focus();assert.equal(doc.activeElement,first);
  hold=deferred();first.dispatch({type:'click',target:first});
  const busy=doc.querySelector('#journal-sync');
  assert.notEqual(busy,first,'the view re-rendered');assert.equal(busy.textContent,'Working…');assert.equal(busy.getAttribute('aria-disabled'),'true');
  assert.equal(doc.activeElement,busy,'focus must not fall back to main');
  hold.resolve();hold=null;await settle(app);
  const idle=doc.querySelector('#journal-sync');assert.equal(idle.textContent,'Check journal sync');assert.equal(idle.getAttribute('aria-disabled'),null);assert.equal(doc.activeElement,idle);
});

test('style.css holds one area D block: P&L figures are uncoloured and no protected token is declared',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  const start=css.indexOf('/* == area:D journal == */'),end=css.indexOf('/* == end area:D == */');
  assert.ok(start>0&&end>start);assert.equal(css.indexOf('/* == area:D journal == */',start+1),-1);
  const block=css.slice(start,end);
  assert.match(block,/\.journal-pnl dd,\.journal-pnl \.pnl-positive,\.journal-pnl \.pnl-negative\{color:var\(--ink,#1d2926\)\}/);
  assert.doesNotMatch(block,/--(?:ink|muted|paper|white)\s*:/);
  assert.doesNotMatch(block,/\.utility-desk :is\(select,\[tabindex\]\):focus-visible/);
  assert.doesNotMatch(block,/(?:\.journal-storage|\.desk-feedback|\.journal-accrual|\.journal-no-order)[^{}]*\{[^}]*(?:display:none|visibility:hidden)/);
});
