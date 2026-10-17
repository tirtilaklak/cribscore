import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderStockView} from '../dist/lib/stock-view.js';
import {renderStockView as baselineView} from './fixtures/stock-view-before-slate.mjs';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {createApprovedSlateSlot,renderApprovedResearchView} from '../dist/lib/research-slate-view.js';
import {serializeResearchSlate} from '../server/research-slate/research-slate.mjs';
import {fixture,bindCase,at,expiry} from './fixtures/research-slate-fixtures.mjs';

const data=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
const snapshot=(horizon='next_week')=>buildStockSnapshot(data,horizon,at);
const dom=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,tag)=>[...(node.tag===tag?[node]:[]),...(node.children||[]).flatMap(child=>typeof child==='string'?[]:all(child,tag))];
const content=node=>typeof node==='string'?node:(node.children||[]).map(content).join('');
const members=(tree,cls)=>all(tree,'span').concat(all(tree,'strong')).filter(node=>(node.attrs.class||'').split(' ').includes(cls)).map(content);
const visible=html=>{const tree=dom(html);return {cards:members(tree,'ticker'),events:members(tree,'event-ticker'),tree};};
const queries=['PG','pg','pG','  PG  ','\tpg\n'];

async function installed({withoutPG=false,ticker='PG'}={}){
  const input=fixture([75,75,50]);
  const names=[[ticker,'Procter & Gamble','Volume and margins need to improve together.'],['NFLX','Netflix','An upgrade remains an unproven operating hypothesis.'],['TSLA','Tesla','An upgrade needs operating evidence.']];
  input.publicCases.forEach((c,i)=>{[c.ticker,c.company,c.thesis]=names[i];bindCase(input,c);});
  if(withoutPG)input.publicCases.shift();
  const draft=serializeResearchSlate(input);assert.equal(draft.ok,true);
  let now=Date.parse(at);const slot=createApprovedSlateSlot({readApprovedBytes:async()=>draft.serialized,clock:()=>now});
  assert.equal(await slot.refresh(),true);
  return {slot,payload:JSON.parse(draft.serialized),setTime:value=>{now=Date.parse(value);}};
}
const approved=(slot,query)=>renderApprovedResearchView(slot,{horizonId:'next_week',query});

test('actual PG search excludes upgrade matches in operating cards and event rows for both horizons',()=>{
  for(const horizon of ['next_day','next_week'])for(const query of queries){
    const out=visible(renderStockView(snapshot(horizon),query));
    assert.deepEqual(out.cards,['PG']);assert.deepEqual(out.events,['PG']);
    assert.match(content(out.tree),/Forecast unavailable/);
  }
});

test('fallback ticker recognition uses the union of available operating and event rows',()=>{
  const eventOnly=snapshot();eventOnly.hypotheses=eventOnly.hypotheses.filter(r=>r.ticker!=='PG');
  let out=visible(renderStockView(eventOnly,'PG'));assert.deepEqual(out.cards,[]);assert.deepEqual(out.events,['PG']);
  const cardOnly=snapshot();cardOnly.event_watch=cardOnly.event_watch.filter(r=>r.ticker!=='PG');
  cardOnly.event_watch.forEach(r=>{r.event_summary+=' PG peer reference.';});
  out=visible(renderStockView(cardOnly,'PG'));assert.deepEqual(out.cards,['PG']);assert.deepEqual(out.events,[]);
});

test('fallback company, prose, empty and unmatched queries retain broad search behavior',()=>{
  const s=snapshot();
  assert.deepEqual(visible(renderStockView(s,'upgrade')).cards,['NFLX','PG','TSLA']);
  assert.deepEqual(visible(renderStockView(s,'Procter')).cards,['PG']);
  assert.deepEqual(visible(renderStockView(s,'   ')).cards,s.hypotheses.map(r=>r.ticker));
  const absent=visible(renderStockView(s,'no-such-company-or-phrase'));assert.deepEqual(absent.cards,[]);assert.deepEqual(absent.events,[]);
});

test('an absent ticker does not invoke a guessed ticker universe in either branch',async()=>{
  const s=snapshot();s.hypotheses=s.hypotheses.filter(r=>r.ticker!=='PG');s.event_watch=s.event_watch.filter(r=>r.ticker!=='PG');
  assert.deepEqual(visible(renderStockView(s,'PG')).cards,['NFLX','TSLA']);
  const {slot}=await installed({withoutPG:true});assert.deepEqual(visible(approved(slot,'PG')).cards,['NFLX','TSLA']);
});

test('approved rows use exact available tickers despite prose collisions',async()=>{
  const {slot}=await installed();
  for(const query of queries)assert.deepEqual(visible(approved(slot,query)).cards,['PG']);
});

test('approved company and prose search remains broad and never pads missing matches',async()=>{
  const {slot}=await installed();
  assert.deepEqual(visible(approved(slot,'upgrade')).cards,['NFLX','TSLA']);
  assert.deepEqual(visible(approved(slot,'Procter')).cards,['PG']);
  assert.deepEqual(visible(approved(slot,'   ')).cards,['PG','NFLX','TSLA']);
  assert.deepEqual(visible(approved(slot,'no-such-company-or-phrase')).cards,[]);
});

test('exact matching uses literal available punctuation and adds no dollar-prefix interpretation',async()=>{
  const s=snapshot();s.hypotheses.find(r=>r.ticker==='PG').ticker='BRK.B';s.event_watch.find(r=>r.ticker==='PG').ticker='BRK.B';
  let out=visible(renderStockView(s,'  brk.b  '));assert.deepEqual(out.cards,['BRK.B']);assert.deepEqual(out.events,['BRK.B']);
  const {slot}=await installed({ticker:'BRK.B'});assert.deepEqual(visible(approved(slot,'  brk.b  ')).cards,['BRK.B']);
  out=visible(renderStockView(snapshot(),'$PG'));assert.deepEqual(out.cards,[]);assert.deepEqual(out.events,[]);
  assert.deepEqual(visible(approved(slot,'$BRK.B')).cards,[]);
});

test('search preserves declared coverage, original rank, full-scorer ties and slot state',async()=>{
  const {slot,payload}=await installed(),key=slot.stateKey('next_week');
  const before=visible(approved(slot,'')),after=visible(approved(slot,'PG'));
  const coverage=tree=>content(all(tree,'p').find(n=>n.attrs.class==='coverage-strip'));
  assert.equal(coverage(after.tree),coverage(before.tree));
  assert.match(content(after.tree),/Research rank 1 · tied/);assert.match(content(after.tree),/Research evidence score 75\/100/);
  assert.equal(payload.rows[0].research_rank,1);assert.equal(payload.rows[0].tied_priority,true);
  assert.equal(slot.stateKey('next_week'),key);assert.deepEqual(after.cards,['PG']);
  for(const value of [payload.source_cutoff_at,payload.display_expires_at,payload.horizon.entry_at,payload.horizon.exit_at]){
    assert.ok(all(after.tree,'time').some(n=>n.attrs.datetime===value));
  }
});

test('expired or wrong-horizon approved slates retain exact-ticker fallback behavior',async()=>{
  const {slot,setTime}=await installed();
  let html=renderStockView(snapshot('next_day'),'PG',{slateSlot:slot,horizonId:'next_day'});
  assert.equal(html,baselineView(snapshot('next_day'),'PG'));assert.deepEqual(visible(html).cards,['PG']);
  setTime(expiry);html=renderStockView(snapshot(),'PG',{slateSlot:slot,horizonId:'next_week'});
  assert.equal(html,baselineView(snapshot(),'PG'));assert.deepEqual(visible(html).cards,['PG']);
});

test('frozen fallback remains identical for exact, broad, absent and empty searches',()=>{
  for(const horizon of ['next_day','next_week'])for(const query of [...queries,'upgrade','Procter','no-such-company-or-phrase','']){
    const s=snapshot(horizon);assert.equal(renderStockView(s,query),baselineView(s,query));
  }
});
