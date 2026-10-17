import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeTiingoObservedCapture} from './tiingo-observed-bridge.mjs';
import {bridgeFixture} from './fixtures.mjs';
import {inspectMarketSnapshot,commitMarketSnapshot,projectMarketArchive} from '../market-ingestion/market-ingestion.mjs';
const bridge=f=>bridgeTiingoObservedCapture(f.normalized,f.options);
test('observed capture bridges to generic inspection without fabricated publication/finality',()=>{
 const f=bridgeFixture(),b=bridge(f);assert.equal(b.ok,true,JSON.stringify(b));
 const inspected=inspectMarketSnapshot(b.snapshot,f.marketOptions);assert.equal(inspected.eligible,true,JSON.stringify(inspected));
 assert.equal(inspected.derivedDisplayAllowed,true);assert.equal(inspected.priceDisplayAllowed,false);assert.equal(inspected.priceReference,null);
 assert.equal(b.snapshot.source.publishedAt,null);assert.equal(b.snapshot.source.publicationPrecision,'unknown');
 assert.ok(b.snapshot.bars.every(x=>x.providerPublishedAt===null&&x.status==='as_observed'));
 assert.equal(b.provenance.backtestAvailabilityProven,false);assert.equal(b.provenance.responseSha256,f.options.capture.responseSha256);
 assert.equal(b.snapshot.source.requestURL,f.options.capture.requestURL);assert.equal(b.snapshot.actions.sha256,b.snapshot.source.sha256);
});
test('API normalized output alone cannot bridge or confer ranking eligibility',()=>{
 const f=bridgeFixture();assert.equal(f.normalized.data.eligibleForRanking,false);
 for(const key of ['capture','calendar','identityReview','basisReview','actionsReview']){
  const altered=structuredClone(f.options);delete altered[key];assert.equal(bridgeTiingoObservedCapture(f.normalized,altered).ok,false,key);
 }
});
test('authenticated capture completion and ingestion clocks must be actual and ordered',()=>{
 for(const edit of [c=>c.authenticated=false,c=>c.responseSha256='',c=>c.responseCompletedAt='2026-10-16T20:00:00Z',c=>c.ingestedAt='2026-10-17T09:59:00Z',c=>c.ingestedAt='2026-10-17T11:01:00Z',c=>c.requestStartedAt='2026-10-17T99:00:00Z']){
  const f=bridgeFixture();edit(f.options.capture);assert.equal(bridge(f).ok,false);
 }
});
test('actual fractional capture seconds survive the bridge and generic inspection unchanged',()=>{
 const f=bridgeFixture(),capturedAt='2026-10-17T10:00:00.321Z';
 f.options.capture.responseCompletedAt=capturedAt;f.normalized.data.observedAt=capturedAt;
 const b=bridge(f);assert.equal(b.ok,true);assert.equal(b.snapshot.source.availabilityObservedAt,capturedAt);
 assert.ok(b.snapshot.bars.every(x=>x.availabilityObservedAt===capturedAt));
 assert.equal(inspectMarketSnapshot(b.snapshot,f.marketOptions).eligible,true);
});
test('no secret query field or wrong request identity is retained',()=>{
 for(const suffix of ['&token=DO-NOT-RETAIN','&startDate=2026-01-01','#fragment']){
  const f=bridgeFixture();f.options.capture.requestURL+=suffix;f.normalized.data.sourceURL=f.options.capture.requestURL;
  const out=bridge(f);assert.equal(out.ok,false);assert.doesNotMatch(JSON.stringify(out),/DO-NOT-RETAIN/);
 }
});
test('security/basis review cannot be inferred from a ticker or unadjusted field names',()=>{
 for(const edit of [o=>o.identityReview.security.id='OTHER',o=>o.identityReview.security.cik='0000000002',o=>o.identityReview.security.instrumentType='fund',o=>o.basisReview.basis.coverage='single_venue',o=>o.basisReview.reviewedAt='2026-10-17T09:59:59Z']){
  const f=bridgeFixture();edit(f.options);assert.equal(bridge(f).ok,false);
 }
});
test('same-response action fields require complete supported-action coverage review',()=>{
 for(const edit of [a=>a.unsupportedActionsReviewed=false,a=>a.unsupportedActionsPresent=true,a=>a.coveredSessions.pop(),a=>a.splitFactorBasis='unknown',a=>a.responseSha256='b'.repeat(64),a=>a.complete=false]){
  const f=bridgeFixture();edit(f.options.actionsReview);assert.equal(bridge(f).ok,false);
 }
});
test('same-source nontrivial split and dividend map without mixing adjusted prices',()=>{
 const f=bridgeFixture(),bar=f.normalized.data.bars.at(-2);bar.actions={splitFactor:2,dividendCash:0.5};
 assert.equal(bridge(f).ok,false);
 f.options.actionsReview.sameDayDistributionShareBasisBySession={[bar.sessionDate]:'post_split'};
 const b=bridge(f);assert.equal(b.ok,true);assert.equal(b.snapshot.actions.items.length,2);
 assert.equal(b.snapshot.actions.items[0].splitRatio,2);assert.equal(b.snapshot.actions.items[1].cashPerShare,0.5);
 assert.equal(b.snapshot.actions.items[1].perShareBasis,'post_split');
 assert.ok(b.snapshot.bars.every(x=>!Object.hasOwn(x,'adjustedClose')&&!Object.hasOwn(x,'splitFactor')));
 assert.equal(inspectMarketSnapshot(b.snapshot,f.marketOptions).eligible,true);
});
test('missing session, duplicate session or incomplete calendar cannot manufacture coverage',()=>{
 for(const edit of [f=>f.normalized.data.bars.pop(),f=>f.normalized.data.bars.push(f.normalized.data.bars[0]),f=>f.options.calendar.state='unknown',f=>f.options.calendar.sessions.splice(-10,1),f=>f.options.calendar.sessions[0].date='2026-06-30']){
  const f=bridgeFixture();edit(f);assert.equal(bridge(f).ok,false);
 }
});
test('fresh current capture cannot make a still-open future session completed',()=>{
 const f=bridgeFixture(),b=structuredClone(f.normalized.data.bars.at(-1));b.sessionDate='2026-10-19';
 f.normalized.data.bars.push(b);f.options.capture.requestURL=f.options.capture.requestURL.replace('endDate=2026-10-16','endDate=2026-10-19');f.normalized.data.sourceURL=f.options.capture.requestURL;
 assert.equal(bridge(f).ok,false);
});
test('rights remain a separate generic gate; bridge never mints operations from coarse API authorization',()=>{
 const f=bridgeFixture(),b=bridge(f);f.marketOptions.rightsReviews=[];
 assert.equal(b.ok,true);assert.equal(inspectMarketSnapshot(b.snapshot,f.marketOptions).eligible,false);
});
test('derived-only archive projection works with raw display denied and remains unranked',()=>{
 const f=bridgeFixture(),b=bridge(f),archive={revision:0,snapshots:[],runs:[]};
 const event={runId:'SYNTHETIC-run',expectedRevision:0,outcome:'snapshot',startedAt:f.options.capture.requestStartedAt,checkedAt:'2026-10-17T10:03:00Z',snapshot:b.snapshot};
 const committed=commitMarketSnapshot(archive,event,f.marketOptions);assert.equal(committed.accepted,true,JSON.stringify(committed.reasons));
 const projected=projectMarketArchive(committed.archive,f.marketOptions);assert.equal(projected.feedInputsUsable,true);assert.equal(projected.priceReference,null);
 assert.equal(projected.rank,null);assert.equal(projected.score,null);assert.equal(projected.expectedReturn,null);assert.equal(projected.gainProbability,null);
});
