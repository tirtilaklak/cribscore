/**
 * Narrow, fail-closed SEC historical-fact boundary.
 * This validates supplied context; it does not certify legal permission or prove
 * source authenticity. Capture, source comparison and rights review are separate.
 */
export const EVIDENCE_CONTRACT_VERSION = '1.0.0';

const METRICS = Object.freeze({
  RevenueFromContractWithCustomerExcludingAssessedTax: 'revenue',
  Revenues: 'revenue',
  SalesRevenueNet: 'revenue',
  NetIncomeLoss: 'net income',
});
const OPERATIONS = ['fetch', 'store', 'transform', 'display'];
const SCALES = new Map([[1, ''], [1000, ' thousand'], [1000000, ' million'], [1000000000, ' billion']]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const versioned = value => nonempty(value) || (Number.isSafeInteger(value) && value > 0);

function dateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function instant(value) {
  if (typeof value !== 'string' || !ISO.test(value)) return NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !dateOnly(value.slice(0, 10))) return NaN;
  const time = value.slice(11, 19).split(':').map(Number);
  if (time[0] > 23 || time[1] > 59 || time[2] > 59) return NaN;
  if (!value.endsWith('Z')) {
    const offset = value.slice(-6).slice(1).split(':').map(Number);
    if (offset[0] > 14 || offset[1] > 59 || (offset[0] === 14 && offset[1] !== 0)) return NaN;
  }
  return parsed;
}

function secUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.sec.gov' || url.port
      || url.username || url.password || url.search) return null;
    return url;
  } catch { return null; }
}

function inspectRights(rightsInput, operation, time, reasons, prefix, record) {
  const rights = Array.isArray(rightsInput) ? rightsInput : rightsInput ? [rightsInput] : [];
  const known = rights.filter(right => right && Number.isFinite(instant(right.reviewedAt))
    && instant(right.reviewedAt) <= time && Number.isFinite(instant(right.validFrom))
    && instant(right.validFrom) <= time);
  // The most recently observed audit can correct an earlier terms assessment.
  // It cannot supply permission before its real audit time.
  known.sort((a, b) => instant(b.reviewedAt) - instant(a.reviewedAt)
    || instant(b.validFrom) - instant(a.validFrom)
    || String(b.version).localeCompare(String(a.version), 'en', { numeric: true }));
  const right = known[0];
  if (!right) { reasons.push(`${prefix}_rights_unknown`); return; }
  if (!nonempty(right.reviewId) || !versioned(right.version) || !secUrl(right.termsUrl)) {
    reasons.push(`${prefix}_rights_audit_incomplete`);
  }
  const binding = right.sourceBinding;
  if (right.purpose !== 'historical_financial_facts' || binding?.cik !== record.issuer?.cik
    || binding?.accession !== record.source?.accession || !Array.isArray(binding?.urls)
    || !binding.urls.includes(record.source?.url) || !binding.urls.includes(record.source?.indexUrl)) {
    reasons.push(`${prefix}_rights_scope_mismatch`);
  }
  const expiry = instant(right.expiresAt);
  if (!Number.isFinite(expiry)) reasons.push(`${prefix}_rights_expiry_unknown`);
  else if (expiry <= time || expiry <= instant(right.validFrom)) reasons.push(`${prefix}_rights_expired`);
  const state = right.operations?.[operation];
  if (state !== 'allowed') reasons.push(`${prefix}_rights_${['denied', 'revoked'].includes(state) ? state : 'unknown'}`);
  const sameEffective = known.filter(item => item !== right && item.validFrom === right.validFrom
    && item.reviewedAt === right.reviewedAt && (item.version === right.version
      || item.operations?.[operation] !== right.operations?.[operation]));
  if (sameEffective.length) reasons.push(`${prefix}_rights_conflict`);
}

/**
 * at is the actual requested operation time; asOf restricts fact availability.
 * expected binds a consumer request to a specific issuer/metric/period/unit.
 * No supplied prose, label, confidence or recommendation enters claim wording.
 */
export function inspectEvidence(record, options = {}) {
  const reasons = [];
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return { eligible: false, reasons: ['options_invalid'] };
  }
  const operationTime = options.at ?? new Date().toISOString();
  const at = instant(operationTime);
  const asOf = instant(options.asOf ?? operationTime);
  const operation = options.operation ?? 'display';
  if (!Number.isFinite(at)) reasons.push('operation_time_invalid');
  if (!Number.isFinite(asOf) || asOf > at) reasons.push('as_of_invalid');
  if (!OPERATIONS.includes(operation)) reasons.push('operation_unknown');
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { eligible: false, reasons: [...reasons, 'record_missing'] };
  }
  const issuer = record.issuer ?? {};
  const metric = record.metric ?? {};
  const period = record.period ?? {};
  const source = record.source ?? {};
  const concept = typeof metric.concept === 'string' && Object.hasOwn(METRICS, metric.concept) ? METRICS[metric.concept] : null;
  const cik = typeof issuer.cik === 'string' ? issuer.cik : '';
  const accession = typeof source.accession === 'string' ? source.accession : '';
  if (!nonempty(issuer.name) || !/^\d{10}$/.test(cik)) reasons.push('issuer_incomplete');
  if (!concept || metric.taxonomy !== 'us-gaap' || metric.accountingBasis !== 'US-GAAP') reasons.push('metric_unsupported');
  if (record.unit !== 'USD' || !SCALES.has(record.scale)) reasons.push('unit_unsupported');
  if (record.scope !== 'consolidated' || !Array.isArray(record.dimensions) || record.dimensions.length) reasons.push('scope_or_dimensions_unsupported');
  const raw = typeof record.value === 'number' ? String(record.value) : record.value;
  const value = typeof raw === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER
    || !Number.isFinite(value * record.scale) || Math.abs(value * record.scale) > Number.MAX_SAFE_INTEGER) reasons.push('value_invalid');
  const duration = (Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / 86400000;
  if (period.type !== 'duration' || !dateOnly(period.start) || !dateOnly(period.end)
    || duration < 0 || duration > 371 || !Number.isInteger(period.fiscalYear)
    || period.fiscalYear !== Number(period.end?.slice(0, 4))) reasons.push('period_invalid');
  if (!['10-K', '10-Q'].includes(source.form) || source.original !== true
    || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) reasons.push('original_filing_required');
  const url = secUrl(source.url);
  const index = secUrl(source.indexUrl);
  const accessionDigits = accession.replaceAll('-', '');
  const cikPath = /^\d{10}$/.test(cik) ? String(Number(cik)) : '';
  const expectedPath = `/Archives/edgar/data/${cikPath}/${accessionDigits}/`;
  // This first slice supports issuer-submitted accessions. Agent-filed originals
  // require a separately verified issuer binding before widening this rule.
  if (!url || !index || !url.pathname.startsWith(expectedPath) || !index.pathname.startsWith(expectedPath)
    || accession.slice(0, 10) !== cik) reasons.push('source_identity_mismatch');
  if (!nonempty(source.location) || !/^[a-f0-9]{64}$/i.test(source.sha256 ?? '')
    || !nonempty(source.parserVersion)) reasons.push('source_provenance_incomplete');
  if (!['reconstructed_public_history', 'operational_capture'].includes(source.mode)) reasons.push('source_mode_invalid');
  const accepted = instant(source.acceptedAt);
  const fetched = instant(source.fetchedAt);
  const ingested = instant(source.ingestedAt);
  const published = instant(source.publishedAt);
  const observed = instant(source.publicAvailabilityObservedAt);
  let available = published;
  if (source.publishedAt === null && dateOnly(source.publishedDate)
    && source.publishedTimePrecision === 'date' && Number.isFinite(observed)) available = observed;
  if (![accepted, fetched, ingested, available].every(Number.isFinite)) reasons.push('source_times_incomplete');
  if (Number.isFinite(accepted) && Number.isFinite(available) && accepted > available) reasons.push('publication_precedes_acceptance');
  if (dateOnly(period.end) && Number.isFinite(accepted)
    && Date.parse(`${period.end}T00:00:00Z`) > accepted) reasons.push('period_after_source');
  if (Number.isFinite(available) && Number.isFinite(fetched) && available > fetched) reasons.push('fetch_precedes_availability');
  if (Number.isFinite(fetched) && Number.isFinite(ingested) && fetched > ingested) reasons.push('ingestion_precedes_fetch');
  if ([accepted, available, fetched, ingested].some(time => Number.isFinite(time) && time > at)) reasons.push('source_time_in_future');
  if (Number.isFinite(available) && available > asOf) reasons.push('evidence_unavailable_as_of');
  if (source.mode === 'operational_capture' && Number.isFinite(ingested) && ingested > asOf) reasons.push('not_ingested_as_of');
  if (source.nonReliance === true || record.nonReliance === true) reasons.push('non_reliance_notice');
  if (source.superseded === true || record.superseded === true) reasons.push('source_superseded');
  const expected = options.expected ?? {};
  for (const [key, actual] of Object.entries({ cik: issuer.cik, issuerName: issuer.name, metricConcept: metric.concept,
    unit: record.unit, scale: record.scale, periodStart: period.start, periodEnd: period.end })) {
    if (Object.hasOwn(expected, key) && expected[key] !== actual) reasons.push(`expected_${key}_mismatch`);
  }
  if (Number.isFinite(fetched)) inspectRights(record.rights, 'fetch', fetched, reasons, 'fetch', record);
  if (Number.isFinite(ingested)) {
    inspectRights(record.rights, 'store', ingested, reasons, 'store', record);
    inspectRights(record.rights, 'transform', ingested, reasons, 'transform', record);
  }
  if (Number.isFinite(at) && OPERATIONS.includes(operation)) inspectRights(record.rights, operation, at, reasons, operation, record);
  const unique = [...new Set(reasons)];
  if (unique.length) return { eligible: false, reasons: unique };
  const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value);
  return {
    eligible: true,
    reasons: [],
    claim: `${issuer.name.trim()} reported ${concept} of USD ${amount}${SCALES.get(record.scale)} for ${period.start} through ${period.end} (consolidated, US GAAP), as reported in its original Form ${source.form}.`,
  };
}

/** Research state is distinct from directional or earnings-timed actions. */
export function inspectResearchState(state = {}, options = {}) {
  const reasons = [];
  const at = instant(options.at ?? new Date().toISOString());
  const event = state.earnings?.nextEvent;
  const eventAt = instant(event?.at);
  const timingEligible = state.timingDependent !== true
    || (event?.status === 'confirmed' && Number.isFinite(eventAt) && Number.isFinite(at) && eventAt >= at);
  if (!timingEligible) reasons.push('earnings_date_unknown');
  return { research_status: 'unvalidated', direction: null, historicalFactsEligible: true,
    timingActionEligible: timingEligible, reasons };
}
