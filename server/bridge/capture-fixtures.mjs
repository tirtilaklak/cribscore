// Entirely synthetic. The transport uses an injected in-memory Response; no
// network, real credential, entitlement, issuer review or persisted source.
import {bridgeFixture} from './fixtures.mjs';
import {fetchTiingoEod,TIINGO_TERMS,TIINGO_TERMS_VERSION} from '../market-data/tiingo-eod.mjs';
export async function capturedFixture({sameDayActions=false,etf=false}={}) {
 const f=bridgeFixture(),o=f.options;
 delete o.capture;
 const id=etf?'SYNTHETIC-ETF-benchmark':'SYNTHETIC-common-target',ticker=etf?'SYNBENCH':'SYNTHETIC';
 o.policy.securityId=id;o.policy.instrumentType=etf?'etf':'common_equity';o.policy.usage=etf?'benchmark':'candidate';o.usage=o.policy.usage;
 o.policy.sourceUrl=`https://api.tiingo.com/tiingo/daily/${ticker}/prices`;o.policy.actionsUrl=o.policy.sourceUrl;
 for(const key of ['identityReview','basisReview','actionsReview'])o[key].securityId=id;
 Object.assign(o.identityReview.security,{id,ticker,instrumentType:o.policy.instrumentType});
 o.rightsReviews[0].securityIds=[id];o.rightsReviews[0].urls=[o.policy.sourceUrl];
 if(sameDayActions){const b=f.body.at(-1);b.splitFactor=2;b.divCash=0.5;o.actionsReview.sameDayDistributionShareBasisBySession={[b.date.slice(0,10)]:'post_split'};}
 const started='2026-10-17T09:59:58.123Z',completed='2026-10-17T10:00:00.456Z';
 const authorization={provider:'tiingo',dataset:'eod',plan:'power',approved:true,reviewedAt:'2026-10-01T08:00:00Z',expiresAt:'2026-10-24T00:00:00Z',operations:['fetch'],reviewId:'SYNTHETIC transport review',termsURL:TIINGO_TERMS,termsVersion:TIINGO_TERMS_VERSION,supplementalTermsReviewed:true,entitlement:{active:true,verifiedAt:'2026-10-01T08:00:00Z',expiresAt:'2026-10-24T00:00:00Z',evidenceId:'SYNTHETIC-NOT-ACTUAL'}};
 let clockCalls=0,fetchCalls=0;
 const bytes=new TextEncoder().encode('\ufeff '+JSON.stringify(f.body)+'\n');
 const envelope=await fetchTiingoEod({ticker,securityId:id,startDate:f.body[0].date.slice(0,10),endDate:f.body.at(-1).date.slice(0,10),
  token:'SYNTHETIC-ONLY-NOT-A-CREDENTIAL',authorization,at:started,clock:()=>clockCalls++?completed:started,
  fetchImpl:async()=>{fetchCalls++;return new Response(bytes,{headers:{'content-type':'application/json'}});}});
 if(!envelope.ok)throw new Error(JSON.stringify(envelope));
 for(const key of ['identityReview','basisReview','actionsReview'])o[key].responseSha256=envelope.capture.responseSha256;
 o.ingestionRecord={id:etf?'SYNTHETIC-etf-ingestion':'SYNTHETIC-target-ingestion',state:'accepted',captureId:etf?'SYNTHETIC-assigned-etf-capture':'SYNTHETIC-assigned-target-capture',captureIdSource:'host_ingestion_ledger',
  reviewerId:'SYNTHETIC-ingestion-reviewer',sourceRefs:['SYNTHETIC-private-host-receipt'],reviewedAt:'2026-10-17T10:01:00Z',ingestedAt:'2026-10-17T10:02:00Z',
  provider:'tiingo',dataset:'eod',securityId:id,responseSha256:envelope.capture.responseSha256,authorizationReviewId:envelope.capture.authorizationReviewId,
  requestURL:envelope.capture.requestURL,requestStartedAt:started,responseCompletedAt:completed};
 return {envelope,options:o,bytes,fetchCalls};
}
