import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';
import {summarizeSourceChecks} from '../dist/lib/source-freshness.js';
const payload=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
const at='2026-10-17T17:00:00Z';
const make=(horizon='next_day')=>buildStockSnapshot(payload,horizon,at);
const render=snapshot=>renderStockView(snapshot,'',{sourceFreshness:summarizeSourceChecks(snapshot.source_checks,{at})});

test('current precise windows and no-gap policy stay unchanged; session count needs explicit sessions',()=>{
  for(const horizon of ['next_day','next_week']){
    const snapshot=make(horizon),html=render(snapshot);
    assert.match(html,/<small>2026-10-19 13:30 UTC<\/small>/);
    assert.ok(html.includes(`<small>2026-10-${horizon==='next_day'?'19':'23'} 20:00 UTC</small>`));
    assert.match(html,/No prior-close or weekend opening gap is earned/);
    assert.equal((html.match(/class="card stock-card"/g)||[]).length,6);
    assert.equal((html.match(/class="event-item"/g)||[]).length,5);
    assert.match(html,/0 eligible/);
    assert.match(html,/TARGET<\/span>/);
    snapshot.window.sessions=Array.from({length:horizon==='next_day'?1:5},(_,index)=>({open:`2026-10-${19+index}T13:30:00Z`,close:`2026-10-${19+index}T20:00:00Z`}));
    assert.ok(render(snapshot).includes(horizon==='next_day'?'ONE SESSION':'FIVE EXCHANGE SESSIONS'));
  }
});

test('shifted window labels and event positions follow selected endpoints without calendar identity gate',()=>{
  const snapshot=make('next_week');
  snapshot.window.entry_at='2026-10-26T09:30:00-04:00';
  snapshot.window.exit_at='2026-10-30T16:00:30-04:00';
  snapshot.price_session='2026-10-23';
  const html=render(snapshot);
  assert.match(html,/<h2>October 26–30, 2026<\/h2>/);
  assert.match(html,/<small>2026-10-26 13:30 UTC<\/small>/);
  assert.match(html,/<small>2026-10-30 20:00:30 UTC<\/small>/);
  assert.match(html,/October 23 close is a historical reference/);
  assert.match(html,/Price reference session Oct 23/);
  assert.match(html,/Oct 23 completed-session OHLCV/);
  assert.match(html,/before entry/);
  assert.doesNotMatch(html,/Within the selected window\./);
  assert.doesNotMatch(html,/<small>2026-10-19|<small>2026-10-23/);
  snapshot.window.entry_at='2026-10-21T13:30:00Z';
  snapshot.window.exit_at='2026-11-02T21:00:00Z';
  assert.match(render(snapshot),/<h2>October 21, 2026 – November 2, 2026<\/h2>/);
});

test('unavailable timing has its own alert and malformed source dates never normalize into observations',()=>{
  const snapshot=make();
  snapshot.status='unavailable';snapshot.window.entry_at='invalid';
  snapshot.source_checks[0].observed_at='2026-02-30T01:00:00Z';
  const html=render(snapshot);
  assert.match(html,/The holding window could not be established/);
  assert.doesNotMatch(html,/This slate is archived/);
  assert.match(html,/Window dates unavailable/);
  assert.doesNotMatch(html,/<time datetime="2026-02-30/);
  assert.match(html,/Source timing needs review<br>Original observation: Unavailable/);
});

test('corrupt optional source metadata remains explicit without dropping the six cases or promoting latest checks',()=>{
  for(const corruption of [null,{related_sources:{}},{related_sources:[null]},{related_sources:[{label:'Bad link',url:'javascript:alert(1)'}]}]){
    const snapshot=make();
    snapshot.source_checks[0]=corruption===null?null:{...snapshot.source_checks[0],...corruption};
    const html=render(snapshot);
    assert.equal((html.match(/class="card stock-card"/g)||[]).length,6);
    assert.match(html,/Source metadata incomplete/);
    const first=html.slice(html.indexOf('<li data-source-id='),html.indexOf('</li>',html.indexOf('<li data-source-id=')));
    assert.doesNotMatch(first,/Latest inventory check|Checked within/);
    assert.match(first,/Source link unavailable|Related sources incomplete|Related source metadata incomplete|Related source link unavailable/);
    assert.doesNotMatch(html,/href="javascript:/);
    assert.doesNotThrow(()=>renderStockView(snapshot));
  }
});
