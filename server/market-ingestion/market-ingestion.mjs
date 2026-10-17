/**
 * Offline prototype for one approved provider, dataset and permanent security.
 * It validates supplied evidence; it does not establish source authenticity,
 * permission, provider access, a complete calendar, or durable persistence.
 * No network, environment, filesystem, generated clocks or injected callbacks.
 */
export const INGESTION_VERSION = 'prototype-3-scoped-proposed';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.trim().length > 0;
const id = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/i.test(x);
const clone = x => structuredClone(x);
const unique = x => [...new Set(x)];
const canonical = x => JSON.stringify(normalize(x));
function normalize(x) { return Array.isArray(x) ? x.map(normalize) : object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k,normalize(x[k])])) : x; }
function day(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(`${x}T00:00:00Z`)) && new Date(`${x}T00:00:00Z`).toISOString().slice(0,10) === x; }
function instant(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x) || !day(x.slice(0,10))) return NaN;
  const [h,m,s] = x.slice(11,19).split(':').map(Number);
  return h <= 23 && m <= 59 && s <= 59 ? Date.parse(x) : NaN;
}
const utc = x => Number.isFinite(instant(x));
function https(x) { try { const u = new URL(x); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search; } catch { return false; } }
function requestURL(value, canonicalURL) {
  try { const u=new URL(value),base=new URL(canonicalURL);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&u.origin===base.origin&&u.pathname===base.pathname&&![...u.searchParams.keys()].some(key=>/token|key|secret|password|auth|credential/i.test(key)); } catch { return false; }
}
const pick = (x, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(x ?? {},k)).map(k => [k,x[k]]));
const sameSet = (a,b) => Array.isArray(a) && a.length === b.length && new Set(a).size === a.length && b.every(x => a.includes(x));

function cleanSnapshot(s) {
  if (!object(s)) return null;
  return clone({
    ...pick(s,['id','providerId','datasetId','priceSession']),
    security:pick(s.security,['id','cik','ticker','exchange','shareClass','instrumentType','currency','validFrom','validThrough']),
    source:pick(s.source,['url','requestURL','captureId','requestStartedAt','sha256','version','parserVersion','publishedAt','fetchedAt','ingestedAt','availabilityMode','availabilityObservedAt','publicationPrecision','correctionPossible']),
    basis:pick(s.basis,['currency','price','volume','coverage','session']),
    bars:Array.isArray(s.bars) ? s.bars.map(b => pick(b,['securityId','session','open','high','low','close','volume','providerPublishedAt','availabilityObservedAt','status'])) : null,
    actions:{...pick(s.actions,['sourceUrl','sha256','version','securityId','complete','coverageStart','coverageEnd','reviewedAt']),
      coverageReview:pick(s.actions?.coverageReview,['reviewedAt','reviewerVersion','unsupportedActionsReviewed']),
      items:Array.isArray(s.actions?.items) ? s.actions.items.map(a => pick(a,['id','securityId','type','effectiveSession','splitRatio','cashPerShare','currency','perShareBasis'])) : null}
  });
}

function policyReasons(p) {
  return !object(p) || !id(p.id) || !id(p.providerId) || !id(p.datasetId) || !id(p.securityId)
    || !['common_equity','etf'].includes(p.instrumentType ?? 'common_equity') || (p.instrumentType==='etf' && p.usage!=='benchmark') || !id(p.calendarId) || !text(p.exchange) || !/^\d{10}$/.test(p.cik ?? '') || !text(p.shareClass) || p.currency !== 'USD' || p.audience !== 'owner_private'
    || !https(p.sourceUrl) || !https(p.actionsUrl) || (p.sourceUrl === p.actionsUrl && p.actionsSourceMode !== 'same_eod_fields_reviewed')
    || (p.actionsSourceMode === 'same_eod_fields_reviewed' && p.sourceUrl !== p.actionsUrl)
    || !Number.isSafeInteger(p.requiredSessions) || p.requiredSessions < 60 || p.requiredSessions > 260
    || !Number.isSafeInteger(p.maxCheckAgeMs) || p.maxCheckAgeMs <= 0
    || !Number.isSafeInteger(p.maxTermsAgeMs) || p.maxTermsAgeMs <= 0 ? ['policy_invalid'] : [];
}

function calendarInspection(calendar, policy, cutoffAt) {
  const reasons = [];
  if (!object(calendar) || calendar.id !== policy.calendarId || !id(calendar.version) || !hash(calendar.sha256)
    || !utc(calendar.observedAt) || instant(calendar.observedAt) > instant(cutoffAt)
    || !day(calendar.validThrough) || calendar.validThrough < cutoffAt.slice(0,10)
    || !Array.isArray(calendar.sessions) || calendar.sessions.length < policy.requiredSessions) return {reasons:['calendar_unverified'],completed:[]};
  let previous = null;
  for (const s of calendar.sessions) {
    if (!object(s) || !day(s.date) || !utc(s.openAt) || !utc(s.closeAt) || s.openAt.slice(0,10)!==s.date || s.closeAt.slice(0,10)!==s.date || instant(s.openAt) >= instant(s.closeAt)
      || (previous && (s.date <= previous.date || instant(s.openAt) <= instant(previous.closeAt)))) reasons.push('calendar_invalid');
    previous = s;
  }
  const completed = calendar.sessions.filter(s => instant(s?.closeAt) <= instant(cutoffAt));
  if (completed.length < policy.requiredSessions) reasons.push('calendar_history_incomplete');
  return {reasons:unique(reasons),completed};
}

function rightsAt(reviews, operation, at, p) {
  if (!Array.isArray(reviews) || !reviews.length) return [`${operation}_rights_unknown`];
  const reasons = [], identities = new Map();
  for (const r of reviews) {
    if (!object(r) || !id(r.id) || !Number.isSafeInteger(r.version) || r.version < 1 || !utc(r.reviewedAt)
      || !utc(r.validFrom) || !utc(r.expiresAt) || instant(r.validFrom) < instant(r.reviewedAt)
      || instant(r.expiresAt) <= instant(r.validFrom)) { reasons.push('rights_audit_invalid'); continue; }
    const identity = `${r.id}:${r.version}`, fingerprint = canonical(r);
    if (identities.has(identity) && identities.get(identity) !== fingerprint) reasons.push('rights_identity_conflict');
    identities.set(identity,fingerprint);
    if (r.providerId !== p.providerId || r.datasetId !== p.datasetId || r.audience !== p.audience
      || r.purpose !== 'market_data_research' || !sameSet(r.securityIds,[p.securityId])
      || !sameSet(r.urls,unique([p.sourceUrl,p.actionsUrl]))) reasons.push('rights_scope_mismatch');
    if (!Array.isArray(r.termsEvidence) || !r.termsEvidence.length || r.termsEvidence.some(e => !object(e)
      || !https(e.url) || !hash(e.sha256) || !utc(e.observedAt) || instant(e.observedAt) > instant(r.reviewedAt)
      || instant(r.reviewedAt)-instant(e.observedAt) > p.maxTermsAgeMs)) reasons.push('rights_terms_evidence_missing');
  }
  if (reasons.length) return unique(reasons);
  const applicable = reviews.filter(r => instant(r.reviewedAt) <= instant(at) && instant(r.validFrom) <= instant(at))
    .sort((a,b) => instant(b.reviewedAt)-instant(a.reviewedAt) || instant(b.validFrom)-instant(a.validFrom) || b.version-a.version);
  const right = applicable[0];
  if (!right) return [`${operation}_rights_unknown`];
  if (instant(right.expiresAt) <= instant(at)) reasons.push(`${operation}_rights_expired`);
  if (right.operations?.[operation] !== 'allowed') reasons.push(`${operation}_rights_${['denied','revoked'].includes(right.operations?.[operation]) ? right.operations[operation] : 'unknown'}`);
  if (applicable.slice(1).some(r => instant(r.reviewedAt) === instant(right.reviewedAt) && instant(r.validFrom) === instant(right.validFrom)
    && r.operations?.[operation] !== right.operations?.[operation])) reasons.push('rights_contemporaneous_conflict');
  return unique(reasons);
}

/** All inputs are supplied by a separately approved collector/calendar/audit path. */
export function inspectMarketSnapshot(snapshot, options = {}) {
  const unavailable = reasons => ({eligible:false,structurallyValid:false,fresh:false,internalUseAllowed:false,priceDisplayAllowed:false,derivedDisplayAllowed:false,reasons,priceReference:null,liquidity:null});
  if (!object(options) || !utc(options.at) || !utc(options.cutoffAt) || instant(options.cutoffAt) > instant(options.at)) return unavailable(['operation_time_invalid']);
  const {policy:p,calendar,rightsReviews,at,cutoffAt} = options;
  const policyErrors = policyReasons(p); if (policyErrors.length) return unavailable(policyErrors);
  const ci = calendarInspection(calendar,p,cutoffAt); if (ci.reasons.length) return unavailable(ci.reasons);
  const currentCalendar = calendarInspection(calendar,p,at); if (currentCalendar.reasons.length) return unavailable(currentCalendar.reasons);
  let s; try { s = cleanSnapshot(snapshot); } catch { return unavailable(['snapshot_not_serializable']); }
  if (!s) return unavailable(['snapshot_invalid']);
  const reasons = [], source = s.source, security = s.security;
  if (!id(s.id) || s.providerId !== p.providerId || s.datasetId !== p.datasetId || security.id !== p.securityId
    || security.cik !== p.cik || !text(security.ticker) || security.exchange !== p.exchange
    || security.shareClass !== p.shareClass || security.instrumentType !== (p.instrumentType ?? 'common_equity') || security.currency !== p.currency
    || !day(security.validFrom) || !day(security.validThrough)) reasons.push('security_binding_invalid');
  const through = ci.completed.findIndex(x => x.date === s.priceSession);
  const expected = through < 0 ? [] : ci.completed.slice(0,through+1).slice(-p.requiredSessions);
  if (expected.length !== p.requiredSessions || !Array.isArray(s.bars) || s.bars.length !== p.requiredSessions) reasons.push('history_incomplete');
  if (source.url !== p.sourceUrl || !hash(source.sha256) || !id(source.version) || !id(source.parserVersion)) reasons.push('source_provenance_invalid');
  const observedCapture=source.availabilityMode==='observed_capture';
  if (source.availabilityMode!==undefined&&!['provider_published','observed_capture'].includes(source.availabilityMode)) reasons.push('availability_mode_invalid');
  if (source.requestURL!==undefined&&!requestURL(source.requestURL,p.sourceUrl)) reasons.push('request_url_invalid');
  if (source.requestStartedAt!==undefined&&(!utc(source.requestStartedAt)||instant(source.requestStartedAt)>instant(source.fetchedAt))) reasons.push('capture_request_clock_invalid');
  if (![source.fetchedAt,source.ingestedAt].every(utc) || instant(source.fetchedAt) > instant(source.ingestedAt)
    || instant(source.ingestedAt) > instant(cutoffAt)) reasons.push('provider_clock_invalid');
  if (observedCapture) {
    if (source.publishedAt!==null||source.publicationPrecision!=='unknown'||source.correctionPossible!==true||!id(source.captureId)||!utc(source.requestStartedAt)
      || !requestURL(source.requestURL,p.sourceUrl)||!utc(source.availabilityObservedAt)||instant(source.availabilityObservedAt)!==instant(source.fetchedAt)) reasons.push('observed_capture_provenance_invalid');
  } else if (!utc(source.publishedAt)||instant(source.publishedAt)>instant(source.fetchedAt)) reasons.push('provider_clock_invalid');
  if (s.basis.currency !== p.currency || s.basis.price !== 'unadjusted' || s.basis.volume !== 'reported_shares'
    || s.basis.coverage !== 'consolidated' || s.basis.session !== 'regular') reasons.push('price_volume_basis_unsupported');
  if (Array.isArray(snapshot.bars) && snapshot.bars.some(b => object(b) && ['adjustedClose','adjustedVolume','splitFactor','totalReturn'].some(k => Object.hasOwn(b,k)))) reasons.push('mixed_adjustment_basis');
  for (let i = 0; i < (s.bars?.length ?? 0); i++) {
    const b = s.bars[i], session = expected[i];
    if (!session || b.session !== session.date || b.securityId !== p.securityId || b.status !== (observedCapture?'as_observed':'final')) reasons.push('bar_session_or_identity_invalid');
    if (![b.open,b.high,b.low,b.close].every(x => typeof x === 'number' && Number.isFinite(x) && x > 0)
      || b.high < Math.max(b.open,b.close,b.low) || b.low > Math.min(b.open,b.close,b.high)
      || !Number.isSafeInteger(b.volume) || b.volume < 0 || !Number.isFinite(b.close*b.volume)
      || b.close*b.volume > Number.MAX_SAFE_INTEGER) reasons.push('ohlcv_invalid');
    if (observedCapture) {
      if (b.providerPublishedAt!==null||!utc(b.availabilityObservedAt)||instant(b.availabilityObservedAt)!==instant(source.availabilityObservedAt)
        || instant(b.availabilityObservedAt)<instant(session?.closeAt)||instant(b.availabilityObservedAt)>instant(source.ingestedAt)) reasons.push('bar_observation_invalid');
    } else if (!utc(b.providerPublishedAt) || instant(b.providerPublishedAt) < instant(session?.closeAt)
      || instant(b.providerPublishedAt) > instant(source.publishedAt)) reasons.push('bar_publication_invalid');
  }
  if (expected.length && (security.validFrom > expected[0].date || security.validThrough < s.priceSession)) reasons.push('security_effective_interval_incomplete');
  const a = s.actions;
  if (a.sourceUrl !== p.actionsUrl || !hash(a.sha256) || !id(a.version) || a.securityId !== p.securityId
    || a.complete !== true || !day(a.coverageStart) || !day(a.coverageEnd) || !utc(a.reviewedAt)
    || instant(a.reviewedAt) > instant(source.ingestedAt) || instant(a.reviewedAt) < instant(expected.at(-1)?.closeAt)
    || (expected.length && (a.coverageStart > expected[0].date || a.coverageEnd < s.priceSession))
    || !Array.isArray(a.items)) reasons.push('corporate_actions_incomplete');
  if (p.actionsSourceMode==='same_eod_fields_reviewed' && (a.sourceUrl!==source.url||a.sha256?.toLowerCase()!==source.sha256?.toLowerCase()
    || !utc(a.coverageReview.reviewedAt)||instant(a.coverageReview.reviewedAt)<instant(expected.at(-1)?.closeAt)||instant(a.coverageReview.reviewedAt)>instant(source.ingestedAt)
    || !id(a.coverageReview.reviewerVersion)||a.coverageReview.unsupportedActionsReviewed!==true)) reasons.push('shared_actions_coverage_unreviewed');
  const actionIds = new Set();
  for (const action of a.items ?? []) {
    if (!id(action.id) || actionIds.has(action.id) || action.securityId !== p.securityId
      || !expected.some(x => x.date === action.effectiveSession)) reasons.push('corporate_action_identity_invalid');
    actionIds.add(action.id);
    if (action.type === 'split') {
      if (!Number.isFinite(action.splitRatio) || action.splitRatio <= 0 || action.splitRatio === 1 || action.cashPerShare !== undefined) reasons.push('split_invalid');
    } else if (action.type === 'cash_dividend') {
      if (!Number.isFinite(action.cashPerShare) || action.cashPerShare < 0 || action.currency !== p.currency || action.splitRatio !== undefined) reasons.push('distribution_invalid');
    } else reasons.push('corporate_action_unsupported');
  }
  if (reasons.length) return unavailable(unique(reasons));
  const capture = [...(utc(source.requestStartedAt)?rightsAt(rightsReviews,'fetch',source.requestStartedAt,p):[]),...rightsAt(rightsReviews,'fetch',source.fetchedAt,p),...rightsAt(rightsReviews,'store',source.ingestedAt,p),...rightsAt(rightsReviews,'transform',source.ingestedAt,p)];
  const checkAt = options.lastSuccessfulCheckAt ?? source.fetchedAt;
  if (!utc(checkAt) || instant(checkAt) < instant(source.fetchedAt) || instant(checkAt) > instant(at)) return unavailable(['check_clock_invalid']);
  const fresh = s.priceSession === ci.completed.at(-1).date && s.priceSession === currentCalendar.completed.at(-1).date && instant(at)-instant(checkAt) < p.maxCheckAgeMs;
  if (!fresh) reasons.push('price_check_stale');
  const currentStore = rightsAt(rightsReviews,'store',at,p), currentTransform = rightsAt(rightsReviews,'transform',at,p);
  const display = rightsAt(rightsReviews,'display',at,p);
  const derive=rightsAt(rightsReviews,'derive',at,p),derived = [...derive,...rightsAt(rightsReviews,'derived_display',at,p)];
  const priceDisplayAllowed = capture.length === 0 && display.length === 0;
  const internalUseAllowed = capture.length === 0 && fresh && currentTransform.length === 0 && derive.length === 0;
  const derivedDisplayAllowed = capture.length === 0 && fresh && currentTransform.length === 0 && derived.length === 0;
  const last = s.bars.at(-1), dollarVolumes = s.bars.map(b => b.close*b.volume).sort((a,b) => a-b), n = dollarVolumes.length;
  const currentReview = Array.isArray(rightsReviews) ? [...rightsReviews].filter(r => object(r) && instant(r.reviewedAt) <= instant(at) && instant(r.validFrom) <= instant(at)).sort((a,b) => instant(b.reviewedAt)-instant(a.reviewedAt) || instant(b.validFrom)-instant(a.validFrom) || b.version-a.version)[0] : null;
  const lineage = {snapshotId:s.id,providerId:p.providerId,datasetId:p.datasetId,priceHash:source.sha256,actionsHash:a.sha256,calendarId:calendar.id,calendarVersion:calendar.version,rightsReviewId:currentReview?.id ?? null,rightsReviewVersion:currentReview?.version ?? null,evaluatedAt:at};
  return {eligible:capture.length === 0 && currentStore.length === 0 && currentTransform.length === 0 && fresh,
    structurallyValid:true,fresh,internalUseAllowed,priceDisplayAllowed,derivedDisplayAllowed,
    reasons:unique([...reasons,...capture,...currentStore,...currentTransform,...display,...derived]),
    priceReference:priceDisplayAllowed ? {securityId:p.securityId,value:last.close,currency:p.currency,session:last.session,providerPublishedAt:last.providerPublishedAt,availabilityObservedAt:observedCapture?last.availabilityObservedAt:null,publicationPrecision:observedCapture?'unknown':'exact',correctionPossible:true,sourceUrl:source.url,kind:'completed_session_reference',executableEntry:false,lineage:clone(lineage)} : null,
    liquidity:derivedDisplayAllowed ? {kind:'median_daily_dollar_volume',value:n%2 ? dollarVolumes[(n-1)/2] : (dollarVolumes[n/2-1]+dollarVolumes[n/2])/2,currency:p.currency,sessions:n,coverage:'consolidated',basis:'raw_close_times_reported_volume',snapshotId:s.id,calculationVersion:INGESTION_VERSION,lineage:clone(lineage)} : null};
}

function validArchive(a) {
  return object(a) && Number.isSafeInteger(a.revision) && a.revision >= 0 && Array.isArray(a.snapshots) && a.snapshots.every(s => object(s) && id(s.id) && object(s.source) && hash(s.source.sha256) && object(s.actions) && hash(s.actions.sha256) && Array.isArray(s.bars) && s.bars.every(object) && object(s.security) && object(s.basis))
    && new Set(a.snapshots.map(s => s.id)).size === a.snapshots.length && Array.isArray(a.runs) && a.runs.every(r => object(r) && id(r.runId) && utc(r.committedAt))
    && new Set(a.runs.map(r => r.runId)).size === a.runs.length && (!a.snapshots.length ? a.activeSnapshotId == null : a.snapshots.some(s => s.id === a.activeSnapshotId));
}
const pricesMeaning = s => canonical({providerId:s.providerId,datasetId:s.datasetId,security:s.security,basis:s.basis,priceSession:s.priceSession,bars:s.bars.map(b=>pick(b,['securityId','session','open','high','low','close','volume','providerPublishedAt','status']))});
const actionsMeaning = s => canonical(pick(s.actions,['securityId','complete','coverageStart','coverageEnd','items']));

/** Candidate transaction only; a host must atomically persist the revision and all data. */
export function commitMarketSnapshot(previous, event, options = {}) {
  const reject = (...reasons) => ({accepted:false,reasons:unique(reasons),archive:previous});
  if (!validArchive(previous) || !object(event) || !object(options) || !utc(options.at)) return reject('archive_or_event_invalid');
  if (!id(event.runId) || !Number.isSafeInteger(event.expectedRevision) || !['snapshot','failed'].includes(event.outcome)
    || !utc(event.startedAt) || !utc(event.checkedAt) || instant(event.startedAt) > instant(event.checkedAt) || instant(event.checkedAt) > instant(options.at)) return reject('event_invalid');
  let update; try { update = {...pick(event,['runId','expectedRevision','outcome','startedAt','checkedAt']),snapshot:event.snapshot ? cleanSnapshot(event.snapshot) : null,failureCode:event.outcome === 'failed' ? event.failureCode : null}; } catch { return reject('event_not_serializable'); }
  if (event.outcome === 'failed' && (event.snapshot || typeof event.failureCode !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(event.failureCode))) return reject('failure_invalid');
  let fingerprint; try { fingerprint = canonical(update); } catch { return reject('event_not_serializable'); }
  const replay = previous.runs.find(r => r.runId === event.runId);
  if (replay) return replay.eventFingerprint === fingerprint ? {accepted:true,reasons:[],archive:previous} : reject('run_id_conflict');
  if (event.expectedRevision !== previous.revision) return reject('revision_conflict');
  if (previous.revision === Number.MAX_SAFE_INTEGER) return reject('revision_exhausted');
  if (previous.runs.some(r => instant(r.committedAt) > instant(options.at))
    || (previous.lastCheckedAt && (!utc(previous.lastCheckedAt) || instant(event.startedAt) < instant(previous.lastCheckedAt)))) return reject('clock_regression');
  const next = clone(previous), active = previous.snapshots.find(s => s.id === previous.activeSnapshotId);
  next.revision++; next.lastCheckedAt = event.checkedAt;
  let admittedSnapshotId = null;
  if (event.outcome === 'failed') next.sourceStatus = 'check_failed';
  else {
    const s = update.snapshot;
    if (!s || instant(s.source.fetchedAt) < instant(event.startedAt) || instant(s.source.ingestedAt) > instant(event.checkedAt)) return reject('capture_outside_run');
    // Inspect the supplied object as well, so unsupported mixed adjustment fields
    // cannot be removed by normalization before their inconsistency is detected.
    const inspection = inspectMarketSnapshot(event.snapshot,{...options,lastSuccessfulCheckAt:undefined});
    if (!inspection.eligible) return reject(...inspection.reasons);
    if (active && active.source.sha256.toLowerCase() === s.source.sha256.toLowerCase() && pricesMeaning(active) !== pricesMeaning(s)) return reject('same_price_hash_conflicting_payload');
    if (active && active.actions.sha256.toLowerCase() === s.actions.sha256.toLowerCase() && actionsMeaning(active) !== actionsMeaning(s)) return reject('same_actions_hash_conflicting_payload');
    const unchanged = active && pricesMeaning(active) === pricesMeaning(s) && actionsMeaning(active) === actionsMeaning(s);
    if (!unchanged) {
      if (previous.snapshots.some(x => x.id === s.id)) return reject('snapshot_id_conflict');
      next.snapshots.push(s); next.activeSnapshotId = s.id; admittedSnapshotId = s.id; next.dataChangedAt = options.at;
    }
    next.sourceStatus = 'available'; next.lastSuccessfulCheckAt = event.checkedAt;
  }
  next.runs.push({runId:event.runId,revision:next.revision,expectedRevision:event.expectedRevision,startedAt:event.startedAt,checkedAt:event.checkedAt,committedAt:options.at,outcome:event.outcome,eventFingerprint:fingerprint,admittedSnapshotId,...(event.outcome === 'failed' ? {failureCode:event.failureCode} : {})});
  return {accepted:true,reasons:[],archive:next};
}

/** Raw reference display and derived metrics are separately rechecked on every read. */
export function projectMarketArchive(archive, options = {}) {
  const empty = {sourceStatus:'unavailable',priceReference:null,liquidity:null,internalInputsUsable:false,feedInputsUsable:false,rawDisplayAllowed:false,derivedDisplayAllowed:false,rank:null,score:null,expectedReturn:null,gainProbability:null,marketCap:null,refreshConfigured:false};
  if (!validArchive(archive) || !object(options) || !utc(options.at)) return {...empty,reasons:['archive_or_operation_invalid']};
  if ([archive.lastCheckedAt,archive.lastSuccessfulCheckAt,archive.dataChangedAt].filter(x => x != null).some(x => !utc(x) || instant(x) > instant(options.at))) return {...empty,reasons:['archive_clock_invalid']};
  const active = archive.snapshots.find(s => s.id === archive.activeSnapshotId);
  if (!active) return {...empty,reasons:['snapshot_missing']};
  const result = inspectMarketSnapshot(active,{...options,lastSuccessfulCheckAt:archive.lastSuccessfulCheckAt});
  const failed = archive.sourceStatus === 'check_failed';
  const sourceStatus = !result.structurallyValid ? 'evidence_blocked' : !result.priceDisplayAllowed&&!result.derivedDisplayAllowed ? 'rights_blocked' : failed ? 'check_failed' : !result.fresh ? 'check_overdue' : !result.priceDisplayAllowed ? 'derived_only_context' : 'completed_session_reference';
  return {...empty,sourceStatus,priceReference:result.priceReference,liquidity:failed ? null : result.liquidity,
    internalInputsUsable:!failed&&result.eligible&&result.internalUseAllowed,feedInputsUsable:!failed&&result.eligible&&result.derivedDisplayAllowed,
    rawDisplayAllowed:result.priceDisplayAllowed,derivedDisplayAllowed:!failed&&result.derivedDisplayAllowed,
    lastCheckedAt:archive.lastCheckedAt ?? null,lastSuccessfulCheckAt:archive.lastSuccessfulCheckAt ?? null,dataChangedAt:archive.dataChangedAt ?? null,
    reasons:unique([...result.reasons,...(failed ? ['latest_check_failed'] : [])])};
}
