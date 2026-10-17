import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectEvidence, inspectResearchState } from '../dist/lib/evidence.js';

// Explicit synthetic fixture. These values are not product evidence.
const AT = '2026-10-16T23:40:00Z';
function fixture() {
  return {
    issuer: { name: 'Synthetic Test Issuer', cik: '0000000123' },
    metric: { taxonomy: 'us-gaap', concept: 'NetIncomeLoss', label: 'ignored caller label', accountingBasis: 'US-GAAP' },
    value: '-12', unit: 'USD', scale: 1000000, scope: 'consolidated', dimensions: [],
    period: { start: '2025-01-01', end: '2025-12-31', type: 'duration', fiscalYear: 2025 },
    source: {
      url: 'https://www.sec.gov/Archives/edgar/data/123/000000012326000001/original.htm',
      indexUrl: 'https://www.sec.gov/Archives/edgar/data/123/000000012326000001/0000000123-26-000001-index.htm',
      accession: '0000000123-26-000001', form: '10-K', original: true,
      location: 'Consolidated statements, tagged NetIncomeLoss, context FY2025',
      sha256: 'a'.repeat(64), parserVersion: 'synthetic-test-1',
      acceptedAt: '2026-02-01T18:00:00-05:00', publishedAt: '2026-02-01T23:01:00Z',
      fetchedAt: '2026-10-16T23:35:00Z', ingestedAt: '2026-10-16T23:36:00Z', mode: 'reconstructed_public_history',
    },
    rights: [{ reviewId: 'synthetic-audit', reviewedAt: '2026-10-16T23:30:00Z', validFrom: '2026-10-16T23:30:00Z',
      expiresAt: '2026-10-17T23:30:00Z', version: '1', termsUrl: 'https://www.sec.gov/privacy.htm',
      purpose: 'historical_financial_facts', sourceBinding: { cik: '0000000123', accession: '0000000123-26-000001',
        urls: ['https://www.sec.gov/Archives/edgar/data/123/000000012326000001/original.htm',
          'https://www.sec.gov/Archives/edgar/data/123/000000012326000001/0000000123-26-000001-index.htm'] },
      operations: { fetch: 'allowed', store: 'allowed', transform: 'allowed', display: 'allowed' } }],
  };
}
const inspect = record => inspectEvidence(record, { at: AT });

test('complete synthetic context renders a bound negative net-income claim', () => {
  const result = inspect(fixture());
  assert.equal(result.eligible, true, result.reasons.join(', '));
  assert.match(result.claim, /net income of USD -12 million/);
  assert.match(result.claim, /2025-01-01 through 2025-12-31/);
});
test('caller prose and labels cannot reverse a loss or acquire supported status', () => {
  const data = fixture(); data.claim = 'Profit rose to USD 900 billion'; data.metric.label = data.claim;
  assert.doesNotMatch(inspect(data).claim, /Profit|rose|900/);
});
test('malformed JSON identity fields fail closed without throwing', () => {
  for (const mutate of [data => data.source.accession = 123, data => data.source.accession = [],
    data => data.issuer.cik = 123, data => data.metric.concept = '__proto__',
    data => data.metric.concept = 'constructor', data => data.metric.concept = 'toString']) {
    const data = fixture(); mutate(data);
    const result = inspect(data); assert.equal(result.eligible, false); assert.equal(result.claim, undefined);
  }
  assert.deepEqual(inspectEvidence(fixture(), null), { eligible: false, reasons: ['options_invalid'] });
});
for (const operation of ['fetch', 'store', 'transform', 'display']) {
  for (const status of ['unknown', 'denied', 'revoked']) {
    test(`${operation} ${status} blocks dependent display`, () => {
      const data = fixture(); data.rights[0].operations[operation] = status;
      assert.equal(inspect(data).eligible, false);
      assert.ok(inspect(data).reasons.includes(`${operation}_rights_${status}`));
    });
  }
}
test('late rights audit cannot retroactively authorize capture', () => {
  const data = fixture(); data.rights[0].reviewedAt = '2026-10-16T23:39:00Z';
  assert.ok(inspect(data).reasons.includes('fetch_rights_unknown'));
});
test('expired display permission does not inherit capture-time permission', () => {
  const data = fixture(); data.rights[0].expiresAt = '2026-10-16T23:38:00Z';
  assert.ok(inspect(data).reasons.includes('display_rights_expired'));
  assert.ok(!inspect(data).reasons.includes('fetch_rights_expired'));
});
test('new revoked terms version overrides old allowed version at use time', () => {
  const data = fixture(); data.rights.push({ ...data.rights[0], reviewId: 'new-audit', version: '2',
    reviewedAt: '2026-10-16T23:39:00Z', validFrom: '2026-10-16T23:39:00Z',
    operations: { ...data.rights[0].operations, display: 'revoked' } });
  assert.ok(inspect(data).reasons.includes('display_rights_revoked'));
});
test('a later observed revocation cannot hide behind an older effective date', () => {
  const data = fixture(); data.rights.push({ ...data.rights[0], reviewId: 'correction-audit', version: '2',
    reviewedAt: '2026-10-16T23:39:00Z', validFrom: '2026-10-01T00:00:00Z',
    operations: { ...data.rights[0].operations, display: 'revoked' } });
  assert.ok(inspect(data).reasons.includes('display_rights_revoked'));
  assert.ok(!inspect(data).reasons.includes('fetch_rights_revoked'));
});
test('request binds issuer, period, metric, unit and scale', () => {
  for (const expected of [{ cik: '0000000124' }, { issuerName: 'Other Issuer' }, { periodEnd: '2024-12-31' }, { metricConcept: 'Revenues' }, { unit: 'EUR' }, { scale: 1000000000 }]) {
    assert.equal(inspectEvidence(fixture(), { at: AT, expected }).eligible, false);
  }
});
test('rights for another source or purpose cannot authorize the record', () => {
  for (const mutate of [data => data.rights[0].sourceBinding.cik = '0000000124',
    data => data.rights[0].purpose = 'model_input', data => delete data.rights[0].sourceBinding]) {
    const data = fixture(); mutate(data); assert.ok(inspect(data).reasons.includes('display_rights_scope_mismatch'));
  }
});
test('contradictory rights at the same audit and effective instant fail closed', () => {
  const data = fixture(); data.rights.push({ ...data.rights[0], version: '2',
    operations: { ...data.rights[0].operations, display: 'revoked' } });
  assert.ok(inspect(data).reasons.includes('display_rights_conflict'));
});
test('original filing identity, dimensions, invalid dates and future ingestion are blocked', () => {
  for (const mutate of [data => data.source.form = '10-K/A', data => data.source.original = false,
    data => data.issuer.cik = '0000000124', data => data.scope = 'segment',
    data => data.dimensions = ['business-segment'], data => data.period.end = '2025-02-30',
    data => data.source.ingestedAt = '2026-10-16T23:41:00Z', data => data.source.acceptedAt = '2026-02-01T18:00:00',
    data => data.source.url = data.source.url.replace('www.sec.gov', 'sec.gov.example.com'),
    data => data.value = 'Infinity', data => data.unit = 'EUR',
    data => data.source.acceptedAt = '2024-02-01T18:00:00Z']) {
    const data = fixture(); mutate(data); const result = inspect(data);
    assert.equal(result.eligible, false); assert.equal(result.claim, undefined);
  }
});
test('observed-public fallback allows today but never fabricates historical publication time', () => {
  const data = fixture(); Object.assign(data.source, { publishedAt: null, publishedDate: '2026-02-02',
    publishedTimePrecision: 'date', publicAvailabilityObservedAt: '2026-10-16T23:35:00Z' });
  assert.equal(inspect(data).eligible, true);
  assert.ok(inspectEvidence(data, { at: AT, asOf: '2026-10-01T12:00:00Z' }).reasons.includes('evidence_unavailable_as_of'));
});
test('unknown publication without an actual observation is withheld', () => {
  const data = fixture(); data.source.publishedAt = null;
  assert.ok(inspect(data).reasons.includes('source_times_incomplete'));
});
test('non-reliance notice suppresses a cached conclusion', () => {
  const data = fixture(); data.source.nonReliance = true;
  assert.ok(inspect(data).reasons.includes('non_reliance_notice'));
});
test('operational history excludes late ingestion while reconstruction is labeled separately', () => {
  const data = fixture(); data.source.mode = 'operational_capture';
  assert.ok(inspectEvidence(data, { at: AT, asOf: '2026-03-01T00:00:00Z' }).reasons.includes('not_ingested_as_of'));
});
test('research status has no direction and unknown earnings only withholds timing-dependent action', () => {
  const state = { research_status: 'validated', direction: 'buy', timingDependent: true, earnings: { nextEvent: { status: 'unknown' } } };
  const result = inspectResearchState(state, { at: AT });
  assert.equal(result.research_status, 'unvalidated'); assert.equal(result.direction, null);
  assert.equal(result.historicalFactsEligible, true); assert.equal(result.timingActionEligible, false);
  assert.deepEqual(result.reasons, ['earnings_date_unknown']);
  assert.deepEqual(inspectResearchState({ ...state, timingDependent: false }, { at: AT }).reasons, []);
});
test('past confirmed earnings cannot stand in for next event', () => {
  const result = inspectResearchState({ timingDependent: true, earnings: { nextEvent: { status: 'confirmed', at: '2026-10-01T20:00:00Z' } } }, { at: AT });
  assert.equal(result.timingActionEligible, false);
});
