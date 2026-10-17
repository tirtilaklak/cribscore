import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMarketSnapshot,commitMarketSnapshot,projectMarketArchive} from '../market-ingestion.mjs';
import {fixture} from './fixtures.mjs';

test('valid synthetic 60-session raw consolidated feed has separate reference and derived liquidity',()=>{
  const f=fixture(), before=structuredClone(f), result=inspectMarketSnapshot(f.snapshot,f.options);
  assert.equal(result.eligible,true,JSON.stringify(result));
  assert.equal(result.priceReference.value,159); assert.equal(result.priceReference.executableEntry,false);
  assert.equal(result.liquidity.value,12950000); assert.equal(result.liquidity.sessions,60);
  assert.deepEqual(f,before);
});

for (const [name,change] of [
  ['fewer than 60 sessions',f=>f.snapshot.bars.shift()],
  ['missing middle session',f=>f.snapshot.bars.splice(30,1)],
  ['duplicate session',f=>f.snapshot.bars[30]=structuredClone(f.snapshot.bars[29])],
  ['out-of-order sessions',f=>f.snapshot.bars.reverse()],
  ['provider mismatch',f=>f.snapshot.providerId='OTHER'],
  ['dataset mismatch',f=>f.snapshot.datasetId='OTHER'],
  ['ticker reuse under another permanent identity',f=>f.snapshot.bars[20].securityId='OTHER'],
  ['different issuer behind same asserted security',f=>f.snapshot.security.cik='0000000002'],
  ['different share class',f=>f.snapshot.security.shareClass='preferred'],
  ['security not effective for all bars',f=>f.snapshot.security.validFrom='2026-10-01'],
  ['unsupported security',f=>f.snapshot.security.instrumentType='option'],
  ['unverified currency',f=>f.snapshot.basis.currency='EUR'],
  ['single venue volume',f=>f.snapshot.basis.coverage='single_venue'],
  ['adjusted prices with raw volume',f=>f.snapshot.basis.price='split_adjusted'],
  ['mixed adjusted field',f=>f.snapshot.bars[2].adjustedClose=1],
  ['partial session',f=>f.snapshot.bars.at(-1).status='provisional'],
  ['impossible high/low',f=>f.snapshot.bars[5].high=1],
  ['negative price',f=>f.snapshot.bars[5].close=-1],
  ['numeric string price',f=>f.snapshot.bars[5].close='100'],
  ['NaN price',f=>f.snapshot.bars[5].open=NaN],
  ['fractional volume',f=>f.snapshot.bars[5].volume=1.1],
  ['negative volume',f=>f.snapshot.bars[5].volume=-1],
  ['missing volume',f=>delete f.snapshot.bars[5].volume],
  ['unsafe liquidity arithmetic',f=>f.snapshot.bars[5].volume=Number.MAX_SAFE_INTEGER],
  ['missing provider timestamp',f=>delete f.snapshot.bars.at(-1).providerPublishedAt],
  ['publication before session complete',f=>f.snapshot.bars.at(-1).providerPublishedAt='2026-10-16T19:59:00Z'],
  ['provider snapshot before bar publication',f=>f.snapshot.source.publishedAt='2026-10-16T20:00:00Z'],
  ['fetch before provider publication',f=>f.snapshot.source.fetchedAt='2026-10-16T19:59:00Z'],
  ['ingestion before fetch',f=>f.snapshot.source.ingestedAt='2026-10-17T09:59:59Z'],
  ['ingestion after cutoff',f=>f.snapshot.source.ingestedAt='2026-10-17T11:01:00Z'],
  ['missing provider hash',f=>delete f.snapshot.source.sha256],
  ['credentials embedded in source URL',f=>f.snapshot.source.url='https://user:pass@quotes.example.invalid/daily'],
  ['calendar not covering cutoff date',f=>f.options.calendar.validThrough='2026-10-16'],
  ['calendar duplicate session',f=>f.options.calendar.sessions[5]=structuredClone(f.options.calendar.sessions[4])],
  ['calendar observed after cutoff',f=>f.options.calendar.observedAt='2026-10-17T11:01:00Z'],
  ['calendar shape invalid',f=>f.options.calendar.sessions={}],
  ['lowered minimum history policy',f=>f.options.policy.requiredSessions=1],
  ['unknown actions',f=>f.snapshot.actions.complete=false],
  ['incomplete action history',f=>f.snapshot.actions.coverageStart='2026-10-01'],
  ['stale action review',f=>f.snapshot.actions.reviewedAt='2026-10-15T20:00:00Z'],
  ['action review after ingestion',f=>f.snapshot.actions.reviewedAt='2026-10-17T10:01:00Z'],
  ['unknown split ratio',f=>f.snapshot.actions.items=[{id:'SPLIT',securityId:f.options.policy.securityId,type:'split',effectiveSession:'2026-10-16',splitRatio:0}]],
  ['unsupported spin-off',f=>f.snapshot.actions.items=[{id:'SPINOFF',securityId:f.options.policy.securityId,type:'spinoff',effectiveSession:'2026-10-16'}]],
  ['distribution currency mismatch',f=>f.snapshot.actions.items=[{id:'DIV',securityId:f.options.policy.securityId,type:'cash_dividend',effectiveSession:'2026-10-16',cashPerShare:1,currency:'EUR'}]],
  ['ambiguous action fields',f=>f.snapshot.actions.items=[{id:'DIV',securityId:f.options.policy.securityId,type:'cash_dividend',effectiveSession:'2026-10-16',cashPerShare:1,currency:'USD',splitRatio:2}]],
  ['cutoff in future',f=>f.options.cutoffAt='2026-10-17T13:00:00Z'],
  ['invalid date rollover',f=>f.options.at='2026-02-30T12:00:00Z'],
  ['unqualified local time',f=>f.options.at='2026-10-17T12:00:00'],
]) test(`fails closed: ${name}`,()=>{const f=fixture();change(f);const r=inspectMarketSnapshot(f.snapshot,f.options);assert.equal(r.eligible,false,JSON.stringify(r));assert.equal(r.priceReference,null);assert.equal(r.liquidity,null);});

test('zero volume remains an observed zero and cannot become missing or fabricated liquidity',()=>{
  const f=fixture();for(const b of f.snapshot.bars)b.volume=0;
  const r=inspectMarketSnapshot(f.snapshot,f.options);assert.equal(r.eligible,true);assert.equal(r.liquidity.value,0);
});

test('raw split and cash distribution coverage is retained without inventing total-return adjustment',()=>{
  const f=fixture();f.snapshot.actions.items=[{id:'SPLIT',securityId:f.options.policy.securityId,type:'split',effectiveSession:'2026-10-16',splitRatio:2},{id:'DIV',securityId:f.options.policy.securityId,type:'cash_dividend',effectiveSession:'2026-10-16',cashPerShare:1,currency:'USD'}];
  const result=inspectMarketSnapshot(f.snapshot,f.options);assert.equal(result.eligible,true);assert.equal(result.priceReference.value,159);assert.equal(result.liquidity.basis,'raw_close_times_reported_volume');
});

for(const operation of ['fetch','store','transform']) test(`capture ${operation} denial blocks dependent outputs`,()=>{
  const f=fixture();f.review.operations[operation]='denied';const r=inspectMarketSnapshot(f.snapshot,f.options);
  assert.equal(r.eligible,false);assert.equal(r.priceReference,null);assert.equal(r.liquidity,null);
});
for(const operation of ['derive','derived_display']) test(`${operation} denial withholds derived metrics while preserving permitted reference`,()=>{
  const f=fixture();f.review.operations[operation]='denied';const r=inspectMarketSnapshot(f.snapshot,f.options);
  assert.equal(r.eligible,true);assert.notEqual(r.priceReference,null);assert.equal(r.liquidity,null);assert.equal(r.derivedDisplayAllowed,false);
});
test('raw display and derived display rights are independently enforced',()=>{
  const f=fixture();f.review.operations.display='denied';const r=inspectMarketSnapshot(f.snapshot,f.options);
  assert.equal(r.priceReference,null);assert.notEqual(r.liquidity,null);
});
for(const [name,change] of [
  ['unknown rights',f=>f.options.rightsReviews=[]],
  ['expired rights',f=>f.review.expiresAt='2026-10-17T10:00:00Z'],
  ['retroactive review',f=>{f.review.reviewedAt='2026-10-17T10:30:00Z';}],
  ['broader source scope',f=>f.review.urls.push('https://other.example.invalid/data')],
  ['different provider',f=>f.review.providerId='OTHER'],
  ['different security',f=>f.review.securityIds=['OTHER']],
  ['public audience approval substituted for private scope',f=>f.review.audience='public'],
  ['missing terms evidence',f=>delete f.review.termsEvidence],
  ['outdated terms observation',f=>f.review.termsEvidence[0].observedAt='2025-01-01T00:00:00Z'],
  ['terms not yet observed at audit',f=>f.review.termsEvidence[0].observedAt='2026-10-01T09:00:00Z'],
  ['edited audit identity',f=>{const r=structuredClone(f.review);r.expiresAt='2026-10-22T23:00:00Z';f.options.rightsReviews.push(r);}],
  ['same-time contradictory audits',f=>{const r=structuredClone(f.review);r.id='OTHER';r.version=2;r.operations.display='revoked';r.operations.derived_display='revoked';f.options.rightsReviews.push(r);}]
]) test(`rights fail closed: ${name}`,()=>{const f=fixture();change(f);const r=inspectMarketSnapshot(f.snapshot,f.options);assert.equal(r.priceReference,null);assert.equal(r.liquidity,null);});

test('re-fetching an older last session cannot hide a missing newly completed session',()=>{
  const f=fixture();f.options.at='2026-10-20T12:00:00Z';f.options.cutoffAt='2026-10-20T11:00:00Z';
  f.snapshot.source.fetchedAt='2026-10-20T10:00:00Z';f.snapshot.source.ingestedAt='2026-10-20T10:00:01Z';
  const r=inspectMarketSnapshot(f.snapshot,f.options);assert.equal(r.fresh,false);assert.equal(r.eligible,false);assert.equal(r.liquidity,null);assert.equal(r.priceReference.session,'2026-10-16');
});
test('check age reaches stale at the explicit boundary, without hiding historical reference',()=>{
  const f=fixture();f.options.at='2026-10-18T10:00:00Z';f.options.cutoffAt=f.options.at;
  const r=inspectMarketSnapshot(f.snapshot,f.options);assert.equal(r.fresh,false);assert.equal(r.liquidity,null);assert.notEqual(r.priceReference,null);
});
test('a historical cutoff cannot conceal sessions completed by actual read time',()=>{
  const f=fixture();f.options.at='2026-10-20T12:00:00Z';f.options.policy.maxCheckAgeMs=30*86400000;
  const r=inspectMarketSnapshot(f.snapshot,f.options);assert.equal(r.fresh,false);assert.equal(r.eligible,false);assert.equal(r.liquidity,null);
});
test('calendar coverage must extend through actual read time, not just the old cutoff',()=>{
  const f=fixture();f.options.at='2026-10-22T12:00:00Z';f.options.policy.maxCheckAgeMs=30*86400000;
  const r=inspectMarketSnapshot(f.snapshot,f.options);assert.equal(r.eligible,false);assert.equal(r.priceReference,null);assert.ok(r.reasons.includes('calendar_unverified'));
});

test('commit is pure, atomically appends one whole snapshot, and replay is idempotent',()=>{
  const f=fixture(),before=structuredClone(f),first=commitMarketSnapshot(f.archive,f.event,f.options);
  assert.equal(first.accepted,true,JSON.stringify(first));assert.equal(first.archive.revision,1);assert.equal(first.archive.snapshots.length,1);
  assert.deepEqual(f,before);assert.deepEqual(commitMarketSnapshot(first.archive,f.event,f.options).archive,first.archive);
  const altered=structuredClone(f.event);altered.snapshot.bars.at(-1).close=158;
  assert.equal(commitMarketSnapshot(first.archive,altered,f.options).accepted,false);
});
test('CAS conflict and invalid partial candidate leave prior snapshot unchanged',()=>{
  const f=fixture(),first=commitMarketSnapshot(f.archive,f.event,f.options).archive;
  for(const change of [e=>e.expectedRevision=0,e=>e.snapshot.bars.pop(),e=>e.snapshot.basis.coverage='single_venue',e=>e.snapshot.bars[0].adjustedClose=10]){
    const e=structuredClone(f.event);e.runId='SYNTHETIC-run-2';e.expectedRevision=1;change(e);
    const r=commitMarketSnapshot(first,e,f.options);assert.equal(r.accepted,false);assert.deepEqual(r.archive,first);
  }
});
function laterEvent(f) {
  const e=structuredClone(f.event);e.runId='SYNTHETIC-run-2';e.expectedRevision=1;e.startedAt='2026-10-17T12:01:00Z';e.checkedAt='2026-10-17T12:03:00Z';e.snapshot.id='SYNTHETIC-snapshot-2';e.snapshot.source.fetchedAt='2026-10-17T12:01:00Z';e.snapshot.source.ingestedAt='2026-10-17T12:02:00Z';
  return {event:e,options:{...f.options,at:'2026-10-17T12:04:00Z',cutoffAt:'2026-10-17T12:03:00Z'}};
}
test('unchanged check advances ledger without replacing immutable capture clocks or dataChangedAt',()=>{
  const f=fixture(),first=commitMarketSnapshot(f.archive,f.event,f.options).archive,later=laterEvent(f);
  const r=commitMarketSnapshot(first,later.event,later.options);assert.equal(r.accepted,true,JSON.stringify(r));assert.equal(r.archive.snapshots.length,1);
  assert.deepEqual(r.archive.snapshots,first.snapshots);assert.equal(r.archive.dataChangedAt,first.dataChangedAt);assert.equal(r.archive.lastSuccessfulCheckAt,later.event.checkedAt);
});
test('an index/actions change cannot explain a conflicting price payload under the same price hash',()=>{
  const f=fixture(),first=commitMarketSnapshot(f.archive,f.event,f.options).archive,later=laterEvent(f);
  later.event.snapshot.actions.sha256='e'.repeat(64);later.event.snapshot.bars.at(-1).close=158;
  const r=commitMarketSnapshot(first,later.event,later.options);assert.equal(r.accepted,false);assert.ok(r.reasons.includes('same_price_hash_conflicting_payload'));
});
test('a changed price hash cannot explain conflicting actions under the same actions hash',()=>{
  const f=fixture(),first=commitMarketSnapshot(f.archive,f.event,f.options).archive,later=laterEvent(f);
  later.event.snapshot.source.sha256='e'.repeat(64);later.event.snapshot.actions.items=[{id:'DIV',securityId:f.options.policy.securityId,type:'cash_dividend',effectiveSession:'2026-10-16',cashPerShare:1,currency:'USD'}];
  const r=commitMarketSnapshot(first,later.event,later.options);assert.equal(r.accepted,false);assert.ok(r.reasons.includes('same_actions_hash_conflicting_payload'));
});
test('a material corrected payload appends the entire new snapshot and preserves previous data',()=>{
  const f=fixture(),first=commitMarketSnapshot(f.archive,f.event,f.options).archive,later=laterEvent(f),before=structuredClone(first);
  later.event.snapshot.source.sha256='e'.repeat(64);later.event.snapshot.bars.at(-1).close=158;
  const r=commitMarketSnapshot(first,later.event,later.options);assert.equal(r.accepted,true,JSON.stringify(r));assert.equal(r.archive.snapshots.length,2);assert.deepEqual(r.archive.snapshots[0],before.snapshots[0]);assert.equal(r.archive.activeSnapshotId,later.event.snapshot.id);
});
test('failed check retains permitted reference, marks failure and withholds derived metrics',()=>{
  const f=fixture(),first=commitMarketSnapshot(f.archive,f.event,f.options).archive,later=laterEvent(f);
  const e={...later.event,outcome:'failed',failureCode:'provider_unavailable'};delete e.snapshot;
  const r=commitMarketSnapshot(first,e,later.options);assert.equal(r.accepted,true);
  const view=projectMarketArchive(r.archive,later.options);assert.equal(view.sourceStatus,'check_failed');assert.notEqual(view.priceReference,null);assert.equal(view.liquidity,null);assert.equal(view.feedInputsUsable,false);assert.equal(view.lastSuccessfulCheckAt,first.lastSuccessfulCheckAt);
});
test('every read rechecks rights for raw and derived data',()=>{
  const f=fixture(),first=commitMarketSnapshot(f.archive,f.event,f.options).archive;
  const revoke=structuredClone(f.review);revoke.id='SYNTHETIC-revocation';revoke.version=2;revoke.reviewedAt=revoke.validFrom='2026-10-17T12:01:00Z';revoke.termsEvidence[0].observedAt='2026-10-17T12:00:00Z';revoke.operations.display='revoked';revoke.operations.derived_display='revoked';
  const view=projectMarketArchive(first,{...f.options,at:'2026-10-17T12:02:00Z',rightsReviews:[f.review,revoke]});assert.equal(view.priceReference,null);assert.equal(view.liquidity,null);assert.equal(view.sourceStatus,'rights_blocked');
});
test('price rights do not mint directional rankings, return estimates, capitalizations or scores',()=>{
  const f=fixture();f.event.serviceToken='SYNTHETIC-SECRET';f.event.snapshot.rank=1;f.event.snapshot.score=99;f.event.snapshot.expectedReturn=1;
  const r=commitMarketSnapshot(f.archive,f.event,f.options),view=projectMarketArchive(r.archive,f.options);
  for(const key of ['rank','score','expectedReturn','gainProbability','marketCap'])assert.equal(view[key],null);
  assert.equal(view.refreshConfigured,false);assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC-SECRET|expectedReturn/);
});
test('malformed archives and malformed operation arguments fail closed',()=>{
  const f=fixture();for(const archive of [null,{}, {revision:0,snapshots:[],runs:{}}, {revision:0,snapshots:[null],runs:[]}]){
    assert.equal(commitMarketSnapshot(archive,f.event,f.options).accepted,false);assert.equal(projectMarketArchive(archive,f.options).priceReference,null);
  }
  assert.equal(inspectMarketSnapshot(null,null).eligible,false);
  const malformed={revision:1,snapshots:[{id:'SYNTHETIC'}],activeSnapshotId:'SYNTHETIC',runs:[]};
  assert.equal(commitMarketSnapshot(malformed,{...f.event,expectedRevision:1},f.options).accepted,false);
  f.event.snapshot.bars[0].volume=1n;assert.equal(commitMarketSnapshot(f.archive,f.event,f.options).accepted,false);
});

function observedFixture() {
  const f=fixture(),at=f.snapshot.source.fetchedAt;
  Object.assign(f.snapshot.source,{requestStartedAt:'2026-10-17T09:59:30Z',captureId:'SYNTHETIC-response-1',requestURL:f.options.policy.sourceUrl+'?startDate=2026-01-01&resampleFreq=daily',availabilityMode:'observed_capture',availabilityObservedAt:at,publishedAt:null,publicationPrecision:'unknown',correctionPossible:true});
  for(const bar of f.snapshot.bars)Object.assign(bar,{providerPublishedAt:null,status:'as_observed',availabilityObservedAt:at});
  return f;
}
function sharedActionsFixture() {
  const f=observedFixture();f.options.policy.actionsSourceMode='same_eod_fields_reviewed';f.options.policy.actionsUrl=f.options.policy.sourceUrl;
  f.review.urls=[f.options.policy.sourceUrl];f.snapshot.actions.sourceUrl=f.options.policy.sourceUrl;f.snapshot.actions.sha256=f.snapshot.source.sha256;
  f.snapshot.actions.coverageReview={reviewedAt:'2026-10-17T10:00:00Z',reviewerVersion:'SYNTHETIC-review-1',unsupportedActionsReviewed:true};
  return f;
}
test('actual capture observation supports unknown provider publication and correction-possible bars',()=>{
  const f=observedFixture(),r=inspectMarketSnapshot(f.snapshot,f.options);assert.equal(r.eligible,true,JSON.stringify(r));
  assert.equal(r.priceReference.providerPublishedAt,null);assert.equal(r.priceReference.publicationPrecision,'unknown');assert.equal(r.priceReference.correctionPossible,true);
  const committed=commitMarketSnapshot(f.archive,f.event,f.options);assert.equal(committed.accepted,true,JSON.stringify(committed));
  assert.equal(committed.archive.snapshots[0].source.requestURL,f.snapshot.source.requestURL);assert.equal(committed.archive.snapshots[0].source.captureId,'SYNTHETIC-response-1');
});
test('derived-only approval permits derived output with raw quote display withheld',()=>{
  const f=observedFixture();f.review.operations.display='denied';
  const committed=commitMarketSnapshot(f.archive,f.event,f.options);assert.equal(committed.accepted,true);
  const view=projectMarketArchive(committed.archive,f.options);assert.equal(view.priceReference,null);assert.notEqual(view.liquidity,null);
  assert.equal(view.feedInputsUsable,true);assert.equal(view.internalInputsUsable,true);assert.equal(view.rawDisplayAllowed,false);assert.equal(view.derivedDisplayAllowed,true);assert.equal(view.sourceStatus,'derived_only_context');
});
test('internal derive permission does not imply permission to publish derived output',()=>{
  const f=observedFixture();f.review.operations.display='denied';f.review.operations.derived_display='denied';
  const committed=commitMarketSnapshot(f.archive,f.event,f.options),view=projectMarketArchive(committed.archive,f.options);
  assert.equal(view.internalInputsUsable,true);assert.equal(view.feedInputsUsable,false);assert.equal(view.priceReference,null);assert.equal(view.liquidity,null);
});
test('one reviewed EOD source can cover raw quotes and corporate-action fields',()=>{
  const f=sharedActionsFixture(),r=inspectMarketSnapshot(f.snapshot,f.options);assert.equal(r.eligible,true,JSON.stringify(r));assert.equal(r.derivedDisplayAllowed,true);
});
test('identical observed bytes advance check history without recasting observation time as new data',()=>{
  const f=observedFixture(),first=commitMarketSnapshot(f.archive,f.event,f.options).archive,later=laterEvent(f);
  later.event.snapshot.source.captureId='SYNTHETIC-response-2';later.event.snapshot.source.availabilityObservedAt=later.event.snapshot.source.fetchedAt;
  for(const bar of later.event.snapshot.bars)bar.availabilityObservedAt=later.event.snapshot.source.fetchedAt;
  const r=commitMarketSnapshot(first,later.event,later.options);assert.equal(r.accepted,true,JSON.stringify(r));assert.equal(r.archive.snapshots.length,1);assert.deepEqual(r.archive.snapshots,first.snapshots);assert.equal(r.archive.lastSuccessfulCheckAt,later.event.checkedAt);
});
for(const [name,change] of [
  ['missing actual capture ID',f=>delete f.snapshot.source.captureId],
  ['inferred provider publication',f=>f.snapshot.source.publishedAt='2026-10-16T20:01:00Z'],
  ['invented finality flag',f=>f.snapshot.bars[0].status='final'],
  ['disclaimed future corrections',f=>f.snapshot.source.correctionPossible=false],
  ['backdated per-bar observation',f=>f.snapshot.bars[0].availabilityObservedAt='2026-09-01T00:00:00Z'],
  ['observation detached from actual completed capture',f=>f.snapshot.source.availabilityObservedAt='2026-10-17T09:00:00Z'],
  ['credential in request query',f=>f.snapshot.source.requestURL+='&token=DO-NOT-STORE'],
  ['request path switched from scoped source',f=>f.snapshot.source.requestURL='https://quotes.example.invalid/other'],
])test(`observed-capture variant rejects ${name}`,()=>{const f=observedFixture();change(f);assert.equal(inspectMarketSnapshot(f.snapshot,f.options).eligible,false);});
for(const [name,change] of [
  ['same URL without declared reviewed EOD mode',f=>delete f.options.policy.actionsSourceMode],
  ['shared response with conflicting hashes',f=>f.snapshot.actions.sha256='e'.repeat(64)],
  ['absent coverage review',f=>delete f.snapshot.actions.coverageReview],
  ['no unsupported-action review',f=>f.snapshot.actions.coverageReview.unsupportedActionsReviewed=false],
  ['review after cutoff',f=>f.snapshot.actions.coverageReview.reviewedAt='2026-10-18T10:00:00Z'],
])test(`same-source actions variant rejects ${name}`,()=>{const f=sharedActionsFixture();change(f);assert.equal(inspectMarketSnapshot(f.snapshot,f.options).eligible,false);});
