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

export { AT, URL, INDEX, archive, event, options, syntheticReview, syntheticRecord, planInput, correctionEvent, renewal };
