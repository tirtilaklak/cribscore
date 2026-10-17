import test from 'node:test';
import assert from 'node:assert/strict';
import { planRefresh, commitRefresh, projectArchive } from '../dist/lib/refresh.js';
import { inspectEvidence } from '../dist/lib/evidence.js';

// SYNTHETIC state transitions only. The financial value, hash and rights audit
// below are fixtures, not financial evidence or a source-permission decision.
const AT = '2026-10-17T12:00:00Z';
const SITE_ID = 'snapshot-only-not-a-live-site';
const URL = 'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm';
const INDEX = 'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/0000320193-23-000106-index.html';
const clone = value => structuredClone(value);

function syntheticReview() {
  return {
    reviewId: 'SYNTHETIC-refresh-rights-audit', version: 1,
    reviewedAt: '2026-10-16T08:00:00Z', validFrom: '2026-10-16T08:00:00Z',
    expiresAt: '2026-10-20T08:00:00Z', termsUrl: 'https://www.sec.gov/privacy',
    purpose: 'historical_financial_facts',
    sourceBinding: { cik: '0000320193', accession: '0000320193-23-000106', urls: [URL, INDEX] },
    operations: { fetch: 'allowed', store: 'allowed', transform: 'allowed', display: 'allowed' }
  };
}
function syntheticRecord() {
  return {
    id: 'SYNTHETIC-apple-original-test-fact', issuer: { name: 'SYNTHETIC TEST ISSUER', cik: '0000320193' },
    metric: { taxonomy: 'us-gaap', concept: 'NetIncomeLoss', accountingBasis: 'US-GAAP' },
    value: 7, unit: 'USD', scale: 1000000, scope: 'consolidated', dimensions: [],
    period: { start: '2022-09-25', end: '2023-09-30', fiscalYear: 2023, type: 'duration' },
    source: {
      url: URL, indexUrl: INDEX, accession: '0000320193-23-000106', form: '10-K', original: true,
      location: 'SYNTHETIC exact annual NetIncomeLoss context', sha256: 'a'.repeat(64), parserVersion: 'SYNTHETIC/1',
      acceptedAt: '2023-11-02T18:08:27-04:00', publishedAt: null, publishedDate: '2023-11-03',
      publishedTimePrecision: 'date', publicAvailabilityObservedAt: '2026-10-16T09:00:00Z',
      fetchedAt: '2026-10-16T09:00:00Z', ingestedAt: '2026-10-16T09:00:01Z', mode: 'reconstructed_public_history'
    }, rights: [syntheticReview()]
  };
}
function archive() {
  return { revision: 1, records: [syntheticRecord()], runs: [],
    lastCheckedAt: '2026-10-17T10:00:00Z', lastSuccessfulCheckAt: '2026-10-17T10:00:00Z',
    evidenceChangedAt: '2026-10-16T09:00:01Z', sourceStatus: 'historical_as_reported' };
}
function planInput() {
  return { runId: 'SYNTHETIC-run-2', at: AT,
    site: { id: SITE_ID, audience: 'owner_private', serviceAccessAvailable: true },
    sourcePolicy: { id: 'sec-aapl-2023-original', cik: '0000320193', accession: '0000320193-23-000106',
      urls: [URL, INDEX], review: syntheticReview(), userAgentDeclared: true,
      requestLimits: { maxRequests: 2, minIntervalMs: 1000, timeoutMs: 20000, maxBytes: 3000000, retries: 0, followRedirects: false } },
    lastArchive: archive()
  };
}
function event(outcome = 'unchanged') {
  return { runId: 'SYNTHETIC-run-2', expectedRevision: 1,
    startedAt: '2026-10-17T11:00:00Z', checkedAt: '2026-10-17T11:01:00Z', outcome };
}
const options = { at: AT, inspectEvidence };

function blockedPlan(input) {
  const result = planRefresh(input);
  assert.equal(result.allowed, false);
  assert.ok(Array.isArray(result.reasons) && result.reasons.length);
  assert.deepEqual(result.requests ?? [], [], 'a blocked plan must authorize no requests');
}

test('refresh fixture itself passes the genuine financial-evidence guard', () => {
  assert.equal(inspectEvidence(syntheticRecord(), { at: AT }).eligible, true);
});
test('allowed plan is restricted to the existing two SEC documents', () => {
  const input = planInput(), before = clone(input), result = planRefresh(input);
  assert.equal(result.allowed, true, JSON.stringify(result));
  assert.deepEqual([...result.requests].sort(), [URL, INDEX].sort());
  assert.deepEqual(input, before, 'planning is pure');
});
for (const [name, change] of [
  ['unknown audience', input => { delete input.site.audience; }],
  ['public audience', input => { input.site.audience = 'public'; }],
  ['other Site', input => { input.site.id = 'appgprj_other'; }],
  ['absent service access', input => { input.site.serviceAccessAvailable = false; }],
  ['unknown rights audit', input => { input.sourcePolicy.review = null; }],
  ['expired rights audit', input => { input.sourcePolicy.review.expiresAt = AT; }],
  ['late audit', input => { input.sourcePolicy.review.reviewedAt = '2026-10-17T13:00:00Z'; }],
  ['future effective permission', input => { input.sourcePolicy.review.validFrom = '2026-10-18T13:00:00Z'; }],
  ['missing declared User-Agent', input => { input.sourcePolicy.userAgentDeclared = false; }],
  ['another source purpose', input => { input.sourcePolicy.review.purpose = 'model_input'; }],
  ['different rights issuer', input => { input.sourcePolicy.review.sourceBinding.cik = '0000789019'; }],
  ['different rights accession', input => { input.sourcePolicy.review.sourceBinding.accession = '0000320193-23-000107'; }],
  ['missing rights URL', input => { input.sourcePolicy.review.sourceBinding.urls = [INDEX]; }],
  ['new filing', input => { input.sourcePolicy.urls[0] = URL.replace('000032019323000106', '000032019323000107'); }],
  ['new issuer', input => { input.sourcePolicy.cik = '0000789019'; }],
  ['paid or unapproved source', input => { input.sourcePolicy.urls.push('https://paid.example.invalid/quote'); }],
  ['redirects enabled', input => { input.sourcePolicy.requestLimits.followRedirects = true; }],
  ['retry enabled', input => { input.sourcePolicy.requestLimits.retries = 1; }],
  ['excess requests', input => { input.sourcePolicy.requestLimits.maxRequests = 3; }],
  ['excess rate', input => { input.sourcePolicy.requestLimits.minIntervalMs = 100; }],
  ['unbounded timeout', input => { input.sourcePolicy.requestLimits.timeoutMs = Infinity; }],
  ['unbounded response size', input => { input.sourcePolicy.requestLimits.maxBytes = Infinity; }]
]) {
  test(`refresh plan blocks ${name} before network`, () => {
    const input = planInput(); change(input); blockedPlan(input);
  });
}
for (const operation of ['fetch', 'store', 'transform', 'display']) {
  for (const state of ['unknown', 'denied', 'revoked']) {
    test(`refresh plan blocks ${operation} right ${state}`, () => {
      const input = planInput(); input.sourcePolicy.review.operations[operation] = state; blockedPlan(input);
    });
  }
}
for (const httpStatus of [403, 429]) {
  test(`same-run HTTP ${httpStatus} cannot be retried through a new plan`, () => {
    const input = planInput(); input.attempt = { runId: input.runId, httpStatus }; blockedPlan(input);
  });
}
test('serialized plan contains no service bearer or credential value', () => {
  const input = planInput(); input.site.serviceToken = 'SYNTHETIC-MUST-NOT-PERSIST';
  assert.doesNotMatch(JSON.stringify(planRefresh(input)), /SYNTHETIC-MUST-NOT-PERSIST/);
});
test('unchanged retrieval advances only check clocks and preserves immutable historical context', () => {
  const previous = archive(), before = clone(previous), update = event(), result = commitRefresh(previous, update, options);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.archive.revision, 2);
  assert.equal(result.archive.lastCheckedAt, update.checkedAt);
  assert.equal(result.archive.lastSuccessfulCheckAt, update.checkedAt);
  assert.equal(result.archive.evidenceChangedAt, previous.evidenceChangedAt);
  assert.deepEqual(result.archive.records, previous.records);
  assert.equal(result.archive.runs.length, 1);
  assert.deepEqual(previous, before, 'commit returns new state without mutating old state');
});
test('run-scoped service credentials cannot be persisted through incidental event fields', () => {
  const update = { ...event(), serviceToken: 'SYNTHETIC-SECRET-MUST-NOT-PERSIST' };
  const result = commitRefresh(archive(), update, options);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-SECRET-MUST-NOT-PERSIST/);
});
test('failed check preserves prior archive and does not claim current source status', () => {
  const previous = archive(), update = { ...event('failed'), failure: { code: 'sec_http_403_stop_no_retry' } };
  const result = commitRefresh(previous, update, options);
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.deepEqual(result.archive.records, previous.records);
  assert.equal(result.archive.evidenceChangedAt, previous.evidenceChangedAt);
  assert.equal(result.archive.lastSuccessfulCheckAt, previous.lastSuccessfulCheckAt);
  assert.equal(result.archive.lastCheckedAt, update.checkedAt);
  assert.equal(result.archive.sourceStatus, 'check_failed');
  const view = projectArchive(result.archive, options);
  assert.equal(view.historical, true); assert.equal(view.facts.length, 1);
  assert.equal(view.sourceStatus, 'check_failed');
});
test('expired review is not silently extended by a successful-looking unchanged event', () => {
  const previous = archive(); previous.records[0].rights[0].expiresAt = '2026-10-17T10:30:00Z';
  const result = commitRefresh(previous, event(), options);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.archive, previous);
  assert.equal(result.archive.records[0].rights[0].expiresAt, '2026-10-17T10:30:00Z');
});
test('revision conflict does not replace archive or authorize another fetch', () => {
  const previous = archive(), update = { ...event(), expectedRevision: 0 };
  const result = commitRefresh(previous, update, options);
  assert.equal(result.accepted, false); assert.deepEqual(result.archive, previous);
  assert.ok(result.reasons.includes('revision_conflict'));
});
test('identical run ID is idempotent and cannot double-count a check', () => {
  const update = event(), first = commitRefresh(archive(), update, options);
  assert.equal(first.accepted, true);
  const repeated = commitRefresh(first.archive, update, options);
  assert.equal(repeated.accepted, true);
  assert.deepEqual(repeated.archive, first.archive);
});
test('reusing a run ID with a changed outcome is rejected', () => {
  const first = commitRefresh(archive(), event(), options);
  const result = commitRefresh(first.archive, { ...event('failed'), failure: { code: 'changed_outcome' } }, options);
  assert.equal(result.accepted, false); assert.deepEqual(result.archive, first.archive);
});
for (const [name, change] of [
  ['ambiguous start time', update => { update.startedAt = '2026-10-17T11:00:00'; }],
  ['check before start', update => { update.checkedAt = '2026-10-17T10:00:00Z'; }],
  ['future successful check', update => { update.checkedAt = '2026-10-18T10:00:00Z'; }]
]) {
  test(`commit rejects ${name} without inventing clocks`, () => {
    const previous = archive(), update = event(); change(update);
    const result = commitRefresh(previous, update, options);
    assert.equal(result.accepted, false); assert.deepEqual(result.archive, previous);
  });
}
test('unchanged label cannot conceal a different financial fact', () => {
  const previous = archive(), candidate = clone(previous.records[0]); candidate.value = 99;
  const result = commitRefresh(previous, { ...event(), candidate }, options);
  assert.equal(result.accepted, false); assert.deepEqual(result.archive, previous);
});
test('same source hash with a changed financial value cannot create new evidence', () => {
  const previous = archive(), candidate = clone(previous.records[0]); candidate.value = 99;
  const result = commitRefresh(previous, { ...event('new_evidence'), candidate }, options);
  assert.equal(result.accepted, false); assert.deepEqual(result.archive, previous);
});
test('a new source byte hash alone is an unreviewed change, not company evidence', () => {
  const previous = archive(), candidate = clone(previous.records[0]); candidate.source.sha256 = 'b'.repeat(64);
  candidate.source.fetchedAt = '2026-10-17T11:00:00Z'; candidate.source.ingestedAt = '2026-10-17T11:01:00Z';
  const result = commitRefresh(previous, { ...event('new_evidence'), candidate }, options);
  assert.equal(result.accepted, false); assert.deepEqual(result.archive, previous);
});
test('incomplete source candidate cannot replace the last valid archive', () => {
  const previous = archive(), candidate = clone(previous.records[0]); delete candidate.source.sha256;
  const result = commitRefresh(previous, { ...event('new_evidence'), candidate }, options);
  assert.equal(result.accepted, false); assert.deepEqual(result.archive, previous);
});
test('every read reevaluates actual display rights instead of trusting cached supported status', () => {
  const state = archive();
  const beforeExpiry = projectArchive(state, options); assert.equal(beforeExpiry.facts.length, 1);
  const expired = projectArchive(state, { ...options, at: '2026-10-21T12:00:00Z' });
  assert.equal(expired.facts.length, 0); assert.equal(expired.sourceStatus, 'rights_blocked');
  assert.equal(expired.historical, true); assert.deepEqual(state.records, archive().records);
});
test('an overdue check is stale even while the old fact remains display-permitted', () => {
  const view = projectArchive(archive(), { ...options, at: '2026-10-18T12:00:00Z', maxCheckAgeMs: 86400000 });
  assert.equal(view.sourceStatus, 'check_overdue'); assert.equal(view.facts.length, 1);
  assert.equal(view.evidenceChangedAt, archive().evidenceChangedAt); assert.equal(view.historical, true);
});
test('unknown earnings timing cannot erase otherwise permitted historical facts', () => {
  const state = archive(); state.earnings = { nextEvent: { status: 'unknown', at: null } };
  const view = projectArchive(state, options);
  assert.equal(view.facts.length, 1); assert.equal(view.historical, true);
  assert.notEqual(view.direction, 'buy'); assert.notEqual(view.direction, 'sell');
});

// Additional integration cases: successful paths, append-only rights, malformed
// inputs and bypass attempts. Every observation/review here remains synthetic.
function freshCandidate() {
  const record=syntheticRecord();record.id='SYNTHETIC-corrected-original';record.value=8;
  Object.assign(record.source,{sha256:'b'.repeat(64),publicAvailabilityObservedAt:'2026-10-17T11:00:00Z',fetchedAt:'2026-10-17T11:00:00Z',ingestedAt:'2026-10-17T11:00:30Z'});
  return record;
}
function correctionEvent() {
  const candidate=freshCandidate();
  return {...event('new_evidence'),candidate,changeReview:{type:'reviewed_original_fact_correction',material:true,reasonCode:'source_fact_corrected',reviewerVersion:'SYNTHETIC-reviewer/1',reviewedAt:'2026-10-17T11:00:45Z',previousSourceHash:'a'.repeat(64),sourceHash:candidate.source.sha256}};
}
function renewal() {
  return {...syntheticReview(),reviewId:'SYNTHETIC-observed-renewal',version:2,reviewedAt:'2026-10-17T10:40:00Z',validFrom:'2026-10-17T10:40:00Z',expiresAt:'2026-10-22T08:00:00Z',termsEvidence:[{url:'https://www.sec.gov/privacy',observedAt:'2026-10-17T10:39:00Z',sha256:'c'.repeat(64)}]};
}
test('reviewed changed fact appends an immutable snapshot and advances evidence time only on commit',()=>{
  const previous=archive(),before=clone(previous),update=correctionEvent();
  const result=commitRefresh(previous,update,options);
  assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.archive.records.length,2);
  assert.deepEqual(result.archive.records[0],previous.records[0]);assert.equal(result.archive.activeRecordId,update.candidate.id);
  assert.equal(result.archive.evidenceChangedAt,AT);assert.deepEqual(previous,before);
  const view=projectArchive(result.archive,options);assert.equal(view.facts.length,1);assert.equal(view.facts[0].value,8);
  assert.equal(view.direction,null);assert.equal(view.research_status,'unvalidated');assert.equal(view.refreshConfigured,false);
});
test('initial capture requires explicit original-source review and cannot masquerade as unchanged',()=>{
  const previous={revision:0,records:[],runs:[]};
  assert.equal(commitRefresh(previous,{...event(),expectedRevision:0},options).accepted,false);
  const update=correctionEvent();update.expectedRevision=0;
  update.changeReview={...update.changeReview,type:'initial_original_capture'};
  const result=commitRefresh(previous,update,options);assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.archive.records.length,1);
});
test('changing hash and number without material review still cannot create admitted evidence',()=>{
  const update=correctionEvent();delete update.changeReview;
  assert.equal(commitRefresh(archive(),update,options).accepted,false);
});
test('numeric formatting or issuer-name edits do not make the same underlying fact new',()=>{
  for(const change of [r=>r.value='7.0',r=>{r.value=7;r.issuer.name='SYNTHETIC corrected name';}]){
    const update=correctionEvent();change(update.candidate);
    assert.equal(commitRefresh(archive(),update,options).accepted,false);
  }
});
test('fresh rights renewal is separate from original observation and allows later use without redating evidence',()=>{
  const previous=archive();previous.records[0].rights[0].expiresAt='2026-10-17T10:30:00Z';
  const original=clone(previous.records[0]);
  const result=commitRefresh(previous,{...event(),rightsReviews:[renewal()]},options);
  assert.equal(result.accepted,true,JSON.stringify(result));assert.deepEqual(result.archive.records[0],original);
  assert.equal(result.archive.evidenceChangedAt,previous.evidenceChangedAt);
  assert.equal(result.archive.rightsReviews.length,1);
  const later=projectArchive(result.archive,{...options,at:'2026-10-21T12:00:00Z'});
  assert.equal(later.facts.length,1);assert.equal(later.facts[0].source.fetchedAt,original.source.fetchedAt);
});
test('rights cannot be renewed by editing an existing audit identity or dropping contemporaneous terms evidence',()=>{
  const update=event(),review=syntheticReview();review.expiresAt='2026-10-22T08:00:00Z';
  assert.equal(commitRefresh(archive(),{...update,rightsReviews:[review]},options).accepted,false);
  const withoutEvidence=renewal();delete withoutEvidence.termsEvidence;
  assert.equal(commitRefresh(archive(),{...update,rightsReviews:[withoutEvidence]},options).accepted,false);
});
test('new revocation is retained on a failed run and immediately withholds cached numerical display',()=>{
  const review=renewal();review.operations.display='revoked';
  const result=commitRefresh(archive(),{...event('failed'),failure:{code:'rights_review_required'},rightsReviews:[review]},options);
  assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.archive.records.length,1);
  const view=projectArchive(result.archive,options);assert.equal(view.facts.length,0);assert.equal(view.sourceStatus,'rights_blocked');
});
test('late review cannot authorize a fetch that began before the audit existed',()=>{
  const previous=archive();previous.records[0].rights[0].expiresAt='2026-10-17T10:30:00Z';
  const review=renewal();review.reviewedAt='2026-10-17T11:00:20Z';review.validFrom=review.reviewedAt;
  assert.equal(commitRefresh(previous,{...event(),rightsReviews:[review]},options).accepted,false);
});
test('injected always-eligible inspector cannot bypass the actual SEC context and rights guard',()=>{
  const previous=archive();previous.records[0].unit='EUR';
  const malicious={at:AT,inspectEvidence:()=>({eligible:true,claim:'SYNTHETIC fake buy'})};
  assert.equal(commitRefresh(previous,event(),malicious).accepted,false);
  const view=projectArchive(previous,malicious);assert.equal(view.facts.length,0);assert.doesNotMatch(JSON.stringify(view),/fake buy/);
});
test('projection ignores caller narrative, direction and performance fields and returns only bound claims',()=>{
  const previous=archive();previous.direction='buy';previous.records[0].claim='SYNTHETIC guaranteed gain';previous.records[0].expectedReturn=100;
  const view=projectArchive(previous,options);assert.equal(view.facts.length,1);assert.equal(view.direction,null);
  assert.doesNotMatch(JSON.stringify(view),/guaranteed gain|expectedReturn/);
});
test('failed check may record review-required status without deleting expired historical evidence',()=>{
  const previous=archive();previous.records[0].rights[0].expiresAt='2026-10-17T10:30:00Z';
  const result=commitRefresh(previous,{...event('failed'),failure:{code:'rights_review_required',message:'SYNTHETIC-DO-NOT-STORE'}},options);
  assert.equal(result.accepted,true);assert.deepEqual(result.archive.records,previous.records);
  assert.doesNotMatch(JSON.stringify(result),/DO-NOT-STORE/);assert.equal(projectArchive(result.archive,options).facts.length,0);
});
test('unknown-byte changes remain an explicitly unreviewed source status',()=>{
  const result=commitRefresh(archive(),{...event('failed'),failure:{code:'source_change_unreviewed'}},options);
  assert.equal(result.accepted,true);const view=projectArchive(result.archive,options);
  assert.equal(view.sourceStatus,'source_change_unreviewed');assert.equal(view.facts.length,1);
  assert.equal(view.evidenceChangedAt,archive().evidenceChangedAt);
});
test('pending or uncertain source attempt blocks further planning even with a different run ID',()=>{
  for(const status of ['pending','uncertain','denied','redirect']){
    const input=planInput();input.attempt={runId:'SYNTHETIC-earlier-run',status};blockedPlan(input);
  }
});
test('run replay rejects changed candidate data and a check clock cannot move backwards',()=>{
  const update=correctionEvent(),first=commitRefresh(archive(),update,options);assert.equal(first.accepted,true);
  update.candidate.value=9;assert.equal(commitRefresh(first.archive,update,options).accepted,false);
  assert.equal(commitRefresh(archive(),{...event(),startedAt:'2026-10-17T09:00:00Z'},options).accepted,false);
});
test('invalid timestamps and malformed archives fail closed without generating a clock',()=>{
  for(const at of [null,'2026-02-30T12:00:00Z','2026-10-17T25:00:00Z','2026-10-17T12:00:00','2026-10-17T12:00:00+99:00']){
    assert.equal(planRefresh({...planInput(),at}).allowed,false);
    assert.equal(commitRefresh(archive(),event(),{at}).accepted,false);
    assert.equal(projectArchive(archive(),{at}).facts.length,0);
  }
  assert.equal(commitRefresh({revision:1,records:[null],runs:[]},event(),options).accepted,false);
  assert.equal(projectArchive({revision:1,records:[null],runs:[]},options).facts.length,0);
});
test('freshness uses explicit due policy while preserving failed status and original observation dates',()=>{
  const previous=archive();previous.nextCheckDueAt='2026-10-17T11:30:00Z';
  const view=projectArchive(previous,options);assert.equal(view.sourceStatus,'check_overdue');assert.equal(view.facts[0].period.end,'2023-09-30');
  previous.sourceStatus='check_failed';assert.equal(projectArchive(previous,options).sourceStatus,'check_failed');
  assert.equal(projectArchive(previous,{...options,maxCheckAgeMs:-1}).facts.length,0);
});

test('malformed rights registry entries cannot throw or be silently admitted',()=>{
  for(const change of [a=>a.records[0].rights=[null],a=>a.rightsReviews=[null],a=>a.rightsReviews='invalid']){
    const previous=archive();change(previous);
    assert.equal(commitRefresh(previous,event(),options).accepted,false);
    assert.equal(projectArchive(previous,options).facts.length,0);
  }
  assert.equal(commitRefresh(archive(),{...event(),rightsReviews:{}},options).accepted,false);
});
