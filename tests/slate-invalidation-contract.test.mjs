// Synthetic cross-layer contract tests only. No real source/right approvals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=process.env.CRIBSCORE_PROJECT_ROOT||fileURLToPath(new URL('../',import.meta.url));
const load=name=>import(pathToFileURL(`${root}/${name}`));
const [scoreFixtures,scoring,presentation,serialization,browser]=await Promise.all([
  load('server/research-score/fixtures.mjs'),load('server/research-score/research-score.mjs'),
  load('tests/fixtures/research-slate-fixtures.mjs'),load('server/research-slate/research-slate.mjs'),load('dist/lib/research-slate-view.js')]);
const explicit='Withdraw if the "Kestrel" test fails & margin falls below the reviewed floor.';
const privateTrigger='PRIVATE-CANDIDATE-TRIGGER-DO-NOT-INFER';
function bind(input,c){
  const p=serialization.preparePublicCase(c);assert.equal(p.ok,true);
  c.public_review={...c.public_review,source_cutoff_at:input.sourceCutoffAt,content_sha256:p.sha256};
  return c;
}
function input(){
  const value=presentation.fixture([87.5]);
  value.publicCases[0].invalidation_trigger=explicit;
  bind(value,value.publicCases[0]);return value;
}
function serialize(value){const result=serialization.serializeResearchSlate(value);assert.equal(result.ok,true);return result;}
async function display(serialized,at,query=''){
  const slot=browser.createApprovedSlateSlot({readApprovedBytes:async()=>serialized,clock:()=>Date.parse(at)});
  const installed=await slot.refresh();
  return {slot,installed,html:browser.renderApprovedResearchView(slot,{horizonId:'next_week',query})};
}
const nodes=(n,p)=>[...(p(n)?[n]:[]),...(n.children||[]).flatMap(c=>typeof c==='string'?[]:nodes(c,p))];
const content=n=>typeof n==='string'?n:(n.children||[]).map(content).join('');

test('admitted candidate requires a trigger and its separately reviewed public condition survives exact bytes, DOM and search',async()=>{
  const value=input(),candidate=scoreFixtures.fixture('SYNTHETIC-0');
  candidate.invalidation_trigger=privateTrigger;
  const options={...scoreFixtures.options,at:value.assessmentContext.assessed_at};
  value.sourceCutoffAt=options.cutoff;
  value.scorerResult=scoring.rankResearchCandidates([candidate],scoreFixtures.window,options);
  assert.equal(value.scorerResult.rows.length,1);
  const absent=structuredClone(candidate);delete absent.invalidation_trigger;
  const withheld=scoring.scoreResearchCandidate(absent,scoreFixtures.window,options);
  assert.equal(withheld.status,'withheld');assert.ok(withheld.reasons.includes('mechanism_incomplete'));
  value.slateMetadata.counts.screened=1;value.slateMetadata.counts.blocked=0;
  presentation.bindMetadata(value);bind(value,value.publicCases[0]);
  const result=serialize(value),bytes=JSON.parse(result.serialized);
  assert.equal(bytes.rows[0].invalidation_trigger,explicit);
  assert.ok(!result.serialized.includes(privateTrigger));
  assert.equal(bytes.rows[0].research_rank,1);assert.equal(bytes.rows[0].research_score,87.5);
  assert.equal(bytes.rows[0].tied_priority,false);assert.deepEqual(bytes.metadata.counts,value.slateMetadata.counts);
  const rendered=await display(result.serialized,value.at,'kestrel');assert.equal(rendered.installed,true);
  assert.match(rendered.html,/&quot;Kestrel&quot;/);assert.match(rendered.html,/fails &amp; margin/);
  assert.ok(!rendered.html.includes(privateTrigger));
  const tree=JSON.parse(execFileSync('python3',[`${root}/tests/fixtures/html-tree.py`],{input:rendered.html,encoding:'utf8'}));
  const cards=nodes(tree,n=>n.tag==='article');assert.equal(cards.length,1,'trigger-only search must find the card');
  const details=nodes(cards[0],n=>n.tag==='details');assert.equal(details.length,1);
  assert.equal(details[0].children.filter(c=>typeof c!=='string')[0].tag,'summary');
  assert.ok(content(details[0]).includes(explicit));
  assert.ok(nodes(details[0],n=>n.tag==='h4').some(n=>/invalidat/i.test(content(n))));
  assert.equal((await display(result.serialized,value.at,'unknown-mismatch-term')).html.includes('class="card stock-card"'),false);
});

test('changing the public trigger changes its hash, invalidates old review, and needs a new explicit review',()=>{
  const value=input(),c=value.publicCases[0],oldHash=c.public_review.content_sha256;
  const before=serialize(value);assert.equal(JSON.parse(before.serialized).rows.length,1);
  c.invalidation_trigger='Withdraw if the next report cuts annual operating guidance.';
  const prepared=serialization.preparePublicCase(c);assert.equal(prepared.ok,true);assert.notEqual(prepared.sha256,oldHash);
  const stale=JSON.parse(serialize(value).serialized);assert.equal(stale.rows.length,0);assert.equal(stale.withheld_count,1);
  c.public_review={...c.public_review,review_id:'SYNTHETIC-NEW-CONDITION-REVIEW',reviewed_at:value.at,content_sha256:prepared.sha256};
  const reviewed=JSON.parse(serialize(value).serialized);assert.equal(reviewed.rows.length,1);
  assert.equal(reviewed.rows[0].invalidation_trigger,c.invalidation_trigger);
});

test('missing public trigger is withheld despite private upstream trigger and adverse-case prose',()=>{
  const value=input(),c=value.publicCases[0];delete c.invalidation_trigger;
  c.downside='Withdraw if the next report cuts annual guidance.';
  c.private_candidate={invalidation_trigger:privateTrigger};c.counter_case=explicit;
  assert.equal(serialization.preparePublicCase(c).ok,false);
  const result=JSON.parse(serialize(value).serialized);assert.equal(result.rows.length,0);assert.equal(result.withheld_count,1);
  assert.ok(!JSON.stringify(result).includes(privateTrigger));
});

test('server rejects absent, inherited, accessor, empty, untrimmed, overlong and malformed conditions; exact max length remains explicit',async()=>{
  const invalid=[undefined,null,'',' ',' trailing','trailing ','x'.repeat(501),1,{},'line\nbreak','<script>','hidden\u202etext',
    '\u200b','\u200d','\u200c\u200d\u2060\ufe0f','\u115f\u3164'];
  for(const field of invalid){const value=input(),c=value.publicCases[0];if(field===undefined)delete c.invalidation_trigger;else c.invalidation_trigger=field;
    assert.equal(serialization.preparePublicCase(c).ok,false,`field ${JSON.stringify(field)}`);
    assert.equal(JSON.parse(serialize(value).serialized).rows.length,0);
  }
  const inherited=input();delete inherited.publicCases[0].invalidation_trigger;
  Object.setPrototypeOf(inherited.publicCases[0],{invalidation_trigger:explicit});
  assert.equal(serialization.preparePublicCase(inherited.publicCases[0]).ok,false);
  const accessor=input();Object.defineProperty(accessor.publicCases[0],'invalidation_trigger',{get(){throw new Error('must not run getter');},configurable:true});
  assert.equal(serialization.preparePublicCase(accessor.publicCases[0]).ok,false);
  const maximum=input();maximum.publicCases[0].invalidation_trigger='x'.repeat(500);bind(maximum,maximum.publicCases[0]);
  const result=serialize(maximum);assert.equal(JSON.parse(result.serialized).rows[0].invalidation_trigger.length,500);
  assert.equal((await display(result.serialized,maximum.at)).installed,true);
  // Presence validation must preserve readable multilingual wording and interior
  // joiners exactly; whether it is observable remains a human-review judgment.
  const multilingual=input(),visible='कंपनी का मार्गदर्शन घटे तो रोकें; क्\u200dष परीक्षण।';
  multilingual.publicCases[0].invalidation_trigger=visible;bind(multilingual,multilingual.publicCases[0]);
  const exact=serialize(multilingual);assert.equal(JSON.parse(exact.serialized).rows[0].invalidation_trigger,visible);
  const html=await display(exact.serialized,multilingual.at);assert.equal(html.installed,true);assert.ok(html.html.includes(visible));
});

test('client requires exact new row shape and rejects old or malformed condition bytes into fallback',async()=>{
  const value=input(),serialized=serialize(value).serialized;
  assert.equal((await display(serialized,value.at)).installed,true,'valid explicit condition is accepted');
  const mutations=[p=>delete p.rows[0].invalidation_trigger,p=>p.rows[0].invalidation_trigger='',p=>p.rows[0].invalidation_trigger=' ',
    p=>p.rows[0].invalidation_trigger=' leading',p=>p.rows[0].invalidation_trigger='x'.repeat(501),
    p=>p.rows[0].invalidation_trigger=null,p=>p.rows[0].invalidation_trigger={},p=>p.rows[0].invalidation_trigger='x\ny',
    p=>p.rows[0].invalidation_trigger='<img>',p=>p.rows[0].invalidation_trigger='x\u202ey',
    ...['\u200b','\u200d','\u200c\u200d\u2060\ufe0f','\u115f\u3164'].map(value=>p=>p.rows[0].invalidation_trigger=value),
    p=>p.rows[0].unreviewed_invalidation='unexpected extra field'];
  for(const mutate of mutations){const p=JSON.parse(serialized);mutate(p);const shown=await display(JSON.stringify(p),value.at);
    assert.equal(shown.installed,false);assert.equal(shown.slot.stateKey('next_week'),'fallback');assert.equal(shown.html,null);
  }
});
