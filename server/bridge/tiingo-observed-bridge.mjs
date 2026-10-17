/** Server-only pure proposal. Reviews and capture records are trusted host inputs,
 * not facts established by JSON validation. No network, persistence or ranking. */
export const BRIDGE_VERSION = 'tiingo_observed_bridge_v2';
const text = x => typeof x === 'string' && x.trim().length > 0;
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const refs = x => Array.isArray(x) && x.length > 0 && x.every(text) && new Set(x).size === x.length;
const day = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x+'T00:00:00Z')) && new Date(x+'T00:00:00Z').toISOString().slice(0,10) === x;
const time = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x) && day(x.slice(0,10)) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,19) === x.slice(0,19) ? Date.parse(x) : NaN;
const validTime = x => Number.isFinite(time(x));
const same = (a,b) => Number.isFinite(time(a)) && time(a) === time(b);
const interval = (r,from,to) => day(r?.coverageStart) && day(r?.coverageEnd) && r.coverageStart <= from && r.coverageEnd >= to;
const sameStrings = (a,b) => Array.isArray(a) && a.length === b.length && a.every((x,i)=>x===b[i]);
function reviewValid(r,capture,policy,from,to) {
 return r?.state === 'reviewed_complete' && id(r.id) && text(r.reviewerId) && id(r.reviewerVersion) && refs(r.sourceRefs)
  && r.securityId === policy.securityId && r.responseSha256 === capture.responseSha256
  && interval(r,from,to) && validTime(r.reviewedAt) && time(r.reviewedAt) >= time(capture.responseCompletedAt)
  && time(r.reviewedAt) <= time(capture.ingestedAt);
}
function safeRequest(value,ticker) {
 try {
  const u = new URL(value), allowed = ['startDate','endDate','format','resampleFreq'];
  if (u.origin !== 'https://api.tiingo.com' || u.pathname !== `/tiingo/daily/${encodeURIComponent(ticker)}/prices`
   || u.username || u.password || u.hash || [...u.searchParams.keys()].some(k=>!allowed.includes(k))
   || allowed.some(k=>u.searchParams.getAll(k).length!==1) || u.searchParams.get('format')!=='json'
   || u.searchParams.get('resampleFreq')!=='daily' || !day(u.searchParams.get('startDate'))
   || !day(u.searchParams.get('endDate')) || u.searchParams.get('startDate') > u.searchParams.get('endDate')) return null;
  return {canonical:u.origin+u.pathname,start:u.searchParams.get('startDate'),end:u.searchParams.get('endDate')};
 } catch { return null; }
}
/** Returns a candidate snapshot, never a passed gate or eligible ranking row.
 * Input capture hash must be computed over exact response bytes by the collector.
 * ingestedAt is actual reviewed-ingestion completion, not fetch or review time. */
export function bridgeTiingoObservedCapture(normalized,options={}) {
 const blocked = (...reasons) => ({ok:false,status:'withheld',reasons:[...new Set(reasons)],snapshot:null});
 const {capture:c,policy:p,calendar,identityReview:ir,basisReview:br,actionsReview:ar,at,cutoffAt,usage='candidate'} = options;
 const d = normalized?.data;
 if (normalized?.ok!==true || normalized.status!=='captured_unvalidated' || d?.provider!=='tiingo' || d.dataset!=='eod'
  || !id(d.securityId) || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(d.ticker??'') || !Array.isArray(d.bars) || !d.bars.length) return blocked('normalized_input_invalid');
 if (!validTime(at) || !validTime(cutoffAt) || time(cutoffAt)>time(at)) return blocked('operation_clock_invalid');
 if (!c || c.authenticated!==true || !id(c.captureId) || !id(c.collectorVersion) || !text(c.authorizationReviewId)
  || !hash(c.responseSha256) || ![c.requestStartedAt,c.responseCompletedAt,c.ingestedAt].every(validTime)
  || time(c.requestStartedAt)>time(c.responseCompletedAt) || time(c.responseCompletedAt)>time(c.ingestedAt)
  || time(c.ingestedAt)>time(cutoffAt) || !same(c.responseCompletedAt,d.observedAt) || c.requestURL!==d.sourceURL) return blocked('authenticated_capture_manifest_required');
 const request = safeRequest(c.requestURL,d.ticker);
 if (!request) return blocked('request_provenance_invalid');
 if (!p || p.providerId!=='tiingo' || p.datasetId!=='eod' || p.securityId!==d.securityId || p.audience!=='owner_private'
  || p.sourceUrl!==request.canonical || p.actionsUrl!==p.sourceUrl || p.actionsSourceMode!=='same_eod_fields_reviewed'
  || !Number.isSafeInteger(p.requiredSessions) || p.requiredSessions<60 || p.requiredSessions>260) return blocked('bridge_policy_invalid');
 const instrumentType=p.instrumentType??'common_equity';
 if (!['candidate','benchmark'].includes(usage) || (p.usage!==undefined && p.usage!==usage)
  || !['common_equity','etf'].includes(instrumentType)
  || (instrumentType==='etf' && (usage!=='benchmark' || p.usage!=='benchmark'))) return blocked('instrument_usage_policy_invalid');
 if (calendar?.id!==p.calendarId || calendar.state!=='reviewed_complete' || !id(calendar.version) || !hash(calendar.sha256)
  || !text(calendar.reviewer_id) || !refs(calendar.source_refs) || !validTime(calendar.observedAt) || !validTime(calendar.reviewed_at)
  || time(calendar.observedAt)>time(calendar.reviewed_at) || time(calendar.reviewed_at)>time(cutoffAt)
  || !day(calendar.validThrough) || calendar.validThrough<at.slice(0,10) || !Array.isArray(calendar.sessions)) return blocked('reviewed_calendar_required');
 let previous;
 for (const s of calendar.sessions) {
  if (!day(s?.date) || !validTime(s.openAt) || !validTime(s.closeAt) || s.openAt.slice(0,10)!==s.date || s.closeAt.slice(0,10)!==s.date || time(s.openAt)>=time(s.closeAt)
   || (previous && (s.date<=previous.date || time(s.openAt)<=time(previous.closeAt)))) return blocked('calendar_sessions_invalid');
  previous=s;
 }
 const complete = calendar.sessions.filter(s=>time(s.closeAt)<=time(cutoffAt));
 const current = calendar.sessions.filter(s=>time(s.closeAt)<=time(at));
 const expected = complete.slice(-p.requiredSessions);
 if (expected.length!==p.requiredSessions || expected.at(-1).date!==current.at(-1)?.date) return blocked('completed_calendar_coverage_incomplete');
 const from=expected[0].date,to=expected.at(-1).date;
 if (time(c.responseCompletedAt)<time(expected.at(-1).closeAt)) return blocked('capture_precedes_completed_session');
 const seen = new Set();
 for (const b of d.bars) {
  if (!day(b?.sessionDate) || seen.has(b.sessionDate) || b.sessionDate<request.start || b.sessionDate>request.end
   || !complete.some(s=>s.date===b.sessionDate)) return blocked('captured_session_not_completed_or_unique');
  seen.add(b.sessionDate);
 }
 const selected=expected.map(s=>d.bars.find(b=>b.sessionDate===s.date));
 if (selected.some(b=>!b)) return blocked('captured_history_incomplete');
 if (!reviewValid(ir,c,p,from,to) || ir.security?.id!==p.securityId || ir.security.ticker!==d.ticker
  || ir.security.cik!==p.cik || ir.security.exchange!==p.exchange || ir.security.shareClass!==p.shareClass
  || ir.security.instrumentType!==instrumentType || ir.security.currency!=='USD'
  || !day(ir.security.validFrom) || !day(ir.security.validThrough) || ir.security.validFrom>from || ir.security.validThrough<to) return blocked('security_identity_review_required');
 if (!reviewValid(br,c,p,from,to) || br.basis?.currency!=='USD' || br.basis.price!=='unadjusted'
  || br.basis.volume!=='reported_shares' || br.basis.coverage!=='consolidated' || br.basis.session!=='regular') return blocked('price_volume_basis_review_required');
 if (!reviewValid(ar,c,p,from,to) || ar.unsupportedActionsReviewed!==true || ar.unsupportedActionsPresent!==false
  || ar.complete!==true || ar.splitFactorBasis!=='new_shares_per_old_share' || ar.dividendCashBasis!=='USD_per_share_ex_date'
  || !sameStrings(ar.coveredSessions,expected.map(s=>s.date))) return blocked('corporate_action_coverage_review_required');
 const bars=[],items=[];
 for (const b of selected) {
  const r=b.raw,a=b.actions;
  if (!r || ![r.open,r.high,r.low,r.close].every(x=>Number.isFinite(x)&&x>0) || r.high<Math.max(r.open,r.low,r.close)
   || r.low>Math.min(r.open,r.high,r.close) || !Number.isSafeInteger(r.volume) || r.volume<0 || !Number.isFinite(r.close*r.volume)
   || r.close*r.volume>Number.MAX_SAFE_INTEGER || !Number.isFinite(a?.splitFactor) || a.splitFactor<=0
   || !Number.isFinite(a.dividendCash) || a.dividendCash<0) return blocked('normalized_raw_fields_invalid');
  if (a.splitFactor!==1 && a.dividendCash!==0 && ar.sameDayDistributionShareBasisBySession?.[b.sessionDate]!=='post_split') return blocked('same_day_distribution_basis_unreviewed');
  bars.push({securityId:p.securityId,session:b.sessionDate,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume,
   providerPublishedAt:null,status:'as_observed',availabilityObservedAt:c.responseCompletedAt});
  if(a.splitFactor!==1)items.push({id:`${b.sessionDate}:split`,securityId:p.securityId,type:'split',effectiveSession:b.sessionDate,splitRatio:a.splitFactor});
  if(a.dividendCash!==0)items.push({id:`${b.sessionDate}:cash-dividend`,securityId:p.securityId,type:'cash_dividend',effectiveSession:b.sessionDate,cashPerShare:a.dividendCash,currency:'USD',...(a.splitFactor!==1?{perShareBasis:'post_split'}:{})});
 }
 const snapshot={id:c.captureId,providerId:'tiingo',datasetId:'eod',priceSession:to,
  security:structuredClone(ir.security),basis:structuredClone(br.basis),
  source:{url:p.sourceUrl,requestURL:c.requestURL,requestStartedAt:c.requestStartedAt,captureId:c.captureId,sha256:c.responseSha256,version:c.captureId,parserVersion:BRIDGE_VERSION,
   availabilityMode:'observed_capture',availabilityObservedAt:c.responseCompletedAt,publishedAt:null,publicationPrecision:'unknown',correctionPossible:true,
   fetchedAt:c.responseCompletedAt,ingestedAt:c.ingestedAt},bars,
  actions:{sourceUrl:p.actionsUrl,sha256:c.responseSha256,version:ar.id,securityId:p.securityId,complete:true,coverageStart:from,coverageEnd:to,
   reviewedAt:ar.reviewedAt,coverageReview:{reviewedAt:ar.reviewedAt,reviewerVersion:ar.reviewerVersion,unsupportedActionsReviewed:true},items}};
 return {ok:true,status:'pending_generic_inspection',reasons:[],snapshot,
  provenance:{bridgeVersion:BRIDGE_VERSION,captureId:c.captureId,collectorVersion:c.collectorVersion,authorizationReviewId:c.authorizationReviewId,
   requestStartedAt:c.requestStartedAt,responseCompletedAt:c.responseCompletedAt,ingestedAt:c.ingestedAt,responseSha256:c.responseSha256,
   requestURL:c.requestURL,selectedSessions:expected.map(s=>s.date),capturedBarCount:d.bars.length,
   identityReviewId:ir.id,basisReviewId:br.id,actionsReviewId:ar.id,calendarId:calendar.id,calendarVersion:calendar.version,
   audience:'owner_private',usage,instrumentType,providerPublicationKnown:false,correctionPossible:true,availabilityClaim:'observed_no_later_than_capture',backtestAvailabilityProven:false},
  scorerCalendar:structuredClone(calendar)};
}

/** Join the trusted transport's real envelope to an independently supplied host
 * ingestion record. No capture ID, approval, time or provider fact is generated.
 * A bare normalization result or unaccepted response remains withheld. */
export function bridgeTiingoCapturedEnvelope(envelope,options={}) {
 const blocked=reason=>({ok:false,status:'withheld',reasons:[reason],snapshot:null});
 const c=envelope?.capture,r=options.ingestionRecord;
 if (options.capture!==undefined || envelope?.ok!==true || envelope.status!=='captured_unvalidated'
  || c?.provider!=='tiingo' || c.dataset!=='eod' || c.mode!=='authenticated_response_observed'
  || c.collectorVersion!=='tiingo_eod_capture_v1' || !Number.isSafeInteger(c.httpStatus) || c.httpStatus<200 || c.httpStatus>=300
  || !Number.isSafeInteger(c.responseByteLength) || c.responseByteLength<1 || c.responseByteLength>2000000
  || !hash(c.responseSha256) || c.ingestedAt!==null || c.eligibleForRanking!==false
  || c.providerPublishedAt!==null || c.publicationPrecision!=='unknown' || c.correctionPossible!==true
  || !validTime(c.requestStartedAt) || !validTime(c.responseCompletedAt) || time(c.requestStartedAt)>time(c.responseCompletedAt)
  || c.requestURL!==envelope.data?.sourceURL || !same(c.responseCompletedAt,envelope.data?.observedAt)) return blocked('trusted_transport_envelope_required');
 if (r?.state!=='accepted' || !id(r.id) || !id(r.captureId) || r.captureIdSource!=='host_ingestion_ledger'
  || !text(r.reviewerId) || !refs(r.sourceRefs) || r.provider!==c.provider || r.dataset!==c.dataset
  || r.securityId!==envelope.data.securityId || r.responseSha256!==c.responseSha256
  || r.authorizationReviewId!==c.authorizationReviewId || r.requestURL!==c.requestURL
  || r.requestStartedAt!==c.requestStartedAt || r.responseCompletedAt!==c.responseCompletedAt
  || !validTime(r.reviewedAt) || !validTime(r.ingestedAt) || time(r.reviewedAt)<time(c.responseCompletedAt)
  || time(r.reviewedAt)>time(r.ingestedAt) || time(r.ingestedAt)>time(options.cutoffAt)) return blocked('accepted_ingestion_record_required');
 const capture={captureId:r.captureId,authenticated:true,collectorVersion:c.collectorVersion,authorizationReviewId:c.authorizationReviewId,
  responseSha256:c.responseSha256,requestURL:c.requestURL,requestStartedAt:c.requestStartedAt,
  responseCompletedAt:c.responseCompletedAt,ingestedAt:r.ingestedAt};
 const result=bridgeTiingoObservedCapture(envelope,{...options,capture});
 if (!result.ok)return result;
 return {...result,provenance:{...result.provenance,ingestionRecordId:r.id,ingestionReviewedAt:r.reviewedAt,
  captureIdSource:r.captureIdSource,responseByteLength:c.responseByteLength,httpStatus:c.httpStatus,
  transportMode:c.mode,transportIngestedAt:c.ingestedAt}};
}
