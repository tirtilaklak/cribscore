// Outcome line placement in the Prices and Journal views. feedbackAnchor names the control that
// produced the message; the line then renders right after that control as a static sibling.
// Synthetic models only; nothing is saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderJournalView} from '../dist/lib/journal-view.js';
import {renderPriceView} from '../dist/lib/price-view.js';
import {parsePriceImport,buildPriceView} from '../dist/lib/prices.js';
import {createDocument} from './helpers/interaction-dom.mjs';

const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const elements=node=>node.children.filter(child=>typeof child!=='string');
const classes=node=>(node.attrs.class||'').split(/\s+/).filter(Boolean);
const hasClass=(node,name)=>classes(node).includes(name);
const plain=node=>typeof node==='string'?node:node.children.map(plain).join('');
// Every root-to-node path whose last node matches.
const paths=(node,predicate,trail=[])=>typeof node==='string'?[]:[...(predicate(node)?[[...trail,node]]:[]),...node.children.flatMap(child=>paths(child,predicate,[...trail,node]))];
// The one outcome line of a page, with its neighbours.
function lineOf(html){
  const found=paths(parse(html),node=>hasClass(node,'desk-feedback'));
  assert.equal(found.length,1,'exactly one outcome line on the page');
  const path=found[0],line=path.at(-1),parent=path.at(-2),siblings=elements(parent),index=siblings.indexOf(line);
  return {line,parent,previous:siblings[index-1]||null,next:siblings[index+1]||null,ancestors:path.slice(0,-1)};
}

// ---- cases: scratch digests.mjs repeats these to compare with 7e7f6a9 ----
const at='2026-10-17T18:00:00Z';
const settings={paperNotional:'100.000000',commissionPerFill:'0.000000',slippageBps:5,currency:'USD',benchmarkSymbol:'SPY'};
const model=(entries=[],summary={},storage={state:'synced',message:'Synthetic storage message'})=>({settings,storage,summary,entries,assumptions:['synthetic_rule']});
const PAPER='synthetic:AAA:intent',CONFIRMED='synthetic:BBB:intent',FILL='fill:1';
const paperEntry=(id,status='pending')=>({id,date:'2026-10-17',status,symbol:'TEST',company:'Synthetic fixture',horizonId:'next_day',reason:'Synthetic reason',context:{},paper:{status,quantity:'1',entryPrice:'10',exitPrice:null,realizedPnl:null,openPnl:null,dividendAccrual:null,totalPnl:null,benchmarkPnl:null,excessPnl:null,pendingReasons:[],assumptions:settings},actual:{confirmed:false,fills:[]},revisions:[]});
const confirmedEntry=id=>({...paperEntry(id,'open'),actual:{confirmed:true,confirmedAt:at,realizedPnl:null,openPnl:null,dividendAccrual:null,totalPnl:null,fills:[{id:FILL,side:'buy',occurredAt:at,quantity:'1',price:'10',fee:'0'}]}});
const SYNC='<button type="button" id="journal-sync" class="desk-button desk-button-secondary" data-journal-action="sync">Check journal sync</button>';
const MESSAGE='Synthetic <outcome> & result.';
const trades=()=>model([paperEntry(PAPER),confirmedEntry(CONFIRMED)],{decisions:2,pending:1,open:1,actualConfirmations:1});
const raw=await readFile(new URL('../docs/examples/synthetic-price-import.json',import.meta.url),'utf8');
const example=()=>buildPriceView(parsePriceImport(raw,{at}).series[0],{at});
const symbolOptions=[{symbol:'IBM',label:'IBM · International Business Machines'},{symbol:'TSLA',label:'TSLA · Tesla'}];
const journalCases=()=>[[model(),{feedback:MESSAGE,syncControl:SYNC}],[model(),{feedback:MESSAGE,setupPending:true,importPreview:{message:'1 new event(s)'}}],[trades(),{feedback:MESSAGE,syncControl:SYNC,importPreview:{message:'1 new event(s)'}}],[null,{feedback:MESSAGE}]];
const priceCases=()=>[[null,{symbol:'IBM',symbolOptions,feedback:MESSAGE}],[example(),{symbol:'DEMO',hosted:{status:'idle',url:null,symbol:'DEMO'},feedback:MESSAGE}],[null,{symbol:'IBM',symbolOptions,hosted:{status:'requested',url:'https://www.tradingview.com/chart/?symbol=NYSE%3AIBM',symbol:'IBM'},feedback:MESSAGE}]];
// ---- end cases ----

const INLINE=`<p class="desk-feedback desk-feedback-inline">Synthetic &lt;outcome&gt; &amp; result.</p>`;
const TOP=`<p class="desk-feedback" tabindex="0">Synthetic &lt;outcome&gt; &amp; result.</p>`;
const journalForm=(kind,id,fill)=>node=>node.tag==='form'&&node.attrs['data-journal-form']===kind&&(id===undefined||node.attrs['data-journal-id']===id)&&(fill===undefined||node.attrs['data-journal-fill-id']===fill);
const holds=predicate=>node=>!!node&&paths(node,predicate).length>0;
const action=(name,id)=>node=>node.attrs['data-journal-action']===name&&(id===undefined||node.attrs['data-journal-id']===id);
const stateKey=(...parts)=>JSON.stringify(['journal',...parts]);

// Each case: render options, then where the line must stand.
const journalAnchored=[
  ['form:settings, started',model(),{syncControl:SYNC,feedbackAnchor:'form:settings'},({previous,parent})=>{assert.ok(journalForm('settings')(previous));assert.equal(parent.attrs['data-state-key'],stateKey('settings',null,null));}],
  ['form:settings, before start',model(),{setupPending:true,feedbackAnchor:'form:settings'},({previous})=>assert.ok(journalForm('settings')(previous))],
  ['form:import',model(),{syncControl:SYNC,feedbackAnchor:'form:import'},({previous,parent})=>{assert.ok(journalForm('import')(previous));assert.equal(parent.attrs['data-state-key'],stateKey('backup',null,null));}],
  ['form:import with a review open',model(),{syncControl:SYNC,feedbackAnchor:'form:import',importPreview:{message:'m'}},({previous,next})=>{assert.ok(journalForm('import')(previous));assert.ok(hasClass(next,'desk-notice'),'the review notice follows the line');}],
  ['action:export',model(),{syncControl:SYNC,feedbackAnchor:'action:export'},({previous})=>{assert.ok(hasClass(previous,'desk-actions'));assert.ok(holds(action('export'))(previous));}],
  ['action:confirm-import with the review open',model(),{syncControl:SYNC,feedbackAnchor:'action:confirm-import',importPreview:{message:'m'}},({previous})=>{assert.ok(hasClass(previous,'desk-notice'));assert.ok(holds(action('confirm-import'))(previous));}],
  ['action:cancel-import with the review open',model(),{syncControl:SYNC,feedbackAnchor:'action:cancel-import',importPreview:{message:'m'}},({previous})=>{assert.ok(hasClass(previous,'desk-notice'));assert.ok(holds(action('cancel-import'))(previous));}],
  ['action:sync, started',model(),{syncControl:SYNC,feedbackAnchor:'action:sync'},({previous,parent})=>{assert.ok(hasClass(previous,'journal-storage'));assert.ok(holds(node=>node.attrs.id==='journal-sync')(previous));assert.ok(hasClass(parent,'journal-overview'));}],
  ['form:save-fill',trades(),{syncControl:SYNC,feedbackAnchor:'form:save-fill:synthetic%3ABBB%3Aintent'},({previous,parent})=>{assert.ok(journalForm('save-fill',CONFIRMED)(previous));assert.equal(parent.attrs['data-state-key'],stateKey('new-fill',CONFIRMED,null));}],
  ['form:revise-fill',trades(),{syncControl:SYNC,feedbackAnchor:'form:revise-fill:synthetic%3ABBB%3Aintent:fill%3A1'},({previous,parent})=>{assert.ok(journalForm('revise-fill',CONFIRMED,FILL)(previous));assert.equal(parent.attrs['data-state-key'],stateKey('fill',CONFIRMED,FILL));}],
  ['action:confirm-actual with its prompt',trades(),{syncControl:SYNC,feedbackAnchor:'action:confirm-actual:synthetic%3AAAA%3Aintent'},({previous,parent})=>{assert.ok(hasClass(previous,'journal-confirm'));assert.ok(holds(action('confirm-actual',PAPER))(previous));assert.equal(parent.attrs['data-journal-entry'],PAPER);}],
];
// The action removed its own control, so the line stands where that control stood.
const journalReplaced=[
  ['action:start before start (the host setup card sits right above)',model(),{setupPending:true,feedbackAnchor:'action:start'},({parent,previous,next})=>{assert.ok(hasClass(parent,'journal-desk'));assert.equal(previous,null);assert.ok(hasClass(next,'journal-storage'));}],
  ['action:start after start (where the setup card stood)',model(),{syncControl:SYNC,feedbackAnchor:'action:start'},({parent,previous,next})=>{assert.ok(hasClass(parent,'journal-desk'));assert.equal(previous,null);assert.ok(hasClass(next,'journal-overview'));}],
  ['action:sync before start (its button is in the host setup card)',model(),{setupPending:true,feedbackAnchor:'action:sync'},({parent,previous,next})=>{assert.ok(hasClass(parent,'journal-desk'));assert.equal(previous,null);assert.ok(hasClass(next,'journal-storage'));}],
  ['action:confirm-import after the review closed',model(),{syncControl:SYNC,feedbackAnchor:'action:confirm-import'},({previous,next})=>{assert.ok(journalForm('import')(previous));assert.equal(next,null);}],
  ['action:cancel-import after the review closed',model(),{syncControl:SYNC,feedbackAnchor:'action:cancel-import'},({previous,next})=>{assert.ok(journalForm('import')(previous));assert.equal(next,null);}],
  ['action:confirm-actual after the trade was confirmed',trades(),{syncControl:SYNC,feedbackAnchor:'action:confirm-actual:synthetic%3ABBB%3Aintent'},({parent,previous,next})=>{assert.equal(parent.attrs['data-journal-entry'],CONFIRMED);assert.ok(hasClass(next,'journal-actual'));assert.ok(hasClass(previous,'journal-account')&&!hasClass(previous,'journal-actual'),'after the paper section');}],
];
const priceAnchored=[
  ['form:selection',null,{symbol:'IBM',symbolOptions,feedbackAnchor:'form:selection'},({previous,parent})=>{assert.equal(previous.attrs['data-price-form'],'selection');assert.ok(hasClass(parent,'desk-controls'));}],
  ['form:import',null,{symbol:'IBM',symbolOptions,feedbackAnchor:'form:import'},({previous,parent})=>{assert.equal(previous.attrs['data-price-form'],'import');assert.equal(parent.attrs['data-state-key'],'prices:import');}],
  ['form:import with imported prices',example(),{symbol:'DEMO',hosted:{status:'idle',url:null,symbol:'DEMO'},feedbackAnchor:'form:import'},({previous})=>assert.equal(previous.attrs['data-price-form'],'import')],
  // The chart replaces the load button inside its box, so the line stands where the button stood: just above the box.
  ...['idle','requested'].map(status=>[`action:load-hosted, ${status}`,null,{symbol:'IBM',symbolOptions,hosted:{status,url:'https://www.tradingview.com/chart/?symbol=NYSE%3AIBM',symbol:'IBM'},feedbackAnchor:'action:load-hosted'},({next,parent,ancestors})=>{assert.equal(next.attrs.id,'hosted-price-chart');assert.ok(hasClass(parent,'hosted-price-panel'));assert.ok(!ancestors.some(node=>node.attrs.id==='hosted-price-chart'),'never inside the box the chart replaces');}]),
  ['action:load-hosted, no chart for the symbol',example(),{symbol:'DEMO',hosted:{status:'idle',url:null,symbol:'DEMO'},feedbackAnchor:'action:load-hosted'},({next})=>assert.equal(next.attrs.id,'hosted-price-chart')],
];
const allAnchored=[...journalAnchored.map(([name,m,o,check])=>[name,()=>renderJournalView(m,{feedback:MESSAGE,...o}),()=>renderJournalView(m,{...o,feedback:MESSAGE,feedbackAnchor:null}),check]),
  ...journalReplaced.map(([name,m,o,check])=>[name,()=>renderJournalView(m,{feedback:MESSAGE,...o}),()=>renderJournalView(m,{...o,feedback:MESSAGE,feedbackAnchor:null}),check]),
  ...priceAnchored.map(([name,m,o,check])=>[name,()=>renderPriceView(m,{feedback:MESSAGE,...o}),()=>renderPriceView(m,{...o,feedback:MESSAGE,feedbackAnchor:null}),check])];

test('each journal control gets its outcome line right after it',()=>{
  for(const [name,m,options,check] of journalAnchored){const found=lineOf(renderJournalView(m,{feedback:MESSAGE,...options}));assert.ok(hasClass(found.line,'desk-feedback-inline'),name);check(found);}
});

test('when an action removes its own control, the line stands where that control stood',()=>{
  for(const [name,m,options,check] of journalReplaced){const html=renderJournalView(m,{feedback:MESSAGE,...options}),found=lineOf(html);assert.ok(hasClass(found.line,'desk-feedback-inline'),name);check(found);}
  // Closed review: the Apply and Cancel buttons are gone with it.
  assert.doesNotMatch(renderJournalView(model(),{feedback:MESSAGE,feedbackAnchor:'action:confirm-import'}),/data-journal-action="(?:confirm|cancel)-import"/);
});

test('each Prices control gets its outcome line right after it',()=>{
  for(const [name,m,options,check] of priceAnchored){const found=lineOf(renderPriceView(m,{feedback:MESSAGE,...options}));assert.ok(hasClass(found.line,'desk-feedback-inline'),name);check(found);}
});

test('an inline line is one static sibling: no tabindex, no role, never inside a form, text escaped',()=>{
  for(const [name,render] of allAnchored){
    const html=render(),{line,ancestors}=lineOf(html);
    assert.equal(line.tag,'p',name);assert.deepEqual(classes(line),['desk-feedback','desk-feedback-inline'],name);
    for(const attribute of ['tabindex','role','aria-live','aria-label','id'])assert.equal(line.attrs[attribute],undefined,`${name}: no ${attribute}`);
    assert.ok(!ancestors.some(node=>node.tag==='form'),`${name}: never inside a form, which app.js swaps when dirty`);
    assert.equal(plain(line),'Synthetic <outcome> & result.',name);
    assert.equal(html.split(INLINE).length,2,`${name}: the escaped line appears once`);assert.ok(!html.includes(TOP),`${name}: no top line`);
  }
});

test('the anchor moves only the line: everything else is byte-identical to the unanchored render',()=>{
  for(const [name,render,unanchored] of allAnchored){
    const anchored=render(),plainRender=unanchored();
    assert.ok(plainRender.includes(TOP),`${name}: unanchored keeps the top line`);
    assert.equal(anchored.replace(INLINE,''),plainRender.replace(TOP,''),name);
  }
});

test('without a matching control on the page the line stays at the top, as before',()=>{
  const top=(html,before)=>{const {line,previous}=lineOf(html);assert.deepEqual(classes(line),['desk-feedback']);assert.equal(line.attrs.tabindex,'0');before(previous);};
  const afterOverview=previous=>assert.ok(hasClass(previous,'journal-overview'));
  // Background messages carry no anchor; unknown or absent controls fall back too.
  for(const feedbackAnchor of [null,undefined,'','form:unknown','action:show-all','form:save-fill:missing-entry','form:revise-fill:synthetic%3ABBB%3Aintent:missing-fill','action:confirm-actual:missing-entry','form:selection','action:load-hosted','form:save-fill:synthetic:BBB:intent'])
    top(renderJournalView(trades(),{feedback:MESSAGE,syncControl:SYNC,feedbackAnchor}),afterOverview);
  top(renderJournalView(model(),{feedback:MESSAGE,feedbackAnchor:'action:sync'}),afterOverview);// no sync button rendered here
  top(renderJournalView(trades(),{feedback:MESSAGE,setupPending:true,feedbackAnchor:'form:save-fill:synthetic%3ABBB%3Aintent'}),previous=>assert.ok(hasClass(previous,'journal-storage')));// history is hidden before start
  top(renderJournalView(trades(),{feedback:MESSAGE,syncControl:SYNC,selectedId:PAPER,feedbackAnchor:'form:save-fill:synthetic%3ABBB%3Aintent'}),afterOverview);// the entry is not shown
  for(const feedbackAnchor of [null,'form:settings','action:export','form:unknown','form:import:extra'])
    top(renderPriceView(null,{symbol:'IBM',symbolOptions,feedback:MESSAGE,feedbackAnchor}),previous=>assert.ok(hasClass(previous,'desk-controls')));
});

test('an anchor without a message renders no line at all',()=>{
  for(const feedbackAnchor of ['form:settings','action:start','action:export']){
    for(const feedback of [null,''])assert.equal(paths(parse(renderJournalView(model(),{syncControl:SYNC,feedback,feedbackAnchor})),node=>hasClass(node,'desk-feedback')).length,0);
  }
  for(const feedbackAnchor of ['form:selection','action:load-hosted','form:import'])assert.doesNotMatch(renderPriceView(null,{feedbackAnchor}),/desk-feedback/);
});

test('ids that hold colons cannot point at another entry\'s form',()=>{
  // Entry "a" with fill "b:c" and entry "a:b" with fill "c" would share a plain "a:b:c" key.
  const entry=(id,fill)=>({...confirmedEntry(id),actual:{...confirmedEntry(id).actual,fills:[{id:fill,side:'buy',occurredAt:at,quantity:'1',price:'10',fee:'0'}]}});
  const pair=model([entry('a','b:c'),entry('a:b','c')],{decisions:2,open:2,actualConfirmations:2});
  const first=lineOf(renderJournalView(pair,{feedback:MESSAGE,syncControl:SYNC,feedbackAnchor:'form:revise-fill:a:b%3Ac'}));
  assert.ok(journalForm('revise-fill','a','b:c')(first.previous));
  const second=lineOf(renderJournalView(pair,{feedback:MESSAGE,syncControl:SYNC,feedbackAnchor:'form:revise-fill:a%3Ab:c'}));
  assert.ok(journalForm('revise-fill','a:b','c')(second.previous));
});

test('no anchor keeps every render byte-identical to before (7e7f6a9)',()=>{
  const sha=text=>createHash('sha256').update(text).digest('hex');
  // Digests of the same cases rendered by the 7e7f6a9 modules, before feedbackAnchor existed.
  const before={
    journal:['56c4a89f01299637beb3f4232aa19513a63d795aea3a8ed063194e9d216339a5','2d709f31a96abee3f2fb8983654ada3a6fcc9729b381720aee5ff094e72a150d','5fdc8ce2fbf70ee59dd401eab3440c0b28b327342468c90ef898bcbe76b3f2e6','1ac1800e6dd1ac08bf0924359acb403d3c1d7016b5fc91d6f63bb00c53a96180'],
    prices:['2268b78683df1a644f15de1c698bcbc6a3f8543e5ff48d3d6d01b2b8df36a8ef','4d4cdbd1b434cb4c73548554f6accf002c8eb6beab8b72bfb7262ead08dd2896','7dbdaeb1abc1e493e2f109c8e9b126787808fefddfa4d615e1bb72d7fca764d6'],
  };
  assert.deepEqual(journalCases().map(([m,o])=>sha(renderJournalView(m,o))),before.journal,'a default journal render changed; if on purpose, recompute these digests');
  assert.deepEqual(priceCases().map(([m,o])=>sha(renderPriceView(m,o))),before.prices,'a default Prices render changed; if on purpose, recompute these digests');
  // Omitting the option, null and undefined render the same bytes.
  for(const [m,o] of journalCases())for(const feedbackAnchor of [null,undefined])assert.equal(renderJournalView(m,{...o,feedbackAnchor}),renderJournalView(m,o));
  for(const [m,o] of priceCases())for(const feedbackAnchor of [null,undefined])assert.equal(renderPriceView(m,{...o,feedbackAnchor}),renderPriceView(m,o));
  assert.equal(renderJournalView(),renderJournalView(null,{feedback:MESSAGE,feedbackAnchor:'form:settings'}),'no model, no journal: the anchor changes nothing');
});

test('the live region announces an inline line as it does the top one',async()=>{
  // app.js reads .desk-feedback anywhere in the view; an inline line sits deep inside a disclosure.
  const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function updateLoadStatus()'),source.indexOf('async function startLoad('));
  const announce=(view,html)=>{
    const document=createDocument(`<body><span id="breadcrumb-current">${view==='prices'?'Prices':'Journal'}</span><section id="view-content">${html}</section></body>`);
    let announced;new Function('state','$','loadKindsForView','loadStatus','loadConfig','loadRuns','announce',`${code};updateLoadStatus();`)({view,query:''},selector=>document.querySelector(selector),()=>[],()=>null,{},new Map(),message=>{announced=message;});
    return announced;
  };
  assert.equal(announce('journal',renderJournalView(trades(),{feedback:'Nothing saved: invalid fill.',syncControl:SYNC,feedbackAnchor:'form:save-fill:synthetic%3ABBB%3Aintent'})),'Nothing saved: invalid fill.');
  assert.equal(announce('prices',renderPriceView(null,{symbol:'IBM',feedback:'Import rejected.',feedbackAnchor:'form:import'})),'Import rejected.');
});
