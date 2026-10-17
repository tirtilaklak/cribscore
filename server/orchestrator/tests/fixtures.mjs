// WHOLLY SYNTHETIC. Only in-memory Responses; no real request or permission.
import {bridgeFixture} from '../../bridge/fixtures.mjs';
import {fetchTiingoEod,TIINGO_TERMS,TIINGO_TERMS_VERSION} from '../../market-data/tiingo-eod.mjs';
import {fingerprintTransportEnvelope,RESEARCH_SIGN_POLICY} from '../pipeline.mjs';
import {PRICE_ACTION_CONVENTION,PRICE_ACTION_GRADE_RULE,PRICE_ACTION_NEUTRALITY} from '../../price-action/price-action.mjs';
export async function pipelineFixture({etfBenchmark=false,targetLast=100,benchmarkLast=100,sameDayActions=false}={}){
 const make=async(role,last,etf)=>{
  const f=bridgeFixture(),o=f.options,securityId=`SYNTHETIC-${role}`,ticker=role==='candidate'?'SYNTARGET':'SYNBENCH',sourceUrl=`https://api.tiingo.com/tiingo/daily/${ticker}/prices`;
  Object.assign(o.policy,{securityId,cik:role==='candidate'?'0000000001':'0000000002',sourceUrl,actionsUrl:sourceUrl,instrumentType:etf?'etf':'common_equity',usage:role});
  for(const key of ['identityReview','basisReview','actionsReview']){o[key].securityId=securityId;o[key].id=`SYNTHETIC-${role}-${key}`;}
  Object.assign(o.identityReview.security,{id:securityId,ticker,cik:o.policy.cik,instrumentType:o.policy.instrumentType});
  Object.assign(o.rightsReviews[0],{securityIds:[securityId],urls:[sourceUrl]});
  const body=f.body.map((b,i)=>({...b,open:i===59?last:100,high:(i===59?last:100)*1.01,low:(i===59?last:100)*.99,close:i===59?last:100,adjOpen:100,adjHigh:101,adjLow:99,adjClose:100}));
  if(sameDayActions&&role==='candidate'){
   body.at(-1).splitFactor=2;body.at(-1).divCash=.5;
   o.actionsReview.sameDayDistributionShareBasisBySession={[body.at(-1).date.slice(0,10)]:'post_split'};
  }
  const authorization={provider:'tiingo',dataset:'eod',plan:'power',approved:true,reviewedAt:'2026-10-01T08:00:00Z',expiresAt:'2026-10-24T00:00:00Z',operations:['fetch'],reviewId:`SYNTHETIC ${role} transport review`,termsURL:TIINGO_TERMS,termsVersion:TIINGO_TERMS_VERSION,supplementalTermsReviewed:true,entitlement:{active:true,verifiedAt:'2026-10-01T08:00:00Z',expiresAt:'2026-10-24T00:00:00Z',evidenceId:'SYNTHETIC-NOT-REAL'}};
  const started='2026-10-17T09:59:58.123Z',completed='2026-10-17T10:00:00.456Z',bytes=new TextEncoder().encode('\ufeff '+JSON.stringify(body)+'\n');let ticks=0;
  const transport=await fetchTiingoEod({ticker,securityId,startDate:body[0].date.slice(0,10),endDate:body.at(-1).date.slice(0,10),authorization,at:started,token:'SYNTHETIC-NOT-A-CREDENTIAL',clock:()=>ticks++?completed:started,fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'application/json'}})});
  if(!transport.ok)throw new Error('synthetic_transport_failed');
  for(const key of ['identityReview','basisReview','actionsReview'])o[key].responseSha256=transport.capture.responseSha256;
  const ingestionRecord={id:`SYNTHETIC-${role}-ingestion`,state:'accepted',captureId:`SYNTHETIC-${role}-capture`,captureIdSource:'host_ingestion_ledger',reviewerId:'SYNTHETIC-host-reviewer',sourceRefs:['SYNTHETIC-host-receipt'],reviewedAt:'2026-10-17T10:01:00Z',ingestedAt:'2026-10-17T10:02:00Z',provider:'tiingo',dataset:'eod',securityId,responseSha256:transport.capture.responseSha256,authorizationReviewId:authorization.reviewId,requestURL:transport.capture.requestURL,requestStartedAt:started,responseCompletedAt:completed,transportEnvelopeSha256:fingerprintTransportEnvelope(transport)};
  return {calendar:o.calendar,transport,ingestionRecord,authorization,policy:o.policy,rightsReviews:o.rightsReviews,identityReview:o.identityReview,basisReview:o.basisReview,actionsReview:o.actionsReview,latestCheck:{runId:`SYNTHETIC-${role}-check`,snapshotId:ingestionRecord.captureId,status:'succeeded',checkedAt:'2026-10-17T10:03:00Z'}};
 };
 const target=await make('candidate',targetLast,false),benchmark=await make('benchmark',benchmarkLast,etfBenchmark),calendar=target.calendar;delete target.calendar;delete benchmark.calendar;
 return {runId:'SYNTHETIC-pair-run',expectedRevision:0,at:'2026-10-17T12:00:00Z',cutoffAt:'2026-10-17T11:00:00Z',calendar,target,benchmark,conventionVersion:PRICE_ACTION_CONVENTION,gradeRuleVersion:PRICE_ACTION_GRADE_RULE,numericalNeutralityVersion:PRICE_ACTION_NEUTRALITY,signPolicyVersion:RESEARCH_SIGN_POLICY,toleranceBps:0};
}
export function reseal(leg){leg.ingestionRecord.transportEnvelopeSha256=fingerprintTransportEnvelope(leg.transport);}
