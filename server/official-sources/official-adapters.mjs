// Pure research adapters. No network, credentials, scheduler, UI, or ranking writes.
// A successfully parsed record is not a validated fundamental, trade signal, or
// historical point-in-time observation. Callers retain the original capture.
import {createHash} from 'node:crypto';
const fail = code => { throw new Error(code); };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export function isoDate(value) {
  if (typeof value !== 'string' || !DAY.test(value)) fail('invalid_date');
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) fail('invalid_date');
  return value;
}
export function isoInstant(value) {
  if (typeof value !== 'string' || !STAMP.test(value)) fail('invalid_utc_instant');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) fail('invalid_utc_instant');
  return value;
}
export function normalizeCik(cik) {
  const value = String(cik);
  if (!/^\d{1,10}$/.test(value) || Number(value) <= 0) fail('invalid_cik');
  return value.padStart(10, '0');
}
export function secSourceUrl(kind, cik) {
  const suffix = `CIK${normalizeCik(cik)}.json`;
  if (kind === 'submissions') return `https://data.sec.gov/submissions/${suffix}`;
  if (kind === 'companyfacts') return `https://data.sec.gov/api/xbrl/companyfacts/${suffix}`;
  fail('unsupported_sec_source');
}
function provenance(capture, expectedUrl) {
  if (!capture || capture.url !== expectedUrl) fail('source_identity_mismatch');
  const retrievedAt = isoInstant(capture.retrievedAt);
  if (!['raw_response', 'web_tool_read', 'synthetic_fixture'].includes(capture.mode)) fail('capture_mode_invalid');
  if (capture.mode === 'raw_response' && capture.status !== 'retrieved') fail('capture_not_retrieved');
  if (capture.mode === 'web_tool_read' && capture.status != null && capture.status !== 'observed') fail('capture_not_observed');
  if (capture.mode === 'raw_response' && !/^[a-f0-9]{64}$/.test(capture.sha256 ?? '')) fail('capture_hash_required');
  if (capture.mode !== 'raw_response' && capture.sha256 != null) fail('raw_hash_not_available');
  return Object.freeze({
    url: expectedUrl, retrievedAt, mode: capture.mode, sha256: capture.sha256 ?? null,
    captureStatus: capture.mode === 'raw_response' ? 'retrieved' : capture.mode === 'web_tool_read' ? 'observed' : 'fixture',
    rawCaptureHashVerified: capture.mode === 'raw_response',
    rightsReviewRef: capture.rightsReviewRef ?? null,
    exactPublishedAt: null, firstObservedAt: capture.mode === 'synthetic_fixture' ? null : retrievedAt,
    historicalOperationalIngestion: false, eligibleForRanking: false,
    note: 'Retrieval proves observation at retrieval only; a later response does not prove historical availability.'
  });
}
function decodeJsonPayload(payload, capture) {
  if(capture.mode !== 'raw_response') return structuredClone(payload);
  if(typeof payload !== 'string' && !(payload instanceof Uint8Array)) fail('raw_capture_bytes_required');
  const bytes=Buffer.from(payload);
  if(createHash('sha256').update(bytes).digest('hex') !== capture.sha256) fail('raw_capture_hash_mismatch');
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); } catch { fail('captured_json_invalid'); }
}
export function wasObservedBy(record, cutoff) {
  isoInstant(cutoff);
  const source = record?.source;
  return ['raw_response', 'web_tool_read'].includes(source?.mode) && source?.firstObservedAt != null
    && source.firstObservedAt === source.retrievedAt
    && (source.mode === 'raw_response' ? source.captureStatus === 'retrieved' && source.rawCaptureHashVerified === true : source.captureStatus === 'observed')
    && Date.parse(isoInstant(source.firstObservedAt)) <= Date.parse(cutoff);
}
export function assessEvidenceFreshness(record, at, {maxRetrievalAgeHours = 12, maxObservationAgeDays = null} = {}) {
  isoInstant(at);
  if (!Number.isFinite(maxRetrievalAgeHours) || maxRetrievalAgeHours <= 0
    || (maxObservationAgeDays != null && (!Number.isFinite(maxObservationAgeDays) || maxObservationAgeDays < 0))) fail('invalid_freshness_policy');
  const retrieved = isoInstant(record?.source?.retrievedAt);
  if (!['raw_response', 'web_tool_read', 'synthetic_fixture'].includes(record?.source?.mode)) fail('capture_mode_invalid');
  const ageMs = Date.parse(at) - Date.parse(retrieved);
  const sourceDate = record.observationDate ?? record.period?.end ?? record.reportDate ?? null;
  if (sourceDate) isoDate(sourceDate);
  const period = record.observationPeriod ?? null;
  if (period) {
    if (!['month', 'annual_average'].includes(period.kind)) fail('invalid_observation_period');
    isoDate(period.start); isoDate(period.end);
    const expected = blsPeriodBounds(period.kind === 'month' ? period.start.slice(0,7) : period.start.slice(0,4), period.kind);
    if (period.start !== expected.start || period.end !== expected.end) fail('invalid_observation_period');
  }
  const periodAgeDays = period == null ? null : Math.floor((Date.parse(`${at.slice(0,10)}T00:00:00Z`) - Date.parse(`${period.end}T00:00:00Z`))/86400000);
  const sourceAgeDays = sourceDate == null ? null : Math.floor((Date.parse(`${at.slice(0,10)}T00:00:00Z`) - Date.parse(`${sourceDate}T00:00:00Z`))/86400000);
  return {
    assessedAt: at, retrievalAgeHours: ageMs/3600000,
    retrievalStatus: record?.source?.mode === 'synthetic_fixture' ? 'fixture_not_live' : ageMs < 0 ? 'clock_or_future_capture_error' : ageMs <= maxRetrievalAgeHours*3600000 ? 'within_age_policy' : 'stale_capture',
    observationDate: sourceDate, observationAgeCalendarDays: sourceAgeDays,
    dateBasis: record.observationDate ? 'observation_date' : record.period?.end ? 'reporting_period_end' : record.reportDate ? 'report_date' : null,
    filingDate: record.filedDate ?? record.filingDate ?? null,
    observationPeriod: period ? {...period} : null,
    periodEndAgeCalendarDays: periodAgeDays,
    periodDateBasis: period ? `${period.kind}_period_end` : null,
    releaseDate: record.releaseDate ?? null, exactPublishedAt: record.originalReleaseAt ?? record.source.exactPublishedAt ?? null,
    vintageAsOf: record.vintageAsOf ?? null, originalVintageVerified: record.originalVintageVerified === true,
    observationStatus: sourceAgeDays != null
      ? sourceAgeDays < 0 ? 'future_observation_error' : maxObservationAgeDays == null ? 'age_policy_not_set' : sourceAgeDays <= maxObservationAgeDays ? 'within_age_policy' : 'old_observation'
      : periodAgeDays != null
        ? periodAgeDays < 0 ? 'period_in_progress' : maxObservationAgeDays == null ? 'period_age_policy_not_set' : periodAgeDays <= maxObservationAgeDays ? 'period_end_within_age_policy' : 'old_period'
        : 'date_unknown',
    eligibleForRanking: false,
    note: 'Capture age, observation date, period end and release vintage are separate. Period boundaries do not establish publication time or financial completeness. Calendar-day age is not trading-session age.'
  };
}
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) fail(`invalid_${label}`);
  return value;
};
const accession = value => {
  if (typeof value !== 'string' || !/^\d{10}-\d{2}-\d{6}$/.test(value)) fail('invalid_accession');
  return value;
};
function filingUrl(cik, acc, name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name)
    || name.split('/').some(part => part === '.' || part === '..')) fail('unsafe_primary_document');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replaceAll('-', '')}/${name}`;
}

export function parseSecSubmissions(payload, capture, expectedCik) {
  const cik = normalizeCik(expectedCik);
  const source = provenance(capture, secSourceUrl('submissions', cik));
  payload=decodeJsonPayload(payload,capture);
  if (normalizeCik(payload?.cik) !== cik) fail('issuer_identity_mismatch');
  const recent = payload.filings?.recent;
  const required = ['accessionNumber', 'filingDate', 'reportDate', 'acceptanceDateTime', 'form', 'primaryDocument'];
  if (!recent || required.some(key => !Array.isArray(recent[key]))) fail('filing_columns_missing');
  const n = recent.accessionNumber.length;
  // SEC's compact arrays must remain aligned. Never fill a short column with defaults.
  if (required.some(key => recent[key].length !== n)) fail('filing_columns_misaligned');
  for (const key of ['items','primaryDocDescription']) {
    if(recent[key] != null && (!Array.isArray(recent[key]) || recent[key].length !== n)) fail('optional_filing_columns_misaligned');
  }
  const ids = new Set();
  const records = Array.from({length: n}, (_, index) => {
    const acc = accession(recent.accessionNumber[index]);
    if (ids.has(acc)) fail('duplicate_accession');
    ids.add(acc);
    const filingDate = isoDate(recent.filingDate[index]);
    const reportDate = recent.reportDate[index] ? isoDate(recent.reportDate[index]) : null;
    const acceptedAt = isoInstant(recent.acceptanceDateTime[index]);
    if (Date.parse(acceptedAt) > Date.parse(source.retrievedAt) || filingDate > source.retrievedAt.slice(0, 10)) fail('future_filing');
    const form = text(recent.form[index], 'form');
    return {
      issuer: {cik, name: text(payload.name, 'issuer_name')}, accession: acc, form,
      isAmendment: /\/A$/.test(form), filingDate, reportDate, acceptedAt,
      itemCodes: recent.items?.[index] ?? null, primaryDocumentDescription: recent.primaryDocDescription?.[index] ?? null,
      primaryDocumentUrl: filingUrl(cik, acc, recent.primaryDocument[index]),
      source, status: 'filing_metadata_only', exactPublicDisseminationAt: null,
      statementContextValidated: false, restatementReviewComplete: false
    };
  });
  // Recent is explicitly partial: extra files are discovery metadata, never auto-fetched.
  const additionalFiles = (payload.filings.files ?? []).map(file => ({
    name: text(file.name, 'additional_file'), filingFrom: isoDate(file.filingFrom),
    filingTo: isoDate(file.filingTo), filingCount: file.filingCount
  }));
  return {source, issuer: {cik, name: payload.name, tickers: [...(payload.tickers ?? [])], exchanges: [...(payload.exchanges ?? [])]},
    coverage: {completeHistory: false, recentFilingCount: records.length, additionalFiles}, records};
}

export function parseSecCompanyFactsCandidates(payload, capture, {cik: expectedCik, taxonomy, concept, unit}) {
  const cik = normalizeCik(expectedCik);
  const source = provenance(capture, secSourceUrl('companyfacts', cik));
  payload=decodeJsonPayload(payload,capture);
  if (normalizeCik(payload?.cik) !== cik) fail('issuer_identity_mismatch');
  if (!['us-gaap', 'ifrs-full', 'dei', 'srt'].includes(taxonomy)) fail('unsupported_taxonomy');
  text(concept, 'concept'); text(unit, 'unit');
  const values = payload.facts?.[taxonomy]?.[concept]?.units?.[unit];
  if (!Array.isArray(values)) fail('concept_unit_missing');
  return values.map(fact => {
    const end = isoDate(fact.end), start = fact.start ? isoDate(fact.start) : null;
    const filed = isoDate(fact.filed);
    if (start && start > end) fail('period_reversed');
    if (filed > source.retrievedAt.slice(0, 10) || end > source.retrievedAt.slice(0, 10)) fail('future_fact');
    if (typeof fact.val !== 'number' || !Number.isFinite(fact.val)) fail('fact_number_invalid');
    return {
      issuer: {cik, name: text(payload.entityName, 'issuer_name')}, taxonomy, concept, unit,
      rawReportedValue: fact.val, period: {start, end, kind: start ? 'duration' : 'instant'},
      accession: accession(fact.accn), filedDate: filed, form: text(fact.form, 'form'),
      fiscalYearLabel: fact.fy ?? null, fiscalPeriodLabel: fact.fp ?? null, calendarFrameLabel: fact.frame ?? null,
      status: 'unvalidated_api_fact_candidate', source, statementContextValidated: false,
      contextId: null, dimensions: null, restatementReviewComplete: false,
      requiredReview: ['Original filing context, entity, units, scale, period and dimensions',
        'Duplicate/as-reported/amendment selection and later non-reliance notices',
        'Filing dissemination and historical capture evidence']
    };
  }); // Preserve duplicates and comparative-period facts. Do not pick the latest filing as truth.
}

function blsPeriodBounds(label, kind) {
  const annual = kind === 'annual_average';
  const start = `${label}-${annual ? '01-01' : '01'}`;
  isoDate(start);
  const nextMonth = new Date(Date.parse(`${start}T00:00:00Z`) + 32*86400000).toISOString().slice(0,7)+'-01';
  const end = annual ? `${label}-12-31` : new Date(Date.parse(`${nextMonth}T00:00:00Z`)-86400000).toISOString().slice(0,10);
  return {start, end, kind};
}

export const BLS_ATTRIBUTION = 'BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.';
export function parseBlsSeries(payload, capture, seriesId) {
  if (!/^[A-Z0-9_#-]+$/.test(seriesId)) fail('invalid_bls_series');
  const source = provenance(capture, `https://api.bls.gov/publicAPI/v1/timeseries/data/${seriesId}`);
  payload=decodeJsonPayload(payload,capture);
  if (payload.status !== 'REQUEST_SUCCEEDED') fail('bls_request_unsuccessful');
  const groups = Array.isArray(payload.Results) ? payload.Results : [payload.Results];
  const series = groups.flatMap(group => group?.series ?? []);
  if (series.length !== 1 || series[0].seriesID !== seriesId) fail('bls_series_identity_mismatch');
  const seen = new Set();
  if (!Array.isArray(series[0].data)) fail('bls_data_missing');
  return series[0].data.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('bls_observation_invalid');
    if (!/^\d{4}$/.test(String(item.year)) || !/^M(0[1-9]|1[0-3])$/.test(item.period)) fail('bls_unsupported_period');
    const annual = item.period === 'M13';
    const period = annual ? String(item.year) : `${item.year}-${item.period.slice(1)}`;
    if (seen.has(period)) fail('bls_duplicate_period');
    seen.add(period);
    if (period > source.retrievedAt.slice(0, 7)) fail('future_bls_period');
    if (annual && Number(item.year) >= Number(source.retrievedAt.slice(0,4))) fail('future_bls_annual_average');
    const numeric = typeof item.value === 'string' && /^-?\d+(?:\.\d+)?$/.test(item.value);
    if (numeric && !Number.isFinite(Number(item.value))) fail('bls_number_invalid');
    const observationPeriod = blsPeriodBounds(period, annual ? 'annual_average' : 'month');
    return {seriesId, observationPeriod, period, periodKind: annual ? 'annual_average' : 'month', rawPeriod: item.period,
      periodName: item.periodName ?? null, latestFlag: item.latest ?? null, rawReportedValue: numeric ? Number(item.value) : null,
      rawReportedString: item.value ?? null,
      missingMarker: numeric ? null : item.value ?? null, unit: null, seasonality: null,
      footnotes: structuredClone(item.footnotes ?? []),
      source, status: 'current_vintage_series_observation', originalReleaseAt: null,
      vintageAsOf: source.retrievedAt, originalVintageVerified: false, metadataVerified: false,
      attribution: BLS_ATTRIBUTION};
  });
}
export function parseBlsMonthly(payload, capture, seriesId) {
  const rows=parseBlsSeries(payload,capture,seriesId);
  if(rows.some(row=>row.periodKind!=='month')) fail('bls_nonmonthly_period');
  return rows;
}

// Rows must be transcribed/decoded from a labelled H.15 table. This normalizer
// checks schema and dates; it does not attest the extraction or fetch any page.
export function normalizeH15Rows({releaseDate, rows}, capture) {
  if(capture?.mode === 'raw_response') fail('raw_h15_parser_unavailable');
  const source = provenance(capture, 'https://www.federalreserve.gov/releases/h15/');
  isoDate(releaseDate);
  if (releaseDate > source.retrievedAt.slice(0, 10)) fail('future_h15_release');
  const seen = new Set();
  return rows.map(row => {
    const date = isoDate(row.observationDate);
    if (date > releaseDate) fail('h15_observation_after_release');
    text(row.series, 'h15_series');
    const identity = `${row.series}:${date}`;
    if (seen.has(identity)) fail('duplicate_h15_observation');
    seen.add(identity);
    if (row.value != null && (typeof row.value !== 'number' || !Number.isFinite(row.value))) fail('invalid_h15_number');
    return {series: row.series, observationDate: date, releaseDate, value: row.value ?? null,
      missingMarker: row.value == null ? row.missingMarker ?? 'not_available' : null,
      unit: 'percent_per_annum', source, status: 'dated_macro_context',
      sourceAttribution: 'Board of Governors of the Federal Reserve System, H.15',
      realtime: false, revisionHistoryVerified: false, extractionAttestedByNormalizer: false};
  });
}
