import {classifyCandidate,eventPosition,horizonWindow} from '../../dist/lib/candidates.js';
export const SCORE_POLICY = 'research_evidence_v0_1_unvalidated';
export const PRICE_REVIEW_POLICY = Object.freeze({
 policy_version:'research-score-price-action-zero-neutrality-v1',
 calculation_convention:'five-session-close-cash-entitlements-v1',
 grade_rule_version:'absolute-and-relative-sign-neutrality-v2',
 numerical_neutrality_version:'return-units-neutral-band-1e-12-v1',
 tolerance_bps:0
});
export const COMPONENTS = Object.freeze(['fundamentals','catalyst','price_action','macro']);
export const RUBRIC = Object.freeze({
 fundamentals:Object.freeze({adverse:0,mixed:1,supportive:2}),
 catalyst:Object.freeze({none_or_known:0,confirmed_two_sided:1,incremental_company_test:2}),
 price_action:Object.freeze({weak:0,mixed:1,supportive:2}),
 macro:Object.freeze({headwind:0,mixed_or_no_material_dependence:1,tailwind:2})
});
// Preserve actual UTC capture precision; do not round clocks to whole seconds.
const day=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
function instant(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!day(value.slice(0,10)))return NaN;
 const [hour,minute,second]=value.slice(11,19).split(':').map(Number),parsed=Date.parse(value);
 return hour<24&&minute<60&&second<60&&Number.isFinite(parsed)?parsed:NaN;
}
const nonblank=value=>typeof value==='string' && value.trim().length>0;
// A required explanation cannot be an invisible placeholder. Preserve exact input
// bytes for review binding; this check does not establish semantic sufficiency.
const readable=value=>typeof value==='string' && value.replace(/[\s\p{Cc}\p{Default_Ignorable_Code_Point}]/gu,'').length>0;
const refs=value=>Array.isArray(value) && value.length>0 && value.every(nonblank) && new Set(value).size===value.length;
const atSame=(a,b)=>Number.isFinite(instant(a)) && instant(a)===instant(b);
function priceConventionReviewed(review,candidate) {
 // The separately trusted reviewer binds a recomputed private calculation.
 // These fields check its contract; they do not authenticate an arbitrary JSON assertion.
 return Object.entries(PRICE_REVIEW_POLICY).every(([key,value])=>review[key]===value) &&
  review.calculated_grade===review.rating && nonblank(review.calculation_record_id) &&
  nonblank(review.target_snapshot_id) && nonblank(review.benchmark_snapshot_id) &&
  review.target_snapshot_id!==review.benchmark_snapshot_id && review.benchmark_id!==candidate.security_id &&
  refs(review.target_source_ids) && refs(review.benchmark_source_ids) &&
  [...review.target_source_ids,...review.benchmark_source_ids].every(id=>review.source_ids.includes(id));
}
function priceClocksReviewed(review,measurement,options) {
 // Preserve both legs' actual capture/ingestion clocks and the calculator clock.
 // A newer review cannot make stale or not-yet-calculated evidence available.
 const targetAvailable=instant(review.target_available_at),targetIngested=instant(review.target_ingested_at);
 const benchmarkAvailable=instant(review.benchmark_available_at),benchmarkIngested=instant(review.benchmark_ingested_at);
 const calculated=instant(review.calculated_at),reviewed=instant(review.reviewed_at),cutoff=instant(options.cutoff);
 return [targetAvailable,targetIngested,benchmarkAvailable,benchmarkIngested,calculated,reviewed,cutoff].every(Number.isFinite) &&
  targetAvailable>=instant(measurement.end) && benchmarkAvailable>=instant(measurement.end) &&
  targetIngested>=targetAvailable && benchmarkIngested>=benchmarkAvailable &&
  instant(review.source_available_at)===Math.max(targetAvailable,benchmarkAvailable) &&
  instant(review.ingested_at)===Math.max(targetIngested,benchmarkIngested) &&
  calculated>=Math.max(targetIngested,benchmarkIngested) && calculated<=reviewed && reviewed<=cutoff;
}
function priceMeasurement(calendar,options) {
 const cutoff=instant(options.cutoff),at=instant(options.at);
 if(!Number.isFinite(cutoff)||!Number.isFinite(at)||calendar?.state!=='reviewed_complete'||!nonblank(calendar.id)||!nonblank(calendar.version)||!/^[a-f0-9]{64}$/i.test(calendar.sha256??'')||!nonblank(calendar.reviewer_id)||!refs(calendar.source_refs)||!Number.isFinite(instant(calendar.observedAt))||!Number.isFinite(instant(calendar.reviewed_at))||instant(calendar.observedAt)>instant(calendar.reviewed_at)||instant(calendar.reviewed_at)>cutoff||!day(calendar.validThrough)||calendar.validThrough<options.at.slice(0,10)||!Array.isArray(calendar.sessions)||calendar.sessions.length<6)return null;
 const sessions=[...calendar.sessions];
 if(sessions.some(s=>!Number.isFinite(instant(`${s?.date}T00:00:00Z`))||!Number.isFinite(instant(s?.openAt))||!Number.isFinite(instant(s?.closeAt))||instant(s.closeAt)<=instant(s.openAt)||s.openAt.slice(0,10)!==s.date||s.closeAt.slice(0,10)!==s.date)||new Set(sessions.map(s=>s.date)).size!==sessions.length)return null;
 sessions.sort((a,b)=>instant(a.openAt)-instant(b.openAt));
 if(sessions.some((s,i)=>i>0&&instant(s.openAt)<instant(sessions[i-1].closeAt)))return null;
 const completed=sessions.filter(s=>instant(s.closeAt)<=cutoff),latestNow=sessions.filter(s=>instant(s.closeAt)<=at).at(-1);
 if(completed.length<6||!latestNow||!atSame(completed.at(-1).closeAt,latestNow.closeAt))return null;
 // Five close-to-close intervals need six completed closing endpoints. The
 // reviewed-complete envelope comes from calendar ingestion, not weekday guesses.
 return {start:completed.at(-6).closeAt,end:completed.at(-1).closeAt,session:completed.at(-1).date};
}
function holdingWindowMatches(calendar,window,options) {
 // Freeze the declared horizon at the source cutoff. A later assessment must
 // not roll a missed entry forward; the classifier separately requires upcoming.
 const selected=horizonWindow(calendar.sessions.map(s=>({open:s.openAt,close:s.closeAt})),options.cutoff,window?.horizon_id);
 return selected!==null && calendar.validThrough>=selected.exit_at.slice(0,10) &&
  atSame(window?.entry_at,selected.entry_at) && atSame(window?.exit_at,selected.exit_at);
}
function boundReview(review,candidate,window,options) {
 const order=[review?.observation_at,review?.source_available_at,review?.ingested_at,review?.reviewed_at,options.cutoff].map(instant);
 return review?.state==='reviewed' && nonblank(review.reviewer_id) && refs(review.source_refs) && refs(review.source_ids) && nonblank(review.evidence_snapshot_id) &&
  review.candidate_security_id===candidate.security_id && review.horizon_id===window.horizon_id &&
  atSame(review.entry_at,window.entry_at) && atSame(review.exit_at,window.exit_at) && atSame(review.source_cutoff_at,options.cutoff) &&
  order.every(Number.isFinite) && order.every((t,i)=>i===0||t>=order[i-1]) && instant(review.expires_at)>instant(options.at);
}
function publicationRightPassed(review,sourceIds,options) {
 return options.audience==='owner_private' && review?.audience==='owner_private' && review.state==='approved' && review.operation==='display_derived_research_score' && review.policy_version===SCORE_POLICY &&
  nonblank(review.reviewer_id) && refs(review.source_refs) && refs(review.source_ids) && nonblank(review.rights_record_id) &&
  Number.isFinite(instant(review.reviewed_at)) && instant(review.reviewed_at)<=instant(options.cutoff) &&
  Number.isFinite(instant(review.effective_at)) && instant(review.effective_at)<=instant(options.at) && instant(review.expires_at)>instant(options.at) &&
  sourceIds.every(id=>review.source_ids.includes(id));
}
export function scoreResearchCandidate(candidate,window,options={}) {
 const inspection=classifyCandidate(candidate,window,options),reasons=[...inspection.reasons];
 if(!nonblank(candidate?.security_id))reasons.push('security_identity_invalid');
 const measurement=priceMeasurement(options.priceCalendar,options);
 if(!measurement||!holdingWindowMatches(options.priceCalendar,window,options))reasons.push('holding_window_calendar_mismatch');
 const input=candidate?.research_score_review;
 if(input?.policy_version!==SCORE_POLICY)reasons.push('score_policy_unreviewed');
 const records=input?.components;
 if(!Array.isArray(records)||records.length!==COMPONENTS.length)reasons.push('four_component_reviews_required');
 const values={},sourceIds=[];
 for(const id of COMPONENTS){
  const matches=Array.isArray(records)?records.filter(r=>r?.id===id):[],r=matches[0];
  if(matches.length!==1||!boundReview(r,candidate,window,options)||!Object.hasOwn(RUBRIC[id],r.rating)||!readable(r.rationale)) {reasons.push(`${id}_review_invalid`);continue;}
  if(id==='price_action'&&(!measurement||r.price_session!==options.priceSession||r.price_session!==measurement.session||!atSame(r.measurement_start_at,measurement.start)||!atSame(r.measurement_end_at,measurement.end)||instant(r.observation_at)<instant(measurement.end)||instant(r.source_available_at)<instant(measurement.end)||r.measurement_window!=='five_completed_sessions_total_return'||r.benchmark_window_matched!==true||!nonblank(r.benchmark_id)||r.corporate_actions_reconciled!==true)){reasons.push('price_action_measurement_invalid');continue;}
  if(id==='price_action'&&!priceConventionReviewed(r,candidate)){reasons.push('price_action_calculation_review_invalid');continue;}
  if(id==='price_action'&&!priceClocksReviewed(r,measurement,options)){reasons.push('price_action_calculation_clock_invalid');continue;}
  if(id==='macro'&&r.rating!=='mixed_or_no_material_dependence'&&!readable(r.company_transmission)){reasons.push('macro_company_transmission_required');continue;}
  if(id==='catalyst'&&r.rating!=='none_or_known'&&(candidate.catalyst?.status!=='confirmed'||eventPosition(candidate.catalyst?.interval,window)!=='in_window'||!refs(candidate.catalyst?.source_refs)||!readable(candidate.catalyst?.positive)||!readable(candidate.catalyst?.adverse))){reasons.push('catalyst_not_confirmed_in_window');continue;}
  if(id==='catalyst'&&r.rating==='incremental_company_test'&&(r.new_information_mechanism_reviewed!==true||candidate.catalyst?.reviewer_signed_off!==true||!readable(candidate.catalyst?.expected_information)||!readable(candidate.catalyst?.company_reference))){reasons.push('incremental_information_unreviewed');continue;}
  values[id]=RUBRIC[id][r.rating];sourceIds.push(...r.source_ids);
 }
 if(!publicationRightPassed(input?.publication_rights_review,[...new Set(sourceIds)],options))reasons.push('derived_score_display_rights_blocked');
 const common={security_id:nonblank(candidate?.security_id)?candidate.security_id:null,policy_version:SCORE_POLICY,horizon_id:window?.horizon_id??null,audience:'owner_private',expected_return:null,gain_probability:null,predictive_status:'unvalidated'};
 if(reasons.length)return {...common,status:'withheld',score:null,components:null,reasons:[...new Set(reasons)]};
 // Allowlisted output deliberately excludes raw prices, observations and prose.
 return {...common,status:'scored',score:COMPONENTS.reduce((sum,id)=>sum+values[id]*12.5,0),components:values,priority_route:inspection.route,entry_at:window.entry_at,exit_at:window.exit_at,source_cutoff_at:options.cutoff,reasons:[]};
}
export function rankResearchCandidates(candidates,window,options={},limit=10){
 if(!Number.isInteger(limit)||limit<5||limit>10)throw new RangeError('Research display limit must be an integer from 5 to 10.');
 const counts=new Map();for(const c of candidates)counts.set(c?.security_id,(counts.get(c?.security_id)||0)+1);
 const assessed=candidates.map(c=>counts.get(c?.security_id)>1?{security_id:nonblank(c?.security_id)?c.security_id:null,status:'withheld',score:null,reasons:['duplicate_security_id']}:scoreResearchCandidate(c,window,options));
 const eligible=assessed.filter(x=>x.status==='scored').sort((a,b)=>b.score-a.score||a.security_id.localeCompare(b.security_id));
 const rows=eligible.slice(0,limit).map((row,index)=>({...row,display_order:index+1,research_rank:eligible.findIndex(x=>x.score===row.score)+1,tie_group:`${SCORE_POLICY}:${row.score}`,tied_priority:eligible.filter(x=>x.score===row.score).length>1}));
 return {policy_version:SCORE_POLICY,audience:'owner_private',ranking_basis:'reviewed_research_evidence',predictive_status:'unvalidated',limit,eligible_count:eligible.length,rows,withheld:assessed.filter(x=>x.status==='withheld')};
}
