import {fixture} from '../../market-ingestion/tests/fixtures.mjs';
import {PRICE_ACTION_CONVENTION} from '../price-action.mjs';

export function priceActionFixture() {
  const f=fixture();
  const leg=(kind)=>{
    const copy=structuredClone(f),securityId=`SYNTHETIC-${kind}`,cik=kind==='target'?'0000000001':'0000000002';
    copy.options.policy.securityId=securityId;copy.options.policy.cik=cik;
    copy.snapshot.id=`SYNTHETIC-${kind}-snapshot`;
    copy.snapshot.security.id=securityId;copy.snapshot.security.cik=cik;
    copy.snapshot.actions.securityId=securityId;
    Object.assign(copy.snapshot.source,{requestStartedAt:'2026-10-17T09:59:30Z',captureId:`SYNTHETIC-${kind}-capture`,requestURL:copy.options.policy.sourceUrl+'?startDate=2026-01-01',availabilityMode:'observed_capture',availabilityObservedAt:copy.snapshot.source.fetchedAt,publishedAt:null,publicationPrecision:'unknown',correctionPossible:true});
    for(const b of copy.snapshot.bars)Object.assign(b,{securityId,open:100,high:101,low:99,close:100,providerPublishedAt:null,availabilityObservedAt:copy.snapshot.source.fetchedAt,status:'as_observed'});
    copy.review.securityIds=[securityId];
    return {snapshot:copy.snapshot,policy:copy.options.policy,rightsReviews:copy.options.rightsReviews,latestCheck:{runId:`SYNTHETIC-${kind}-check`,snapshotId:copy.snapshot.id,status:'succeeded',checkedAt:'2026-10-17T10:01:00Z'}};
  };
  return {at:f.options.at,cutoffAt:f.options.cutoffAt,calendar:f.options.calendar,conventionVersion:PRICE_ACTION_CONVENTION,toleranceBps:10,target:leg('target'),benchmark:leg('benchmark')};
}
export function price(bar,close) {Object.assign(bar,{open:close,close,high:close*1.01,low:close*.99});}
export function action(leg,type,session,fields={}) {return {id:`SYNTHETIC-${type}-${session}`,securityId:leg.policy.securityId,type,effectiveSession:session,...fields};}
