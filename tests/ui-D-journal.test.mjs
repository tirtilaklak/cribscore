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
const WINDOW_NOTE='Each card shows its window (the trading days this research covers). A window is 1 or 5 trading days.';
// R-1: the journal records the assessments it observes while the app is open. An abstention is the desk's record.
const RECORDS='The journal records each assessment while this app is open.';
const ABSTENTION='An assessment that finds no eligible stock is saved as an abstention (a record that the desk had nothing eligible).';
const ELIGIBLE='A stock is eligible when it passes every check needed before it can be ranked.';
// No copy may claim a record for every calendar day or while the app is closed (old charter copy and mutation M22).
const DAY_CLAIM=/\b(?:(?:a|each|every|any) (?:calendar |trading )?day|(?:calendar |trading )?days)\b[^.<>]{0,60}?\b(?:no|without an?) eligible\b|\b(?:each|every) (?:calendar |trading )?day[’']s\b|\bevery (?:calendar |trading )?day\b|\bdaily assessments?\b|\bwhile (?:the|this) app is closed\b/i;
// An abstention is not a trade decision, so paper and real trades stay apart.
const TRADE_BLUR=/decision not to trade|Why there was no (?:paper |real )?trade/i;
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
    if(state!=='synced')assert.match(plain(storage),/Export a backup of any records that are only on this device or not yet saved\./);
  }
});

test('R-5: the outcome line takes keyboard focus, so a capped line that scrolls stays readable, and it adds no role',()=>{
  for(const options of [{feedback:'Synthetic outcome'},{feedback:'Synthetic outcome',setupPending:true}]){
    const line=byClass(parse(renderJournalView(model(),options)),'desk-feedback')[0];
    assert.equal(line.tag,'p');assert.equal(line.attrs.tabindex,'0');assert.equal(plain(line),'Synthetic outcome');
    for(const name of ['role','aria-live','aria-label'])assert.equal(line.attrs[name],undefined,`no ${name} on the outcome line`);
  }
  assert.equal(byClass(parse(renderJournalView(model())),'desk-feedback').length,0,'no empty focus stop without a message');
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
  assert.match(html,/The first assessment will appear here\. No trades or returns have been added\./);
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
  // R-11: windows are named in trading days, the same pair as the desk's window toggle.
  assert.deepEqual(byClass(dom,'eyebrow').map(plain),['2026-10-17 · 5 trading days','2026-10-17 · 1 trading day','2026-10-17 · Journal event']);
  assert.equal(plain(all(all(dom,node=>node.attrs['data-journal-entry']==='week')[0],node=>node.tag==='h3')[0]),'No eligible stock');
  assert.doesNotMatch(html,/TARGET|target|Context observation|>Open<|>Closed<|>Abstain<|\d-day window/);
  // MK11.11 (reworded with R70): the abstention context keeps "recorded", the journal's own knowledge.
  // R-1: the summary names the desk's record. It never calls an abstention a trade decision.
  assert.match(html,/<summary>Why nothing was eligible<\/summary><p>No eligible published research was recorded for this date and window\.<\/p>/);
  assert.doesNotMatch(html,TRADE_BLUR);assert.doesNotMatch(html,DAY_CLAIM);
  const facts=byClass(all(dom,node=>node.attrs['data-journal-entry']==='week')[0],'desk-facts')[0];
  assert.deepEqual(elements(facts).map(row=>plain(elements(row)[0])).filter(label=>/window/i.test(label)),['Window','Snapshot window start','Snapshot window end']);
  assert.deepEqual(elements(facts).map(row=>elements(row).map(plain)).find(([label])=>label==='Window'),['Window','5 trading days']);
  const duplicate=all(dom,node=>node.attrs['data-journal-entry']==='other')[0];
  assert.match(plain(duplicate),/The journal saw this decision again\. It did not add a second paper trade\./);
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
  // R-12: no inline style can colour a figure, and a figure carries no class beyond the sign pair block D neutralises.
  assert.equal(all(dom,node=>Object.hasOwn(node.attrs,'style')||node.tag==='font').length,0,'no inline style or font tag colours a figure');
  for(const list of lists)for(const figure of all(list,node=>node.tag==='dd'))assert.match(figure.attrs.class??'',/^(?:|pnl-positive|pnl-negative)$/,'P&L figures keep only the neutralised sign classes');
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

test('settings explain each paper assumption without trade words, and a count of one reads in the singular',()=>{
  const settingsBlock=all(parse(renderJournalView(model())),node=>node.attrs['data-state-key']===JSON.stringify(['journal','settings',null,null]))[0],text=plain(settingsBlock);
  assert.match(text,/Commission per fill is the assumed broker fee each time a paper trade opens or closes\./);
  assert.match(text,/The benchmark is the symbol each paper trade is compared with \(SPY by default\)\./);
  assert.doesNotMatch(text,/\b(?:buy|sell|fund)\b/i,'only the fill form side field says buy or sell; any symbol can be the benchmark');
  const one=paperEntry('one-bp','open');one.paper.assumptions={...settings,slippageBps:1};
  const facts=entry=>plain(all(parse(renderJournalView(model([entry],{decisions:1,open:1}))),node=>node.attrs['data-state-key']===JSON.stringify(['journal','paper',entry.id,null]))[0]);
  assert.match(facts(one),/Slippage per fill1 basis point(?!s)/);assert.match(facts(paperEntry('five-bp','open')),/Slippage per fill5 basis points/);
});

test('first-run and unconfirmed check codes read as plain sentences',()=>{
  const html=renderJournalView(model(),{automation:{publisherState:'unavailable',checkedAt:null,pendingReasons:['observation_not_checked','observation_not_confirmed','publisher_unconfigured','publisher_unavailable']}});
  const status=all(parse(html),node=>node.attrs['data-publisher-state']==='unavailable')[0];
  assert.equal(plain(elements(status)[0]),'Research source not checked');
  assert.deepEqual(all(status,node=>node.tag==='li').map(plain),['The first check has not run yet.','The last check was not confirmed.','The research source is not connected.','The research source is not responding.']);
  assert.doesNotMatch(html,/observation_not|observation not|publisher_un|Some required information is unavailable|suggestion/i);
});

function controller(t,{remote=null,failLoad=false}={}){
  const handlers={},held={get:null},requests=[];let current=remote;
  const doc={querySelector:()=>null,addEventListener:(name,fn)=>{handlers[name]=fn;},removeEventListener(){}};
  const reply=(body,status=200)=>({ok:status===200,status,json:async()=>body});
  const app=createDeskTools({document:doc,now:()=>at,uuid:()=>'synthetic-ui-d',fetch:async(url,options)=>{
    requests.push(`${options.method||'GET'} ${url}`);
    if(url.endsWith('/observe'))return reply({ok:true,journal:current,revision:current.revision,automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:['publisher_unconfigured']}});
    if(options.method==='GET'){if(held.get)await held.get.promise;return failLoad?reply({ok:false,error:'authentication_required'},401):reply({ok:true,journal:current,revision:current?.revision??0});}
    current=JSON.parse(options.body).journal;return reply({ok:true,journal:current,revision:current.revision});
  }});
  t.after(async()=>{held.get?.resolve();await settle(app);app.destroy();});
  return {app,held,requests,click:name=>{const target={dataset:{journalAction:name},closest:()=>target};handlers.click({target});}};
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

test('R-1 and R-11: setup card and overview say what the journal records, and gloss eligible and paper trade at first use',{concurrency:false},async t=>{
  const h=controller(t);await h.app.start();
  const before=h.app.html('journal'),beforeText=plain(parse(before));
  assert.ok(plain(byClass(parse(before),'journal-setup')[0]).includes(`Nothing is recorded yet. Once you start, the journal records each assessment while this app is open. ${ABSTENTION} ${ELIGIBLE}`));
  h.click('start');await settle(h.app);
  const after=h.app.html('journal'),afterText=plain(parse(after));
  assert.ok(plain(byClass(parse(after),'journal-overview')[0]).includes(`${RECORDS} ${ABSTENTION} ${ELIGIBLE} Automatic paper trades (practice trades with no real money) need a reviewed research source and a reviewed price feed. Neither is connected yet. Missing prices stay pending.`));
  const withEntries=renderJournalView(model([plainEntry('day','abstain','next_day'),plainEntry('week','abstain','next_week')],{decisions:2,abstentions:2}),{automation:{publisherState:'unconfigured',checkedAt:at,pendingReasons:[]}});
  for(const [state,html,text] of [['before start',before,beforeText],['after start',after,afterText],['with entries',withEntries,plain(parse(withEntries))]]){
    assert.doesNotMatch(html,DAY_CLAIM,state);assert.doesNotMatch(html,TRADE_BLUR,state);
    const sentence=text.indexOf(ABSTENTION),eligible=text.search(/eligible/i);
    assert.ok(sentence>=0&&eligible>sentence&&eligible<sentence+ABSTENTION.length,`${state}: eligible is first used in the abstention sentence`);
    assert.equal(text.indexOf(`${ABSTENTION} ${ELIGIBLE}`),sentence,`${state}: the eligible gloss follows its first use`);
    assert.match(text.slice(text.search(/paper/i)),/^paper trades \(practice trades with no real money\)/i,`${state}: paper trade is glossed at first use`);
  }
});

test('the sync button keeps its id and uses aria-disabled while busy, never disabled',{concurrency:false},async t=>{
  const h=controller(t,{remote:domain.createJournal({journalId:'synthetic-ui-d-sync',at})});await h.app.start();
  assert.match(h.app.html('journal'),/<button type="button" id="journal-sync" class="desk-button desk-button-secondary" data-journal-action="sync">Check journal sync<\/button>/);
  h.held.get=deferred();h.click('sync');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.app.status().busy,true);
  const busy=h.app.html('journal');
  assert.match(busy,/<button type="button" id="journal-sync" class="desk-button desk-button-secondary" data-journal-action="sync" aria-disabled="true" aria-busy="true">Working…<\/button>/);
  assert.doesNotMatch(busy,/ disabled[ >=]/);
  // An aria-disabled button can still be pressed. Pressing it while busy must change nothing (verify-tests NIT).
  const before=h.requests.length;h.click('sync');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.requests.length,before,'an aria-disabled sync control sends no request while busy');assert.equal(h.app.status().busy,true);
  h.held.get.resolve();h.held.get=null;await settle(h.app);
  assert.doesNotMatch(h.app.html('journal'),/aria-disabled|aria-busy/);
});

test('loading and failure panels expose their state; failure offers Try again and never sounds ready',{concurrency:false},async t=>{
  const h=controller(t,{failLoad:true});
  const loading=parse(h.app.html('journal'));
  assert.equal(all(loading,node=>node.attrs['data-desk-state']==='loading').length,1);assert.equal(plain(all(loading,node=>node.tag==='h2')[0]),'Loading the journal');
  assert.equal(plain(all(loading,node=>node.tag==='p')[0]),'Connecting to the private journal…');
  await h.app.start();
  const html=h.app.html('journal'),panel=all(parse(html),node=>node.attrs['data-desk-state']==='unavailable')[0];assert.ok(panel);
  assert.equal(plain(all(panel,node=>node.tag==='h2')[0]),'The journal did not load');
  const text=plain(panel);assert.doesNotMatch(text,/ready/i);
  assert.match(text,/No records are shown, and nothing was changed\./);assert.match(text,/Details: Private journal unavailable: authentication required\./);
  const button=all(panel,node=>node.attrs.id==='journal-sync')[0];assert.equal(button.attrs['data-journal-action'],'sync');assert.equal(plain(button),'Try again');
  assert.doesNotMatch(html,/Check journal sync/);
  h.held.get=deferred();h.click('sync');await new Promise(resolve=>setImmediate(resolve));
  const retry=h.app.html('journal');
  assert.match(retry,/data-desk-state="loading"[\s\S]*id="journal-sync"[^>]*aria-disabled="true" aria-busy="true">Working…/);
  // While the retry loads, the panel shows the neutral loading line, never the last failure (verify-frontend NIT).
  const retryPanel=all(parse(retry),node=>node.attrs['data-desk-state']==='loading')[0];
  assert.equal(plain(all(retryPanel,node=>node.tag==='p')[0]),'Connecting to the private journal…');
  assert.doesNotMatch(plain(retryPanel),/unavailable|authentication|did not load|Details:/i);
  h.held.get.resolve();h.held.get=null;await settle(h.app);
  assert.match(plain(all(parse(h.app.html('journal')),node=>node.attrs['data-desk-state']==='unavailable')[0]),/Details: Private journal unavailable: authentication required\./,'a second failure shows its details again');
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

// R-12 helpers. A selector "could colour" a P&L figure when its last compound fits the figure (a dd that may carry
// either sign class) and each other compound fits an element the figure sits in (or any element, after + or ~).
// The test is conservative: pseudo-classes, attribute tests and :is()/:not() arguments are ignored, so they never
// hide a rule. Facts and counters (.desk-facts dd, .journal-counts dd) sit outside .journal-pnl and stay out of scope.
const describe=node=>({tag:node.tag,classes:(node.attrs.class||'').split(/\s+/).filter(Boolean),id:node.attrs.id});
const trails=(node,predicate,trail=[])=>{if(typeof node==='string')return [];const here=[...trail,node];return [...(predicate(node)?[here]:[]),...node.children.flatMap(child=>trails(child,predicate,here))];};
const topLevel=(text,separator)=>{const parts=[];let depth=0,current='';for(const char of text){if('(['.includes(char))depth++;if(')]'.includes(char))depth--;if(!depth&&separator.test(char)){parts.push(current);current='';}else current+=char;}return [...parts,current].map(part=>part.trim()).filter(Boolean);};
const chainOf=selector=>{const out=[];let depth=0,current='';const flush=()=>{if(current){out.push({compound:current,next:null});current='';}};for(const char of selector.trim()){if('(['.includes(char))depth++;if(')]'.includes(char))depth--;if(!depth&&/[\s>+~]/.test(char)){flush();if(out.length&&(/[>+~]/.test(char)||out.at(-1).next===null))out.at(-1).next=/\s/.test(char)?' ':char;continue;}current+=char;}flush();return out;};
const partsOf=compound=>{const bare=compound.replace(/\((?:[^()]|\([^()]*\))*\)/g,'').replace(/\[[^\]]*\]/g,'');return {tag:(bare.match(/^[a-z][a-z0-9-]*/i)||[''])[0].toLowerCase(),classes:[...bare.matchAll(/\.([\w-]+)/g)].map(match=>match[1]),ids:[...bare.matchAll(/#([\w-]+)/g)].map(match=>match[1])};};
const fits=(part,node)=>(!part.tag||part.tag===node.tag)&&part.classes.every(name=>node.classes.includes(name))&&part.ids.every(id=>id===node.id);

test('style.css holds one area D block: P&L figures are uncoloured and no protected token is declared',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  const start=css.indexOf('/* == area:D journal == */'),end=css.indexOf('/* == end area:D == */');
  assert.ok(start>0&&end>start);assert.equal(css.indexOf('/* == area:D journal == */',start+1),-1);
  const block=css.slice(start,end);
  assert.match(block,/\.journal-pnl dd,\.journal-pnl \.pnl-positive,\.journal-pnl \.pnl-negative\{color:var\(--ink,#1d2926\)\}/);
  assert.doesNotMatch(block,/--(?:ink|muted|paper|white)\s*:/);
  assert.doesNotMatch(block,/\.utility-desk :is\(select,\[tabindex\]\):focus-visible/);
  assert.doesNotMatch(block,/(?:\.journal-storage|\.desk-feedback|\.journal-accrual|\.journal-no-order)[^{}]*\{[^}]*(?:display:none|visibility:hidden)/);
  // R-12: colour can come back from any block. Scan every rule in the whole file, nested ones included.
  const entry=paperEntry('cascade','closed');entry.actual={confirmed:true,confirmedAt:at,realizedPnl:'-2.000000',openPnl:null,dividendAccrual:'0.500000',totalPnl:'-1.500000',fills:[]};
  const view=parse(renderJournalView(model([entry],{decisions:1,closed:1,actualConfirmations:1})));
  // The shell is read with the tolerant interaction DOM, as the shell tests read it.
  const shell=createDocument(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'));
  const shellNode=node=>({tag:node.tagName.toLowerCase(),classes:node.className.split(/\s+/).filter(Boolean),id:node.id||undefined});
  const shellAll=node=>[node,...node.children.filter(child=>child.tagName!=='#TEXT').flatMap(shellAll)];
  const shellChain=[{tag:'html',classes:[],id:undefined}];for(let node=shell.querySelector('#view-content');node;node=node.parentElement)shellChain.splice(1,0,shellNode(node));
  assert.deepEqual(shellChain.slice(-2).map(node=>node.id),['main','view-content'],'the journal renders inside #view-content in #main');
  const figures=trails(view,node=>hasClass(node,'journal-pnl')).flatMap(list=>trails(list.at(-1),node=>node.tag==='dd').map(inner=>[...list.slice(0,-1),...inner]));
  assert.equal(figures.length,10,'six paper and four actual figures');
  const ancestors=[...shellChain,...figures.flatMap(trail=>trail.slice(0,-1)).filter(node=>node.tag!=='root').map(describe)];
  const everyone=[...shellChain,...shellAll(shell.body).map(shellNode),...all(view,()=>true).filter(node=>node.tag!=='root').map(describe)];
  const figure={tag:'dd',classes:['pnl-positive','pnl-negative'],id:undefined};
  const couldColour=selector=>{const chain=chainOf(selector);if(!chain.length||!fits(partsOf(chain.at(-1).compound),figure))return false;return chain.slice(0,-1).every(({compound,next})=>(/[+~]/.test(next)?everyone:ancestors).some(node=>fits(partsOf(compound),node)));};
  const rules=[...css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selectors,body])=>({selectors:selectors.trim(),body}));
  const touching=rules.filter(rule=>/(?:^|;)\s*(?:-webkit-text-fill-)?color\s*:/.test(rule.body)&&topLevel(rule.selectors,/,/).some(couldColour));
  const tinted=touching.filter(rule=>[...rule.body.matchAll(/(?:^|;)\s*(?:-webkit-text-fill-)?color\s*:\s*([^;]+)/g)].some(([,value])=>!/^(?:var\(--ink(?:,\s*#1d2926)?\)|#1d2926)$/i.test(value.trim())));
  assert.deepEqual(tinted.map(rule=>rule.selectors),['.pnl-positive','.pnl-negative'],'only the base sign pair may tint a figure, and block D overrides it with a more specific ink rule');
  assert.equal(touching.filter(rule=>/!important/.test(rule.body)).length,0,'no forced colour reaches a figure');
  // Visual NIT: one mint line colour for the lead panel. Counters: two rows of three at 681–760 px (verify-visual SHOULD).
  assert.match(block,/\.journal-setup,\.journal-overview\{[^}]*border-color:var\(--mint-line,#c7d2c1\)/);assert.doesNotMatch(block,/#cbd7c3/);
  assert.match(block,/@media\(min-width:681px\) and \(max-width:760px\)\{\.journal-counts\{grid-template-columns:repeat\(3,max-content\)\}\}/);
});
