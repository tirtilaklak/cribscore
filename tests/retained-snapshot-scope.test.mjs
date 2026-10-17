// Offline presentation-only proof. Synthetic bytes enter a mock reader; no rights or
// publication approval is asserted and nothing is served or persisted as app data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createApprovedSlateSlot,renderApprovedResearchView} from '../dist/lib/research-slate-view.js';
import {proposal} from './fixtures/research-slate-fixtures.mjs';
import {buildStockSnapshot} from '../dist/lib/candidates.js';

const appPath=new URL('../dist/app.js',import.meta.url);
const app=await readFile(appPath,'utf8');
const retainedPayload=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
function presentation(horizon){
  const horizonSource=app.match(/^const horizon = .*$/m)?.[0];
  const stampSource=app.match(/^function utcStamp.*$/m)?.[0];
  const rowsSource=app.match(/^function detailRows.*$/m)?.[0];
  const timingSource=app.slice(app.indexOf('function timingContent() {'),app.indexOf('function showDetail(id) {'));
  const railSource=app.match(/^function rail\(\) \{.*$/m)?.[0];
  const detailSource=app.slice(app.indexOf('function showDetail(id) {'),app.indexOf("document.addEventListener('click'"));
  assert.ok(horizonSource&&railSource&&detailSource.startsWith('function showDetail'));
  const nodes = { '#detail-dialog': { dataset: {} } };
  return runInNewContext(`${stampSource}\n${horizonSource}\n${railSource}\n${rowsSource}\n${timingSource}\n${detailSource}\n({description:horizon().description,rail:rail(),timing:showDetail('timing')})`,{
    $:selector=>nodes[selector]??null,
    stockSnapshot:()=>buildStockSnapshot(retainedPayload,horizon,'2026-10-17T04:00:00Z'),
    state:{horizon},text:String,dateText:String,details:(title,content,kicker)=>({title,content,kicker})
  });
}
function plusWeek(value){
  if(Array.isArray(value))return value.map(plusWeek);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plusWeek(v)]));
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(value)){
    const shifted=new Date(Date.parse(value)+7*86400000).toISOString();return value.length===10?shifted.slice(0,10):shifted;
  }
  return value;
}
async function futureView(horizon='next_week'){
  const p=plusWeek(JSON.parse(proposal([75],horizon).serialized));
  const slot=createApprovedSlateSlot({readApprovedBytes:async()=>JSON.stringify(p),clock:()=>Date.parse(p.generated_at)});
  assert.equal(await slot.refresh(),true);const html=renderApprovedResearchView(slot,{horizonId:horizon});assert.ok(html);
  return {p,html,aux:presentation(horizon)};
}

test('future research priorities do not coexist with an unqualified unavailable-current-view claim',async()=>{
  const {html,aux}=await futureView();assert.match(html,/2026-10-26 13:30:00\.000 UTC/);assert.match(html,/Research rank 1/);
  assert.doesNotMatch(aux.rail,/<dt>Current view<\/dt><dd>Unavailable<\/dd>/);
  assert.match(aux.rail,/<dt>Return forecast<\/dt><dd>Unavailable<\/dd>/);
});

test('auxiliary October 19 dates explicitly describe the retained snapshot, not a later approved window',async()=>{
  for(const horizon of ['next_day','next_week']){
    const {html,aux}=await futureView(horizon);assert.match(html,/2026-10-26 13:30:00\.000 UTC/);
    assert.match(aux.description,/^Retained manual snapshot:/);
    assert.match(aux.timing.title,/^Retained snapshot/);
    assert.match(aux.timing.content,/These dates describe the retained manual snapshot/);
    assert.match(aux.timing.content,/research priorities show their own entry, exit, source cutoff and display expiry/);
  }
});

test('retained manual timing, unavailable forecasts and unconfigured collection remain explicit',()=>{
  const day=presentation('next_day'),week=presentation('next_week');
  assert.match(day.timing.content,/2026-10-19 13:30:00\.000 UTC/);
  assert.match(day.timing.content,/<dt>Exit and expiry<\/dt><dd>2026-10-19 20:00:00\.000 UTC/);
  assert.match(week.timing.content,/<dt>Exit and expiry<\/dt><dd>2026-10-23 20:00:00\.000 UTC/);
  for(const p of [day,week]){
    assert.match(p.timing.content,/no close-to-open gap is earned/);
    assert.match(p.timing.content,/A new entry needs a new snapshot/);
    assert.match(p.timing.content,/does not establish a collector or refresh schedule/);
    assert.match(p.rail,/<dt>Refresh schedule<\/dt><dd>Not configured<\/dd>/);
  }
});
