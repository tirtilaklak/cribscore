import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { inspectEvidence, inspectResearchState } from '../dist/lib/evidence.js';
import { SEC_TARGET, assertSecUrl, extractOriginalFact, fetchDocument } from '../scripts/sec-adapter.mjs';

// Every value below is synthetic. These checks do not establish source permission,
// publication time, issuer truth, or the accuracy of a real filing extraction.
const AT = '2026-10-16T14:00:00Z';
const CAPTURE = '2026-10-16T13:00:00Z';
const clone = value => structuredClone(value);
const expected = {
  cik: '0000123456', metricConcept: 'Revenues', unit: 'USD',
  periodStart: '2024-01-01', periodEnd: '2024-12-31'
};
function syntheticRecord() {
  return {
    issuer: { name: 'SYNTHETIC Evidence Test Company', cik: '0000123456' },
    metric: { taxonomy: 'us-gaap', concept: 'Revenues', label: 'Revenue', accountingBasis: 'US-GAAP' },
    value: 95000000, unit: 'USD', scale: 1,
    period: { start: '2024-01-01', end: '2024-12-31', type: 'duration', fiscalYear: 2024 },
    scope: 'consolidated', dimensions: [],
    source: {
      url: 'https://www.sec.gov/Archives/edgar/data/123456/000012345625000001/synthetic-20241231.htm',
      indexUrl: 'https://www.sec.gov/Archives/edgar/data/123456/000012345625000001/0000123456-25-000001-index.htm',
      accession: '0000123456-25-000001', form: '10-K', original: true,
      location: 'Synthetic fixture, Consolidated Statements of Operations, Revenues',
      sha256: 'a'.repeat(64), acceptedAt: '2025-02-03T16:30:00Z',
      publishedAt: '2025-02-03T16:30:00Z', fetchedAt: CAPTURE,
      ingestedAt: '2026-10-16T13:01:00Z', mode: 'reconstructed_public_history',
      parserVersion: 'synthetic-fixture/1'
    },
    rights: [{
      reviewId: 'synthetic-audit-1', reviewedAt: '2026-10-16T12:00:00Z',
      validFrom: '2026-10-16T12:00:00Z', expiresAt: '2026-10-17T00:00:00Z',
      version: 'synthetic-terms/1', termsUrl: 'https://www.sec.gov/about/website-policies',
      purpose: 'historical_financial_facts',
      sourceBinding: {
        cik: '0000123456', accession: '0000123456-25-000001',
        urls: [
          'https://www.sec.gov/Archives/edgar/data/123456/000012345625000001/synthetic-20241231.htm',
          'https://www.sec.gov/Archives/edgar/data/123456/000012345625000001/0000123456-25-000001-index.htm'
        ]
      },
      operations: { fetch: 'allowed', store: 'allowed', transform: 'allowed', display: 'allowed' }
    }]
  };
}
const evaluate = (record, options = {}) => inspectEvidence(record, { operation: 'display', at: AT, asOf: AT, expected, ...options });
function reject(record, options, note) {
  const result = evaluate(record, options);
  assert.equal(result.eligible, false, note);
  assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0, 'rejection must give a reason');
  assert.ok(!result.claim, 'rejected data must not expose a supported claim');
}

test('a fully populated synthetic original record can support only a dated historical claim', () => {
  const result = evaluate(syntheticRecord());
  assert.equal(result.eligible, true, JSON.stringify(result));
  assert.equal(typeof result.claim, 'string');
  assert.match(result.claim, /2024/);
  assert.doesNotMatch(result.claim, /buy|guarantee|target return|confidence/i);
});

for (const [name, change] of [
  ['wrong requested issuer', value => { value.cik = '0000654321'; }],
  ['wrong requested financial concept', value => { value.metricConcept = 'NetIncomeLoss'; }],
  ['wrong requested currency', value => { value.unit = 'EUR'; }],
  ['wrong requested period start', value => { value.periodStart = '2023-01-01'; }],
  ['wrong requested period end', value => { value.periodEnd = '2025-12-31'; }]
]) {
  test(`${name} cannot inherit support from an otherwise valid record`, () => {
    const request = clone(expected); change(request);
    reject(syntheticRecord(), { expected: request });
  });
}

for (const [name, change] of [
  ['missing identity', r => { delete r.issuer.cik; }],
  ['a different issuer SEC URL', r => { r.source.url = r.source.url.replace('/123456/', '/654321/'); }],
  ['a different accession SEC URL', r => { r.source.url = r.source.url.replace('000012345625000001', '000012345625000002'); }],
  ['a homepage citation', r => { r.source.url = 'https://www.sec.gov/'; }],
  ['a segment dimension', r => { r.dimensions = { StatementBusinessSegmentsAxis: 'CloudServicesMember' }; }],
  ['unconsolidated scope', r => { r.scope = 'segment'; }],
  ['adjusted accounting basis', r => { r.metric.accountingBasis = 'adjusted'; }],
  ['a different currency', r => { r.unit = 'EUR'; }],
  ['an unsupported scale', r => { r.scale = 42; }],
  ['an infinite value', r => { r.value = Infinity; }],
  ['a missing number', r => { r.value = null; }],
  ['an impossible date', r => { r.period.end = '2024-02-30'; }],
  ['a reversed period', r => { r.period.start = '2025-01-01'; }],
  ['a per-share measure', r => { r.unit = 'USD/shares'; }],
  ['a missing source hash', r => { delete r.source.sha256; }],
  ['an amendment disguised as original', r => { r.source.form = '10-K/A'; }],
  ['an explicit non-original filing', r => { r.source.original = false; }],
  ['a non-reliance notice', r => { r.source.nonReliance = true; }],
  ['unavailable dimension context', r => { r.dimensions = null; }]
]) {
  test(`${name} fails closed`, () => {
    const record = syntheticRecord(); change(record); reject(record);
  });
}

test('operational as-of rejects a public record ingested after the cutoff', () => {
  const record = syntheticRecord();
  record.source.mode = 'operational_capture';
  reject(record, { asOf: '2026-10-16T13:00:30Z' });
});

for (const field of ['acceptedAt', 'publishedAt', 'fetchedAt', 'ingestedAt']) {
  test(`future ${field} cannot enter a present supported claim`, () => {
    const record = syntheticRecord();
    record.source[field] = '2026-10-17T12:00:00Z';
    reject(record);
  });
}

test('a date-only publication fallback cannot infer earlier intraday availability', () => {
  const record = syntheticRecord();
  record.source.publishedAt = null;
  record.source.publishedDate = '2025-02-03';
  record.source.publishedTimePrecision = 'date';
  record.source.acceptedAt = '2025-02-03T16:30:00Z';
  record.source.publicAvailabilityObservedAt = CAPTURE;
  reject(record, { asOf: '2026-10-16T12:59:59Z' });
});

test('a later source check does not rewrite the historical observation or publication', () => {
  const record = syntheticRecord();
  const before = clone(record);
  const result = evaluate(record);
  assert.equal(result.eligible, true);
  assert.deepEqual(record, before, 'checking must not mutate evidence clocks');
  assert.match(result.claim, /2024/);
});

for (const operation of ['fetch', 'store', 'transform', 'display']) {
  for (const state of ['unknown', 'denied', 'revoked']) {
    test(`${operation} right ${state} blocks dependent supported display`, () => {
      const record = syntheticRecord();
      record.rights[0].operations[operation] = state;
      reject(record);
    });
  }
}

test('a display permission does not supply missing fetch, storage, or transformation rights', () => {
  const record = syntheticRecord();
  record.rights[0].operations = { display: 'allowed' };
  reject(record);
});

test('no audit means no source permission', () => {
  const record = syntheticRecord(); record.rights = []; reject(record);
});

for (const [name, change] of [
  ['another issuer', right => { right.sourceBinding.cik = '0000654321'; }],
  ['another accession', right => { right.sourceBinding.accession = '0000123456-25-000002'; }],
  ['another source URL', right => { right.sourceBinding.urls[0] = 'https://www.sec.gov/'; }],
  ['an unrelated purpose', right => { right.purpose = 'portfolio_execution'; }],
  ['missing source binding', right => { delete right.sourceBinding; }]
]) {
  test(`rights granted for ${name} do not authorize this fact`, () => {
    const record = syntheticRecord(); change(record.rights[0]); reject(record);
  });
}

test('backdating validFrom does not backdate an audit created after capture', () => {
  const record = syntheticRecord();
  record.rights[0].validFrom = '2025-01-01T00:00:00Z';
  record.rights[0].reviewedAt = '2026-10-16T13:30:00Z';
  reject(record);
});

test('previously captured data is not automatically displayable after rights expire', () => {
  const record = syntheticRecord();
  record.rights[0].expiresAt = '2026-10-16T13:30:00Z';
  reject(record);
});

test('a later known revocation is not hidden by an older permissive audit', () => {
  const record = syntheticRecord();
  record.rights.push({
    ...clone(record.rights[0]), reviewId: 'synthetic-audit-2', version: 'synthetic-terms/2',
    reviewedAt: '2026-10-16T13:20:00Z', validFrom: '2026-10-16T13:20:00Z',
    operations: { fetch: 'allowed', store: 'allowed', transform: 'allowed', display: 'revoked' }
  });
  reject(record);
});

test('caller-provided narrative cannot inherit the financial fact support status', () => {
  const record = syntheticRecord();
  record.claim = 'This company guarantees a 95 billion dollar profit tomorrow.';
  record.text = 'Buy immediately for a risk-free return.';
  record.metric.description = 'Revenue grew 500 percent.';
  record.metric.label = 'Guaranteed profit';
  const result = evaluate(record);
  assert.equal(result.eligible, true, JSON.stringify(result));
  assert.doesNotMatch(result.claim, /guarantee|95 billion|risk-free|buy immediately|500 percent/i);
});

test('scaled values render their explicit units without silently reusing a cached claim', () => {
  const whole = syntheticRecord();
  const millions = syntheticRecord();
  millions.value = 95; millions.scale = 1000000;
  const a = evaluate(whole); const b = evaluate(millions);
  assert.equal(a.eligible, true); assert.equal(b.eligible, true);
  assert.match(a.claim, /USD 95,000,000(?:\D|$)/);
  assert.match(b.claim, /USD 95 million/);
  assert.doesNotMatch(b.claim, /USD 95 billion/);
});

test('non-directional research status cannot become actionable through caller direction', () => {
  const state = inspectResearchState({ research_status: 'validated', direction: 'buy', confidence: 0.99 }, { at: AT });
  assert.equal(state.research_status, 'unvalidated');
  assert.equal(state.direction, null);
});

test('unknown next earnings withholds a timing-dependent action with a precise reason', () => {
  const state = inspectResearchState({
    research_status: 'unvalidated', direction: null, timingDependent: true,
    earnings: { previousEvent: { status: 'confirmed', at: '2026-07-20T20:00:00Z' }, nextEvent: { status: 'unknown', at: null } }
  }, { at: AT });
  assert.ok(state.reasons.includes('earnings_date_unknown'));
});

test('unknown next earnings does not suppress a valid historical fact', () => {
  const state = inspectResearchState({
    research_status: 'unvalidated', direction: null, timingDependent: false,
    earnings: { nextEvent: { status: 'unknown', at: null } }
  }, { at: AT });
  assert.ok(!state.reasons.includes('earnings_date_unknown'));
  assert.equal(evaluate(syntheticRecord()).eligible, true);
});

test('a past confirmed earnings event cannot substitute for the unknown next event', () => {
  const state = inspectResearchState({
    research_status: 'unvalidated', direction: null, timingDependent: true,
    earnings: { nextEvent: { status: 'confirmed', at: '2026-07-20T20:00:00Z' } }
  }, { at: AT });
  assert.ok(state.reasons.includes('earnings_date_unknown'));
});

test('served interface provides research status and the daily versus holding-horizon distinction', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../dist/app.js', import.meta.url), 'utf8')
  ]);
  const source = html + app;
  assert.match(source, /unvalidated|research in progress|not validated/i);
  assert.match(source, /daily/i);
  assert.match(source, /weekly|monthly|holding horizon/i);
});

test('served SEC payload cannot label incomplete capture as numeric verified evidence', async () => {
  const payload = JSON.parse(await readFile(new URL('../dist/data/sec-evidence.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(payload.records));
  if (payload.status === 'blocked') {
    assert.deepEqual(payload.records, [], 'blocked capture must not expose unverified numeric facts');
    assert.ok(payload.blockers.length > 0);
    if (payload.sourceNote?.captureStatus === 'raw_document_bytes_unavailable') {
      assert.equal(payload.sourceNote.sha256, null);
      assert.equal(payload.sourceNote.status, 'manual_source_review_only');
    }
  } else {
    assert.equal(payload.status, 'verified');
    assert.ok(payload.records.length > 0, 'verified capture requires a real record');
    for (const record of payload.records) {
      const result = inspectEvidence(record, { at: new Date().toISOString(), operation: 'display' });
      assert.equal(result.eligible, true, JSON.stringify(result));
    }
  }
});

// Exercise the actual source-rendering functions without a browser. The minimal
// document stores generated strings only. No script or HTML is executed by a UI.
async function rendererAt(at) {
  const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
  const boot = source.indexOf("document.addEventListener('click'");
  assert.ok(boot > 0, 'renderer setup boundary must be identifiable');
  const nodes = new Map();
  const document = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {
        textContent: '', innerHTML: '', attributes: {},
        setAttribute(name, value) { this.attributes[name] = String(value); },
        focus() {}
      });
      return nodes.get(selector);
    },
    querySelectorAll() { return []; }
  };
  class FrozenDate extends Date {
    constructor(...args) { super(...(args.length ? args : [at])); }
    static now() { return Date.parse(at); }
  }
  const sandbox = {
    document, URL, URLSearchParams, Intl, Date: FrozenDate, buildStockSnapshot, renderStockView,
    clearTimeout() {}, setTimeout() { return 1; },
    location: { search: '', hash: '', pathname: '/', href: 'http://localhost/' }
  };
  runInNewContext(`${source.slice(0, boot).replace(/^import .*;\n/gm,'')}\nglobalThis.testRenderer = {state, render, factCard};`, sandbox);
  return { ...sandbox.testRenderer, nodes };
}

test('rendered source timing does not substitute acceptance for unknown exact publication', async () => {
  const renderer = await rendererAt(AT);
  const record = syntheticRecord();
  record.source.publishedAt = null;
  record.source.publishedDate = '2025-02-03';
  record.source.publishedTimePrecision = 'date';
  record.source.publicAvailabilityObservedAt = CAPTURE;
  const inspection = evaluate(record);
  assert.equal(inspection.eligible, true);
  const html = renderer.factCard({ record, inspection, claim: inspection.claim }, 0);
  assert.doesNotMatch(html, /<dt>Source availability<\/dt><dd>03 Feb 2025/,
    'acceptance is not proof of the unknown publication instant');
  assert.match(html, /16 Oct 2026/,
    'the observed availability date must be visible for the date-only fallback');
});

test('later display reevaluates cached claims after operation rights expire', async () => {
  const record = syntheticRecord();
  record.rights[0].expiresAt = '2026-10-16T14:30:00Z';
  const inspection = evaluate(record);
  assert.equal(inspection.eligible, true, 'initial earlier display is permitted');
  const renderer = await rendererAt('2026-10-16T15:00:00Z');
  Object.assign(renderer.state, {
    view: 'evidence', contract: { inspectEvidence }, rawRecords: [record],
    facts: [{ record, inspection, claim: inspection.claim }], evidenceState: 'ready'
  });
  renderer.render();
  const html = renderer.nodes.get('#view-content').innerHTML;
  assert.ok(!html.includes(inspection.claim), 'expired claim must not retain a supported display');
});

// Adapter boundaries are exercised with synthetic HTML and a fetch spy. No test
// below fetches SEC or any other host.
function syntheticSecDocuments() {
  return {
    index: `Apple Inc. ${SEC_TARGET.accession} Form 10-K - Annual report Accepted 2023-11-02 18:08:27 Filing Date 2023-11-03`,
    document: `<html><xbrli:context id="annual"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000320193</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2022-09-25</xbrli:startDate><xbrli:endDate>2023-09-30</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><ix:nonFraction id="synthetic-net-income" name="us-gaap:NetIncomeLoss" contextRef="annual" unitRef="usd" scale="6">123</ix:nonFraction></html>`
  };
}

test('SEC extractor reads exact entity-period-USD-consolidated original context', () => {
  const { document, index } = syntheticSecDocuments();
  const result = extractOriginalFact(document, index);
  assert.equal(result.value, 123);
  assert.equal(result.contextId, 'annual');
});

for (const [name, change] of [
  ['wrong issuer context', (doc, index) => [doc.replace('0000320193', '0000789019'), index]],
  ['wrong annual period', (doc, index) => [doc.replace('2022-09-25', '2021-09-26'), index]],
  ['foreign currency', (doc, index) => [doc.replace('iso4217:USD', 'iso4217:EUR'), index]],
  ['per-share unit', (doc, index) => [doc.replace('<xbrli:measure>iso4217:USD</xbrli:measure>', '<xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide>'), index]],
  ['segment dimension', (doc, index) => [doc.replace('</xbrli:entity>', '<xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">aapl:ProductsMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>'), index]],
  ['missing scale', (doc, index) => [doc.replace(' scale="6"', ''), index]],
  ['a thousand-fold scale error', (doc, index) => [doc.replace('scale="6"', 'scale="3"'), index]],
  ['amendment index', (doc, index) => [doc, index.replace('Form 10-K -', 'Form 10-K/A -')]],
  ['another accession index', (doc, index) => [doc, index.replace(SEC_TARGET.accession, '0000320193-23-000107')]],
  ['contradictory exact-context facts', (doc, index) => [doc.replace('</html>', '<ix:nonFraction id="synthetic-conflict" name="us-gaap:NetIncomeLoss" contextRef="annual" unitRef="usd" scale="6">999</ix:nonFraction></html>'), index]]
]) {
  test(`SEC extraction rejects ${name}`, () => {
    const fixture = syntheticSecDocuments();
    const [document, index] = change(fixture.document, fixture.index);
    assert.throws(() => extractOriginalFact(document, index));
  });
}

test('SEC source allowlist rejects wrong host, accession, issuer, and unexpected documents', () => {
  assert.equal(assertSecUrl(SEC_TARGET.url), SEC_TARGET.url);
  for (const candidate of [
    SEC_TARGET.url.replace('www.sec.gov', 'sec.gov.evil.invalid'),
    SEC_TARGET.url.replace('/320193/', '/789019/'),
    SEC_TARGET.url.replace('000032019323000106', '000032019323000107'),
    SEC_TARGET.url.replace('aapl-20230930.htm', 'unknown.htm'),
    SEC_TARGET.url.replace('https:', 'http:'),
    SEC_TARGET.url + '?unrelated=1'
  ]) assert.throws(() => assertSecUrl(candidate), candidate);
});

test('SEC fetch is stopped before network when operation rights are denied', async () => {
  let calls = 0;
  const audit = {
    reviewId: 'synthetic-fetch-audit', version: 1,
    termsUrl: 'https://www.sec.gov/privacy',
    reviewedAt: '2026-10-16T12:00:00Z', validFrom: '2026-10-16T12:00:00Z',
    expiresAt: '2026-10-17T00:00:00Z', operations: { fetch: 'denied' },
    purpose: 'historical_financial_facts',
    sourceBinding: { cik: SEC_TARGET.cik, accession: SEC_TARGET.accession, urls: [SEC_TARGET.url, SEC_TARGET.indexUrl] }
  };
  await assert.rejects(fetchDocument(SEC_TARGET.url, {
    review: audit, userAgent: 'Cribscore/test synthetic', now: () => AT,
    fetcher: async () => { calls++; throw new Error('NETWORK MUST NOT RUN'); }
  }), /rights_fetch_not_allowed/);
  assert.equal(calls, 0);
});

test('SEC fetch is stopped before network when the audit was recorded later', async () => {
  let calls = 0;
  const audit = {
    reviewId: 'synthetic-future-audit', version: 1,
    termsUrl: 'https://www.sec.gov/privacy',
    reviewedAt: '2026-10-16T15:00:00Z', validFrom: '2025-01-01T00:00:00Z',
    expiresAt: '2026-10-17T00:00:00Z', operations: { fetch: 'allowed' },
    purpose: 'historical_financial_facts',
    sourceBinding: { cik: SEC_TARGET.cik, accession: SEC_TARGET.accession, urls: [SEC_TARGET.url, SEC_TARGET.indexUrl] }
  };
  await assert.rejects(fetchDocument(SEC_TARGET.url, {
    review: audit, userAgent: 'Cribscore/test synthetic', now: () => AT,
    fetcher: async () => { calls++; throw new Error('NETWORK MUST NOT RUN'); }
  }), /rights_not_current/);
  assert.equal(calls, 0);
});
