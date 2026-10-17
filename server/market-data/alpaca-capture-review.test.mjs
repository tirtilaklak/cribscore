import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchAlpacaDailyBars,ALPACA_BARS_ENDPOINT,ALPACA_TERMS} from './alpaca-daily.mjs';
import {prepareAlpacaCaptureReview,fingerprintAlpacaEnvelope} from './alpaca-capture-review.mjs';
import {syntheticAlpacaOptions} from './alpaca-test-fixtures.mjs';
import {resolvePriceMark} from '../../dist/lib/prices.js';
// SYNTHETIC ONLY. No upstream request, real account, retained market data or grant.
const at='2026-10-17T12:01:00Z',cutoffAt='2026-10-17T12:00:30Z';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(raw='\ufeff {"bars":{"TEST":[{"t":"2026-10-16T04:00:00Z","o":100.01,"h":103.02,"l":98.01,"c":102.12,"v":1}]},"next_page_token":null}\n') {
 const o=syntheticAlpacaOptions(),retainedBytes=Buffer.from(raw);
 const envelope=await fetchAlpacaDailyBars({...o,fetchImpl:async()=>new Response(retainedBytes,{headers:{'content-type':'application/json'}})});
 assert.equal(envelope.ok,true);
 const c=envelope.capture,s=envelope.series;
 const use={id:'SYNTHETIC-USE-NOT-A-GRANT',version:1,providerId:'alpaca',datasetId:'historical-stock-bars',ownerScope:'synthetic-owner',audience:'owner_private',purpose:'market_data_research',securityIds:[s.entityId],urls:[ALPACA_BARS_ENDPOINT],reviewedAt:'2026-10-17T10:00:00Z',validFrom:'2026-10-17T10:00:00Z',expiresAt:'2026-10-18T00:00:00Z',operations:{store:'allowed',transform:'allowed'},termsEvidence:[{url:ALPACA_TERMS,sha256:'a'.repeat(64),observedAt:'2026-10-17T09:00:00Z'}]};
 return {envelope,retainedBytes,authorization:o.authorization,ownerScope:'synthetic-owner',at,cutoffAt,retentionReview:structuredClone(use),processingReview:{...structuredClone(use),id:'SYNTHETIC-PROCESSING-NOT-A-GRANT'},ingestionRecord:{state:'accepted',id:'SYNTHETIC-LEDGER',captureId:'SYNTHETIC-HOST-CAPTURE',captureIdSource:'host_ingestion_ledger',ownerScope:'synthetic-owner',reviewerId:'SYNTHETIC-REVIEWER',sourceRefs:['SYNTHETIC-RECEIPT'],provider:c.provider,dataset:c.dataset,securityId:s.entityId,transportSeriesId:s.id,responseSha256:c.responseSha256,responseByteLength:c.responseByteLength,authorizationReviewId:c.authorizationReviewId,requestURL:c.requestURL,requestStartedAt:c.requestStartedAt,responseCompletedAt:c.responseCompletedAt,storedAt:'2026-10-17T12:00:01Z',reviewedAt:'2026-10-17T12:00:02Z',ingestedAt:'2026-10-17T12:00:03Z',transportEnvelopeSha256:await fingerprintAlpacaEnvelope(envelope)}};
}
async function rebind(f) {f.ingestionRecord.transportEnvelopeSha256=await fingerprintAlpacaEnvelope(f.envelope);}
async function changeBytes(f,raw){f.retainedBytes=Buffer.from(raw);f.envelope.capture.responseSha256=sha(f.retainedBytes);f.envelope.capture.responseByteLength=f.retainedBytes.length;f.ingestionRecord.responseSha256=sha(f.retainedBytes);f.ingestionRecord.responseByteLength=f.retainedBytes.length;await rebind(f);}
const withheld=r=>{assert.equal(r.ok,false);assert.equal(r.status,'withheld');assert.equal(r.paperMarksEligible,false);assert.equal(r.reviewedPricesReady,false);assert.equal(r.privateDraft,undefined);assert.equal(r.series,undefined);};
test('offline bytes and host ledger yield only a private immutable review draft',async()=>{
 const f=await fixture(),before=JSON.stringify(f.envelope),r=await prepareAlpacaCaptureReview(f);
 assert.equal(r.ok,true);assert.equal(r.status,'review_required');assert.equal(r.paperMarksEligible,false);assert.equal(r.displayAllowed,false);assert.equal(r.reviewedPricesReady,false);assert.equal(r.eligibleForRanking,false);
 assert.equal(r.privateDraft.review,null);assert.equal(r.privateDraft.series.id,'SYNTHETIC-HOST-CAPTURE');assert.equal(r.privateDraft.lineage.transportSeriesId,'SYNTHETIC-ALPACA-TEST');assert.equal(r.privateDraft.lineage.rawBytesReverifiedHere,true);assert.equal(r.privateDraft.lineage.sourceAuthenticity,'trusted_host_records_not_independently_authenticated');assert.equal(r.privateDraft.lineage.providerPublishedAt,null);assert.equal(r.privateDraft.series.actions.status,'unknown');assert.equal(r.privateDraft.series.bars[0].availableAt,f.envelope.capture.responseCompletedAt);assert.equal(r.privateDraft.series.bars[0].providerTimestamp,'2026-10-16T04:00:00Z');
 assert.equal(JSON.stringify(f.envelope),before);assert.ok(Object.isFrozen(r.privateDraft.series.bars[0]));assert.throws(()=>{r.privateDraft.series.bars[0].close=7;},TypeError);assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|100\.01|102\.12|privateDraft|responseSha256/);
 for(const review of [null,r.privateDraft.requiredPaperReviewBindings]){const mark=resolvePriceMark(r.privateDraft.series,{session:'2026-10-16',kind:'close',review,at});assert.equal(mark.mark,null);assert.deepEqual(mark.reasons,['paper_source_review_missing']);}
});
for(const [name,edit,reason] of [
 ['byte mutation',f=>{f.retainedBytes[f.retainedBytes.indexOf('100.01')+5]=57;},'retained_capture_binding_mismatch'],
 ['whitespace byte rewrite',f=>{f.retainedBytes=Buffer.from(f.retainedBytes.toString().replace('\n',' '));},'retained_capture_binding_mismatch'],
 ['envelope mutation',f=>{f.envelope.series.bars[0].close=100;},'retained_capture_binding_mismatch'],
 ['owner swap',f=>{f.ownerScope='another-owner';},'accepted_ingestion_record_required'],
 ['missing host receipt',f=>{f.ingestionRecord={};},'accepted_ingestion_record_required'],
 ['caller capture ID',f=>{f.ingestionRecord.captureIdSource='caller';},'accepted_ingestion_record_required'],
 ['unaccepted receipt',f=>{f.ingestionRecord.state='proposed';},'accepted_ingestion_record_required'],
 ['missing permanent binding',f=>{delete f.ingestionRecord.securityId;},'accepted_ingestion_record_required'],
 ['wrong raw hash in ledger',f=>{f.ingestionRecord.responseSha256='b'.repeat(64);},'accepted_ingestion_record_required'],
 ['receipt from after cutoff',f=>{f.ingestionRecord.ingestedAt=at;},'accepted_ingestion_record_required'],
 ['storage before response',f=>{f.ingestionRecord.storedAt='2026-10-17T11:59:59Z';},'accepted_ingestion_record_required'],
 ['ingestion before review',f=>{f.ingestionRecord.ingestedAt='2026-10-17T12:00:01Z';},'accepted_ingestion_record_required'],
 ['cutoff after now',f=>{f.cutoffAt='2026-10-17T12:02:00Z';},'review_scope_or_clock_invalid'],
 ['response after cutoff',f=>{f.cutoffAt=f.envelope.capture.requestStartedAt;},'unreviewed_transport_envelope_required'],
 ['forged verified flag',f=>{f.envelope.accessVerified=true;},'unreviewed_transport_envelope_required'],
 ['captured set',f=>{f.envelope.status='capture_set_unvalidated';},'unreviewed_transport_envelope_required'],
 ['terminal suffix page',f=>{f.envelope.series.source.paginationComplete=false;},'single_complete_page_required'],
 ['missing token metadata',f=>{delete f.envelope.pagination.tokenFieldPresent;},'single_complete_page_required'],
 ['continued page',f=>{f.envelope.pagination.nextPageToken='NEXT';},'single_complete_page_required'],
 ['different capture review',f=>{f.authorization.reviewId='OTHER';},'capture_authorization_mismatch'],
 ['fetch approval expired at request',f=>{f.authorization.expiresAt=f.envelope.capture.requestStartedAt;},'capture_authorization_invalid'],
 ['capture entitlement absent',f=>{delete f.authorization.entitlement;},'capture_authorization_invalid'],
 ['fetch grant does not grant storage',f=>{delete f.retentionReview.operations.store;},'retained_use_rights_required'],
 ['expired retention',f=>{f.retentionReview.expiresAt=at;},'retained_use_rights_required'],
 ['late retention does not authorize original store',f=>{f.retentionReview.validFrom='2026-10-17T12:00:02Z';},'retained_use_rights_required'],
 ['storage does not grant transform',f=>{delete f.processingReview.operations.transform;},'retained_use_rights_required'],
 ['transformation future approval',f=>{f.processingReview.validFrom='2026-10-17T12:02:00Z';},'retained_use_rights_required'],
 ['public scope',f=>{f.retentionReview.audience='public';},'retained_use_rights_required'],
 ['wrong security rights',f=>{f.processingReview.securityIds=['OTHER'];},'retained_use_rights_required'],
 ['terms evidence malformed',f=>{f.processingReview.termsEvidence[0].sha256='not-hash';},'retained_use_rights_required'],
 ['terms evidence from future',f=>{f.processingReview.termsEvidence[0].observedAt=at;},'retained_use_rights_required'],
 ['terms evidence credential-bearing URL',f=>{f.processingReview.termsEvidence[0].url=ALPACA_TERMS+'?token=secret';},'retained_use_rights_required'],
])test(`review boundary rejects ${name}`,async()=>{const f=await fixture();edit(f);const r=await prepareAlpacaCaptureReview(f);withheld(r);assert.deepEqual(r.reasons,[reason]);});
for(const [name,edit] of [
 ['manual source',f=>{f.envelope.series.source.channel='manual_import';}],
 ['forged no-action coverage',f=>{f.envelope.series.actions.status='complete';}],
 ['forged closing price',f=>{f.envelope.series.bars[0].decimals.close='103';}],
 ['published timestamp invented',f=>{f.envelope.series.source.publishedAt='2026-10-17T11:00:00Z';}],
 ['session label treated as availability',f=>{f.envelope.series.bars[0].availableAt='2026-10-16T04:00:00Z';}],
])test(`re-adaptation detects ${name} even with a matching envelope digest`,async()=>{const f=await fixture();edit(f);await rebind(f);const r=await prepareAlpacaCaptureReview(f);withheld(r);assert.deepEqual(r.reasons,['retained_series_mismatch']);});
for(const [name,change] of [
 ['same-day end',u=>u.searchParams.set('end','2026-10-17T05:00:00Z')],
 ['future asof',u=>u.searchParams.set('asof','2026-10-18')],
 ['suffix token',u=>u.searchParams.set('page_token','NEXT')],
 ['unexpected parameter',u=>u.searchParams.set('latest','true')],
 ['repeated feed',u=>u.searchParams.append('feed','sip')],
 ['redirect host',u=>u.hostname='attacker.invalid'],
 ['IEX substitution',u=>u.searchParams.set('feed','iex')],
])test(`retained request rejects ${name} despite matching receipt`,async()=>{const f=await fixture(),u=new URL(f.envelope.capture.requestURL);change(u);f.envelope.capture.requestURL=u.href;f.ingestionRecord.requestURL=u.href;await rebind(f);const r=await prepareAlpacaCaptureReview(f);withheld(r);assert.deepEqual(r.reasons,['retained_request_invalid']);});
for(const raw of ['null','[]','{"bars":{},"next_page_token":"NEXT"}','{"bars":{}}','{"bars":{},"next_page_token":null,"next_page_token":null}','{"bars":{"TEST":[{"v":9007199254740991.1}]},"next_page_token":null}'])test(`retained bytes fail closed on ${raw.slice(0,45)}`,async()=>{const f=await fixture();await changeBytes(f,raw);withheld(await prepareAlpacaCaptureReview(f));});
test('expired fetch authority can support historical re-verification only with current separate store/transform authority',async()=>{
 const f=await fixture();f.at='2026-10-18T12:00:00Z';f.retentionReview.expiresAt='2026-10-19T00:00:00Z';f.processingReview.expiresAt='2026-10-19T00:00:00Z';assert.equal((await prepareAlpacaCaptureReview(f)).ok,true);
});
test('legacy v1 envelopes are reparsed with strict current checks',async()=>{const f=await fixture();f.envelope.capture.collectorVersion='alpaca_daily_capture_v1';await rebind(f);assert.equal((await prepareAlpacaCaptureReview(f)).ok,true);});
test('caller mutations after invoking review cannot change Buffer bytes or records under verification',async()=>{
 const f=await fixture(),expected=f.ingestionRecord.captureId,pending=prepareAlpacaCaptureReview(f);f.retainedBytes.fill(0);f.envelope.series.bars[0].decimals.close='999';f.ingestionRecord.captureId='OTHER';f.processingReview.operations.transform='denied';const r=await pending;assert.equal(r.ok,true);assert.equal(r.privateDraft.series.id,expected);assert.equal(r.privateDraft.series.bars[0].decimals.close,'102.12');
});
test('JSON-only fingerprint is key-order-independent, array-order-sensitive and rejects ambiguous objects without invoking hooks',async()=>{
 assert.equal(await fingerprintAlpacaEnvelope({b:2,a:1}),await fingerprintAlpacaEnvelope({a:1,b:2}));assert.notEqual(await fingerprintAlpacaEnvelope([1,2]),await fingerprintAlpacaEnvelope([2,1]));let calls=0;
 for(const bad of [{get x(){calls++;return 1;}},{toJSON(){calls++;return {};}},new Date(),{value:undefined},{value:-0},new Array(3),{[Symbol('x')]:1},Object.assign([],{extra:1})])assert.equal(await fingerprintAlpacaEnvelope(bad),null);assert.equal(calls,0);
});
test('malformed outer records and missing/oversized retained bytes return withheld without throwing',async()=>{
 for(const key of ['envelope','ingestionRecord','authorization','retentionReview','processingReview']){const f=await fixture();f[key]=null;withheld(await prepareAlpacaCaptureReview(f));}
 for(const bytes of [undefined,'source text',new Uint8Array(),new Uint8Array(2_000_001)]){const f=await fixture();f.retainedBytes=bytes;withheld(await prepareAlpacaCaptureReview(f));}
});

test('canonical snapshot rejects repeated large values before constructing an unbounded result',async()=>{
 const repeated='x'.repeat(2_000_000);assert.equal(await fingerprintAlpacaEnvelope(Array(10_000).fill(repeated)),null);
});
test('noncanonical control characters in request URL are not silently normalized into a trusted URL',async()=>{
 const f=await fixture();f.envelope.capture.requestURL=f.envelope.capture.requestURL.replace('https:','https:\n');f.ingestionRecord.requestURL=f.envelope.capture.requestURL;await rebind(f);const r=await prepareAlpacaCaptureReview(f);withheld(r);assert.deepEqual(r.reasons,['retained_request_invalid']);
});
