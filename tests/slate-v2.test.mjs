import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {serializeResearchSlate,prepareSlateMetadata,preparePublicCase,SLATE_SCHEMA} from '../server/research-slate/research-slate.mjs';
import {createApprovedSlateSlot,renderApprovedResearchView} from '../dist/lib/research-slate-view.js';
import {inspectFeedAuthorization,TIINGO_TERMS,TIINGO_TERMS_VERSION} from '../server/market-data/tiingo-eod.mjs';
import {fixture,bindCase,bindMetadata,at,cutoff,expiry,assessedAt,metadataReviewedAt,copyReviewedAt} from './fixtures/research-slate-fixtures.mjs';
const payload=input=>{const out=serializeResearchSlate(input);assert.equal(out.ok,true,JSON.stringify(out));return JSON.parse(out.serialized);};
const dom=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,tag)=>[...(node.tag===tag?[node]:[]),...(node.children||[]).flatMap(child=>typeof child==='string'?[]:all(child,tag))];
const content=node=>typeof node==='string'?node:(node.children||[]).map(content).join('');
async function render(p){const slot=createApprovedSlateSlot({readApprovedBytes:async()=>typeof p==='string'?p:JSON.stringify(p),clock:()=>Date.parse(at)});await slot.refresh();return renderApprovedResearchView(slot,{horizonId:'next_week'});}
const replaceTiming=(input,timing,kind='scheduled_event')=>{input.publicCases[0].catalyst.kind=kind;input.publicCases[0].catalyst.timing=timing;bindCase(input,input.publicCases[0]);return input;};

test('v2 uses reviewed full-assessment counts without copying current snapshot or visible-row counts',async()=>{
  const input=fixture();input.publicCases.shift();const p=payload(input);
  assert.equal(p.schema_version,SLATE_SCHEMA);assert.equal(SLATE_SCHEMA,'cribscore_research_slate_v2');
  assert.deepEqual(p.metadata.counts,{roster:24,screened:5,blocked:2,eligible:3});assert.equal(p.rows.length,2);assert.equal(p.withheld_count,1);
  const tree=dom(await render(p)),visible=content(tree);
  assert.match(visible,/Universe SYNTHETIC-US-v2 · 24 roster · 5 screened · 2 blocked · 3 research eligible/);
  assert.match(visible,/Completed price session: Oct 16, 2026/);assert.match(visible,/Partial source coverage at cutoff/);
  assert.match(visible,/Some roster sources remain incomplete/);assert.equal(all(tree,'a').find(a=>a.attrs.href==='#methodology').children.join(''),'Retained method & limits');
});
test('eligible totals above the shortlist limit remain explicit and are never backfilled from public cases',()=>{
  const input=fixture([75,75,75,75,75,75,75]);input.scorerResult.limit=5;input.scorerResult.rows=input.scorerResult.rows.slice(0,5);
  const p=payload(input);assert.equal(p.rows.length,5);assert.equal(p.metadata.counts.eligible,7);assert.equal(p.metadata.counts.screened,9);
  input.publicCases.shift();assert.equal(payload(input).rows.length,4);assert.equal(payload(input).metadata.counts.eligible,7);
});
test('full-scorer ties survive seven eligible, limit five and a single admitted public case',async()=>{
  // Same control as independent_tests: seven rank-1 peers, only five shortlisted, one case admitted.
  const input=fixture(Array(7).fill(87.5));input.scorerResult.limit=5;input.scorerResult.rows=input.scorerResult.rows.slice(0,5);input.publicCases=input.publicCases.slice(0,1);
  assert.ok(input.scorerResult.rows.every(r=>r.tied_priority===true&&r.research_rank===1));
  const p=payload(input);assert.equal(p.rows.length,1);assert.equal(p.withheld_count,4);assert.equal(p.metadata.counts.eligible,7);
  assert.equal(p.rows[0].tied_priority,true);assert.match(content(dom(await render(p))),/Research rank 1 · tied/);
});
test('a tie extending beyond the shortlist boundary retains its full-scorer label',async()=>{
  const input=fixture([87.5,87.5,87.5,87.5,75,75,75]);input.scorerResult.limit=5;input.scorerResult.rows=input.scorerResult.rows.slice(0,5);
  const p=payload(input);assert.equal(p.rows.length,5);assert.equal(p.rows[4].research_rank,5);assert.equal(p.rows[4].tied_priority,true);
  assert.match(content(dom(await render(p))),/Research rank 5 · tied/);
  const single=payload(fixture([75]));assert.equal(single.rows[0].tied_priority,false);assert.doesNotMatch(content(dom(await render(single))),/· tied/);
});
test('tie metadata requires strict booleans and rejects contradictions without inventing true or false',async()=>{
  for(const value of [undefined,null,0,1,'true','false',{},[]]){
    const input=fixture();input.scorerResult.rows[0].tied_priority=value;const p=payload(input);
    assert.equal(p.rows.length,2);assert.equal(p.withheld_count,1);assert.ok(p.rows.every(r=>r.ticker!=='AAA'));
    const bad=payload(fixture());bad.rows[0].tied_priority=value;assert.equal(await render(bad),null);
  }
  const input=fixture();input.scorerResult.rows[0].tied_priority=false;assert.equal(payload(input).rows.length,2,'false contradicts a tie visible in scorer rows');
  const bad=payload(fixture());bad.rows[0].tied_priority=false;assert.equal(await render(bad),null,'false contradicts equal-score peers in payload');
  const missing=payload(fixture());delete missing.rows[0].tied_priority;assert.equal(await render(missing),null);
});
test('metadata and trusted scorer context are mandatory, not inferred',()=>{
  for(const field of ['slateMetadata','assessmentContext']){const input=fixture();delete input[field];assert.equal(serializeResearchSlate(input).ok,false);}
  for(const field of ['universe_version','counts','price_session','source_health','review']){const input=fixture();delete input.slateMetadata[field];assert.equal(serializeResearchSlate(input).ok,false);}
  for(const field of ['eligible_count','withheld']){const input=fixture();delete input.scorerResult[field];assert.equal(serializeResearchSlate(input).ok,false);}
});
test('invalid counts, unknown health and incomplete completed-session fields fail closed',()=>{
  const changes=[m=>m.counts.roster=4,m=>m.counts.screened=6,m=>m.counts.blocked=6,m=>m.counts.eligible=-1,m=>m.counts.roster=1.5,
    m=>m.counts.roster=Number.MAX_SAFE_INTEGER+1,m=>m.counts.eligible='3',m=>m.universe_version='bad version',
    m=>m.price_session.date='2026-02-30',m=>m.price_session.closed_at='2026-10-15T20:00:00Z',m=>delete m.price_session.closed_at,
    m=>m.source_health.state='live',m=>m.source_health.state='unavailable_at_cutoff',m=>m.source_health.label='',m=>m.source_health.label='<b>all good</b>'];
  for(const change of changes){const input=fixture();change(input.slateMetadata);assert.equal(serializeResearchSlate(input).ok,false);}
});
test('valid-looking metadata must agree with the full scorer result and same assessment context',()=>{
  const changes=[input=>input.assessmentContext.universe_version='ANOTHER-UNIVERSE',input=>input.assessmentContext.price_session.date='2026-10-15',
    input=>input.assessmentContext.price_session.closed_at='2026-10-16T20:00:00.000Z',input=>input.scorerResult.eligible_count=4,
    input=>input.scorerResult.withheld.pop(),input=>input.scorerResult.withheld[0].status='scored',input=>input.scorerResult.rows.pop(),
    input=>{input.slateMetadata.counts.eligible=4;input.slateMetadata.counts.screened=6;bindMetadata(input);}];
  for(const change of changes){const input=fixture();change(input);assert.equal(serializeResearchSlate(input).ok,false);}
});
test('metadata review binds all supplied facts, exact horizon/cutoff and display lifetime',()=>{
  const changes=[input=>input.slateMetadata.source_health.label='All sources complete',input=>input.slateMetadata.counts.roster=25,
    input=>input.slateMetadata.review.audience='public',input=>input.slateMetadata.review.source_cutoff_at='2026-10-17T01:00:00.100Z',
    input=>input.slateMetadata.review.entry_at='2026-10-19T13:30:01Z',input=>input.slateMetadata.review.horizon_id='next_day',
    input=>input.slateMetadata.review.reviewed_at='2026-10-16T19:59:59Z',input=>input.slateMetadata.review.reviewed_at='2026-10-18T00:00:00Z',
    input=>input.slateMetadata.review.expires_at='2026-10-18T00:00:00.119Z',input=>input.slateMetadata.review.content_sha256='f'.repeat(64)];
  for(const change of changes){const input=fixture();change(input);assert.equal(serializeResearchSlate(input).ok,false);}
  const exact=fixture();exact.slateMetadata.review.expires_at=expiry;assert.equal(serializeResearchSlate(exact).ok,true);
});
test('actual assessment and presentation reviews after cutoff serialize without backdating source data',()=>{
  const input=fixture(),out=serializeResearchSlate(input);assert.equal(out.ok,true);
  assert.ok(Date.parse(cutoff)<Date.parse(assessedAt));assert.ok(Date.parse(assessedAt)<Date.parse(metadataReviewedAt));
  assert.ok(Date.parse(metadataReviewedAt)<Date.parse(copyReviewedAt));assert.ok(Date.parse(copyReviewedAt)<Date.parse(at));
  const p=JSON.parse(out.serialized);assert.equal(p.rows.length,3);assert.equal(p.source_cutoff_at,cutoff);assert.equal(p.generated_at,at);
  assert.ok(!out.serialized.includes('assessed_at'));assert.ok(!out.serialized.includes('reviewed_at'));
  assert.equal(out.status,'review_required');
});
test('assessment time must be explicitly supplied, no earlier than cutoff and no later than review or serialization',()=>{
  for(const value of [undefined,'2026-10-17T01:00:00.099Z','2026-10-17T01:35:00.451Z','2026-10-17T01:45:00.124Z',
    '2026-02-30T01:30:00Z','2026-10-17T01:30:00.1234Z','2026-10-17T01:30:00+00:00']){
    const input=fixture();input.assessmentContext.assessed_at=value;assert.equal(serializeResearchSlate(input).ok,false,String(value));
  }
  const missing=fixture();delete missing.assessmentContext.assessed_at;assert.equal(serializeResearchSlate(missing).ok,false);
});
test('metadata review before the recorded assessment or after serializer time is rejected at fractional boundaries',()=>{
  for(const value of ['2026-10-17T01:30:00.199Z','2026-10-17T01:45:00.124Z','2026-02-30T01:35:00Z']){
    const input=fixture();input.slateMetadata.review.reviewed_at=value;assert.equal(serializeResearchSlate(input).ok,false,value);
  }
  for(const value of [cutoff,at]){
    const input=fixture();input.assessmentContext.assessed_at=value;input.slateMetadata.review.reviewed_at=value;
    for(const c of input.publicCases)c.public_review.reviewed_at=value;
    assert.equal(serializeResearchSlate(input).ok,true,'equal adjacent clocks are permitted: '+value);
  }
});
test('final public-copy review may follow cutoff but future review withholds its row',()=>{
  const input=fixture();input.publicCases[0].public_review.reviewed_at=at;assert.equal(payload(input).rows.length,3);
  input.publicCases[0].public_review.reviewed_at='2026-10-17T01:45:00.124Z';
  const p=payload(input);assert.equal(p.rows.length,2);assert.equal(p.withheld_count,1);assert.equal(p.metadata.counts.eligible,3);
});
test('later presentation review cannot admit a post-cutoff fact, uncompleted session or different source cutoff',()=>{
  const known=replaceTiming(fixture(),{precision:'exact',at:'2026-10-17T01:20:00Z'},'known_information');
  assert.ok(Date.parse(known.publicCases[0].public_review.reviewed_at)>Date.parse(known.publicCases[0].catalyst.timing.at));
  assert.equal(payload(known).rows.length,2,'a later copy review does not move the known-information cutoff');
  const price=fixture();price.slateMetadata.price_session={date:'2026-10-17',closed_at:'2026-10-17T01:10:00Z'};
  price.assessmentContext.price_session={...price.slateMetadata.price_session};bindMetadata(price);
  assert.equal(serializeResearchSlate(price).ok,false,'close still must precede source cutoff');
  const row=fixture();row.scorerResult.rows[0].source_cutoff_at='2026-10-17T01:20:00Z';assert.equal(payload(row).rows.length,2);
});
test('completed-session close must be at or before cutoff, with exact supplied session identity',()=>{
  for(const closed_at of [cutoff,'2026-10-17T01:00:00.101Z']){
    const input=fixture();input.slateMetadata.price_session={date:'2026-10-17',closed_at};input.assessmentContext.price_session={...input.slateMetadata.price_session};bindMetadata(input);
    assert.equal(serializeResearchSlate(input).ok,closed_at===cutoff);
  }
  const input=fixture();input.slateMetadata.price_session={date:'2026-10-15',closed_at:'2026-10-15T20:00:00Z'};bindMetadata(input);
  assert.equal(serializeResearchSlate(input).ok,false,'a prior completed session cannot replace the scorer context session');
});
test('new metadata admits no raw price/hash/credential/review output fields or prototype leaks',()=>{
  const input=fixture(),sentinel='PRIVATE_METADATA_SENTINEL';let getters=0;
  for(const target of [input.slateMetadata,input.slateMetadata.counts,input.slateMetadata.price_session,input.slateMetadata.source_health,input.slateMetadata.review,input.assessmentContext]){
    target.ignored={raw:{close:sentinel,adjusted:sentinel},token:sentinel,hash:sentinel,review:sentinel};
    Object.defineProperty(target,'__proto__',{value:{token:sentinel},enumerable:true});
    Object.defineProperty(target,'unused',{get(){getters++;return sentinel;},enumerable:true});
  }
  const result=serializeResearchSlate(input);assert.equal(result.ok,true);assert.equal(getters,0);assert.ok(!result.serialized.includes(sentinel));
  assert.ok(!result.serialized.includes('content_sha256'));assert.ok(!result.serialized.includes('"review"'));assert.ok(!result.serialized.includes('assessmentContext'));
  assert.equal(Object.prototype.token,undefined);
});
test('renderer rejects legacy v1, missing metadata and malformed public metadata rather than using old snapshot counts',async()=>{
  const good=payload(fixture()),changes=[p=>p.schema_version='cribscore_research_slate_v1',p=>delete p.metadata,p=>p.metadata.counts.eligible=2,
    p=>p.metadata.price_session.closed_at='2026-10-16T24:00:00Z',p=>p.metadata.price_session={date:'2026-10-17',closed_at:'2026-10-17T02:00:00Z'},
    p=>p.metadata.source_health.state='unknown',p=>p.metadata.source_health.token='SECRET',p=>p.metadata.review={state:'reviewed'},p=>p.metadata.counts.raw={close:'SECRET'}];
  for(const change of changes){const p=structuredClone(good);change(p);assert.equal(await render(p),null);}
});
test('date-only known information remains date-only, keeps its timezone and never invents a future catalyst',async()=>{
  const input=replaceTiming(fixture(),{precision:'date_only',date:'2026-10-13',time_zone:'America/New_York'},'known_information');
  input.publicCases[0].catalyst.label='Already-known operating update';bindCase(input,input.publicCases[0]);
  const p=payload(input),c=p.rows[0].catalyst;assert.equal(c.window_position,'before_window');assert.equal(c.kind,'known_information');
  assert.deepEqual(c.timing,{precision:'date_only',date:'2026-10-13',time_zone:'America/New_York'});assert.equal(Object.hasOwn(c,'at'),false);
  assert.ok(!JSON.stringify(c).includes('2026-10-13T'));assert.ok(!JSON.stringify(c).includes(cutoff));
  const tree=dom(await render(p)),article=all(tree,'article')[0];assert.match(content(article),/Oct 13, 2026 · Time unknown \(America\/New_York\)/);
  assert.match(content(article),/Known information · Before this holding window/);assert.doesNotMatch(content(article),/Scheduled event/);
  assert.ok(all(article,'time').some(t=>t.attrs.datetime==='2026-10-13'));assert.ok(!all(article,'time').some(t=>t.attrs.datetime?.startsWith('2026-10-13T')));
});
test('date-only events use conservative local-date boundaries across both horizons',()=>{
  for(const [date,expected] of [['2026-10-18','before_window'],['2026-10-19','boundary_uncertain'],['2026-10-20','in_window'],['2026-10-23','boundary_uncertain'],['2026-10-24','after_window']]){
    const input=replaceTiming(fixture(),{precision:'date_only',date,time_zone:'America/New_York'});assert.equal(payload(input).rows[0].catalyst.window_position,expected);
  }
  const one=replaceTiming(fixture([75],'next_day'),{precision:'date_only',date:'2026-10-19',time_zone:'America/New_York'});assert.equal(payload(one).rows[0].catalyst.window_position,'boundary_uncertain');
  const tokyo=replaceTiming(fixture(),{precision:'date_only',date:'2026-10-24',time_zone:'Asia/Tokyo'});assert.equal(payload(tokyo).rows[0].catalyst.window_position,'boundary_uncertain');
});
test('exact event boundaries and fractional precision remain exact and inclusive',()=>{
  for(const [event,expected] of [['2026-10-19T13:29:59.999Z','before_window'],['2026-10-19T13:30:00Z','in_window'],['2026-10-23T20:00:00Z','in_window'],['2026-10-23T20:00:00.001Z','after_window']]){
    const input=replaceTiming(fixture(),{precision:'exact',at:event}),c=payload(input).rows[0].catalyst;assert.equal(c.window_position,expected);assert.equal(c.timing.at,event);
  }
});
test('intervals remain bounded intervals with precise crossings, not midpoint or fabricated event times',async()=>{
  const cases=[['2026-10-19T13:29:59Z','2026-10-19T13:29:59.999Z','before_window'],['2026-10-19T13:29:59.999Z','2026-10-19T13:30:00Z','boundary_uncertain'],
    ['2026-10-19T13:30:00Z','2026-10-19T13:30:00.001Z','in_window'],['2026-10-23T19:59:59.999Z','2026-10-23T20:00:00Z','in_window'],
    ['2026-10-23T20:00:00Z','2026-10-23T20:00:00.001Z','boundary_uncertain'],['2026-10-23T20:00:00.001Z','2026-10-23T20:00:00.002Z','after_window']];
  for(const [start_at,end_at,expected] of cases){
    const timing={precision:'interval',start_at,end_at},input=replaceTiming(fixture(),timing),p=payload(input);
    assert.equal(p.rows[0].catalyst.window_position,expected);assert.deepEqual(p.rows[0].catalyst.timing,timing);
    if(expected==='boundary_uncertain'){const tree=dom(await render(p));assert.match(content(tree),/Window boundary uncertain/);assert.match(content(tree),/Time interval/);}
  }
});
test('malformed timing, unknown timezone and source-clock-only records withhold the case',()=>{
  const times=[{precision:'date_only',date:'2026-02-30',time_zone:'UTC'},{precision:'date_only',date:'2026-10-13'},{precision:'date_only',date:'2026-10-13',time_zone:'Mars/Base'},
    {precision:'date_only',date:'2026-10-13',time_zone:'+02:00'},{precision:'date_only',date:'2026-10-13',time_zone:'UTC',at:cutoff},
    {precision:'interval',start_at:cutoff,end_at:cutoff},{precision:'interval',start_at:at,end_at:cutoff},{precision:'interval',start_at:cutoff},
    {precision:'exact',observed_at:cutoff},{precision:'exact',captured_at:cutoff},{precision:'exact',at:'2026-10-17T01:00:00.1234Z'},
    {precision:'exact',at:'2026-10-17T01:00:00+00:00'},{precision:'date_only',date:'2026-10-13T00:00:00Z',time_zone:'UTC'}];
  for(const timing of times){const input=fixture();input.publicCases[0].catalyst.timing=timing;assert.equal(preparePublicCase(input.publicCases[0]).ok,false);const p=payload(input);assert.equal(p.rows.length,2);assert.equal(p.withheld_count,1);}
});
test('known information must be known by cutoff and case review; event timing is never substituted from those clocks',()=>{
  for(const timing of [{precision:'exact',at:'2026-10-17T01:00:00.101Z'},{precision:'date_only',date:'2026-10-17',time_zone:'America/New_York'},
    {precision:'interval',start_at:'2026-10-16T23:00:00Z',end_at:'2026-10-17T02:00:00Z'}]){
    const input=replaceTiming(fixture(),timing,'known_information');assert.equal(payload(input).rows.length,2);
  }
  const exact=replaceTiming(fixture(),{precision:'exact',at:cutoff},'known_information');assert.equal(payload(exact).rows.length,3);
  exact.publicCases[0].public_review.reviewed_at='2026-10-17T00:59:59Z';assert.equal(payload(exact).rows.length,2);
  const known=replaceTiming(fixture(),{precision:'date_only',date:'2026-10-16',time_zone:'America/New_York'},'known_information');assert.equal(payload(known).rows.length,3);
});
test('timing kind/precision changes invalidate case review; client rejects misclassified boundaries',async()=>{
  const input=replaceTiming(fixture(),{precision:'date_only',date:'2026-10-13',time_zone:'UTC'},'known_information');
  input.publicCases[0].catalyst.timing.time_zone='America/New_York';assert.equal(payload(input).rows.length,2);
  const good=payload(replaceTiming(fixture(),{precision:'date_only',date:'2026-10-19',time_zone:'America/New_York'}));
  good.rows[0].catalyst.window_position='in_window';assert.equal(await render(good),null);
  good.rows[0].catalyst.window_position='boundary_uncertain';good.rows[0].catalyst.timing.captured_at=cutoff;assert.equal(await render(good),null);
});
test('metadata and date-only output remain exact-byte bound under separate v2 output review',()=>{
  const output=serializeResearchSlate(replaceTiming(fixture(),{precision:'date_only',date:'2026-10-13',time_zone:'America/New_York'},'known_information'));
  const expires='2026-10-24T00:00:00Z',auth={provider:'tiingo',dataset:'eod',plan:'power',approved:true,reviewedAt:at,expiresAt:expires,
    operations:['display_derived'],reviewId:'SYNTHETIC',termsURL:TIINGO_TERMS,termsVersion:TIINGO_TERMS_VERSION,supplementalTermsReviewed:true,
    entitlement:{active:true,verifiedAt:at,expiresAt:expires,evidenceId:'SYNTHETIC'}};
  assert.equal(inspectFeedAuthorization(auth,{at,operation:'display_derived',output}).ok,false);
  auth.derivedOutputReview={approved:true,reviewId:'SYNTHETIC-ONLY',reviewedAt:at,expiresAt:expires,audience:'owner_private',
    sourceDataAbsent:true,nonSubstitutive:true,nonReconstructible:true,schemaVersion:output.schemaVersion,methodVersion:output.methodVersion,
    sha256:createHash('sha256').update(output.serialized,'utf8').digest('hex')};
  assert.equal(inspectFeedAuthorization(auth,{at,operation:'display_derived',output}).ok,true);
  const p=JSON.parse(output.serialized);p.metadata.counts.roster++;
  assert.equal(inspectFeedAuthorization(auth,{at,operation:'display_derived',output:{...output,serialized:JSON.stringify(p)}}).ok,false);
  auth.derivedOutputReview.schemaVersion='cribscore_research_slate_v1';assert.equal(inspectFeedAuthorization(auth,{at,operation:'display_derived',output}).ok,false);
  assert.equal(output.status,'review_required');assert.equal(Object.hasOwn(JSON.parse(output.serialized),'publication_status'),false);
});
