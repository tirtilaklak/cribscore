/** Server-only pure proposal: no fetch, persistence, scheduler or delivery. */
import {createHash} from 'node:crypto';
import {inspectFeedAuthorization} from '../market-data/tiingo-eod.mjs';
import {bridgeTiingoCapturedEnvelope} from '../bridge/tiingo-observed-bridge.mjs';
import {inspectMarketSnapshot} from '../market-ingestion/market-ingestion.mjs';
import {calculatePriceActionDraft,projectPriceActionComparison,PRICE_ACTION_CONVENTION,PRICE_ACTION_GRADE_RULE,PRICE_ACTION_NEUTRALITY} from '../price-action/price-action.mjs';

export const PIPELINE_VERSION='observed-pair-orchestrator-proposal-v1';
export const RESEARCH_SIGN_POLICY='research-score-price-action-zero-neutrality-v1';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function time(x){if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x))return NaN;const n=Date.parse(x);return Number.isFinite(n)&&new Date(n).toISOString().slice(0,19)===x.slice(0,19)?n:NaN;}
function normalize(x){
 if(x===null||typeof x==='string'||typeof x==='boolean')return x;
 if(typeof x==='number'&&Number.isFinite(x))return x;
 if(Array.isArray(x))return x.map(normalize);
 if(object(x)&&Object.getPrototypeOf(x)===Object.prototype)return Object.fromEntries(Object.keys(x).sort().map(k=>[k,normalize(x[k])]));
 throw new TypeError('plain_json_required');
}
const digest=x=>createHash('sha256').update(JSON.stringify(normalize(x))).digest('hex');
function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;}
const copy=x=>structuredClone(x);
const flags={candidateGatePassed:false,scoreReviewPassed:false,eligibleForRanking:false,expectedReturn:null,gainProbability:null,sourceStoreEnabled:false,derivedStoreEnabled:false,refreshConfigured:false,deliveryAuthorized:false};
const rounding={arithmeticBoundaryEpsilon:1e-12,roundoffMultiplier:4,roundoffBasis:'Number.EPSILON times return magnitude; spread uses the sum of absolute leg returns and boundary'};
export const emptyReceiptLedger=()=>freeze({version:PIPELINE_VERSION,revision:0,events:[]});
/** Host seals this at handoff; this is NOT the hash of the original response bytes. */
export const fingerprintTransportEnvelope=envelope=>digest(envelope);

function validLedger(ledger){
 if(!object(ledger)||ledger.version!==PIPELINE_VERSION||!Number.isSafeInteger(ledger.revision)||ledger.revision<0||!Array.isArray(ledger.events)||ledger.events.length!==ledger.revision)return false;
 let previous=null,previousAt=-Infinity;const runs=new Set();
 for(let i=0;i<ledger.events.length;i++){
  const e=ledger.events[i];
  if(!object(e)||e.version!==PIPELINE_VERSION||e.sequence!==i+1||!id(e.runId)||runs.has(e.runId)||!hash(e.inputSha256)||!hash(e.receiptSha256)||e.previousReceiptSha256!==previous||!Number.isFinite(time(e.evaluatedAt))||time(e.evaluatedAt)<previousAt||!['accepted_for_private_review','rejected'].includes(e.decision))return false;
  const {receiptSha256,...content}=e;if(digest(content)!==receiptSha256)return false;
  previous=e.receiptSha256;previousAt=time(e.evaluatedAt);runs.add(e.runId);
 }
 return true;
}
function receipt(ledger,event,inputSha256,reasons,captures=[],recorded=true){
 const content={version:PIPELINE_VERSION,sequence:recorded?ledger.revision+1:null,runId:id(event?.runId)?event.runId:null,
  decision:reasons.length?'rejected':'accepted_for_private_review',reasons:[...new Set(reasons)],evaluatedAt:Number.isFinite(time(event?.at))?event.at:null,
  cutoffAt:Number.isFinite(time(event?.cutoffAt))?event.cutoffAt:null,inputSha256,
  previousReceiptSha256:ledger.events.at(-1)?.receiptSha256??null,captures,
  meaning:'historical private calculation review only',...flags};
 return {...content,receiptSha256:digest(content)};
}
function result(ledger,receipt,recorded,privateResult=null,reviewProjection=null,status){
 const out={version:PIPELINE_VERSION,status:status??(receipt.decision==='rejected'?'rejected':'accepted_review_draft'),accepted:status?false:receipt.decision==='accepted_for_private_review',recorded,receipt,ledger,reviewProjection,...flags};
 // Prevent an accidental JSON.stringify(result) from exposing numeric returns.
 Object.defineProperty(out,'privateResult',{value:freeze(privateResult),enumerable:false,writable:false,configurable:false});
 return freeze(out);
}
function operationReview(reviews,operation,at){
 const applicable=reviews.filter(r=>time(r.reviewedAt)<=time(at)&&time(r.validFrom)<=time(at)).sort((a,b)=>time(b.reviewedAt)-time(a.reviewedAt)||time(b.validFrom)-time(a.validFrom)||b.version-a.version),r=applicable[0];
 if(!r||time(r.expiresAt)<=time(at)||r.operations?.[operation]!=='allowed'||applicable.slice(1).some(other=>time(other.reviewedAt)===time(r.reviewedAt)&&time(other.validFrom)===time(r.validFrom)&&other.operations?.[operation]!==r.operations?.[operation]))return null;
 return {operation,at,reviewId:r.id,version:r.version};
}
function inspectLeg(leg,event,usage){
 const fail=(...reasons)=>({reasons:reasons.map(r=>`${usage}_${r}`)});
 if(!object(leg)||!object(leg.transport)||!object(leg.ingestionRecord))return fail('capture_input_required');
 const envelope=leg.transport,c=envelope.capture,record=leg.ingestionRecord;
 if(envelope.ok!==true||envelope.status!=='captured_unvalidated')return fail('transport_not_successful');
 if(!hash(record.transportEnvelopeSha256)||record.transportEnvelopeSha256!==fingerprintTransportEnvelope(envelope))return fail('transport_receipt_binding_invalid');
 if(!object(c)||c.authorizationReviewId!==leg.authorization?.reviewId)return fail('authorization_binding_invalid');
 for(const clock of[c.requestStartedAt,c.responseCompletedAt]){
  const check=inspectFeedAuthorization(leg.authorization,{at:clock,operation:'fetch'});
  if(!check.ok)return fail(...check.reasons);
 }
 const bridged=bridgeTiingoCapturedEnvelope(envelope,{ingestionRecord:record,usage,policy:leg.policy,calendar:event.calendar,
  identityReview:leg.identityReview,basisReview:leg.basisReview,actionsReview:leg.actionsReview,at:event.at,cutoffAt:event.cutoffAt});
 if(!bridged.ok)return fail(...bridged.reasons);
 const check=leg.latestCheck;
 if(!object(check)||!id(check.runId)||check.status!=='succeeded'||check.snapshotId!==record.captureId||!Number.isFinite(time(check.checkedAt))||time(check.checkedAt)<time(record.ingestedAt)||time(check.checkedAt)>time(event.at))return fail('latest_check_unconfirmed');
 const options={at:event.at,cutoffAt:event.cutoffAt,calendar:event.calendar,policy:leg.policy,rightsReviews:leg.rightsReviews,lastSuccessfulCheckAt:check.checkedAt};
 const inspected=inspectMarketSnapshot(bridged.snapshot,options);
 if(!inspected.eligible||!inspected.internalUseAllowed)return fail(...(inspected.reasons.length?inspected.reasons:['internal_use_not_allowed']));
 // Generic validation checks full audit scope. Explicitly cover request START too;
 // a later response-time review must not retroactively authorize that request.
 const operations=[['fetch',c.requestStartedAt],['fetch',c.responseCompletedAt],['store',record.ingestedAt],['transform',record.ingestedAt],['store',event.at],['transform',event.at],['derive',event.at]];
 const rights=operations.map(([operation,at])=>operationReview(leg.rightsReviews,operation,at));
 if(rights.some(r=>!r))return fail('operation_time_rights_blocked');
 return {reasons:[],calculatorLeg:{snapshot:bridged.snapshot,policy:leg.policy,rightsReviews:leg.rightsReviews,latestCheck:check},
  lineage:{usage,captureId:record.captureId,hostIngestionRecordId:record.id,transportEnvelopeSha256:record.transportEnvelopeSha256,
   responseSha256:c.responseSha256,responseByteLength:c.responseByteLength,requestURL:c.requestURL,requestStartedAt:c.requestStartedAt,responseCompletedAt:c.responseCompletedAt,
   ingestedAt:record.ingestedAt,collectorVersion:c.collectorVersion,authorizationReviewId:c.authorizationReviewId,
   identityReviewId:leg.identityReview.id,basisReviewId:leg.basisReview.id,actionsReviewId:leg.actionsReview.id,
   calendarId:event.calendar.id,calendarVersion:event.calendar.version,calendarSha256:event.calendar.sha256,
   providerPublishedAt:null,publicationPrecision:'unknown',correctionPossible:true,
   latestCheckRunId:check.runId,lastSuccessfulCheckAt:check.checkedAt,operationRights: rights,
   authenticityBasis:'trusted_host_transport_and_ingestion_records',rawBytesReverifiedHere:false}};
}

/** Atomic pair evaluation; only receipts are retained in the returned memory ledger.
 * An immutable recorded rejection never carries a previous successful grade.
 * All inputs are trusted-host records, not browser assertions. */
export function evaluateCapturedPair(previous,event){
 let ledger,input,inputSha256;
 try{ledger=copy(previous);if(!validLedger(ledger))throw new Error('ledger');}catch{
  const empty=emptyReceiptLedger();return result(null,receipt(empty,null,null,['receipt_ledger_invalid'],[],false),false);
 }
 try{input=copy(event);inputSha256=digest(input);}catch{return result(ledger,receipt(ledger,null,null,['event_not_plain_json'],[],false),false);}
 const reject=(reasons,recorded=false,captures=[])=>{const r=receipt(ledger,input,inputSha256,reasons,captures,recorded);return result(recorded?{...ledger,revision:ledger.revision+1,events:[...ledger.events,r]}:ledger,r,recorded);};
 if(!object(input)||!id(input.runId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!Number.isFinite(time(input.at))||!Number.isFinite(time(input.cutoffAt))||time(input.cutoffAt)>time(input.at))return reject(['event_identity_or_clock_invalid']);
 const prior=ledger.events.find(r=>r.runId===input.runId);
 if(prior)return prior.inputSha256===inputSha256?result(ledger,prior,false,null,null,'replayed_receipt_only'):reject(['run_id_conflict']);
 if(input.expectedRevision!==ledger.revision)return reject(['revision_conflict']);
 if(ledger.revision===Number.MAX_SAFE_INTEGER)return reject(['revision_exhausted']);
 if(ledger.events.some(r=>time(r.evaluatedAt)>time(input.at)))return reject(['event_clock_regression']);
 if(input.signPolicyVersion!==RESEARCH_SIGN_POLICY||input.toleranceBps!==0||input.conventionVersion!==PRICE_ACTION_CONVENTION||input.gradeRuleVersion!==PRICE_ACTION_GRADE_RULE||input.numericalNeutralityVersion!==PRICE_ACTION_NEUTRALITY)return reject(['explicit_zero_tolerance_sign_policy_required'],true);
 try{
  const target=inspectLeg(input.target,input,'candidate'),benchmark=inspectLeg(input.benchmark,input,'benchmark');
  const reasons=[...target.reasons,...benchmark.reasons],captures=[target.lineage,benchmark.lineage].filter(Boolean);
  if(reasons.length)return reject(reasons,true,captures);
  const calculation={at:input.at,cutoffAt:input.cutoffAt,calendar:input.calendar,conventionVersion:input.conventionVersion,toleranceBps:0,target:target.calculatorLeg,benchmark:benchmark.calculatorLeg};
  const draft=calculatePriceActionDraft(calculation);
  if(draft.status!=='review_required')return reject(draft.reasons,true,captures);
  const projected=projectPriceActionComparison(calculation);
  const projection={schemaVersion:'price-action-review-draft-v1',methodVersion:PRICE_ACTION_CONVENTION,signPolicyVersion:RESEARCH_SIGN_POLICY,gradeRuleVersion:PRICE_ACTION_GRADE_RULE,numericalNeutralityVersion:PRICE_ACTION_NEUTRALITY,...rounding,audience:'owner_private',status:projected.status,reviewStatus:'draft_requires_independent_review',historicalGrade:projected.historicalGrade,assessedAt:input.at,cutoffAt:input.cutoffAt,toleranceBps:0,
   ...(projected.window?{window:projected.window}:{}),reasons:projected.reasons,...flags};
  const r=receipt(ledger,input,inputSha256,[],captures,true),next={...ledger,revision:ledger.revision+1,events:[...ledger.events,r]};
  return result(next,r,true,{calculation:draft,sourceLineage:captures},projection);
 }catch{return reject(['pipeline_dependency_or_input_error'],true);}
}

/** Safe allowlist serializer for a review draft; it grants no delivery permission. */
export function serializePriceActionReview(result){
 const p=result?.reviewProjection;
 if(result?.status!=='accepted_review_draft'||!p||p.schemaVersion!=='price-action-review-draft-v1')return null;
 const out={schemaVersion:p.schemaVersion,methodVersion:p.methodVersion,signPolicyVersion:p.signPolicyVersion,gradeRuleVersion:PRICE_ACTION_GRADE_RULE,numericalNeutralityVersion:PRICE_ACTION_NEUTRALITY,...rounding,audience:'owner_private',status:p.status,reviewStatus:'draft_requires_independent_review',historicalGrade:['weak','mixed','supportive'].includes(p.historicalGrade)?p.historicalGrade:null,assessedAt:p.assessedAt,cutoffAt:p.cutoffAt,toleranceBps:0,...flags};
 if(p.window)out.window={initialSession:p.window.initialSession,finalSession:p.window.finalSession,initialCloseAt:p.window.initialCloseAt,finalCloseAt:p.window.finalCloseAt,completedReturnIntervals:5,sessionEndpoints:[...p.window.sessionEndpoints],entryBasis:'historical_regular_close',exitBasis:'historical_regular_close'};
 return JSON.stringify(out);
}
