/** Pure descriptive calculation. No source reads, orders, forecasts or approved gates. */
import {inspectMarketSnapshot} from '../market-ingestion/market-ingestion.mjs';

export const PRICE_ACTION_CONVENTION = 'five-session-close-cash-entitlements-v1';
export const PRICE_ACTION_GRADE_RULE = 'absolute-and-relative-sign-neutrality-v2';
export const PRICE_ACTION_NEUTRALITY = 'return-units-neutral-band-1e-12-v1';
const ARITHMETIC_BOUNDARY_EPSILON=1e-12;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const unique=x=>[...new Set(x)];
const clone=x=>structuredClone(x);
function time(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return NaN;
  const t=Date.parse(value);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,19)===value.slice(0,19)?t:NaN;
}
function currentReview(reviews,at) {
  return Array.isArray(reviews)?[...reviews].filter(r=>object(r)&&time(r.reviewedAt)<=time(at)&&time(r.validFrom)<=time(at))
    .sort((a,b)=>time(b.reviewedAt)-time(a.reviewedAt)||time(b.validFrom)-time(a.validFrom)||b.version-a.version)[0]:null;
}
const empty=reasons=>({status:'withheld',reasons:unique(reasons),conventionVersion:PRICE_ACTION_CONVENTION,gradeRuleVersion:PRICE_ACTION_GRADE_RULE,
  reviewStatus:'not_reviewed',candidateGatePassed:false,scoreReviewPassed:false,eligibleForRanking:false,
  historicalGrade:null,internalComparison:null,expectedReturn:null,gainProbability:null,executableEntry:false,refreshConfigured:false});

function inspectLeg(leg,input,label) {
  if(!object(leg)||!object(leg.snapshot))return {reasons:[`${label}_missing`]};
  const check=leg.latestCheck;
  if(!object(check)||check.status!=='succeeded'||typeof check.runId!=='string'||!check.runId||check.snapshotId!==leg.snapshot.id
    ||!Number.isFinite(time(check.checkedAt))||time(check.checkedAt)<time(leg.snapshot.source?.ingestedAt)||time(check.checkedAt)>time(input.at))return {reasons:[`${label}_latest_check_unconfirmed`]};
  let inspection;
  try {inspection=inspectMarketSnapshot(leg.snapshot,{at:input.at,cutoffAt:input.cutoffAt,calendar:input.calendar,policy:leg.policy,rightsReviews:leg.rightsReviews,lastSuccessfulCheckAt:check.checkedAt});}
  catch{return {reasons:[`${label}_feed_inspection_failed`]};}
  if(!inspection.eligible||!inspection.internalUseAllowed)return {reasons:inspection.reasons.length?inspection.reasons.map(x=>`${label}_${x}`):[`${label}_internal_use_not_allowed`]};
  const s=leg.snapshot,started=time(s.source.requestStartedAt),finished=time(s.source.fetchedAt);
  if(!Number.isFinite(started)||started>finished)return {reasons:[`${label}_capture_request_clock_invalid`]};
  const startRight=currentReview(leg.rightsReviews,s.source.requestStartedAt);
  if(!startRight||time(startRight.expiresAt)<=started||startRight.operations?.fetch!=='allowed'||leg.rightsReviews.some(r=>r!==startRight&&time(r.reviewedAt)===time(startRight.reviewedAt)&&time(r.validFrom)===time(startRight.validFrom)&&r.operations?.fetch!==startRight.operations?.fetch))return {reasons:[`${label}_fetch_start_rights_blocked`]};
  const bars=s.bars.slice(-6);
  if(bars.length!==6||bars.some(b=>!(b.volume>0)))return {reasons:[`${label}_traded_endpoints_missing`]};
  const first=bars[0].session,last=bars.at(-1).session;
  const actionSessions=new Map(bars.slice(1).map(b=>[b.session,[]]));
  for(const action of s.actions.items)if(actionSessions.has(action.effectiveSession))actionSessions.get(action.effectiveSession).push(action);
  let shares=1,cashEntitlements=0;
  const adjustments=[];
  for(const [session,actions]of actionSessions){
    const splits=actions.filter(a=>a.type==='split'),dividends=actions.filter(a=>a.type==='cash_dividend');
    if(splits.length>1)return {reasons:[`${label}_multiple_splits_same_session`]};
    if(splits.length&&dividends.some(a=>a.perShareBasis!=='post_split'))return {reasons:[`${label}_same_day_distribution_basis_ambiguous`]};
    for(const dividend of dividends)if(dividend.perShareBasis!==undefined&&dividend.perShareBasis!=='post_split')return {reasons:[`${label}_distribution_basis_unsupported`]};
    if(splits.length){shares*=splits[0].splitRatio;adjustments.push({actionId:splits[0].id,session,type:'split',splitRatio:splits[0].splitRatio});}
    if(!Number.isFinite(shares)||shares<=0)return {reasons:[`${label}_action_arithmetic_invalid`]};
    for(const dividend of dividends){
      cashEntitlements+=shares*dividend.cashPerShare;
      adjustments.push({actionId:dividend.id,session,type:'cash_dividend',cashPerShare:dividend.cashPerShare,perShareBasis:dividend.perShareBasis??'current_shares_no_same_day_split'});
    }
    if(!Number.isFinite(cashEntitlements)||cashEntitlements<0)return {reasons:[`${label}_action_arithmetic_invalid`]};
  }
  const initialValue=bars[0].close,terminalEquityValue=shares*bars.at(-1).close,terminalValue=terminalEquityValue+cashEntitlements;
  const historicalReturn=(terminalValue-initialValue)/initialValue;
  if(!Number.isFinite(terminalEquityValue)||terminalEquityValue<=0||!Number.isFinite(terminalValue)||!Number.isFinite(historicalReturn))return {reasons:[`${label}_action_arithmetic_invalid`]};
  const right=currentReview(leg.rightsReviews,input.at);
  return {reasons:[],bars,first,last,historicalReturn,initialValue,terminalEquityValue,cashEntitlements,shares,adjustments,
    derivedDisplayAllowed:inspection.derivedDisplayAllowed,lineage:{snapshotId:s.id,securityId:leg.policy.securityId,providerId:leg.policy.providerId,datasetId:leg.policy.datasetId,
      priceHash:s.source.sha256,actionsHash:s.actions.sha256,captureId:s.source.captureId??null,requestStartedAt:s.source.requestStartedAt,
      lastCheckRunId:check.runId,lastSuccessfulCheckAt:check.checkedAt,
      availabilityObservedAt:s.source.availabilityObservedAt??null,publishedAt:s.source.publishedAt,publicationPrecision:s.source.publicationPrecision??'exact',
      correctionPossible:s.source.correctionPossible??true,rightsReviewId:right?.id??null,rightsReviewVersion:right?.version??null}};
}

/**
 * Internal result, including numeric descriptive returns, must remain private.
 * One notional share is held from initial close through five later closes.
 * Splits alter shares; ex-date cash entitlements are held without reinvestment.
 * No payment receipt, executable fill, prospective entry or future gain is asserted.
 */
export function calculatePriceActionDraft(input={}) {
  if(!object(input)||!Number.isFinite(time(input.at))||!Number.isFinite(time(input.cutoffAt))||time(input.cutoffAt)>time(input.at))return empty(['operation_time_invalid']);
  if(input.conventionVersion!==PRICE_ACTION_CONVENTION)return empty(['explicit_action_convention_required']);
  if(typeof input.toleranceBps!=='number'||!Number.isFinite(input.toleranceBps)||input.toleranceBps<0||input.toleranceBps>100)return empty(['declared_tolerance_invalid']);
  const target=inspectLeg(input.target,input,'target'),benchmark=inspectLeg(input.benchmark,input,'benchmark');
  if(target.reasons.length||benchmark.reasons.length)return empty([...target.reasons,...benchmark.reasons]);
  if(input.target.policy.securityId===input.benchmark.policy.securityId)return empty(['benchmark_must_be_distinct']);
  if(input.target.policy.currency!==input.benchmark.policy.currency)return empty(['benchmark_currency_mismatch']);
  const targetSessions=target.bars.map(b=>b.session),benchmarkSessions=benchmark.bars.map(b=>b.session);
  if(targetSessions.some((s,i)=>s!==benchmarkSessions[i]))return empty(['benchmark_endpoints_mismatch']);
  const completed=input.calendar.sessions.filter(s=>time(s.closeAt)<=time(input.cutoffAt)).slice(-6);
  if(completed.length!==6||completed.some((s,i)=>s.date!==targetSessions[i]))return empty(['exact_completed_endpoints_required']);
  const spread=target.historicalReturn-benchmark.historicalReturn,tolerance=input.toleranceBps/10000;
  if(!Number.isFinite(spread))return empty(['comparison_arithmetic_invalid']);
  const boundary=tolerance+ARITHMETIC_BOUNDARY_EPSILON;
  // A subtraction can round an exact inclusive boundary just outside it.
  // Scale this numerical allowance to the computed returns, not price levels.
  const absoluteRoundoff=4*Number.EPSILON*Math.max(Math.abs(target.historicalReturn),boundary);
  const spreadRoundoff=4*Number.EPSILON*(Math.abs(target.historicalReturn)+Math.abs(benchmark.historicalReturn)+boundary);
  const historicalGrade=target.historicalReturn>boundary+absoluteRoundoff&&spread>boundary+spreadRoundoff?'supportive':target.historicalReturn< -boundary-absoluteRoundoff&&spread< -boundary-spreadRoundoff?'weak':'mixed';
  const window={initialSession:target.first,finalSession:target.last,initialCloseAt:completed[0].closeAt,finalCloseAt:completed.at(-1).closeAt,
    completedReturnIntervals:5,sessionEndpoints:targetSessions,entryBasis:'historical_regular_close',exitBasis:'historical_regular_close'};
  const convention={version:PRICE_ACTION_CONVENTION,initialShares:1,priceBasis:'unadjusted',distributions:'gross_ex_date_cash_entitlements_held_without_reinvestment',
    sameDaySplitDividendBasis:'explicit_post_split_or_withheld',initialEndpointActions:'excluded_already_reflected_in_initial_share_basis',transactionCosts:'not_modeled',taxes:'not_modeled',paymentReceipt:'not_asserted',execution:'not_asserted'};
  return {...empty([]),status:'review_required',reviewStatus:'draft_requires_independent_review',historicalGrade,
    assessedAt:input.at,cutoffAt:input.cutoffAt,window,convention,toleranceBps:input.toleranceBps,
    gradeRule:{version:PRICE_ACTION_GRADE_RULE,numericalNeutralityVersion:PRICE_ACTION_NEUTRALITY,supportive:'target return and spread both exceed tolerance plus the numerical neutrality and roundoff allowances',weak:'target return and spread both fall below the negative numerical boundary and roundoff allowances',otherwise:'mixed',arithmeticBoundaryEpsilon:ARITHMETIC_BOUNDARY_EPSILON,roundoffMultiplier:4,roundoffBasis:'Number.EPSILON times return magnitude; spread uses the sum of absolute leg returns and boundary'},
    lineage:{target:target.lineage,benchmark:benchmark.lineage,calendarId:input.calendar.id,calendarVersion:input.calendar.version,calendarHash:input.calendar.sha256},
    derivedDisplayAllowed:target.derivedDisplayAllowed&&benchmark.derivedDisplayAllowed,
    internalComparison:{targetReturn:target.historicalReturn,benchmarkReturn:benchmark.historicalReturn,targetMinusBenchmark:spread,
      target:{initialValue:target.initialValue,terminalEquityValue:target.terminalEquityValue,cashEntitlements:target.cashEntitlements,terminalShares:target.shares,adjustments:target.adjustments},
      benchmark:{initialValue:benchmark.initialValue,terminalEquityValue:benchmark.terminalEquityValue,cashEntitlements:benchmark.cashEntitlements,terminalShares:benchmark.shares,adjustments:benchmark.adjustments}},
    interpretation:'Historical descriptive comparison only; a supportive grade does not predict a gain or pass a candidate gate.'};
}

/** Recompute against current supplied source rights; never project internal prices/returns. */
export function projectPriceActionComparison(input={}) {
  const draft=calculatePriceActionDraft(input);
  const result={status:draft.status,reviewStatus:draft.reviewStatus,historicalGrade:null,reasons:draft.reasons,
    conventionVersion:PRICE_ACTION_CONVENTION,gradeRuleVersion:PRICE_ACTION_GRADE_RULE,candidateGatePassed:false,scoreReviewPassed:false,eligibleForRanking:false,
    expectedReturn:null,gainProbability:null,executableEntry:false,refreshConfigured:false};
  if(draft.status!=='review_required')return result;
  if(!draft.derivedDisplayAllowed)return {...result,status:'rights_blocked',reasons:['derived_display_rights_required_for_both_legs']};
  return {...result,historicalGrade:draft.historicalGrade,assessedAt:draft.assessedAt,window:clone(draft.window),toleranceBps:draft.toleranceBps,
    convention:clone(draft.convention),gradeRule:clone(draft.gradeRule),lineage:clone(draft.lineage),interpretation:draft.interpretation};
}
