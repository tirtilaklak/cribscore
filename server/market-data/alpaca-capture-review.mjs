/** Offline capture-to-review boundary. All authority/ledger records must come
 * from authenticated host storage, never browser JSON. Bytes/hash consistency
 * cannot authenticate the upstream source, a reviewer, or a lawful entitlement.
 * No IO, generated clocks, credentials, store writes, reader or mark approvals.
 */
import {adaptAlpacaDailyBars} from '../../dist/lib/prices.js';
import {parseAlpacaJSON} from './alpaca-json.mjs';
import {ALPACA_BARS_ENDPOINT,inspectAlpacaAuthorization,validateAlpacaDailyRequest} from './alpaca-daily.mjs';
export const ALPACA_CAPTURE_REVIEW_VERSION='alpaca_capture_review_v1';
const flags=Object.freeze({eligibleForRanking:false,paperMarksEligible:false,automaticTrading:false,displayAllowed:false,reviewedPricesReady:false});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=500&&x===x.trim()&&!/[\x00-\x1f\x7f]/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const utc=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,19)===x.slice(0,19);
const refs=x=>Array.isArray(x)&&x.length>0&&x.length<=32&&x.every(text)&&new Set(x).size===x.length;
const unavailable=reason=>Object.freeze({ok:false,status:'withheld',reasons:[reason],...flags});
const digest=async bytes=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};

// A bounded JSON-only snapshot rejects getters/toJSON/undefined and sparse arrays
// before hashing. It never executes an object's serialization hook. Object key
// order is not evidence; array order, explicit null and number types are evidence.
function canonical(value) {
  let nodes=0,size=0;
  const bounded=token=>{size+=token.length;if(size>8_000_000)throw Error('input');return token;};
  function visit(v,depth) {
    if (++nodes>120_000 || depth>40) throw Error('input');
    if(v===null||typeof v==='boolean')return bounded(String(v));
    if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))throw Error('input');return bounded(String(v));}
    if(typeof v==='string'){if(v.length>2_000_000)throw Error('input');return bounded(JSON.stringify(v));}
    if(!object(v)&&!Array.isArray(v))throw Error('input');
    const proto=Object.getPrototypeOf(v);
    if(proto!==Object.prototype&&proto!==Array.prototype&&proto!==null)throw Error('input');
    const descriptors=Object.getOwnPropertyDescriptors(v);
    if(Reflect.ownKeys(descriptors).some(k=>typeof k!=='string'||!Object.hasOwn(descriptors[k],'value')))throw Error('input');
    if(Array.isArray(v)){
      if(v.length>10_000||Object.keys(descriptors).length!==v.length+1)throw Error('input');
      const values=[];for(let i=0;i<v.length;i++){if(!Object.hasOwn(descriptors,String(i)))throw Error('input');values.push(visit(descriptors[i].value,depth+1));}
      return '['+values.join(',')+']';
    }
    return '{'+Object.keys(descriptors).sort().map(k=>bounded(JSON.stringify(k)+':')+visit(descriptors[k].value,depth+1)).join(',')+'}';
  }
  const serialized=visit(value,0);if(serialized.length>8_000_000)throw Error('input');return serialized;
}

export async function fingerprintAlpacaEnvelope(envelope) {
  try{return await digest(new TextEncoder().encode(canonical(envelope)));}catch{return null;}
}
function requestFromURL(raw) {
  try {
    const url=new URL(raw),required=['symbols','feed','timeframe','adjustment','asof','currency','start','end','limit','sort'];
    if(typeof raw!=='string'||url.href!==raw||url.origin+url.pathname!==ALPACA_BARS_ENDPOINT||url.username||url.password||url.hash||[...url.searchParams.keys()].some(k=>!required.includes(k))||required.some(k=>url.searchParams.getAll(k).length!==1)||url.searchParams.get('limit')!=='5000'||url.searchParams.get('sort')!=='asc')return null;
    const request=Object.fromEntries(required.filter(k=>!['limit','sort'].includes(k)).map(k=>[k,url.searchParams.get(k)]));
    request.symbols=request.symbols.split(',');
    if(request.symbols.length!==1||request.feed!=='sip'||request.timeframe!=='1Day'||request.adjustment!=='raw'||request.currency!=='USD')return null;
    return request;
  }catch{return null;}
}
function allowedUse(review,operation,at,ownerScope,securityId) {
  if(!object(review)||!id(review.id)||!Number.isSafeInteger(review.version)||review.version<1||review.providerId!=='alpaca'||review.datasetId!=='historical-stock-bars'||review.ownerScope!==ownerScope||review.audience!=='owner_private'||review.purpose!=='market_data_research'||!Array.isArray(review.securityIds)||review.securityIds.length!==1||review.securityIds[0]!==securityId||!Array.isArray(review.urls)||review.urls.length!==1||review.urls[0]!==ALPACA_BARS_ENDPOINT)return false;
  if(![review.reviewedAt,review.validFrom,review.expiresAt].every(utc)||Date.parse(review.reviewedAt)>Date.parse(review.validFrom)||Date.parse(review.validFrom)>Date.parse(at)||Date.parse(at)>=Date.parse(review.expiresAt)||review.operations?.[operation]!=='allowed')return false;
  return Array.isArray(review.termsEvidence)&&review.termsEvidence.length>0&&review.termsEvidence.length<=32&&review.termsEvidence.every(e=>{
    if(!object(e)||!hash(e.sha256)||!utc(e.observedAt)||Date.parse(e.observedAt)>Date.parse(review.reviewedAt))return false;
    try{const u=new URL(e.url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search;}catch{return false;}
  });
}

/** Returns a private draft only after exact retained bytes and host receipt agree.
 * The non-enumerable privateDraft avoids accidentally serializing prices into a
 * status response. It is a deliberate property, not an access-control boundary.
 * Multi-page capture sets must wait for a separate retained-set ledger contract.
 */
export async function prepareAlpacaCaptureReview({envelope,retainedBytes,ingestionRecord,authorization,retentionReview,processingReview,ownerScope,at,cutoffAt}={}) {
  if(!utc(at)||!utc(cutoffAt)||Date.parse(cutoffAt)>Date.parse(at)||!text(ownerScope))return unavailable('review_scope_or_clock_invalid');
  if(!(retainedBytes instanceof Uint8Array)||retainedBytes.byteLength<1||retainedBytes.byteLength>2_000_000)return unavailable('retained_bytes_required');
  let e,r,a,retention,processing,serialized,bytes;
  try {
    serialized=canonical(envelope);e=JSON.parse(serialized);r=JSON.parse(canonical(ingestionRecord));a=JSON.parse(canonical(authorization));retention=JSON.parse(canonical(retentionReview));processing=JSON.parse(canonical(processingReview));bytes=new Uint8Array(retainedBytes);
  }catch{return unavailable('review_input_invalid');}
  if (![e,r,a,retention,processing].every(object)) return unavailable('review_input_invalid');
  const c=e.capture,s=e.series;
  if(e.ok!==true||e.status!=='captured_unvalidated'||!object(c)||!object(s)||Object.keys(flags).filter(k=>!['displayAllowed','reviewedPricesReady'].includes(k)).some(k=>e[k]!==false)||e.accessVerified!==false||c.provider!=='alpaca'||c.dataset!=='historical-stock-bars'||c.mode!=='authenticated_response_observed'||!['alpaca_daily_capture_v1','alpaca_daily_capture_v1.1'].includes(c.collectorVersion)||c.httpStatus!==200||!hash(c.responseSha256)||c.responseByteLength!==bytes.byteLength||c.ingestedAt!==null||c.providerPublishedAt!==null||c.publicationPrecision!=='unknown'||c.correctionPossible!==true||c.identityReconciled!==false||c.calendarCoverage!=='unverified'||c.corporateActionCoverage!=='unverified'||c.eligibleForRanking!==false||c.paperMarksEligible!==false||c.automaticTrading!==false||!text(c.authorizationReviewId)||![c.requestStartedAt,c.responseCompletedAt].every(utc)||Date.parse(c.requestStartedAt)>Date.parse(c.responseCompletedAt)||Date.parse(c.responseCompletedAt)>Date.parse(cutoffAt))return unavailable('unreviewed_transport_envelope_required');
  if(e.pagination?.complete!==true||e.pagination?.tokenFieldPresent!==true||e.pagination?.nextPageToken!==null||s.source?.paginationComplete!==true)return unavailable('single_complete_page_required');
  const request=requestFromURL(c.requestURL);
  const security=Object.fromEntries(['symbol','originalSymbol','entityId','currency','exchange','sessionTimezone'].map(k=>[k,s[k]]));
  if(!request||validateAlpacaDailyRequest(request,security,s.id,c.requestStartedAt))return unavailable('retained_request_invalid');
  if(r.state!=='accepted'||!id(r.id)||!id(r.captureId)||r.captureIdSource!=='host_ingestion_ledger'||r.ownerScope!==ownerScope||!text(r.reviewerId)||!refs(r.sourceRefs)||r.provider!==c.provider||r.dataset!==c.dataset||r.securityId!==s.entityId||r.transportSeriesId!==s.id||r.responseSha256!==c.responseSha256||r.responseByteLength!==c.responseByteLength||r.authorizationReviewId!==c.authorizationReviewId||r.requestURL!==c.requestURL||r.requestStartedAt!==c.requestStartedAt||r.responseCompletedAt!==c.responseCompletedAt||![r.storedAt,r.reviewedAt,r.ingestedAt].every(utc)||Date.parse(c.responseCompletedAt)>Date.parse(r.storedAt)||Date.parse(r.storedAt)>Date.parse(r.reviewedAt)||Date.parse(r.reviewedAt)>Date.parse(r.ingestedAt)||Date.parse(r.ingestedAt)>Date.parse(cutoffAt)||!hash(r.transportEnvelopeSha256))return unavailable('accepted_ingestion_record_required');
  if(a.reviewId!==c.authorizationReviewId)return unavailable('capture_authorization_mismatch');
  for(const operation of ['fetch','normalize'])for(const operationAt of [c.requestStartedAt,c.responseCompletedAt])if(!inspectAlpacaAuthorization(a,{at:operationAt,operation}).ok)return unavailable('capture_authorization_invalid');
  if(!allowedUse(retention,'store',r.storedAt,ownerScope,s.entityId)||!allowedUse(retention,'store',at,ownerScope,s.entityId)||!allowedUse(processing,'transform',at,ownerScope,s.entityId))return unavailable('retained_use_rights_required');
  let rawHash,envelopeHash,body;
  try { [rawHash,envelopeHash]=await Promise.all([digest(bytes),digest(new TextEncoder().encode(serialized))]);body=parseAlpacaJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch{return unavailable('retained_bytes_unparseable');}
  if(rawHash!==c.responseSha256||envelopeHash!==r.transportEnvelopeSha256)return unavailable('retained_capture_binding_mismatch');
  if(!object(body)||body.next_page_token!==null||!Object.hasOwn(body,'next_page_token'))return unavailable('single_complete_page_required');
  const adapted=adaptAlpacaDailyBars(body,{request,security,capture:{id:s.id,url:c.requestURL,requestStartedAt:c.requestStartedAt,capturedAt:c.responseCompletedAt,responseSha256:rawHash},at:cutoffAt});
  if(!adapted.series||canonical(adapted.series)!==canonical(s))return unavailable('retained_series_mismatch');
  const series=structuredClone(adapted.series);series.id=r.captureId;
  const out={ok:true,status:'review_required',reasons:[],pendingRequirements:['independent_security_identity_review','verified_exchange_calendar','complete_corporate_action_capture_and_review','paper_source_use_review','publication_and_intent_before_entry','equivalent_benchmark_evidence'],...flags};
  Object.defineProperty(out,'privateDraft',{enumerable:false,writable:false,configurable:false,value:freeze({
    series,review:null,
    lineage:{version:ALPACA_CAPTURE_REVIEW_VERSION,hostIngestionRecordId:r.id,hostCaptureId:r.captureId,transportSeriesId:s.id,ownerScope,responseSha256:rawHash,responseByteLength:bytes.byteLength,transportEnvelopeSha256:envelopeHash,requestURL:c.requestURL,requestStartedAt:c.requestStartedAt,responseCompletedAt:c.responseCompletedAt,storedAt:r.storedAt,ingestedAt:r.ingestedAt,ingestionReviewedAt:r.reviewedAt,cutoffAt,preparedAt:at,authorizationReviewId:a.reviewId,retentionReviewId:retention.id,processingReviewId:processing.id,rawBytesReverifiedHere:true,sourceAuthenticity:'trusted_host_records_not_independently_authenticated',providerPublishedAt:null,publicationPrecision:'unknown',correctionPossible:true},
    requiredPaperReviewBindings:{seriesId:series.id,symbol:series.symbol,entityId:series.entityId,currency:series.currency,sessionTimezone:series.sessionTimezone,provider:series.source.provider,dataset:series.source.dataset,sourceUrl:series.source.url,capturedAt:series.source.capturedAt,responseSha256:series.source.responseSha256,priceBasis:series.priceBasis,priceSession:series.source.priceSession}
  })});
  return freeze(out);
}
