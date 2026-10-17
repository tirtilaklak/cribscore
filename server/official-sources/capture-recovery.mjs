/** Offline recovery advice for retained official captures. No request or retry executes here.
 * The host must supply its complete attempt history. This checker does not authenticate
 * that history, grant source rights, or resolve a prior denial.
 */
import {createHash} from 'node:crypto';
import {isoInstant} from './official-adapters.mjs';
const TREASURY_URL='https://home.treasury.gov/treasury-daily-interest-rate-xml-feed?data=daily_treasury_yield_curve&field_tdr_date_value=2026';
function kind(url) {
  if (typeof url !== 'string') return null;
  if (/^https:\/\/data\.sec\.gov\/(?:submissions|api\/xbrl\/companyfacts)\/CIK\d{10}\.json$/.test(url)) return 'sec_json';
  if (url==='https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0') return 'bls_json';
  if (url===TREASURY_URL) return 'treasury_xml';
  return null;
}
const flags={requestAllowed:false,automaticRetryAllowed:false,refreshConfigured:false,eligibleForRanking:false,financialCompleteness:'unestablished'};
export function planOfficialSourceRecovery({url,attempts,retainedBytes,at,maxCaptureAgeHours=12}={}) {
  const output=(action,reason,extra={})=>({action,reason,url,assessedAt:at,retainedCaptureAt:null,sha256:null,...extra,...flags});
  let now;
  try {now=Date.parse(isoInstant(at));} catch {return output('stop','assessment_clock_invalid');}
  if (!kind(url)) return output('stop','official_endpoint_not_supported');
  if (!Number.isFinite(maxCaptureAgeHours)||maxCaptureAgeHours<=0) return output('stop','cache_policy_invalid');
  if (!Array.isArray(attempts)) return output('stop','attempt_history_required');
  if (!attempts.length) return output('request_manual_scope','no_retained_attempt');
  // Preserve order: sorting supplied history could hide a rollback or a replaced receipt.
  let previousStart=-Infinity;
  for (const attempt of attempts) {
    let start;
    try {start=Date.parse(isoInstant(attempt.startedAt));} catch {return output('stop','attempt_history_clock_invalid');}
    if(attempt.url!==url) return output('stop','attempt_history_source_mismatch');
    if(start<=previousStart||start>now) return output('stop','attempt_history_clock_invalid');
    previousStart=start;
  }
  const latest=attempts.at(-1);
  if (['attempting','pending','uncertain'].includes(latest.status)) return output('inspect_uncertain_outcome','prior_attempt_unresolved');
  if (['blocked','failed','denied'].includes(latest.status)) return output('stop','prior_attempt_stopped_no_automatic_retry');
  if (latest.status!=='retrieved') return output('stop','attempt_status_invalid');
  let captured;
  try {captured=Date.parse(isoInstant(latest.retrievedAt));} catch {return output('stop','capture_clock_invalid');}
  if (captured<previousStart||captured>now) return output('stop','capture_clock_invalid');
  if (latest.mode!=='raw_response'||latest.httpStatus!==200||latest.method!=='GET'||latest.retryCount!==0) return output('stop','capture_transport_invalid');
  const type=kind(url), contentType=String(latest.contentType??'').split(';')[0].trim().toLowerCase();
  const expectedType=type==='treasury_xml'?['application/xml','text/xml','application/atom+xml']:['application/json'];
  if(!expectedType.includes(contentType)) return output('stop','capture_content_type_mismatch');
  if (!/^[a-f0-9]{64}$/.test(latest.sha256??'')||!Number.isSafeInteger(latest.byteLength)||latest.byteLength<=0) return output('stop','capture_digest_or_size_invalid');
  if (!(retainedBytes instanceof Uint8Array)) return output('verify_retained_bytes','retained_bytes_required');
  if (retainedBytes.byteLength!==latest.byteLength||createHash('sha256').update(retainedBytes).digest('hex')!==latest.sha256) return output('stop','retained_bytes_mismatch');
  const clocks={retainedCaptureAt:latest.retrievedAt,sha256:latest.sha256,captureAgeHours:(now-captured)/3600000};
  // Treasury's retained response failed content type. Even a future valid XML
  // response needs a separately reviewed decoder before any yield is admitted.
  if (type==='treasury_xml') return output('review_parser','treasury_xml_parser_unavailable',clocks);
  if (now-captured>maxCaptureAgeHours*3600000) return output('request_manual_scope','retained_capture_stale',clocks);
  return output('reuse_retained_capture','verified_bytes_within_cache_policy',clocks);
}
