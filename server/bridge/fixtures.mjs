// SYNTHETIC ONLY. No fixture grants permission, proves issuer facts or is served.
import {fixture as marketFixture} from '../market-ingestion/tests/fixtures.mjs';
import {normalizeTiingoEod} from '../market-data/tiingo-eod.mjs';
export function bridgeFixture() {
 const f=marketFixture(),{options}=f,p=options.policy;
 p.providerId='tiingo';p.datasetId='eod';p.sourceUrl='https://api.tiingo.com/tiingo/daily/SYNTHETIC/prices';
 p.actionsUrl=p.sourceUrl;p.actionsSourceMode='same_eod_fields_reviewed';
 const body=f.snapshot.bars.map(b=>({date:b.session+'T00:00:00.000Z',open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,
  adjOpen:b.open,adjHigh:b.high,adjLow:b.low,adjClose:b.close,adjVolume:b.volume,divCash:0,splitFactor:1}));
 const from=body[0].date.slice(0,10),to=body.at(-1).date.slice(0,10);
 const requestURL=p.sourceUrl+`?startDate=${from}&endDate=${to}&format=json&resampleFreq=daily`;
 const capture={captureId:'SYNTHETIC-capture-1',authenticated:true,collectorVersion:'SYNTHETIC-collector-1',authorizationReviewId:'SYNTHETIC-rights',
  responseSha256:'a'.repeat(64),requestURL,requestStartedAt:'2026-10-17T09:59:58Z',responseCompletedAt:'2026-10-17T10:00:00Z',ingestedAt:'2026-10-17T10:02:00Z'};
 const normalized=normalizeTiingoEod(body,{ticker:'SYNTHETIC',securityId:p.securityId,observedAt:capture.responseCompletedAt,sourceURL:requestURL});
 const common={state:'reviewed_complete',reviewerId:'SYNTHETIC-reviewer',reviewerVersion:'SYNTHETIC-rules-1',sourceRefs:['SYNTHETIC-byte-capture'],
  securityId:p.securityId,responseSha256:capture.responseSha256,coverageStart:from,coverageEnd:to,reviewedAt:'2026-10-17T10:01:00Z'};
 const identityReview={...common,id:'SYNTHETIC-identity-review',security:structuredClone(f.snapshot.security)};
 const basisReview={...common,id:'SYNTHETIC-basis-review',basis:structuredClone(f.snapshot.basis)};
 const actionsReview={...common,id:'SYNTHETIC-action-review',complete:true,unsupportedActionsReviewed:true,unsupportedActionsPresent:false,
  coveredSessions:body.map(b=>b.date.slice(0,10)),splitFactorBasis:'new_shares_per_old_share',dividendCashBasis:'USD_per_share_ex_date'};
 Object.assign(options.calendar,{state:'reviewed_complete',reviewed_at:'2026-10-01T08:01:00Z',reviewer_id:'SYNTHETIC-calendar-reviewer',source_refs:['SYNTHETIC-calendar-source']});
 options.calendar.sessions.push(...['2026-10-22','2026-10-23'].map(date=>({date,openAt:date+'T13:30:00Z',closeAt:date+'T20:00:00Z'})));
 options.calendar.validThrough='2026-10-24';
 Object.assign(options.rightsReviews[0],{providerId:'tiingo',datasetId:'eod',urls:[p.sourceUrl]});
 options.rightsReviews[0].operations.display='denied';
 return {body,normalized,options:{...options,capture,identityReview,basisReview,actionsReview},marketOptions:options};
}
