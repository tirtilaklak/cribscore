import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderJournalView} from '../dist/lib/journal-view.js';

const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const base=entries=>({settings:{paperNotional:'100.000000',commissionPerFill:'0.000000',slippageBps:5,currency:'USD',benchmarkSymbol:'SPY'},storage:{state:'unsaved',message:'Synthetic view test'},summary:{decisions:entries.length,abstentions:0,pending:0,open:0,closed:0,noFill:0,actualConfirmations:0},entries,assumptions:[]});

test('correction controls preserve each supported fractional UTC instant without truncating price-only corrections',()=>{
  const instants=['2026-10-17T10:00:00Z','2026-10-17T10:00:00.1Z','2026-10-17T10:00:00.12Z','2026-10-17T10:00:00.123Z'];
  const fills=instants.map((occurredAt,index)=>({id:`fill-${index}`,side:'buy',occurredAt,quantity:'1.00000000',price:'10.000000',fee:'0.000000',currency:'USD'}));
  const entry={id:'fixture',date:'2026-10-17',status:'open',symbol:'TEST',horizonId:'next_day',reason:'Synthetic fixture',context:{},paper:null,actual:{confirmed:true,fills},revisions:[]};
  const dom=parse(renderJournalView(base([entry])));
  const forms=all(dom,node=>node.attrs['data-journal-form']==='revise-fill');
  assert.equal(forms.length,instants.length);
  forms.forEach((form,index)=>{
    const input=all(form,node=>node.attrs.name==='occurredAt')[0];
    assert.equal(input.attrs.step,'0.001');
    assert.equal(input.attrs.value,instants[index].replace(/Z$/,'').replace(/\.(\d+)$/,(_,fraction)=>'.'+fraction.padEnd(3,'0')));
    assert.equal(Date.parse(input.attrs.value+'Z'),Date.parse(instants[index]));
  });
  const newFill=all(dom,node=>node.attrs['data-journal-form']==='save-fill')[0];
  const newTime=all(newFill,node=>node.attrs.name==='occurredAt')[0];
  assert.equal(newTime.attrs.value,'');assert.equal(newTime.attrs.step,'0.001');
});

test('abstention copy identifies UTC observations without claiming unattended daily assessments',()=>{
  const entry={id:'observed',date:'2026-10-17',status:'abstain',symbol:null,horizonId:'next_day',reason:'No eligible published suggestion',context:{snapshot:{},observedAt:'2026-10-17T17:00:00Z'},paper:null,actual:{confirmed:false},revisions:[]};
  const html=renderJournalView(base([entry]));
  assert.match(html,/An observed assessment with no eligible suggestion is recorded as an abstention\./);
  assert.match(html,/<dt>Observation date \(UTC\)<\/dt><dd>2026-10-17<\/dd>/);
  assert.doesNotMatch(html,/A day without an eligible suggestion|<dt>Decision date<\/dt>/);
  assert.doesNotMatch(html,/data-journal-action="confirm-actual"/);
});
