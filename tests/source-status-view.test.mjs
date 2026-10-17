import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';
import {summarizeSourceChecks} from '../dist/lib/source-freshness.js';

const payload=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
const at='2026-10-17T17:00:00Z';
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const plain=node=>typeof node==='string'?node:node.children.map(plain).join('');
const hasClass=(node,name)=>(node.attrs.class||'').split(/\s+/).includes(name);
const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
function render(checks,summary=summarizeSourceChecks(checks,{at})){
  const snapshot=buildStockSnapshot(payload,'next_day',at);
  snapshot.source_checks=checks;
  const dom=parse(renderStockView(snapshot,'',{sourceFreshness:summary}));
  return all(dom,node=>node.tag==='li'&&Object.hasOwn(node.attrs,'data-source-id'));
}

test('endpoint rows retain both exact clocks, stale CompanyFacts and all coverage behind accessible disclosures',()=>{
  const checks=payload.operating_evidence.source_checks,rows=render(checks);
  assert.equal(rows.length,14);
  assert.equal(rows.filter(row=>plain(row).includes('Checked within 12 hours')).length,7);
  assert.equal(rows.filter(row=>plain(row).includes('Check due')).length,7);
  const keys=[];
  for(const check of checks){
    const row=rows.find(item=>item.attrs['data-source-id']===check.id);
    const detail=all(row,node=>node.tag==='details')[0];
    assert.ok(detail);
    assert.equal(Object.hasOwn(detail.attrs,'open'),false);
    assert.equal(plain(all(detail,node=>node.tag==='summary')[0]),`Coverage & sources for ${check.name}`);
    keys.push(detail.attrs['data-state-key']);
    assert.ok(plain(detail).includes(check.note),`${check.id}: original coverage note retained`);
    assert.ok(plain(detail).includes(check.status));
    const links=all(detail,node=>node.tag==='a');
    assert.deepEqual(links.map(node=>node.attrs.href),[check.url,...(check.related_sources||[]).map(source=>source.url)]);
    for(const link of links)assert.equal(link.attrs.rel,'noopener noreferrer');
    assert.deepEqual(all(row,node=>node.tag==='time').map(node=>node.attrs.datetime),[check.observed_at,...(check.last_check?[check.last_check.observed_at]:[])]);
    assert.equal(all(detail,node=>node.tag==='time').length,0,'clocks stay outside collapsed coverage');
    if(check.source_kind==='sec_companyfacts'){
      assert.ok(plain(row).includes('Check due'));
      assert.ok(!plain(row).includes('Latest inventory check'));
    }
  }
  assert.equal(new Set(keys).size,14);
});

test('invalid endpoint check is not promoted to a visible latest check',()=>{
  const checks=structuredClone(payload.operating_evidence.source_checks);
  const check=checks.find(row=>row.source_kind==='sec_submissions');
  check.last_check.url=check.url+'?different-endpoint';
  const row=render(checks).find(row=>row.attrs['data-source-id']===check.id);
  assert.ok(plain(row).includes('Source timing needs review'));
  assert.ok(!plain(row).includes('Latest inventory check'));
  assert.deepEqual(all(row,node=>node.tag==='time').map(node=>node.attrs.datetime),[check.observed_at]);
});

test('duplicate or mismatched projections never lend a source row another endpoint clock',()=>{
  const originals=structuredClone(payload.operating_evidence.source_checks);
  const inventory=originals.find(row=>row.source_kind==='sec_submissions');
  const facts=originals.find(row=>row.source_kind==='sec_companyfacts');
  facts.id=inventory.id;
  const duplicateRows=render(originals).filter(row=>row.attrs['data-source-id']===inventory.id);
  assert.equal(duplicateRows.length,2);
  for(const row of duplicateRows){
    assert.ok(plain(row).includes('Source timing needs review'));
    assert.equal(all(row,node=>node.tag==='time').length,1);
  }
  const checks=structuredClone(payload.operating_evidence.source_checks);
  for(const mutate of [row=>row.sourceKind='sec_companyfacts',row=>row.observedAt='2026-10-17T00:00:00Z',(_,summary)=>summary.checks.push({...summary.checks[0]})]){
    const summary=summarizeSourceChecks(checks,{at});
    mutate(summary.checks[0],summary);
    const row=render(checks,summary)[0];
    assert.ok(plain(row).includes('Source timing needs review'));
    assert.equal(all(row,node=>node.tag==='time').length,1);
  }
});
