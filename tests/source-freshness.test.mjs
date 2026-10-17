import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSourceCheck, summarizeSourceChecks} from '../dist/lib/source-freshness.js';
const observed = '2026-10-17T01:28:32.346Z';
const check = () => ({id:'bls_cpi_api',observed_at:observed,status:'Captured once · current-vintage monthly data',note:'September 2026'});

test('source capture age expires while copied observation clock and financial limits remain unchanged',()=>{
  const row=check(), before=structuredClone(row);
  const edge=assessSourceCheck(row,{at:'2026-10-17T13:28:32.346Z'});
  assert.equal(edge.captureStatus,'capture_within_age_policy');
  assert.equal(edge.nextTransitionAt,'2026-10-17T13:28:32.347Z');
  const expired=assessSourceCheck(row,{at:'2026-10-17T13:28:32.347Z'});
  assert.equal(expired.captureStatus,'capture_stale');
  assert.equal(expired.nextTransitionAt,null);
  assert.equal(expired.observedAt,observed);
  assert.equal(expired.financialCompleteness,'unestablished');
  assert.equal(expired.eligibleForRanking,false);
  assert.equal(expired.observationPeriod,null);
  assert.deepEqual(row,before);
});

test('source-check clocks reject future capture, date rollover and absent observation without borrowing review time',()=>{
  const at='2026-10-17T05:00:00Z';
  const rows=[{observed_at:'2026-10-18T01:00:00Z'},{observed_at:'2026-02-30T01:00:00Z'},{reviewed_at:at},check()];
  const result=summarizeSourceChecks(rows,{at});
  assert.equal(result.status,'source_clock_incomplete');
  assert.equal(result.invalidCount,2);
  assert.equal(result.missingCount,1);
  assert.equal(result.withinAgePolicyCount,1);
  assert.equal(result.nextTransitionAt,'2026-10-17T13:28:32.347Z');
  assert.equal(assessSourceCheck(rows[0],{at}).nextTransitionAt,'2026-10-18T01:00:00.000Z');
  assert.equal(result.oldestObservedAt,observed);
  assert.equal(result.latestObservedAt,observed);
  assert.equal(assessSourceCheck(rows[0],{at}).captureAgeHours,null);
  assert.throws(()=>summarizeSourceChecks(rows,{at:'2026-02-30T00:00:00Z'}),/policy_invalid/);
});

test('aggregate source age uses every retained observation and does not let one new capture mask older ones',()=>{
  const result=summarizeSourceChecks([check(),{id:'sec_ibm',observed_at:'2026-10-16T01:26:03.104Z'}],{at:'2026-10-17T05:00:00Z'});
  assert.equal(result.status,'source_observations_stale');
  assert.equal(result.staleCount,1);
  assert.equal(result.withinAgePolicyCount,1);
  assert.equal(result.oldestObservedAt,'2026-10-16T01:26:03.104Z');
  assert.equal(result.eligibleForRanking,false);
  assert.equal(summarizeSourceChecks([],{at:observed}).status,'no_source_observations');
  assert.throws(()=>summarizeSourceChecks([],{at:observed,maxCaptureAgeHours:0}),/policy_invalid/);
});

const inventory=()=>({id:'sec_ibm',name:'SEC filing inventory · IBM',url:'https://data.sec.gov/submissions/CIK0000051143.json',source_kind:'sec_submissions',observed_at:'2026-10-17T01:26:03.104Z',last_check:{url:'https://data.sec.gov/submissions/CIK0000051143.json',source_kind:'sec_submissions',observed_at:'2026-10-17T16:35:39.488Z',outcome:'unchanged',sha256:'a'.repeat(64)}});
test('endpoint-scoped recheck preserves first observation and never renews separate CompanyFacts capture',()=>{
  const row=inventory(),before=structuredClone(row),at='2026-10-17T17:00:00Z';
  const state=assessSourceCheck(row,{at});
  assert.equal(state.observedAt,row.observed_at);
  assert.equal(state.effectiveObservedAt,row.last_check.observed_at);
  assert.equal(state.lastCheckedAt,row.last_check.observed_at);
  assert.equal(state.captureStatus,'capture_within_age_policy');
  assert.equal(state.nextTransitionAt,'2026-10-18T04:35:39.489Z');
  const facts={id:'sec_ibm_companyfacts',source_kind:'sec_companyfacts',url:'https://data.sec.gov/api/xbrl/companyfacts/CIK0000051143.json',observed_at:'2026-10-17T01:22:00.759Z'};
  const summary=summarizeSourceChecks([row,facts],{at});
  assert.equal(summary.withinAgePolicyCount,1);assert.equal(summary.staleCount,1);
  assert.equal(summary.bySourceKind.sec_submissions.withinAgePolicyCount,1);
  assert.equal(summary.bySourceKind.sec_companyfacts.staleCount,1);
  assert.equal(summary.latestObservedAt,row.last_check.observed_at);
  assert.equal(summary.originalLatestObservedAt,row.observed_at);
  assert.deepEqual(row,before);
});
test('invalid last-check binding, digest, outcome or chronology cannot fall back to an earlier apparently fresh clock',()=>{
  const changes=[
    row=>row.last_check.url='https://data.sec.gov/api/xbrl/companyfacts/CIK0000051143.json',
    row=>row.last_check.source_kind='sec_companyfacts',
    row=>row.last_check.sha256='bad',
    row=>row.last_check.outcome='failed',
    row=>row.last_check.observed_at='2026-10-17T01:00:00Z',
    row=>row.last_check.observed_at='2026-02-30T01:00:00Z',
    row=>row.last_check=null,
    row=>row.observed_at=null,
    row=>{row.url='https://elsewhere.example/data';row.last_check.url=row.url;}
  ];
  for(const change of changes){
    const row=inventory();change(row);
    const result=assessSourceCheck(row,{at:'2026-10-17T17:00:00Z',maxCaptureAgeHours:24});
    assert.equal(result.captureStatus,'capture_time_invalid');assert.equal(result.captureAgeHours,null);
    assert.equal(result.lastCheckedAt,null);assert.equal(result.effectiveObservedAt,null);
    assert.equal(result.nextTransitionAt,null);
  }
});
test('future bound recheck remains invalid until its clock and expires from its own actual capture',()=>{
  const row=inventory(),at='2026-10-17T16:00:00Z';
  const future=assessSourceCheck(row,{at});
  assert.equal(future.lastCheckReason,'future_check');assert.equal(future.captureStatus,'capture_time_invalid');
  assert.equal(future.nextTransitionAt,'2026-10-17T16:35:39.488Z');
  assert.equal(assessSourceCheck(row,{at:row.last_check.observed_at}).captureStatus,'capture_within_age_policy');
  assert.equal(assessSourceCheck(row,{at:'2026-10-18T04:35:39.489Z'}).captureStatus,'capture_stale');
});
