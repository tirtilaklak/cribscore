// Server-only, disabled unless the caller supplies credentials AND a current
// trusted rights review. No secret discovery, persistence, scheduler or trading.
import {adaptAlpacaDailyBars} from '../../dist/lib/prices.js';
import {parseAlpacaJSON} from './alpaca-json.mjs';

export const ALPACA_BARS_ENDPOINT = 'https://data.alpaca.markets/v2/stocks/bars';
export const ALPACA_TERMS = 'https://files.alpaca.markets/disclosures/library/TermsAndConditions.pdf';
export const ALPACA_COLLECTOR_VERSION = 'alpaca_daily_capture_v1.1';
const LIMITS = Object.freeze({eligibleForRanking:false,paperMarksEligible:false,automaticTrading:false});
const MAX_BYTES = 2_000_000;
const MAX_EMPTY_CHUNKS = 128;
const expired = (signal,deadline) => signal.aborted || performance.now() >= deadline;
const cancelReader = reader => { try { Promise.resolve(reader?.cancel()).catch(()=>{}); } catch {} };
// Race explicit abort as well as checking elapsed monotonic time: injected or
// stalled streams may ignore AbortSignal, and empty reads may starve its timer.
async function withinDeadline(call,signal,deadline) {
  if (expired(signal,deadline)) throw Error('transport_deadline');
  let onAbort;
  const aborted=new Promise((_,reject)=>{onAbort=()=>reject(Error('transport_deadline'));signal.addEventListener('abort',onAbort,{once:true});});
  try {
    const value=await Promise.race([call(),aborted]);
    if (expired(signal,deadline)) throw Error('transport_deadline');
    return value;
  } finally { signal.removeEventListener('abort',onAbort); }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 500 && !/[\x00-\x1f\x7f]/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const symbol = value => typeof value === 'string' && /^[A-Z][A-Z0-9.-]{0,14}$/.test(value);
const utc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && utc(value + 'T00:00:00Z');
const current = (record, at) => object(record) && utc(record.reviewedAt) && utc(record.expiresAt) && Date.parse(record.reviewedAt) <= Date.parse(at) && Date.parse(at) < Date.parse(record.expiresAt);
const unavailable = (reason, status='unavailable') => ({ok:false,status,reasons:[reason],series:null,capture:null,...LIMITS});
function newYorkDate(at) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));
  return ['year','month','day'].map(type => parts.find(part => part.type === type).value).join('-');
}
function credentialsValid(credentials) {
  return object(credentials) && ['keyId','secretKey'].every(key => typeof credentials[key] === 'string' && /^[\x21-\x7e]{1,512}$/.test(credentials[key]));
}

// A shape check of a server-owned attestation, never proof of permission and never
// accepted from request JSON. A free plan or a reachable URL is not a rights review.
// This module deliberately grants no retention, display or paper-mark operation.
export function inspectAlpacaAuthorization(review, {at, operation='fetch'}={}) {
  if (!['fetch','normalize'].includes(operation)) return unavailable('operation_not_supported','setup_required');
  if (!utc(at)) return unavailable('operation_clock_invalid','setup_required');
  if (!object(review) || review.schemaVersion !== 'cribscore-alpaca-rights-v1' || review.provider !== 'alpaca' || review.dataset !== 'historical-stock-bars' || review.feed !== 'sip' || review.approved !== true || !text(review.reviewId)) return unavailable('rights_review_missing','setup_required');
  if (!current(review,at)) return unavailable('rights_review_stale','setup_required');
  if (!Array.isArray(review.operations) || review.operations.some(value => !['fetch','normalize'].includes(value)) || !review.operations.includes(operation)) return unavailable('operation_not_authorized','setup_required');
  const terms = review.terms;
  if (!object(terms) || terms.url !== ALPACA_TERMS || !hash(terms.sha256) || !text(terms.evidenceId) || !utc(terms.reviewedAt) || Date.parse(terms.reviewedAt) > Date.parse(review.reviewedAt)) return unavailable('terms_review_missing','setup_required');
  const rights = review.sourceRights;
  if (!object(rights) || rights.approved !== true || rights.providerAndExchangeTermsReviewed !== true || rights.scope !== 'delayed_sip_historical_personal_research' || !text(rights.evidenceId) || !current(rights,at)) return unavailable('source_rights_review_missing','setup_required');
  const entitlement = review.entitlement;
  if (!object(entitlement) || entitlement.active !== true || entitlement.delayedSipHistorical !== true || !text(entitlement.evidenceId) || !current(entitlement,at)) return unavailable('account_entitlement_missing','setup_required');
  if (review.audience !== 'owner_private') return unavailable('audience_not_authorized','setup_required');
  return {ok:true,status:'review_current',reasons:[],...LIMITS};
}

export function inspectAlpacaSetup({credentials, authorization, at}={}) {
  const reasons = [];
  if (!credentialsValid(credentials)) reasons.push('credentials_missing_or_invalid');
  for (const operation of ['fetch','normalize']) {
    const check = inspectAlpacaAuthorization(authorization,{at,operation});
    if (!check.ok) reasons.push(...check.reasons);
  }
  return {ok:reasons.length===0,status:reasons.length?'setup_required':'configured_unverified',provider:'alpaca',dataset:'historical-stock-bars',feed:'sip',reasons:[...new Set(reasons)],connectionVerified:false,...LIMITS};
}

export function validateAlpacaDailyRequest(request, security, captureId, startedAt) {
  if (!utc(startedAt)) return 'operation_clock_invalid';
  const required = ['symbols','feed','timeframe','adjustment','asof','currency','start','end'];
  if (!object(request) || Object.keys(request).some(key => ![...required,'pageToken'].includes(key)) || required.some(key => !Object.hasOwn(request,key)) || request.feed !== 'sip' || request.timeframe !== '1Day' || request.adjustment !== 'raw' || request.currency !== 'USD' || !Array.isArray(request.symbols) || request.symbols.length !== 1 || !symbol(request.symbols[0]) || !day(request.asof) || !utc(request.start) || !utc(request.end) || Date.parse(request.start) >= Date.parse(request.end) || Date.parse(request.end)-Date.parse(request.start) > 3660*86400000) return 'request_scope_invalid';
  if (request.pageToken !== undefined && (typeof request.pageToken !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(request.pageToken))) return 'pagination_token_invalid';
  if (request.asof > newYorkDate(startedAt)) return 'symbol_asof_in_future';
  if (Date.parse(request.end) > Date.parse(startedAt)-15*60000) return 'historical_end_too_recent';
  // Daily bars can exist during a still-open session. Requiring a previous New
  // York date avoids retaining a provisional bar as a later final daily close.
  // This conservative transport defers same-day bars until the next local day.
  if (newYorkDate(request.end) >= newYorkDate(startedAt)) return 'completed_new_york_day_required';
  if (!object(security) || security.symbol !== request.symbols[0] || !symbol(security.originalSymbol) || !text(security.entityId) || security.currency !== 'USD' || !text(security.exchange) || security.sessionTimezone !== 'America/New_York' || !text(captureId)) return 'security_mapping_invalid';
  return null;
}

export async function fetchAlpacaDailyBars({request,security,captureId,credentials,authorization,at,fetchImpl=fetch,clock=()=>new Date().toISOString()}={}) {
  let startedAt;
  try { startedAt=clock(); } catch { return unavailable('operation_clock_invalid'); }
  if (!utc(startedAt) || !utc(at) || Date.parse(startedAt)<Date.parse(at)) return unavailable('operation_clock_invalid');
  const setup=inspectAlpacaSetup({credentials,authorization,at:startedAt});
  if (!setup.ok) return {...setup,series:null,capture:null};
  const invalid=validateAlpacaDailyRequest(request,security,captureId,startedAt);
  if (invalid) return unavailable(invalid);
  if (request.pageToken?.includes(credentials.keyId) || request.pageToken?.includes(credentials.secretKey)) return unavailable('pagination_token_invalid');
  // Capture immutable input copies before the first asynchronous boundary.
  const scopedRequest=structuredClone(request), scopedSecurity=structuredClone(security), review=structuredClone(authorization);
  const keyId=credentials.keyId, secretKey=credentials.secretKey;
  const url=new URL(ALPACA_BARS_ENDPOINT);
  for (const key of ['symbols','feed','timeframe','adjustment','asof','currency','start','end']) url.searchParams.set(key,key==='symbols'?scopedRequest.symbols.join(','):scopedRequest[key]);
  url.searchParams.set('limit','5000'); url.searchParams.set('sort','asc');
  if (scopedRequest.pageToken !== undefined) url.searchParams.set('page_token',scopedRequest.pageToken);
  const signal=AbortSignal.timeout(20000), deadline=performance.now()+20000;
  let response;
  try {
    response=await withinDeadline(()=>fetchImpl(url.href,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',signal,headers:{'APCA-API-KEY-ID':keyId,'APCA-API-SECRET-KEY':secretKey,Accept:'application/json'}}),signal,deadline);
  } catch { return unavailable(expired(signal,deadline)?'transport_deadline_exceeded':'transport_failed_no_retry'); }
  if (response.status===401) return unavailable('provider_authentication_failed','setup_required');
  if (response.status===403) return unavailable('provider_permission_denied','setup_required');
  if (response.status===429) return unavailable('rate_limited_no_retry');
  if (response.status!==200 || response.ok!==true || response.redirected===true) return unavailable('http_failed_no_retry');
  if (response.url && response.url!==url.href) return unavailable('response_url_mismatch');
  if (!/^application\/json(?:;|$)/i.test(response.headers?.get('content-type')||'')) return unavailable('content_type_invalid');
  const declared=response.headers.get('content-length');
  if (declared!==null && (!/^\d+$/.test(declared) || Number(declared)>MAX_BYTES)) return unavailable('response_too_large_or_invalid_length');
  let bytes,reader;
  try {
    reader=response.body?.getReader();
    if (!reader) return unavailable('response_body_unavailable');
    const buffer=new Uint8Array(MAX_BYTES); let total=0,emptyChunks=0;
    while (true) {
      const {done,value}=await withinDeadline(()=>reader.read(),signal,deadline); if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('invalid_chunk');
      emptyChunks=value.byteLength===0?emptyChunks+1:0;
      if (emptyChunks>MAX_EMPTY_CHUNKS) { cancelReader(reader); return unavailable('response_no_progress'); }
      if (total+value.byteLength>MAX_BYTES) {
        // The failure is already established. Cancellation is best effort and
        // must not hold this result hostage to a stalled/rejecting stream sink.
        cancelReader(reader);
        return unavailable('response_too_large');
      }
      // Copy before the next await; retain one bounded buffer, not an object
      // per fragment. Producers may reuse their Uint8Array/Node Buffer storage.
      buffer.set(value,total); total+=value.byteLength;
    }
    bytes=buffer.subarray(0,total);
  } catch { cancelReader(reader); return unavailable(expired(signal,deadline)?'response_deadline_exceeded':'response_read_failed'); }
  finally { try { reader?.releaseLock(); } catch {} }
  let capturedAt;
  try { capturedAt=clock(); } catch { return unavailable('observation_clock_invalid'); }
  if (!utc(capturedAt) || Date.parse(capturedAt)<Date.parse(startedAt)) return unavailable('observation_clock_invalid');
  for (const operation of ['fetch','normalize']) {
    const currentReview=inspectAlpacaAuthorization(review,{at:capturedAt,operation});
    if (!currentReview.ok) return currentReview;
  }
  let body;
  try { body=parseAlpacaJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { return unavailable('response_json_invalid'); }
  if (body?.next_page_token != null && (typeof body.next_page_token !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(body.next_page_token) || body.next_page_token.includes(keyId) || body.next_page_token.includes(secretKey))) return unavailable('response_pagination_token_invalid');
  let responseSha256;
  try { responseSha256=Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join(''); }
  catch { return unavailable('response_digest_unavailable'); }
  const adapted=adaptAlpacaDailyBars(body,{request:scopedRequest,security:scopedSecurity,capture:{id:captureId,url:url.href,requestStartedAt:startedAt,capturedAt,responseSha256},at:capturedAt});
  if (!adapted.series || adapted.status==='invalid') return {...unavailable('provider_bars_invalid'),issues:adapted.issues};
  return {ok:true,status:'captured_unvalidated',reasons:[],series:adapted.series,warnings:adapted.warnings,accessVerified:false,...LIMITS,
    pagination:{complete:adapted.series.source.paginationComplete,nextPageToken:body.next_page_token??null,tokenFieldPresent:Object.hasOwn(body,'next_page_token')},
    capture:{provider:'alpaca',dataset:'historical-stock-bars',mode:'authenticated_response_observed',requestURL:url.href,requestStartedAt:startedAt,responseCompletedAt:capturedAt,responseSha256,responseByteLength:bytes.byteLength,authorizationReviewId:review.reviewId,collectorVersion:ALPACA_COLLECTOR_VERSION,httpStatus:200,providerPublishedAt:null,publicationPrecision:'unknown',correctionPossible:true,ingestedAt:null,identityReconciled:false,calendarCoverage:'unverified',corporateActionCoverage:'unverified',...LIMITS}};
}

/** Bounded, all-or-unavailable page collection. The returned capture set stays
 * in private memory; it is not a retained/reviewed-price reader. No retries or
 * automatic rate-limit backoff: a 429 stops this run and its scheduler owns the
 * next authorized attempt. Page hashes continue to identify exact source bytes.
 */
export async function fetchAlpacaDailyHistory(options={}) {
  const {maxPages=8,maxResponseBytes=8_000_000,...pageOptions}=options;
  const fail=(reason,status='unavailable',completedPages=0)=>({...unavailable(reason,status),pages:[],pagination:{complete:false,completedPages}});
  if (!Number.isSafeInteger(maxPages) || maxPages<1 || maxPages>8 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes<1 || maxResponseBytes>8_000_000) return fail('collection_limit_invalid');
  if (pageOptions.request?.pageToken!==undefined) return fail('history_requires_first_page');
  // Freeze the whole request/review once, not only the individually fetched pages.
  let context;
  try { context={...pageOptions,request:structuredClone(pageOptions.request),security:structuredClone(pageOptions.security),authorization:structuredClone(pageOptions.authorization),credentials:structuredClone(pageOptions.credentials)}; }
  catch { return fail('collection_context_invalid'); }
  const pages=[],seenTokens=new Set(),seenSessions=new Set();
  let token,bytes=0;
  for (let index=0;index<maxPages;index++) {
    const result=await fetchAlpacaDailyBars({...context,at:pages.at(-1)?.capture.responseCompletedAt??context.at,request:{...context.request,...(token===undefined?{}:{pageToken:token})},captureId:index===0?context.captureId:`${context.captureId}:page-${index+1}`});
    if (!result.ok) return {...result,pages:[],pagination:{complete:false,completedPages:pages.length}};
    bytes+=result.capture.responseByteLength;
    if (bytes>maxResponseBytes) return fail('collection_byte_limit',undefined,pages.length);
    if (!result.pagination.tokenFieldPresent) return fail('pagination_completeness_unknown',undefined,pages.length);
    for (const bar of result.series.bars) {
      if (seenSessions.has(bar.session)) return fail('pagination_duplicate_session',undefined,pages.length);
      seenSessions.add(bar.session);
    }
    if (pages.length && result.series.bars.length && result.series.bars[0].session <= pages.at(-1).series.bars.at(-1)?.session) return fail('pagination_session_order_invalid',undefined,pages.length);
    pages.push(result);
    token=result.pagination.nextPageToken;
    if (token===null) return {ok:true,status:pages.length===1?'captured_unvalidated':'capture_set_unvalidated',reasons:[],pages,series:pages.length===1?pages[0].series:null,capture:pages.length===1?pages[0].capture:null,pagination:{complete:true,completedPages:pages.length},responseByteLength:bytes,requiresCaptureSetReview:pages.length>1,accessVerified:false,...LIMITS};
    if (!result.series.bars.length) return fail('pagination_no_progress',undefined,pages.length);
    if (seenTokens.has(token)) return fail('pagination_token_cycle',undefined,pages.length);
    seenTokens.add(token);
  }
  return fail('pagination_page_limit',undefined,pages.length);
}
