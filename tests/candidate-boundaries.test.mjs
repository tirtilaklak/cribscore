import test from 'node:test';
import assert from 'node:assert/strict';
import {horizonWindow,classifyCandidate,orderCandidates,REQUIRED_GATES} from '../dist/lib/candidates.js';

// Synthetic test records only. No source facts, permissions or market data.
const at='2026-10-17T12:00:00Z',cutoff='2026-10-17T00:23:39Z';
const sessions=['12','13','14','15','16','19','20','21','22','23'].map(d=>({open:`2026-10-${d}T13:30:00Z`,close:`2026-10-${d}T20:00:00Z`}));
const day=horizonWindow(sessions,at,'next_day');
const completedSessionCoverage={state:'complete',from:'2026-10-12T00:00:00Z',through:cutoff,reviewed_at:cutoff,source_refs:['SYNTHETIC-CALENDAR'],session_count:5};
const options={at,cutoff,completedSessions:sessions,completedSessionCoverage};
function fixture(){return {
  security_id:'SYNTHETIC-1',cik:'0000000123',positive_case:'Operating support',counter_case:'Demand weakens',invalidation_trigger:'Guide cut',source_refs:['SYNTHETIC'],
  gates:REQUIRED_GATES.map(id=>({id,state:'passed',source_refs:['SYNTHETIC'],reviewed_at:'2026-10-16T23:00:00Z',expires_at:'2026-10-24T00:00:00Z'})),
  guidance:{metric_review:{metric:'diluted_eps',share_class_id:'SYNTHETIC-CLASS-A',before_share_basis:'diluted-class-a',after_share_basis:'diluted-class-a',effective_at:'2026-10-01T00:00:00Z',reviewed_at:cutoff,expires_at:'2026-10-24T00:00:00Z',reviewer_id:'SYNTHETIC-REVIEWER',source_refs:['SYNTHETIC']},operating_driver_review:{status:'verified_operating_contribution',solely_non_operating:false,reviewed_at:cutoff,expires_at:'2026-10-24T00:00:00Z',reviewer_id:'SYNTHETIC-REVIEWER',source_refs:['SYNTHETIC']},before_basis:'adjusted_diluted_eps',after_basis:'adjusted_diluted_eps',before_period:'FY2026',after_period:'FY2026',currency:'USD',before_currency:'USD',after_currency:'USD',eps_before:1,eps_after:1.1,revenue_before:100,revenue_after:101,operating_explanation:'SYNTHETIC operating growth',adjustments_reconciled:true,source_refs:['SYNTHETIC'],published_interval:{start:'2026-10-16T12:00:00Z',end:'2026-10-16T12:00:00Z'}}
};}

test('control: eligible synthetic case cannot introduce caller return/probability values',()=>{
  const c={...fixture(),expected_return:999,gain_probability:1};
  assert.equal(classifyCandidate(c,day,options).eligible,true);
  const [ordered]=orderCandidates([c],day,options);
  assert.equal(ordered.expected_return,null);
  assert.equal(ordered.gain_probability,null);
});

test('a later financing blocker cannot be hidden behind an earlier passed gate',()=>{
  const c=fixture();
  c.gates.push({...c.gates.find(g=>g.id==='financing'),state:'blocked',reviewed_at:cutoff});
  const passedFirst=classifyCandidate(c,day,options);
  c.gates.reverse();
  const blockedFirst=classifyCandidate(c,day,options);
  assert.equal(blockedFirst.eligible,false,'control: blocker is recognized when first');
  assert.equal(passedFirst.eligible,false,JSON.stringify({passedFirst,blockedFirst}));
});

test('missing completed sessions cannot make stale guidance qualify as age zero',()=>{
  const c=fixture();
  c.guidance.published_interval={start:'2026-10-13T12:00:00Z',end:'2026-10-13T12:00:00Z'};
  assert.equal(classifyCandidate(c,day,options).eligible,false,'full calendar correctly rejects four-session-old guidance');
  const result=classifyCandidate(c,day,{...options,completedSessions:[sessions[0]]});
  assert.equal(result.eligible,false,JSON.stringify(result));
});

test('equivalent UTC/offset encodings of one session cannot count twice toward five sessions',()=>{
  const future=sessions.filter(s=>Date.parse(s.open)>Date.parse(at));
  future.splice(1,0,{open:'2026-10-19T09:30:00-04:00',close:'2026-10-19T16:00:00-04:00'});
  const result=horizonWindow(future,at,'next_week');
  assert.ok(result===null||result.exit_at==='2026-10-23T20:00:00Z',JSON.stringify(result));
});

test('freshness requires complete, reviewed, array-bound coverage through the cutoff',()=>{
  const mutations=[
    o=>delete o.completedSessionCoverage,
    o=>o.completedSessionCoverage.state='partial',
    o=>o.completedSessionCoverage.source_refs=[],
    o=>o.completedSessionCoverage.reviewed_at='2026-10-17T00:23:40Z',
    o=>o.completedSessionCoverage.through='2026-10-16T20:00:00Z',
    o=>o.completedSessionCoverage.from='2026-10-16T13:30:00Z',
    o=>o.completedSessionCoverage.session_count=4,
    o=>o.completedSessions.push({...o.completedSessions[0]}),
  ];
  for(const mutate of mutations){const opts=structuredClone(options);mutate(opts);assert.equal(classifyCandidate(fixture(),day,opts).eligible,false);}
});

test('calendar rejects impossible dates and overlapping session records',()=>{
  for(const invalid of [
    [{open:'2026-02-30T13:30:00Z',close:'2026-02-30T20:00:00Z'}],
    [{open:'2026-10-19T13:30:00Z',close:'2026-10-19T20:00:00Z'},{open:'2026-10-19T14:30:00Z',close:'2026-10-19T21:00:00Z'}],
    [{open:'2026-10-19T24:00:00Z',close:'2026-10-20T20:00:00Z'}],
  ])assert.equal(horizonWindow(invalid,'2026-01-01T00:00:00Z','next_day'),null);
});


test('permanent IDs must be nonblank trimmed strings for both qualifying routes',()=>{
 const routeB=()=>{const c=fixture();delete c.guidance;c.catalyst={status:'confirmed',interval:{start:'2026-10-19T15:00:00Z'},expected_information:'SYNTHETIC operating update',positive:'Operating improvement',adverse:'Operating weakness',company_reference:'SYNTHETIC company guide',reviewer_signed_off:true,source_refs:['SYNTHETIC']};return c;};
 assert.equal(classifyCandidate(routeB(),day,options).eligible,true);
 for(const create of [fixture,routeB])for(const id of [123,0,{},[],null,undefined,'',' ',' A','A ']){const c=create();c.security_id=id;const result=classifyCandidate(c,day,options);assert.equal(result.eligible,false);assert.ok(result.reasons.includes('identity_unresolved'));}
});

test('malformed IDs cannot crash a tied queue or enter before its valid member',()=>{
 const valid=fixture();valid.security_id='SYNTHETIC-VALID';
 for(const id of [123,456,{},null,' ']){const c=fixture();c.security_id=id;let result;assert.doesNotThrow(()=>{result=orderCandidates([c,valid],day,options);});assert.deepEqual(result.map(c=>c.security_id),['SYNTHETIC-VALID']);}
});
