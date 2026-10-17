// Offline-prepared adapter. No account, token, license or activation is supplied.
// Server/job use only: never import into the public static bundle.
import {createHash} from 'node:crypto';
export const TIINGO_EOD_DOCS = 'https://www.tiingo.com/documentation/end-of-day';
export const TIINGO_TERMS = 'https://app.tiingo.com/tos/';
export const TIINGO_TERMS_VERSION = '2026-10-06';
const utc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19)===value.slice(0,19);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && utc(value+'T00:00:00Z');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const blocked = reason => ({ok:false,status:'unavailable',reasons:[reason],data:null});
const textPresent = value => typeof value==='string' && !!value.trim();
const currentWindow = (from,until,at) => utc(from) && utc(until) && Date.parse(from)<=Date.parse(at) && Date.parse(until)>Date.parse(at);
const operations = ['fetch','persist_source','persist_derived','display_derived'];

// This is a trusted server review record, never an assertion accepted from a UI request.
// A successful check authorizes one operation at `at`; callers recheck immediately before each side effect.
export function inspectFeedAuthorization(review, {at, operation='fetch', output}={}) {
  if (!operations.includes(operation)) return blocked('operation_not_supported');
  if (!utc(at) || !review || review.provider!=='tiingo' || review.dataset!=='eod' || review.approved!==true) return blocked('authorization_missing');
  if (!currentWindow(review.reviewedAt,review.expiresAt,at)) return blocked('authorization_stale');
  if (!Array.isArray(review.operations) || review.operations.some(value=>!operations.includes(value)) || !review.operations.includes(operation)) return blocked('operation_not_authorized');
  if (review.termsURL!==TIINGO_TERMS || review.termsVersion!==TIINGO_TERMS_VERSION || !textPresent(review.reviewId) || review.supplementalTermsReviewed!==true) return blocked('terms_review_missing');
  const entitlement=review.entitlement;
  if (review.plan!=='power' || entitlement?.active!==true || !textPresent(entitlement.evidenceId) || !currentWindow(entitlement.verifiedAt,entitlement.expiresAt,at)) return blocked('power_entitlement_required');
  if (operation==='persist_source') {
    const retention=review.sourceRetention;
    if (retention?.mode!=='delete_on_entitlement_end' || !textPresent(retention.evidenceId) || !utc(retention.cleanupVerifiedAt) || Date.parse(retention.cleanupVerifiedAt)>Date.parse(at)) return blocked('source_retention_review_required');
  }
  if (operation==='persist_derived' || operation==='display_derived') {
    const derived=review.derivedOutputReview;
    if (derived?.approved!==true || !textPresent(derived.reviewId) || !currentWindow(derived.reviewedAt,derived.expiresAt,at) || derived.audience!=='owner_private' || derived.sourceDataAbsent!==true || derived.nonSubstitutive!==true || derived.nonReconstructible!==true) return blocked('derived_output_review_required');
    if (!textPresent(derived.schemaVersion) || !textPresent(derived.methodVersion) || output?.schemaVersion!==derived.schemaVersion || output?.methodVersion!==derived.methodVersion || !textPresent(output?.serialized) || !/^[a-f0-9]{64}$/.test(derived.sha256||'')) return blocked('derived_output_binding_invalid');
    // Review is bound to the exact UTF-8 bytes the caller may persist/deliver, not merely a method name.
    // This checks the attestation's binding; it does not prove that an algorithm is irreversible.
    if (createHash('sha256').update(output.serialized,'utf8').digest('hex')!==derived.sha256) return blocked('derived_output_changed');
  }
  return {ok:true,reasons:[]};
}

export function normalizeTiingoEod(body,{ticker,securityId,observedAt,sourceURL}={}) {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker||'') || typeof securityId!=='string' || !securityId.trim() || !utc(observedAt)) return blocked('identity_or_clock_invalid');
  if (!Array.isArray(body) || !body.length || body.length>3000) return blocked('response_shape_invalid');
  const bars=[],seen=new Set();
  for(const item of body) {
    if(!utc(item?.date) || !item.date.endsWith('T00:00:00.000Z') && !item.date.endsWith('T00:00:00Z')) return blocked('session_date_invalid');
    const date=item.date.slice(0,10);
    if(!day(date) || seen.has(date) || Date.parse(item.date)>Date.parse(observedAt)) return blocked('duplicate_or_future_session');
    seen.add(date);
    const values=['open','high','low','close','volume','adjOpen','adjHigh','adjLow','adjClose','adjVolume','divCash','splitFactor'];
    if(values.some(key=>!finite(item[key]))) return blocked('bar_field_missing');
    if(['open','high','low','close','adjOpen','adjHigh','adjLow','adjClose','splitFactor'].some(key=>item[key]<=0) || item.volume<0 || item.adjVolume<0 || item.divCash<0 || !Number.isSafeInteger(item.volume)) return blocked('bar_value_invalid');
    if(item.low>Math.min(item.open,item.close) || item.high<Math.max(item.open,item.close) || item.low>item.high || item.adjLow>Math.min(item.adjOpen,item.adjClose) || item.adjHigh<Math.max(item.adjOpen,item.adjClose) || item.adjLow>item.adjHigh) return blocked('ohlc_inconsistent');
    bars.push({sessionDate:date,raw:{open:item.open,high:item.high,low:item.low,close:item.close,volume:item.volume},adjusted:{open:item.adjOpen,high:item.adjHigh,low:item.adjLow,close:item.adjClose,volume:item.adjVolume},actions:{dividendCash:item.divCash,splitFactor:item.splitFactor}});
  }
  bars.sort((a,b)=>a.sessionDate.localeCompare(b.sessionDate));
  return {ok:true,status:'captured_unvalidated',reasons:[],data:{provider:'tiingo',dataset:'eod',ticker,securityId,observedAt,sourceURL,bars,asOfSessionDate:bars.at(-1).sessionDate,delay:'end_of_day',quoteTimestamp:null,identityReconciled:false,calendarCoverage:'unverified',corporateActionCoverage:'unverified',eligibleForRanking:false}};
}

export async function fetchTiingoEod({ticker,securityId,startDate,endDate,token,authorization,at,fetchImpl=fetch,clock=()=>new Date().toISOString()}={}) {
  const startedAt=clock();
  if(!utc(startedAt) || !utc(at) || Date.parse(startedAt)<Date.parse(at))return blocked('operation_clock_invalid');
  const auth=inspectFeedAuthorization(authorization,{at:startedAt,operation:'fetch'});
  if(!auth.ok)return auth;
  if(typeof token!=='string' || !token.trim())return blocked('credential_unavailable');
  if(!/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker||'') || !day(startDate) || !day(endDate) || startDate>endDate || endDate>at.slice(0,10))return blocked('request_scope_invalid');
  const url=new URL('https://api.tiingo.com/tiingo/daily/'+encodeURIComponent(ticker)+'/prices');
  url.searchParams.set('startDate',startDate);url.searchParams.set('endDate',endDate);url.searchParams.set('format','json');url.searchParams.set('resampleFreq','daily');
  // The token is never placed in a URL, returned payload, log, file, or thrown error.
  let response;
  try {response=await fetchImpl(url.href,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Authorization:'Token '+token,Accept:'application/json'}});} catch{return blocked('transport_failed_no_retry');}
  if(response.status===429)return blocked('rate_limited_no_retry');
  if(!response.ok)return blocked('http_failed_no_retry');
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))return blocked('content_type_invalid');
  const size=Number(response.headers.get('content-length'));
  if(Number.isFinite(size)&&size>2000000)return blocked('response_too_large');
  // Preserve exact response bytes. Decoded/re-encoded text is not a source-byte hash.
  let bytes;
  try {
    const reader=response.body?.getReader();
    if(!reader)return blocked('response_body_unavailable');
    const chunks=[];let total=0;
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>2000000){await reader.cancel();return blocked('response_too_large');}chunks.push(value);}
    bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  }catch{return blocked('response_read_failed');}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return blocked('response_json_invalid');}
  const observedAt=clock();
  if(!utc(observedAt) || Date.parse(observedAt)<Date.parse(startedAt))return blocked('observation_clock_invalid');
  const current=inspectFeedAuthorization(authorization,{at:observedAt,operation:'fetch'});
  if(!current.ok)return current;
  if(Array.isArray(body)&&body.some(item=>typeof item?.date!=='string' || item.date.slice(0,10)<startDate || item.date.slice(0,10)>endDate))return blocked('bar_outside_request');
  const normalized=normalizeTiingoEod(body,{ticker,securityId,observedAt,sourceURL:url.href});
  if(!normalized.ok)return normalized;
  // Private in-memory provenance. Never serialize this ingestion envelope to the Site.
  return {...normalized,capture:{provider:'tiingo',dataset:'eod',mode:'authenticated_response_observed',
    requestURL:url.href,requestStartedAt:startedAt,responseCompletedAt:observedAt,
    responseSha256:createHash('sha256').update(bytes).digest('hex'),responseByteLength:bytes.byteLength,
    authorizationReviewId:authorization.reviewId,collectorVersion:'tiingo_eod_capture_v1',
    httpStatus:response.status,providerPublishedAt:null,publicationPrecision:'unknown',correctionPossible:true,
    ingestedAt:null,eligibleForRanking:false}};

}
