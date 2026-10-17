// priority_v0_1 is a research queue, never an expected-return model.
// Gate attestations must come from reviewed ingestion; JSON shape alone is not evidence.
export const METHOD_VERSION = 'priority_v0_1';
export const REQUIRED_GATES = ['identity', 'prices_actions', 'company_evidence', 'event_calendar', 'mechanism', 'financing', 'provenance_rights'];
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const parsed=Date.parse(value),day=Date.parse(`${value.slice(0,10)}T00:00:00Z`);
  if (!Number.isFinite(parsed) || !Number.isFinite(day) || new Date(day).toISOString().slice(0,10)!==value.slice(0,10)) return NaN;
  const [hour,minute,second]=value.slice(11,19).split(':').map(Number);
  if (hour>23 || minute>59 || second>59) return NaN;
  if (!value.endsWith('Z')) {const [hour,minute]=value.slice(-5).split(':').map(Number);if(hour>14 || minute>59 || (hour===14 && minute!==0))return NaN;}
  return parsed;
}
const sourceLinked = item => Array.isArray(item?.source_refs) && item.source_refs.length > 0 && item.source_refs.every(ref=>typeof ref==='string'&&ref.trim().length>0);

// Structured human/ingestion attestations, not proof derived from caller prose.
// Legacy free-text EPS bases cannot establish diluted, comparable per-share economics.
const nonblank = value => typeof value === 'string' && value.trim().length > 0;
// Required case prose must contain visible content. Check without rewriting the
// reviewed text; joiners and other default-ignorable characters may occur in it.
const readable = value => typeof value === 'string' && value.replace(/[\s\p{Cc}\p{Default_Ignorable_Code_Point}]/gu,'').length > 0;
function reviewedRouteARecord(record, guidance, at, cutoff) {
  const published = instant(guidance?.published_interval?.end);
  return record && nonblank(record.reviewer_id) &&
    Array.isArray(record.source_refs) && record.source_refs.length > 0 && record.source_refs.every(nonblank) &&
    Number.isFinite(published) && instant(record.reviewed_at) >= published &&
    instant(record.reviewed_at) <= instant(cutoff) && instant(record.expires_at) > instant(at);
}
function routeAReviewPassed(guidance, at, cutoff) {
  const metric = guidance?.metric_review, driver = guidance?.operating_driver_review;
  return ['gaap_diluted_eps', 'adjusted_diluted_eps'].includes(guidance?.before_basis) &&
    guidance.before_basis === guidance.after_basis &&
    reviewedRouteARecord(metric, guidance, at, cutoff) && metric.metric === 'diluted_eps' &&
    nonblank(metric.share_class_id) && nonblank(metric.before_share_basis) &&
    metric.before_share_basis === metric.after_share_basis &&
    Number.isFinite(instant(metric.effective_at)) && instant(metric.effective_at) <= instant(guidance.published_interval.end) &&
    reviewedRouteARecord(driver, guidance, at, cutoff) &&
    driver.status === 'verified_operating_contribution' && driver.solely_non_operating === false;
}

function orderedSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.some(s=>!Number.isFinite(instant(s?.open)) || !Number.isFinite(instant(s?.close)) || instant(s.close)<=instant(s.open))) return null;
  const ordered=[...sessions].sort((a,b)=>instant(a.open)-instant(b.open));
  // Compare instants, not timestamp spellings. Overlapping records cannot be
  // counted as distinct regular sessions, even when their offsets differ.
  if (ordered.some((s,index)=>index>0 && instant(s.open)<instant(ordered[index-1].close))) return null;
  return ordered;
}

function guidanceAge(sessions,coverage,releaseStart,cutoff) {
  const ordered=orderedSessions(sessions),from=instant(coverage?.from),through=instant(coverage?.through),reviewed=instant(coverage?.reviewed_at);
  // This is a reviewed calendar-ingestion attestation, not a proof supplied by
  // JSON shape. Its count binds the complete covered interval to this array.
  if (!ordered || coverage?.state!=='complete' || !sourceLinked(coverage) || !Number.isFinite(from) || !Number.isFinite(through) || !Number.isFinite(reviewed) || reviewed>cutoff || from>releaseStart || through<cutoff || from>=through || !Number.isSafeInteger(coverage.session_count) || coverage.session_count<1) return null;
  const completed=ordered.filter(s=>instant(s.close)>=from && instant(s.close)<=cutoff);
  if (completed.length!==coverage.session_count || completed.some(s=>instant(s.open)<from) || !completed.some(s=>instant(s.open)<=releaseStart)) return null;
  return completed.filter(s=>instant(s.close)>=releaseStart).length;
}

export function horizonWindow(sessions, publishedAt, horizonId = 'next_day') {
  const published = instant(publishedAt), count = horizonId === 'next_week' ? 5 : horizonId === 'next_day' ? 1 : 0;
  const ordered=orderedSessions(sessions);
  if (!Number.isFinite(published) || !count || !ordered) return null;
  const future = ordered.filter(s => instant(s.open) > published);
  if (future.length < count) return null;
  return { horizon_id:horizonId, entry_at:future[0].open, exit_at:future[count-1].close, expires_at:future[count-1].close, timezone:'America/New_York', sessions:future.slice(0,count) };
}

export function windowState(window, at) {
  const now = instant(at), start = instant(window?.entry_at), end = instant(window?.exit_at);
  if (![now,start,end].every(Number.isFinite) || start >= end) return 'unavailable';
  return now >= end ? 'archived' : now >= start ? 'in_progress' : 'upcoming';
}

export function eventPosition(event, window) {
  const start = instant(event?.start), end = instant(event?.end || event?.start), entry = instant(window?.entry_at), exit = instant(window?.exit_at);
  if (![start,end,entry,exit].every(Number.isFinite) || end < start || entry >= exit) return 'unknown';
  if (end < entry) return 'before_entry';
  if (start > exit) return 'after_exit';
  if (start < entry || end > exit) return 'unknown';
  return 'in_window';
}

export function classifyCandidate(candidate, window, {at, cutoff, completedSessions = [], completedSessionCoverage} = {}) {
  const reasons = [];
  if (!['next_day','next_week'].includes(window?.horizon_id)) reasons.push('horizon_unsupported');
  if (windowState(window,at) !== 'upcoming') reasons.push('window_not_upcoming');
  if (!Number.isFinite(instant(cutoff)) || instant(cutoff) > instant(at) || instant(cutoff) >= instant(window?.entry_at)) reasons.push('cutoff_invalid');
  if (!nonblank(candidate?.security_id) || candidate.security_id!==candidate.security_id.trim() || !/^\d{10}$/.test(candidate?.cik || '')) reasons.push('identity_unresolved');
  for (const id of REQUIRED_GATES) {
    const matches = Array.isArray(candidate?.gates) ? candidate.gates.filter(g=>g?.id===id) : [];
    const gate = matches[0];
    if (matches.length!==1 || gate?.state !== 'passed' || !sourceLinked(gate) || !Number.isFinite(instant(gate?.reviewed_at)) || instant(gate.reviewed_at)>instant(cutoff) || !(instant(gate.expires_at)>instant(at))) reasons.push(`${id}_blocked`);
  }
  if (![candidate?.positive_case,candidate?.counter_case,candidate?.invalidation_trigger].every(readable) || !sourceLinked(candidate)) reasons.push('mechanism_incomplete');
  if (candidate?.pre_entry_release_unreconciled) reasons.push('pre_entry_release_unreconciled');
  const g = candidate?.guidance;
  let route = null, orderKey = null;
  if (g) {
    const comparable = g.before_basis && g.before_basis === g.after_basis && g.before_period && g.before_period === g.after_period && g.currency && g.before_currency === g.currency && g.after_currency === g.currency;
    const values = [g.eps_before,g.eps_after,g.revenue_before,g.revenue_after];
    const releaseStart=instant(g.published_interval?.start), releaseEnd=instant(g.published_interval?.end);
    const maxAge=guidanceAge(completedSessions,completedSessionCoverage,releaseStart,instant(cutoff));
    const limit=window?.horizon_id==='next_day'?1:5;
    if (comparable && routeAReviewPassed(g, at, cutoff) && values.every(Number.isFinite) && g.eps_before>0 && g.eps_after>g.eps_before && g.revenue_before>0 && g.revenue_after>=g.revenue_before && readable(g.operating_explanation) && g.adjustments_reconciled===true && sourceLinked(g) && releaseEnd>=releaseStart && releaseEnd<=instant(cutoff) && maxAge!==null && maxAge<=limit) {route='A';orderKey=maxAge;}
  }
  const e=candidate?.catalyst;
  if (!route && e?.status==='confirmed' && eventPosition(e.interval,window)==='in_window' && [e.expected_information,e.positive,e.adverse,e.company_reference].every(readable) && e.reviewer_signed_off===true && sourceLinked(e)) {route='B';orderKey=instant(e.interval.start);}
  if (!route) reasons.push('no_qualifying_route');
  return {eligible:reasons.length===0, route:reasons.length?null:route, orderKey:reasons.length?null:orderKey, reasons, expected_return:null, gain_probability:null};
}

export function orderCandidates(candidates, window, options) {
  const admitted = candidates.map(candidate=>({candidate,inspection:classifyCandidate(candidate,window,options)})).filter(x=>x.inspection.eligible);
  admitted.sort((a,b)=>a.inspection.route.localeCompare(b.inspection.route)||a.inspection.orderKey-b.inspection.orderKey||a.candidate.security_id.localeCompare(b.candidate.security_id));
  return admitted.map(({candidate,inspection})=>({...candidate,priority_route:inspection.route, tie_group:`${inspection.route}:${inspection.orderKey}`, tied_priority:admitted.filter(x=>x.inspection.route===inspection.route&&x.inspection.orderKey===inspection.orderKey).length>1, ordering_reason:inspection.route==='A'?'Research priority: comparable operating guidance changed more recently. This does not establish a higher expected stock return.':'Research priority: earlier confirmed information event. This does not establish a higher expected stock return.', expected_return:null,gain_probability:null}));
}

export function referenceReturn({entryPrice,exitPrice,distribution=0,entryAt,exitAt,window}) {
  if (![entryPrice,exitPrice,distribution].every(Number.isFinite) || entryPrice<=0 || exitPrice<0 || distribution<0 || instant(entryAt)!==instant(window?.entry_at) || instant(exitAt)!==instant(window?.exit_at)) return null;
  return (exitPrice+distribution)/entryPrice-1;
}

export function buildStockSnapshot(payload, horizonId, at) {
  const events=payload?.event_evidence, operating=payload?.operating_evidence;
  if (!events || !operating) return null;
  const h=events.horizons;
  const window={horizon_id:horizonId, entry_at:h.entry_at_utc, exit_at:horizonId==='next_week'?h.week_exit_at_utc:h.day_exit_at_utc, timezone:'America/New_York'};
  const status=windowState(window,at);
  const hypotheses=[...operating.hypotheses,...operating.caution_watch].map(item=>({...item,rank:null,expected_return:null,gain_probability:null,price_reference:null,gate_reasons:Object.entries(operating.publication_gates).filter(([key])=>!['market_consensus','event_dates','ranked_upside_list'].includes(key))})).sort((a,b)=>a.ticker.localeCompare(b.ticker));
  const eventWatch=events.candidates.map(item=>({...item,rank:null,position:eventPosition({start:item.webcast_at_utc,end:item.webcast_at_utc},window)})).sort((a,b)=>a.event_date.localeCompare(b.event_date)||a.ticker.localeCompare(b.ticker));
  return {id:`manual-2026-10-17-${horizonId}`,method_version:METHOD_VERSION,mode:status==='unavailable'?'unavailable':'evidence_only',ranking_basis:'research_priority',predictive_status:'unvalidated',window,status,reviewed_at:operating.checked_at_utc,source_cutoff_at:null,price_session:h.last_completed_regular_session,price_available:false,roster_count:new Set([...hypotheses,...eventWatch].map(x=>x.ticker)).size,screened_count:operating.screened_count,blocked_count:operating.blocked_count,candidates:[],hypotheses,event_watch:eventWatch,sources:operating.sources,macro_context:operating.macro_context,source_checks:Array.isArray(operating.source_checks)?operating.source_checks:[],conclusion:horizonId==='next_week'?operating.conclusion.next_week:operating.conclusion.next_day};
}
