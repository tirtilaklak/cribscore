/**
 * Pure refresh transaction core. No fetch, disk write, storage binding, token,
 * clock generation or scheduler is provided here. A collector must attest the
 * actual check; a durable host must atomically persist revision + run + archive
 * and verify its readback. Local tests cannot establish either capability.
 */
import { inspectEvidence as inspectBoundEvidence } from './evidence.js';

export const REFRESH_CONTRACT_VERSION = '1.0.0';
export const REFRESH_SCOPE = Object.freeze({
  siteId:'snapshot-only-not-a-live-site',
  cik:'0000320193', accession:'0000320193-23-000106',
  url:'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm',
  indexUrl:'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/0000320193-23-000106-index.html',
});
const OPS=['fetch','store','transform','display'];
const EXPECTED={cik:REFRESH_SCOPE.cik,metricConcept:'NetIncomeLoss',unit:'USD',scale:1000000,periodStart:'2022-09-25',periodEnd:'2023-09-30'};
const text=value=>typeof value==='string'&&value.trim().length>0;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
const code=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(value);
const clone=value=>structuredClone(value);
function instant(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
  const parsed=Date.parse(value),day=Date.parse(`${value.slice(0,10)}T00:00:00Z`);
  if(!Number.isFinite(parsed)||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==value.slice(0,10))return NaN;
  const parts=value.slice(11,19).split(':').map(Number);
  if(parts[0]>23||parts[1]>59||parts[2]>59)return NaN;
  if(!value.endsWith('Z')){const [hours,minutes]=value.slice(-5).split(':').map(Number);if(hours>14||minutes>59||(hours===14&&minutes!==0))return NaN;}
  return parsed;
}
const utc=value=>typeof value==='string'&&value.endsWith('Z')&&Number.isFinite(instant(value));
const canonical=value=>JSON.stringify(normalize(value));
function normalize(value){if(Array.isArray(value))return value.map(normalize);if(object(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])]));return value;}
const pick=(input,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(input??{},key)).map(key=>[key,input[key]]));
function exactURLs(urls){return Array.isArray(urls)&&urls.length===2&&new Set(urls).size===2&&urls.includes(REFRESH_SCOPE.url)&&urls.includes(REFRESH_SCOPE.indexUrl);}
function termsURL(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='www.sec.gov'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}}
function cleanReview(review){
  if(!object(review))return null;
  const out=pick(review,['reviewId','version','reviewedAt','validFrom','expiresAt','termsUrl','purpose']);
  out.sourceBinding=pick(review.sourceBinding,['cik','accession','urls']);
  out.operations=pick(review.operations,OPS);
  if(Array.isArray(review.termsEvidence))out.termsEvidence=review.termsEvidence.map(item=>pick(item,['url','observedAt','sha256']));
  return clone(out);
}
function rightsAt(reviews,operation,at){
  const now=instant(at);
  if(!Number.isFinite(now))return ['operation_time_invalid'];
  const known=(Array.isArray(reviews)?reviews:[]).filter(r=>object(r)&&instant(r.reviewedAt)<=now&&instant(r.validFrom)<=now)
    .sort((a,b)=>instant(b.reviewedAt)-instant(a.reviewedAt)||instant(b.validFrom)-instant(a.validFrom)||String(b.version).localeCompare(String(a.version),'en',{numeric:true}));
  const r=known[0];
  if(!r)return [`${operation}_rights_unknown`];
  const reasons=[];
  if(!id(r.reviewId)||!(text(r.version)||(Number.isSafeInteger(r.version)&&r.version>0))||!termsURL(r.termsUrl))reasons.push(`${operation}_rights_audit_incomplete`);
  if(r.purpose!=='historical_financial_facts'||r.sourceBinding?.cik!==REFRESH_SCOPE.cik||r.sourceBinding?.accession!==REFRESH_SCOPE.accession||!exactURLs(r.sourceBinding?.urls))reasons.push(`${operation}_rights_scope_mismatch`);
  if(!Number.isFinite(instant(r.expiresAt))||instant(r.expiresAt)<=now||instant(r.expiresAt)<=instant(r.validFrom))reasons.push(`${operation}_rights_expired`);
  if(r.operations?.[operation]!=='allowed')reasons.push(`${operation}_rights_${['denied','revoked'].includes(r.operations?.[operation])?r.operations[operation]:'unknown'}`);
  if(known.slice(1).some(other=>other.reviewedAt===r.reviewedAt&&other.validFrom===r.validFrom&&(other.operations?.[operation]!==r.operations?.[operation]||canonical(other.sourceBinding)!==canonical(r.sourceBinding))))reasons.push(`${operation}_rights_conflict`);
  return reasons;
}
function scoped(record){return record?.issuer?.cik===REFRESH_SCOPE.cik&&record?.source?.accession===REFRESH_SCOPE.accession&&record.source.url===REFRESH_SCOPE.url&&record.source.indexUrl===REFRESH_SCOPE.indexUrl&&record.source.form==='10-K';}
function cleanRecord(record){
  if(!object(record))return null;
  const out=pick(record,['id','value','unit','scale','scope','dimensions','nonReliance','superseded']);
  out.issuer=pick(record.issuer,['name','cik']);
  out.metric=pick(record.metric,['taxonomy','concept','accountingBasis']);
  out.period=pick(record.period,['start','end','type','fiscalYear']);
  out.source=pick(record.source,['url','indexUrl','accession','form','original','location','sha256','indexSha256','acceptedAt','acceptedTimezone','publishedAt','publishedDate','publishedTimePrecision','publicAvailabilityObservedAt','fetchedAt','ingestedAt','mode','parserVersion','contextId','factId','unitId','nonReliance','superseded']);
  out.rights=(Array.isArray(record.rights)?record.rights:record.rights?[record.rights]:[]).map(cleanReview);
  return clone(out);
}
function validArchive(archive){return object(archive)&&Number.isSafeInteger(archive.revision)&&archive.revision>=0&&Array.isArray(archive.records)&&archive.records.every(r=>object(r)&&(!Array.isArray(r.rights)||r.rights.every(object)))&&(archive.rightsReviews===undefined||Array.isArray(archive.rightsReviews)&&archive.rightsReviews.every(object))&&Array.isArray(archive.runs)&&archive.runs.every(r=>object(r)&&id(r.runId))&&new Set(archive.runs.map(r=>r.runId)).size===archive.runs.length;}
function registry(archive){return Array.isArray(archive?.rightsReviews)?archive.rightsReviews:[];}
function reviewsFor(record,archive){
  const reviews=[...(Array.isArray(record?.rights)?record.rights:record?.rights?[record.rights]:[]),...registry(archive)];
  return reviews.filter((r,index)=>reviews.findIndex(other=>canonical(cleanReview(other))===canonical(cleanReview(r)))===index);
}
function inspect(record,archive,at,operation,additionalInspector){
  if(!scoped(record))return {eligible:false,reasons:['source_outside_refresh_scope']};
  const bound={...record,rights:reviewsFor(record,archive)};
  const result=inspectBoundEvidence(bound,{at,operation,expected:EXPECTED});
  if(!result.eligible)return result;
  const rightsReasons=[...rightsAt(bound.rights,'fetch',record.source.fetchedAt),...rightsAt(bound.rights,'store',record.source.ingestedAt),...rightsAt(bound.rights,'transform',record.source.ingestedAt),...rightsAt(bound.rights,operation,at)];
  if(rightsReasons.length)return {eligible:false,reasons:[...new Set(rightsReasons)]};
  // An injected inspector can impose more restrictions; it cannot bypass the
  // actual bound SEC guard or mint a different supported claim.
  if(additionalInspector&&additionalInspector!==inspectBoundEvidence){
    let extra;try{extra=additionalInspector(clone(bound),{at,operation,expected:clone(EXPECTED)});}catch{return {eligible:false,reasons:['additional_inspection_failed']};}
    if(extra?.eligible!==true)return {eligible:false,reasons:['additional_inspection_withheld']};
  }
  return result;
}

/** Inspect readiness at the supplied actual time. Re-run rights at each use. */
export function planRefresh(input={}){
  const reasons=[];
  if(!object(input))return {allowed:false,reasons:['input_invalid'],operations:[],requests:[]};
  const {runId,at,site,sourcePolicy:p,lastArchive,attempt}=input;
  if(!id(runId))reasons.push('run_id_invalid');
  if(!utc(at))reasons.push('operation_time_invalid');
  if(site?.id!==REFRESH_SCOPE.siteId)reasons.push('site_identity_mismatch');
  if(site?.audience!=='owner_private')reasons.push('site_not_owner_private');
  if(site?.serviceAccessAvailable!==true)reasons.push('service_access_unavailable');
  if(!validArchive(lastArchive))reasons.push('archive_invalid');
  if(lastArchive?.lastCheckedAt&&(!utc(lastArchive.lastCheckedAt)||instant(lastArchive.lastCheckedAt)>instant(at)))reasons.push('archive_clock_invalid');
  if(Array.isArray(lastArchive?.runs)&&lastArchive.runs.some(r=>r?.runId===runId))reasons.push('run_already_recorded');
  if(attempt&&!object(attempt))reasons.push('prior_attempt_invalid');
  if(attempt&&(attempt.httpStatus>=300||['denied','pending','uncertain','redirect','failed'].includes(attempt.status)||attempt.outcome==='uncertain'))reasons.push('prior_attempt_stop_no_retry');
  if(p?.id!=='sec-aapl-2023-original'||p.cik!==REFRESH_SCOPE.cik||p.accession!==REFRESH_SCOPE.accession||!exactURLs(p.urls))reasons.push('source_policy_not_allowlisted');
  if(p?.userAgentDeclared!==true)reasons.push('declared_user_agent_required');
  const limits=p?.requestLimits;
  if(!object(limits)||limits.maxRequests!==2||!Number.isFinite(limits.minIntervalMs)||limits.minIntervalMs<1000||!Number.isFinite(limits.timeoutMs)||limits.timeoutMs<=0||limits.timeoutMs>20000||!Number.isSafeInteger(limits.maxBytes)||limits.maxBytes<=0||limits.maxBytes>3000000||limits.retries!==0||limits.followRedirects!==false)reasons.push('request_limits_invalid');
  const reviews=Array.isArray(p?.reviews)?p.reviews:p?.review?[p.review]:[];
  for(const op of OPS)reasons.push(...rightsAt(reviews,op,at));
  const unique=[...new Set(reasons)];
  return {allowed:unique.length===0,reasons:unique,operations:unique.length?[]:[...OPS],requests:unique.length?[]:[REFRESH_SCOPE.indexUrl,REFRESH_SCOPE.url]};
}

const financialMeaning=record=>({issuer:{cik:record.issuer.cik},metric:record.metric,value:Number(record.value),unit:record.unit,scale:record.scale,scope:record.scope,dimensions:record.dimensions,period:record.period});
const sameFact=(a,b)=>canonical(financialMeaning(cleanRecord(a)))===canonical(financialMeaning(cleanRecord(b)));
const hashKey=value=>typeof value==='string'?value.toLowerCase():value??null;
const sameBytes=(a,b)=>hashKey(a?.source?.sha256)===hashKey(b?.source?.sha256)&&hashKey(a?.source?.indexSha256)===hashKey(b?.source?.indexSha256);
function cleanChangeReview(review){return object(review)?pick(review,['type','reviewedAt','reviewerVersion','previousSourceHash','sourceHash','material','reasonCode']):null;}
function cleanEvent(event){
  return {runId:event.runId,expectedRevision:event.expectedRevision,startedAt:event.startedAt,checkedAt:event.checkedAt,outcome:event.outcome,
    candidate:event.candidate?cleanRecord(event.candidate):null,failure:event.failure?{code:event.failure.code}:null,
    changeReview:cleanChangeReview(event.changeReview),rightsReviews:Array.isArray(event.rightsReviews)?event.rightsReviews.map(cleanReview):[]};
}
function appendReviews(previous,additions,checkedAt){
  const retained=[...registry(previous)],known=[...previous.records.flatMap(r=>Array.isArray(r.rights)?r.rights:r.rights?[r.rights]:[]),...retained];
  for(const review of additions){
    if(!review||instant(review.reviewedAt)>instant(checkedAt)||!utc(review.reviewedAt))return {reasons:['rights_review_time_invalid']};
    const matching=known.filter(r=>r.reviewId===review.reviewId&&r.version===review.version);
    if(matching.some(r=>canonical(cleanReview(r))!==canonical(review)))return {reasons:['rights_review_identity_conflict']};
    if(matching.length)continue;
    if(!Array.isArray(review.termsEvidence)||!review.termsEvidence.length||review.termsEvidence.some(e=>!termsURL(e.url)||!utc(e.observedAt)||instant(e.observedAt)>instant(review.reviewedAt)||!/^[a-f0-9]{64}$/i.test(e.sha256??'')))return {reasons:['rights_review_terms_evidence_required']};
    if(known.some(r=>instant(r.reviewedAt)>instant(review.reviewedAt)))return {reasons:['rights_review_not_append_only']};
    // A new revocation is valid audit evidence and can be retained. It does not
    // authorize a successful source check; current rights will fail below.
    for(const op of OPS){const failures=rightsAt([review],op,checkedAt).filter(reason=>!/_rights_(?:denied|revoked|unknown)$/.test(reason));if(failures.length)return {reasons:failures};}
    retained.push(review);known.push(review);
  }
  return {reviews:retained,reasons:[]};
}

/** Return a candidate transaction. The host must commit it atomically with CAS. */
export function commitRefresh(previous,event,options={}){
  const reject=(...reasons)=>({accepted:false,reasons:[...new Set(reasons)],archive:previous});
  if(!validArchive(previous))return reject('archive_invalid');
  if(!object(event)||!object(options)||!utc(options.at))return reject('event_or_operation_invalid');
  if(event.rightsReviews!==undefined&&!Array.isArray(event.rightsReviews))return reject('rights_registry_invalid');
  let update;try{update=cleanEvent(event);}catch{return reject('event_not_serializable');}
  if(!id(update.runId)||!Number.isSafeInteger(update.expectedRevision)||update.expectedRevision<0||!['unchanged','new_evidence','failed'].includes(update.outcome))return reject('event_invalid');
  const now=instant(options.at),started=instant(update.startedAt),checked=instant(update.checkedAt);
  if(!utc(update.startedAt)||!utc(update.checkedAt)||started>checked||checked>now)return reject('event_times_invalid');
  if(update.outcome==='failed'&&!code(update.failure?.code))return reject('failure_code_invalid');
  if(update.outcome!=='failed'&&update.failure)return reject('outcome_failure_conflict');
  const fingerprint=canonical(update),recorded=previous.runs.find(r=>r.runId===update.runId);
  if(recorded)return recorded.eventFingerprint===fingerprint?{accepted:true,reasons:[],archive:previous}:reject('run_id_conflict');
  if(update.expectedRevision!==previous.revision)return reject('revision_conflict');
  if(previous.revision===Number.MAX_SAFE_INTEGER)return reject('revision_exhausted');
  const priorClocks=[previous.lastSuccessfulCheckAt,previous.evidenceChangedAt,...previous.runs.map(run=>run.committedAt)].filter(value=>value!==undefined&&value!==null);
  if(priorClocks.some(value=>!utc(value)||instant(value)>now))return reject('commit_clock_regression');
  if(previous.lastCheckedAt&&(!utc(previous.lastCheckedAt)||started<instant(previous.lastCheckedAt)||checked<instant(previous.lastCheckedAt)))return reject('check_clock_regression');
  if(update.outcome==='failed'&&(update.candidate||update.changeReview))return reject('failed_run_cannot_admit_candidate');
  // Candidate capture audits share the same immutable audit identity namespace.
  // A correction cannot silently edit an existing audit or introduce a renewal
  // without the append-only registry's chronology and terms-evidence checks.
  const candidateReviews=previous.records.length&&update.outcome==='new_evidence'?update.candidate?.rights??[]:[];
  const added=appendReviews(previous,[...update.rightsReviews,...candidateReviews],update.checkedAt);
  if(added.reasons.length)return reject(...added.reasons);
  const next={revision:previous.revision+1,records:clone(previous.records),runs:clone(previous.runs),
    lastCheckedAt:update.checkedAt,lastSuccessfulCheckAt:previous.lastSuccessfulCheckAt??null,
    evidenceChangedAt:previous.evidenceChangedAt??null,sourceStatus:previous.sourceStatus??'historical_as_reported'};
  if(previous.activeRecordId)next.activeRecordId=previous.activeRecordId;
  if(added.reviews.length)next.rightsReviews=clone(added.reviews);
  if(utc(previous.nextCheckDueAt))next.nextCheckDueAt=previous.nextCheckDueAt;
  if(update.outcome==='failed'){
    next.sourceStatus=update.failure.code==='source_change_unreviewed'?'source_change_unreviewed':'check_failed';
  }else{
    const active=previous.activeRecordId?previous.records.find(r=>r.id===previous.activeRecordId):previous.records.at(-1);
    if(update.outcome==='unchanged'&&!active)return reject('unchanged_without_observation');
    if(update.outcome==='unchanged'&&update.changeReview)return reject('unchanged_with_material_change');
    if(update.outcome==='unchanged'&&update.candidate&&(!sameFact(active,update.candidate)||!sameBytes(active,update.candidate)))return reject('unchanged_candidate_mismatch');
    const candidate=update.outcome==='new_evidence'?update.candidate:active;
    if(!candidate)return reject('candidate_missing');
    const initialFetchRights=rightsAt(reviewsFor(candidate,next),'fetch',update.startedAt);
    if(initialFetchRights.length)return reject(...initialFetchRights);
    for(const operation of OPS){
      const result=inspect(candidate,next,update.checkedAt,operation,options.inspectEvidence);
      if(!result.eligible)return reject(...result.reasons);
      const rightsReasons=rightsAt(reviewsFor(candidate,next),operation,update.checkedAt);
      if(rightsReasons.length)return reject(...rightsReasons);
    }
    const display=inspect(candidate,next,options.at,'display',options.inspectEvidence);
    if(!display.eligible)return reject(...display.reasons);
    if(update.outcome==='new_evidence'){
      if(!id(candidate.id)||previous.records.some(r=>r.id===candidate.id))return reject('candidate_identity_not_new');
      if(instant(candidate.source?.fetchedAt)<started||instant(candidate.source?.ingestedAt)>checked)return reject('candidate_capture_outside_run');
      const review=update.changeReview;
      if(active){
        if(hashKey(active.source.sha256)===hashKey(candidate.source.sha256))return reject('same_source_bytes_not_new_evidence');
        if(sameFact(active,candidate))return reject('source_change_unreviewed');
        if(review?.type!=='reviewed_original_fact_correction'||review.material!==true||review.reasonCode!=='source_fact_corrected'||!text(review.reviewerVersion)||!utc(review.reviewedAt)||instant(review.reviewedAt)<instant(candidate.source.ingestedAt)||instant(review.reviewedAt)>checked||review.previousSourceHash!==active.source.sha256||review.sourceHash!==candidate.source.sha256)return reject('material_change_review_required');
      }else if(review?.type!=='initial_original_capture'||review.material!==true||!text(review.reviewerVersion)||!utc(review.reviewedAt)||instant(review.reviewedAt)<instant(candidate.source.ingestedAt)||instant(review.reviewedAt)>checked||review.sourceHash!==candidate.source.sha256)return reject('initial_capture_review_required');
      next.records.push(clone(candidate));next.activeRecordId=candidate.id;next.evidenceChangedAt=options.at;
    }
    next.lastSuccessfulCheckAt=update.checkedAt;next.sourceStatus='historical_as_reported';
  }
  next.runs.push({runId:update.runId,expectedRevision:update.expectedRevision,revision:next.revision,startedAt:update.startedAt,checkedAt:update.checkedAt,committedAt:options.at,outcome:update.outcome,eventFingerprint:fingerprint,...(update.failure?{failure:{code:update.failure.code}}:{}),...(update.changeReview?{changeReview:clone(update.changeReview)}:{})});
  return {accepted:true,reasons:[],archive:next};
}

/** Re-evaluate every read; return bound historical claims, never recommendations. */
export function projectArchive(archive,options={}){
  const empty={facts:[],sourceStatus:'evidence_blocked',lastCheckedAt:null,lastSuccessfulCheckAt:null,evidenceChangedAt:null,historical:true,direction:null,research_status:'unvalidated',refreshConfigured:false};
  if(!validArchive(archive)||!object(options)||!utc(options.at))return {...empty,reasons:['archive_or_operation_invalid']};
  const facts=[],reasons=[];
  if([archive.lastCheckedAt,archive.lastSuccessfulCheckAt,archive.evidenceChangedAt].filter(Boolean).some(t=>!utc(t)||instant(t)>instant(options.at)))return {...empty,reasons:['archive_clock_invalid']};
  const records=archive.activeRecordId?archive.records.filter(r=>r.id===archive.activeRecordId):archive.records;
  if(archive.activeRecordId&&!records.length)reasons.push('active_record_missing');
  for(const record of records){
    const result=inspect(record,archive,options.at,'display',options.inspectEvidence);
    if(result.eligible){const safe=cleanRecord(record);facts.push({id:safe.id,claim:result.claim,issuer:safe.issuer,metric:safe.metric,period:safe.period,value:safe.value,unit:safe.unit,scale:safe.scale,scope:safe.scope,source:safe.source,historical:true});}
    else reasons.push(...result.reasons);
  }
  let sourceStatus=['check_failed','source_change_unreviewed'].includes(archive.sourceStatus)?archive.sourceStatus:'historical_as_reported';
  const age=options.maxCheckAgeMs, due=options.nextCheckDueAt??archive.nextCheckDueAt;
  if(age!==undefined&&(!Number.isFinite(age)||age<=0))return {...empty,reasons:['freshness_policy_invalid']};
  if(due!==undefined&&!utc(due))return {...empty,reasons:['freshness_policy_invalid']};
  const overdue=(age!==undefined&&(!archive.lastSuccessfulCheckAt||instant(options.at)-instant(archive.lastSuccessfulCheckAt)>age))||(due!==undefined&&instant(options.at)>=instant(due));
  if(overdue&&sourceStatus==='historical_as_reported')sourceStatus='check_overdue';
  if(!facts.length&&reasons.length)sourceStatus=reasons.some(r=>r.includes('_rights_'))?'rights_blocked':'evidence_blocked';
  return {...empty,facts,sourceStatus,lastCheckedAt:archive.lastCheckedAt??null,lastSuccessfulCheckAt:archive.lastSuccessfulCheckAt??null,evidenceChangedAt:archive.evidenceChangedAt??null,reasons:[...new Set(reasons)],overdue};
}
