import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';
const payload=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
test('actual public-source checks keep capture clocks and incomplete coverage separate from company recency',()=>{
 const s=buildStockSnapshot(payload,'next_week','2026-10-17T02:00:00Z');
 assert.equal(s.source_checks.length,14);
 assert.equal(s.source_checks.find(c=>c.id==='sec_nflx').observed_at,'2026-10-17T01:25:30.321Z');
 assert.match(s.source_checks.find(c=>c.id==='sec_nflx').note,/2026-07-17/);
 assert.match(s.source_checks.find(c=>c.id==='bls_cpi_api').note,/current|Latest observation/);
 assert.equal(s.source_checks.filter(c=>c.source_kind==='sec_submissions').length,6);
 assert.equal(s.source_checks.find(c=>c.id==='sec_pg').observed_at,'2026-10-17T02:09:19.936Z');
 assert.equal(s.source_checks.find(c=>c.id==='sec_tsla').observed_at,'2026-10-17T02:09:34.862Z');
 assert.equal(s.source_checks.filter(c=>c.source_kind==='sec_companyfacts').length,6);
 for(const c of s.source_checks.filter(c=>c.source_kind==='sec_submissions')){assert.equal(c.last_check.url,c.url);assert.equal(c.last_check.source_kind,c.source_kind);assert.match(c.last_check.sha256,/^[a-f0-9]{64}$/);assert.ok(Date.parse(c.last_check.observed_at)>Date.parse(c.observed_at));}
 for(const c of s.source_checks.filter(c=>c.source_kind==='sec_companyfacts'))assert.equal(c.last_check,undefined);
 assert.equal(s.price_available,false);assert.deepEqual(s.candidates,[]);
 for(const c of s.hypotheses){assert.equal(c.expected_return,null);assert.equal(c.rank,null);}
 const html=renderStockView(s);
 for(const phrase of ['Captured once','No automatic collector','Price API awaiting approved access','October 15','Web-table extraction'])assert.ok(html.includes(phrase),phrase);
 assert.ok(s.macro_context.some(x=>x.source_ref==='fed_h15'));
});
test('older payloads remain renderable without public-source check metadata',()=>{const d=structuredClone(payload);delete d.operating_evidence.source_checks;assert.match(renderStockView(buildStockSnapshot(d,'next_day','2026-10-17T02:00:00Z')),/No automatic collector/);});
