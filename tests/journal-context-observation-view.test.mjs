import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createJournal,recordAbstention,projectJournal} from '../dist/lib/journal.js';
import {renderJournalView} from '../dist/lib/journal-view.js';

const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const collapsedText=node=>typeof node==='string'?node:node.tag==='details'&&!Object.hasOwn(node.attrs,'open')?node.children.filter(child=>typeof child!=='string'&&child.tag==='summary').map(collapsedText).join(''):node.children.map(collapsedText).join('');

test('collapsed abstention identifies a dated context observation while planned window and non-execution detail remain disclosed',async()=>{
  const at='2026-10-17T18:00:00Z',reason='No eligible published suggestion in the observed context.';
  const initial=createJournal({journalId:'synthetic-context-observation',at});
  const result=await recordAbstention(initial,{id:'observed-context',at,date:'2026-10-17',horizonId:'next_week',unrankedCount:6,reason,snapshot:{id:'retained-context',methodVersion:'test',reviewedAt:'2026-10-16T21:00:00Z',sourceCutoffAt:null,window:{horizon_id:'next_week',entry_at:'2026-10-19T13:30:00Z',exit_at:'2026-10-23T20:00:00Z',timezone:'America/New_York'}}});
  assert.equal(result.ok,true);
  const model=projectJournal(result.journal),before=structuredClone(model),html=renderJournalView(model),dom=parse(html);
  const card=all(dom,node=>node.attrs['data-journal-entry']==='observed-context')[0];assert.ok(card);
  const visible=collapsedText(card);
  assert.match(visible,/2026-10-17/);assert.match(visible,/5-day window/);assert.match(visible,/No eligible stock/);assert.match(visible,/Abstain/);assert.ok(visible.includes(reason));
  assert.doesNotMatch(visible,/2026-10-19|2026-10-23|USD 0|Realized P&L|Actual/);
  assert.equal(all(card,node=>node.attrs['data-journal-action']==='confirm-actual').length,0);
  assert.equal(all(card,node=>(node.attrs.class||'').split(/\s+/).includes('journal-account')).length,0);
  assert.match(html,/These window dates come from the research snapshot \(a dated research review that is not updated\)\. They do not create a paper trade\./);
  assert.deepEqual(model,before);
});
