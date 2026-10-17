/** Pure display projection. No request, timer, timestamp write, or eligibility decision.
 * observed_at retains the original source observation. A later endpoint-bound
 * last_check may supply the age basis; it never replaces that original clock.
 * Loading a static file or reviewing a card cannot create a source check.
 */
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function instant(value) {
  if (typeof value !== 'string' || !STAMP.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,19) === value.slice(0,19) ? time : NaN;
}
function policy(options) {
  const at = options?.at, maxCaptureAgeHours = options?.maxCaptureAgeHours ?? 12;
  const now = instant(at);
  if (!Number.isFinite(now) || !Number.isFinite(maxCaptureAgeHours) || maxCaptureAgeHours <= 0) throw new TypeError('source_freshness_policy_invalid');
  return {at, now, maxCaptureAgeHours};
}
const limits = Object.freeze({financialCompleteness:'unestablished', eligibleForRanking:false});
function endpointKindMatches(kind,url) {
  if(typeof url !== 'string')return false;
  if(kind === 'sec_submissions')return /^https:\/\/data\.sec\.gov\/submissions\/CIK\d{10}\.json$/.test(url);
  if(kind === 'sec_companyfacts')return /^https:\/\/data\.sec\.gov\/api\/xbrl\/companyfacts\/CIK\d{10}\.json$/.test(url);
  return kind === 'bls_current_vintage' && url === 'https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0';
}
function assess(check, p) {
  const originalAt = check?.observed_at ?? null, original = instant(originalAt);
  const originalValid = Number.isFinite(original) && original <= p.now;
  const hasLastCheck = check !== null && typeof check === 'object' && Object.hasOwn(check,'last_check');
  let effectiveAt = originalAt, effective = original, lastCheckStatus = 'absent', lastCheckReason = null;
  if(hasLastCheck) {
    const latest = check.last_check, latestTime = instant(latest?.observed_at);
    if(!latest || typeof latest !== 'object' || Array.isArray(latest)
      || latest.url !== check.url || latest.source_kind !== check.source_kind
      || !endpointKindMatches(check.source_kind,check.url))lastCheckReason='source_binding_invalid';
    else if(!['unchanged','metadata_changed'].includes(latest.outcome))lastCheckReason='outcome_invalid';
    else if(typeof latest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(latest.sha256))lastCheckReason='digest_invalid';
    else if(!Number.isFinite(original) || !Number.isFinite(latestTime) || latestTime < original)lastCheckReason='check_clock_invalid';
    if(lastCheckReason) {effectiveAt=null;effective=NaN;lastCheckStatus='invalid';}
    else {effectiveAt=latest.observed_at;effective=latestTime;lastCheckStatus=latestTime<=p.now?'valid':'invalid';if(latestTime>p.now)lastCheckReason='future_check';}
  }
  const missing = !hasLastCheck && originalAt === null;
  const valid = Number.isFinite(effective) && effective <= p.now;
  const captureAgeHours = valid ? (p.now-effective)/3600000 : null;
  const captureStatus = missing ? 'capture_time_missing' : !valid ? 'capture_time_invalid'
    : captureAgeHours <= p.maxCaptureAgeHours ? 'capture_within_age_policy' : 'capture_stale';
  const expires = effective + p.maxCaptureAgeHours*3600000;
  const next = Number.isFinite(effective) && effective > p.now ? effective
    : valid && p.now <= expires ? Math.floor(expires)+1 : null;
  const nextTransitionAt = next != null && Number.isFinite(new Date(next).getTime()) ? new Date(next).toISOString() : null;
  return {
    nextTransitionAt,
    id: typeof check?.id === 'string' ? check.id : null,
    sourceKind: typeof check?.source_kind === 'string' ? check.source_kind : 'unclassified',
    observedAt: originalValid ? originalAt : null,
    effectiveObservedAt: valid ? effectiveAt : null,
    lastCheckedAt: lastCheckStatus === 'valid' ? effectiveAt : null,
    lastCheckStatus, lastCheckReason,
    lastCheckOutcome:lastCheckStatus === 'valid' ? check.last_check.outcome : null,
    lastCheckSha256:lastCheckStatus === 'valid' ? check.last_check.sha256 : null,
    captureAgeHours, captureStatus,
    assessedAt:p.at, maxCaptureAgeHours:p.maxCaptureAgeHours,
    // Observation periods and release vintages are separate from endpoint checks.
    observationDate:null, observationPeriod:null, exactPublishedAt:null, vintageAsOf:null, reviewedAt:null,
    ...limits
  };
}
export function assessSourceCheck(check, options) {
  return assess(check, policy(options));
}
export function summarizeSourceChecks(checks, options) {
  if (!Array.isArray(checks)) throw new TypeError('source_checks_array_required');
  const p = policy(options);
  const rows = checks.map(check => assess(check, p));
  const count = status => rows.filter(row => row.captureStatus === status).length;
  const withinAgePolicyCount = count('capture_within_age_policy');
  const staleCount = count('capture_stale'), invalidCount = count('capture_time_invalid'), missingCount = count('capture_time_missing');
  const clocks = rows.map(row => row.effectiveObservedAt).filter(Boolean).sort((a,b)=>instant(a)-instant(b));
  const originals = rows.map(row => row.observedAt).filter(Boolean).sort((a,b)=>instant(a)-instant(b));
  const bySourceKind = Object.fromEntries([...new Set(rows.map(row=>row.sourceKind))].map(kind=>{
    const subset=rows.filter(row=>row.sourceKind===kind);
    return [kind,{total:subset.length,withinAgePolicyCount:subset.filter(row=>row.captureStatus==='capture_within_age_policy').length,staleCount:subset.filter(row=>row.captureStatus==='capture_stale').length,invalidCount:subset.filter(row=>row.captureStatus==='capture_time_invalid').length,missingCount:subset.filter(row=>row.captureStatus==='capture_time_missing').length}];
  }));
  const transitions = rows.map(row => row.nextTransitionAt).filter(Boolean).sort((a,b)=>instant(a)-instant(b));
  return {
    nextTransitionAt:transitions[0]??null, checks:rows,
    status: !rows.length ? 'no_source_observations' : invalidCount || missingCount ? 'source_clock_incomplete'
      : staleCount ? 'source_observations_stale' : 'source_observations_within_age_policy',
    total:rows.length, withinAgePolicyCount, staleCount, invalidCount, missingCount, bySourceKind,
    recheckedCount:rows.filter(row=>row.lastCheckStatus==='valid').length,
    originalOldestObservedAt:originals[0]??null, originalLatestObservedAt:originals.at(-1)??null,
    oldestObservedAt:clocks[0]??null, latestObservedAt:clocks.at(-1)??null,
    assessedAt:p.at, maxCaptureAgeHours:p.maxCaptureAgeHours, ...limits
  };
}
