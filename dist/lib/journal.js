// Private journal domain. No network, broker, clock or storage is used unless
// explicitly injected. Hash/shape checks establish integrity, not publisher authority.
export const JOURNAL_SCHEMA='cribscore_journal_v1';
export const DEFAULT_PAPER_SETTINGS=Object.freeze({paperNotional:'100.000000',commissionPerFill:'0.000000',slippageBps:5,currency:'USD',benchmarkSymbol:'SPY',benchmarkEntityId:null});
export const JOURNAL_LIMITS=Object.freeze({events:20000,bytes:8000000});
const CASH=1000000n,QTY=100000000n,MAX_EVENTS=JOURNAL_LIMITS.events,MAX_BYTES=JOURNAL_LIMITS.bytes;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,list)=>object(v)&&Object.keys(v).length===list.length&&list.every(k=>Object.hasOwn(v,k));
const clean=(v,max=160)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const id=v=>clean(v)&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v);
const symbol=v=>typeof v==='string'&&/^[A-Z][A-Z0-9.-]{0,14}$/.test(v);
const instant=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&instant(`${v}T00:00:00Z`);
const horizon=v=>['next_day','next_week'].includes(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>JSON.stringify(v,(_,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>canonical(a)===canonical(b);
const immutable=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))immutable(x);Object.freeze(v);}return v;};
const failure=code=>({ok:false,errors:[code]});
function requireThat(value,code){if(!value)throw new Error(code);}
const decimalRules={6:{pattern:/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/,scale:CASH},8:{pattern:/^(?:0|[1-9]\d{0,14})(?:\.\d{1,8})?$/,scale:QTY}};
function decimal(value,places=6,{positive=false}={}){
  requireThat(typeof value==='string'&&decimalRules[places].pattern.test(value),'invalid_decimal');
  const [whole,part='']=value.split('.'),n=BigInt(whole)*decimalRules[places].scale+BigInt(part.padEnd(places,'0'));
  requireThat(!positive||n>0n,'nonpositive_decimal');return n;
}
function format(n,places=6){const sign=n<0n?'-':'';n=n<0n?-n:n;const scale=10n**BigInt(places);return `${sign}${n/scale}.${String(n%scale).padStart(places,'0')}`;}
function round(n,d){requireThat(d>0n,'invalid_divisor');return n<0n?-round(-n,d):(n+d/2n)/d;}
function validateSettings(v){
  requireThat(object(v)&&['paperNotional','commissionPerFill','slippageBps','currency','benchmarkSymbol'].every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>['paperNotional','commissionPerFill','slippageBps','currency','benchmarkSymbol','benchmarkEntityId'].includes(k))&&(v.benchmarkEntityId==null||clean(v.benchmarkEntityId,160)),'invalid_settings');
  requireThat(decimal(v.paperNotional,6,{positive:true})>decimal(v.commissionPerFill),'notional_does_not_cover_fee');
  requireThat(Number.isInteger(v.slippageBps)&&v.slippageBps>=0&&v.slippageBps<=1000&&v.currency==='USD'&&symbol(v.benchmarkSymbol),'invalid_settings');
}
// Field diagnostics share the domain decimal/settings rules; journal validation
// still reports its original first error and checks every accepted prefix.
export function validatePaperSettings(settings){
  try{validateSettings(settings);return {ok:true,fieldErrors:{}};}catch(error){
    const fieldErrors={},v=object(settings)?settings:{};let notional,commission;
    try{notional=decimal(v.paperNotional,6,{positive:true});}catch{fieldErrors.paperNotional='Enter a positive amount with up to 6 decimal places.';}
    try{commission=decimal(v.commissionPerFill);}catch{fieldErrors.commissionPerFill='Enter zero or a positive amount with up to 6 decimal places.';}
    if(notional!==undefined&&commission!==undefined&&notional<=commission){fieldErrors.paperNotional='Paper notional must be greater than commission per fill.';fieldErrors.commissionPerFill='Commission per fill must be less than paper notional.';}
    if(!Number.isInteger(v.slippageBps)||v.slippageBps<0||v.slippageBps>1000)fieldErrors.slippageBps='Enter a whole number from 0 to 1000.';
    if(!symbol(v.benchmarkSymbol))fieldErrors.benchmarkSymbol='Enter a symbol starting with a letter, using up to 15 letters, numbers, dots or hyphens.';
    return {ok:false,errors:[error.message||'invalid_settings'],fieldErrors};
  }
}
function validateFill(v){
  requireThat(keys(v,['side','occurredAt','quantity','price','fee','currency'])&&['buy','sell'].includes(v.side)&&instant(v.occurredAt)&&v.currency==='USD','invalid_fill');
  return {quantity:decimal(v.quantity,8,{positive:true}),price:decimal(v.price,6,{positive:true}),fee:decimal(v.fee)};
}
// Input diagnostics do not authorize or append a fill. The complete journal
// graph still checks confirmation, publication time, corrections and holdings.
export function validateActualFillFields(fill,{requiresReason=false,reason}={}){
  const v=object(fill)?fill:{},fieldErrors={};let error;
  try{validateFill(fill);}catch(caught){error=caught.message||'invalid_fill';}
  if(!['buy','sell'].includes(v.side))fieldErrors.side='Choose Buy or Sell.';
  if(!instant(v.occurredAt))fieldErrors.occurredAt='Enter a valid UTC date and time.';
  for(const [name,places,positive,message] of [['quantity',8,true,'Enter a positive quantity with up to 8 decimal places.'],['price',6,true,'Enter a positive price with up to 6 decimal places.'],['fee',6,false,'Enter zero or a positive fee with up to 6 decimal places.']]){
    try{decimal(v[name],places,{positive});}catch{fieldErrors[name]=message;}
  }
  if(requiresReason&&!clean(reason,500)){fieldErrors.reason='Enter a reason for correction using 1 to 500 characters, without control characters.';error=error||'invalid_fill_revision';}
  return error?{ok:false,errors:[error],fieldErrors}:{ok:true,fieldErrors};
}
function safeJSON(v,depth=0){
  if(v===null||typeof v==='boolean')return true;
  if(typeof v==='number')return Number.isFinite(v);
  if(typeof v==='string')return v.length<=350000;
  if(depth>30||(!Array.isArray(v)&&!object(v)))return false;
  return Object.entries(v).every(([k,x])=>!['__proto__','prototype','constructor'].includes(k)&&safeJSON(x,depth+1));
}
async function sha256(bytes){const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(bytes));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function publicationPayload(data){return JSON.parse(data.payloadBytes);}
function validateWindow(w){
  requireThat(keys(w,['calendarId','calendarSha256','timeZone','publishedAt','horizonSessions','entrySession','exitSession','entryAt','exitAt','sessions']),'invalid_window');
  requireThat(id(w.calendarId)&&/^[a-f0-9]{64}$/.test(w.calendarSha256)&&clean(w.timeZone,80)&&instant(w.publishedAt)&&[1,5].includes(w.horizonSessions)&&day(w.entrySession)&&day(w.exitSession)&&instant(w.entryAt)&&instant(w.exitAt)&&Date.parse(w.publishedAt)<Date.parse(w.entryAt)&&Date.parse(w.entryAt)<Date.parse(w.exitAt),'invalid_window');
  requireThat(Array.isArray(w.sessions)&&w.sessions.length===w.horizonSessions,'invalid_sessions');
  for(let i=0;i<w.sessions.length;i++){const s=w.sessions[i];requireThat(keys(s,['date','openAt','closeAt'])&&day(s.date)&&instant(s.openAt)&&instant(s.closeAt)&&Date.parse(s.openAt)<Date.parse(s.closeAt)&&(!i||Date.parse(w.sessions[i-1].closeAt)<Date.parse(s.openAt)),'invalid_sessions');}
  requireThat(w.sessions[0].date===w.entrySession&&w.sessions.at(-1).date===w.exitSession&&w.sessions[0].openAt===w.entryAt&&w.sessions.at(-1).closeAt===w.exitAt,'window_session_mismatch');
}
function validateMark(m,{symbol:expected,entityId,at,eventAt,session,kind}={}){
  requireThat(object(m)&&id(m.seriesId)&&symbol(m.symbol)&&(!expected||m.symbol===expected)&&clean(m.entityId,160)&&(!entityId||m.entityId===entityId)&&m.priceTimestamp===null&&m.executionBasis==='daily_bar_paper_reference'&&m.currency==='USD'&&day(m.session)&&['open','close'].includes(m.kind)&&(!kind||m.kind===kind)&&(!session||m.session===session)&&instant(m.eventAt)&&instant(m.availableAt)&&m.priceBasis==='unadjusted'&&id(m.reviewId),'invalid_mark');
  decimal(m.value,6,{positive:true});
  requireThat(Date.parse(m.availableAt)>=Date.parse(m.eventAt)&&(!at||Date.parse(m.availableAt)<=Date.parse(at))&&(!eventAt||Date.parse(m.eventAt)===Date.parse(eventAt)),'mark_not_available_at_event');
  const s=m.source;requireThat(object(s)&&s.priceSession==='regular_daily_aggregate'&&clean(s.provider)&&clean(s.dataset)&&clean(s.url,2048)&&instant(s.capturedAt)&&Date.parse(s.capturedAt)>=Date.parse(m.availableAt)&&/^[a-f0-9]{64}$/.test(s.responseSha256)&&(!at||Date.parse(s.capturedAt)<=Date.parse(at)),'invalid_mark_provenance');
}
function validateAction(a){
  requireThat(object(a)&&id(a.id)&&['split','cash_dividend'].includes(a.type)&&day(a.effectiveSession)&&instant(a.effectiveAt),'invalid_action');
  if(a.type==='split')requireThat(keys(a.splitRatio,['numerator','denominator'])&&/^[1-9]\d{0,9}$/.test(a.splitRatio.numerator)&&/^[1-9]\d{0,9}$/.test(a.splitRatio.denominator),'invalid_split');
  else {decimal(a.cashPerShare);requireThat(a.currency==='USD'&&['post_split','current_shares'].includes(a.perShareBasis),'invalid_dividend_basis');}
}
function validateCoverage(v,w,throughSession=w.exitSession){requireThat(object(v)&&v.coverage==='verified_complete'&&day(v.fromSession)&&day(v.throughSession)&&v.fromSession<=w.entrySession&&v.throughSession>=throughSession&&Array.isArray(v.items),'action_coverage_missing');for(const a of v.items){validateAction(a);requireThat(a.effectiveSession>=v.fromSession&&a.effectiveSession<=v.throughSession,'action_outside_coverage');const session=w.sessions?.find(s=>s.date===a.effectiveSession);if(session)requireThat(Date.parse(a.effectiveAt)===Date.parse(session.openAt),'action_calendar_mismatch');}requireThat(new Set(v.items.map(a=>a.id)).size===v.items.length,'duplicate_action');}
const find=(j,eventId)=>j.events.find(e=>e.id===eventId);
const latest=(j,kind,predicate=()=>true)=>j.events.filter(e=>e.kind===kind&&predicate(e)).at(-1);
function scheduleFor(j,intent){return intent.data.window||latest(j,'paper_schedule',e=>e.data.intentId===intent.id)?.data.window||null;}
function effectiveFills(j,intentId){const replacements=new Map();for(const e of j.events)if(e.kind==='fill_revision')replacements.set(e.data.fillId,e.data.replacement);return j.events.filter(e=>e.kind==='actual_fill'&&e.data.intentId===intentId).map(e=>({id:e.id,...(replacements.get(e.id)||e.data.fill)}));}
function actualReview(j,intentId,fills){if(!fills.length)return null;const times=fills.map(f=>Date.parse(f.occurredAt)),first=Math.min(...times),last=Math.max(...times);return j.events.filter(e=>e.kind==='actual_action_review'&&e.data.intentId===intentId&&Date.parse(e.data.fromAt)<=first&&Date.parse(e.data.throughAt)>=last).at(-1)?.data||null;}
// A review may retain later scheduled actions; every actual path uses its cutoff.
function actualActions(review){return review?review.coverage.items.filter(action=>Date.parse(action.effectiveAt)<=Date.parse(review.throughAt)):[];}
function contextFor(j,intent){return find(j,intent.data.publicationEventId);}
function validateDailyAvailability(mark,w){const session=w.sessions.find(s=>s.date===mark.session);requireThat(session&&Date.parse(mark.availableAt)>=Date.parse(session.closeAt),'daily_bar_available_before_session_close');}
function validateInterimMark(mark,w){const session=w.sessions.find(s=>s.date===mark.session);requireThat(session&&Date.parse(mark.eventAt)===Date.parse(session.closeAt)&&Date.parse(mark.eventAt)>=Date.parse(w.entryAt)&&Date.parse(mark.eventAt)<=Date.parse(w.exitAt),'mark_outside_frozen_window');}
function latestEvaluation(j,intentId){const e=j.events.filter(e=>e.kind==='paper_evaluation'&&e.data.intentId===intentId||e.kind==='paper_revision'&&e.data.replacement.intentId===intentId).at(-1);return e?.kind==='paper_revision'?{...e,data:e.data.replacement}:e;}
function validateEvaluation(d,event,j,{restatement=false}={}){
  requireThat(keys(d,['intentId','entryMark','exitMark','mark','actions','benchmark','reasons']),'invalid_evaluation');
  const intent=find(j,d.intentId),w=intent&&scheduleFor(j,intent);const pub=intent&&contextFor(j,intent),entityId=pub?.data.entities.find(entity=>entity.symbol===intent.data.symbol)?.entityId;requireThat(intent?.kind==='paper_intent'&&w&&Date.parse(event.at)>=Date.parse(intent.at),'missing_intent_window');
  requireThat(Array.isArray(d.reasons)&&d.reasons.every(x=>clean(x,200)),'invalid_reasons');
  if(d.entryMark){validateMark(d.entryMark,{symbol:intent.data.symbol,entityId,at:event.at,eventAt:w.entryAt,session:w.entrySession,kind:'open'});validateDailyAvailability(d.entryMark,w);}
  if(d.exitMark){validateMark(d.exitMark,{symbol:intent.data.symbol,entityId,at:event.at,eventAt:w.exitAt,session:w.exitSession,kind:'close'});validateDailyAvailability(d.exitMark,w);}
  if(d.mark){validateMark(d.mark,{symbol:intent.data.symbol,entityId,at:event.at,kind:'close'});validateInterimMark(d.mark,w);validateDailyAvailability(d.mark,w);}
  requireThat(!d.exitMark||d.entryMark,'exit_without_entry');
  requireThat(!d.entryMark||d.actions,'entry_without_action_coverage');if(d.actions)validateCoverage(d.actions,w,(d.exitMark||d.mark||d.entryMark)?.session||w.entrySession);
  if(d.benchmark){requireThat(![d.benchmark.entryMark,d.benchmark.exitMark,d.benchmark.mark].some(Boolean)||clean(intent.data.settings.benchmarkEntityId,160),'benchmark_identity_missing');requireThat(keys(d.benchmark,['entryMark','exitMark','mark','actions']),'invalid_benchmark');for(const [k,t] of [['entryMark',w.entryAt],['exitMark',w.exitAt],['mark',null]])if(d.benchmark[k]){validateMark(d.benchmark[k],{symbol:intent.data.settings.benchmarkSymbol,entityId:intent.data.settings.benchmarkEntityId,at:event.at,eventAt:t,kind:k==='entryMark'?'open':'close',session:k==='entryMark'?w.entrySession:k==='exitMark'?w.exitSession:undefined});if(k==='mark')validateInterimMark(d.benchmark[k],w);validateDailyAvailability(d.benchmark[k],w);}if(d.benchmark.actions)validateCoverage(d.benchmark.actions,w,(d.benchmark.exitMark||d.benchmark.mark||d.benchmark.entryMark)?.session||w.entrySession);requireThat(!d.benchmark.exitMark||d.benchmark.entryMark,'benchmark_exit_without_entry');}
  const prior=latestEvaluation(j,d.intentId);if(!restatement&&prior?.data.entryMark)requireThat(same(prior.data.entryMark,d.entryMark),'paper_entry_rewrite');if(!restatement&&prior?.data.exitMark)requireThat(['entryMark','exitMark','mark','actions'].every(key=>same(prior.data[key],d[key])),'closed_evaluation_rewrite');
}
// Validation-only proof state. It is created for one validateJournal call and
// contains only accepted-prefix information; projections always replay full P&L.
function createActualValidation() {
  const states=new Map(),effective=new Map();
  let pending=null,disabled=false;
  return {
    validate(j,event,intentId,amounts,fillId=null) {
      const fill=fillId?event.data.replacement:event.data.fill,state=disabled?null:states.get(intentId);
      const previous=fillId?effective.get(fillId):null,time=Date.parse(fill.occurredAt);
      // Prices/fees do not affect oversell, split precision or dividend-basis
      // validity. Exact quantity/time/side equality keeps the same timeline.
      const monetaryOnly=previous?.intentId===intentId&&['side','occurredAt','quantity','currency'].every(key=>previous.fill[key]===fill[key]);
      const chronological=!fillId&&state&&time>=state.lastTimelineAt&&(!state.review||time<=Date.parse(state.review.throughAt));
      let next;
      if(state&&(fillId?monetaryOnly:chronological)) {
        let quantity=state.quantity;
        if(!fillId){requireThat(fill.side!=='sell'||amounts.quantity<=quantity,'oversell');quantity+=fill.side==='buy'?amounts.quantity:-amounts.quantity;}
        next={...state,quantity,lastTimelineAt:fillId?state.lastTimelineAt:time};
      } else {
        const prior=effectiveFills(j,intentId);
        const fills=fillId?prior.map(item=>item.id===fillId?{id:item.id,...fill}:item):[...prior,{id:event.id,...fill}];
        const review=actualReview(j,intentId,fills),actions=actualActions(review);
        const result=calculateLongPosition({fills,actions});
        requireThat(result.ok,result.errors?.[0]||'invalid_actual_accounting');
        // Aggregated quantity may have more digits than an individual input;
        // use the calculator's exact fixed-point output without a new input cap.
        next={quantity:BigInt(result.quantity.replace('.','')),review,lastTimelineAt:Math.max(...fills.map(item=>Date.parse(item.occurredAt)),...actions.map(item=>Date.parse(item.effectiveAt)))};
      }
      pending={event:clone(event),intentId,state:next};
    },
    accept(event) {
      // Any new action review invalidates proof state, even for other intents.
      // A later fill/correction must first select coverage and replay it in full.
      if(event.kind==='actual_action_review')states.clear();
      if(pending) {
        if(!same(event,pending.event)){disabled=true;states.clear();effective.clear();}
        else if(!disabled) {
          states.set(pending.intentId,pending.state);
          const fillId=event.kind==='actual_fill'?event.id:event.data.fillId;
          effective.set(fillId,{intentId:pending.intentId,fill:event.kind==='actual_fill'?event.data.fill:event.data.replacement});
        }
        pending=null;
      } else if(['actual_fill','fill_revision'].includes(event.kind)) {
        // A caller mutation during an async validation boundary must never turn
        // an unexamined accepted clone into reusable accounting proof.
        disabled=true;states.clear();effective.clear();
      }
    }
  };
}

// Lookup indexes contain only this call's accepted event clones. Preserve the
// first ID match and append order used by the original find/filter operations.
function createEventLookup() {
  const byId=new Map(),byKind=new Map();
  return {
    find:(_journal,eventId)=>byId.get(eventId),
    latest(_journal,kind,predicate=()=>true) {
      const events=byKind.get(kind)||[];
      for(let i=events.length-1;i>=0;i--)if(predicate(events[i]))return events[i];
    },
    accept(event) {
      if(!byId.has(event.id))byId.set(event.id,event);
      if(!byKind.has(event.kind))byKind.set(event.kind,[]);
      byKind.get(event.kind).push(event);
    }
  };
}

async function validateEvent(e,j,eventIds,actualValidation,lookup){
  const {find,latest}=lookup;
  requireThat(keys(e,['id','kind','at','data'])&&id(e.id)&&instant(e.at)&&Date.parse(e.at)>=Date.parse(j.createdAt)&&object(e.data),'invalid_event');
  requireThat(!eventIds.has(e.id),'duplicate_event_id');const d=e.data;
  if(e.kind==='settings'){requireThat(keys(d,['settings']),'invalid_settings_event');validateSettings(d.settings);}
  else if(e.kind==='abstain')requireThat(keys(d,['date','horizonId','unrankedCount','reason','snapshot'])&&day(d.date)&&horizon(d.horizonId)&&Number.isSafeInteger(d.unrankedCount)&&d.unrankedCount>=0&&clean(d.reason,500)&&safeJSON(d.snapshot),'invalid_abstention');
  else if(e.kind==='publication'){
    requireThat(keys(d,['publicationId','publishedAt','payloadHash','payloadBytes','policyVersion','snapshotVersion','horizonId','entities'])&&id(d.publicationId)&&instant(d.publishedAt)&&Date.parse(d.publishedAt)<=Date.parse(e.at)&&/^[a-f0-9]{64}$/.test(d.payloadHash)&&typeof d.payloadBytes==='string'&&d.payloadBytes.length<=350000&&clean(d.policyVersion)&&clean(d.snapshotVersion)&&horizon(d.horizonId),'invalid_publication');
    requireThat(await sha256(d.payloadBytes)===d.payloadHash,'publication_hash_mismatch');const p=publicationPayload(d);
    requireThat(object(p)&&p.schema_version===d.snapshotVersion&&p.policy_version===d.policyVersion&&instant(p.generated_at)&&Date.parse(p.generated_at)<=Date.parse(d.publishedAt)&&object(p.horizon)&&p.horizon.id===d.horizonId&&instant(p.horizon.entry_at)&&instant(p.horizon.exit_at)&&Date.parse(p.horizon.entry_at)<Date.parse(p.horizon.exit_at)&&Array.isArray(p.rows)&&p.rows.length>0&&p.rows.length<=10&&p.rows.every(row=>object(row)&&symbol(row.ticker)&&clean(row.company,200))&&new Set(p.rows.map(row=>row.ticker)).size===p.rows.length,'invalid_publication_snapshot');
    requireThat(Array.isArray(d.entities)&&d.entities.length===p.rows.length&&d.entities.every(entity=>keys(entity,['symbol','entityId'])&&symbol(entity.symbol)&&clean(entity.entityId,160)&&p.rows.some(row=>row.ticker===entity.symbol))&&new Set(d.entities.map(entity=>entity.symbol)).size===p.rows.length,'publication_entities_missing');
    requireThat(!j.events.some(x=>x.kind==='publication'&&x.data.publicationId===d.publicationId),'duplicate_publication');
  } else if(e.kind==='paper_intent'){
    requireThat(keys(d,['publicationEventId','symbol','settings','window','date']),'invalid_intent');const pub=find(j,d.publicationEventId);requireThat(pub?.kind==='publication'&&symbol(d.symbol)&&publicationPayload(pub.data).rows.some(row=>row.ticker===d.symbol)&&day(d.date)&&Date.parse(e.at)>=Date.parse(pub.data.publishedAt),'invalid_intent_context');validateSettings(d.settings);
    requireThat(!j.events.some(x=>x.kind==='paper_intent'&&x.data.publicationEventId===d.publicationEventId&&x.data.symbol===d.symbol),'duplicate_intent');
    requireThat(Date.parse(e.at)<Date.parse(publicationPayload(pub.data).horizon.entry_at),'late_intent');if(d.window){validateWindow(d.window);validateIntentWindow(e,pub,d.window);}
  } else if(e.kind==='paper_schedule'){
    requireThat(keys(d,['intentId','window']),'invalid_schedule');const intent=find(j,d.intentId);requireThat(intent?.kind==='paper_intent'&&!scheduleFor(j,intent),'duplicate_schedule');validateWindow(d.window);validateIntentWindow(intent,contextFor(j,intent),d.window);
  } else if(e.kind==='no_fill'){
    requireThat(keys(d,['publicationEventId','intentId','symbol','date','reason'])&&find(j,d.publicationEventId)?.kind==='publication'&&symbol(d.symbol)&&day(d.date)&&clean(d.reason,500),'invalid_no_fill');const pub=find(j,d.publicationEventId),intent=d.intentId?find(j,d.intentId):null;requireThat(publicationPayload(pub.data).rows.some(row=>row.ticker===d.symbol)&&Date.parse(e.at)>=Date.parse(pub.at)&&(!d.intentId||(intent?.kind==='paper_intent'&&intent.data.publicationEventId===pub.id&&intent.data.symbol===d.symbol)),'no_fill_context_mismatch');
  } else if(e.kind==='duplicate')requireThat(keys(d,['targetEventId','date','reason'])&&find(j,d.targetEventId)&&day(d.date)&&clean(d.reason,500),'invalid_duplicate');
  else if(e.kind==='paper_evaluation')validateEvaluation(d,e,j);
  else if(e.kind==='paper_revision'){requireThat(keys(d,['evaluationId','replacement','reason'])&&clean(d.reason,500)&&latestEvaluation(j,d.replacement?.intentId)?.id===d.evaluationId,'invalid_or_stale_paper_revision');validateEvaluation(d.replacement,e,j,{restatement:true});}
  else if(e.kind==='actual_confirmation')requireThat(keys(d,['intentId','confirmed'])&&d.confirmed===true&&find(j,d.intentId)?.kind==='paper_intent'&&Date.parse(e.at)>=Date.parse(find(j,d.intentId).at)&&!latest(j,'actual_confirmation',x=>x.data.intentId===d.intentId),'explicit_confirmation_required');
  else if(e.kind==='actual_action_review'){
    requireThat(keys(d,['intentId','fromAt','throughAt','coverage','reviewMark'])&&find(j,d.intentId)?.kind==='paper_intent'&&instant(d.fromAt)&&instant(d.throughAt)&&Date.parse(d.fromAt)<=Date.parse(d.throughAt),'invalid_actual_action_review');const intent=find(j,d.intentId),pub=contextFor(j,intent);validateMark(d.reviewMark,{symbol:intent.data.symbol,entityId:pub.data.entities.find(x=>x.symbol===intent.data.symbol).entityId,at:e.at,kind:'close'});requireThat(Date.parse(d.reviewMark.eventAt)>=Date.parse(d.throughAt),'actual_action_review_cutoff');validateCoverage(d.coverage,{entrySession:d.fromAt.slice(0,10),exitSession:d.throughAt.slice(0,10)});
  } else if(e.kind==='actual_fill'){
    requireThat(keys(d,['intentId','fill'])&&latest(j,'actual_confirmation',x=>x.data.intentId===d.intentId),'actual_confirmation_missing');const amounts=validateFill(d.fill);requireThat(Date.parse(d.fill.occurredAt)<=Date.parse(e.at)&&Date.parse(d.fill.occurredAt)>=Date.parse(contextFor(j,find(j,d.intentId)).data.publishedAt)&&Date.parse(e.at)>=Date.parse(latest(j,'actual_confirmation',x=>x.data.intentId===d.intentId).at),'future_or_prepublication_actual_fill');
    actualValidation.validate(j,e,d.intentId,amounts);
  } else if(e.kind==='fill_revision'){
    requireThat(keys(d,['fillId','replacement','reason'])&&find(j,d.fillId)?.kind==='actual_fill'&&clean(d.reason,500),'invalid_fill_revision');const amounts=validateFill(d.replacement);requireThat(Date.parse(d.replacement.occurredAt)<=Date.parse(e.at)&&Date.parse(e.at)>=Date.parse(find(j,d.fillId).at)&&Date.parse(d.replacement.occurredAt)>=Date.parse(contextFor(j,find(j,find(j,d.fillId).data.intentId)).data.publishedAt),'future_or_prepublication_actual_fill');
    actualValidation.validate(j,e,find(j,d.fillId).data.intentId,amounts,d.fillId);
  } else throw new Error('unknown_event_kind');
}
function validateIntentWindow(intent,pub,w){const p=publicationPayload(pub.data);requireThat(Date.parse(intent.at)<Date.parse(w.entryAt)&&w.horizonSessions===(pub.data.horizonId==='next_week'?5:1)&&Date.parse(w.publishedAt)===Date.parse(pub.data.publishedAt)&&Date.parse(w.entryAt)===Date.parse(p.horizon.entry_at)&&Date.parse(w.exitAt)===Date.parse(p.horizon.exit_at),'intent_window_mismatch');}
export function createJournal({journalId,at}){requireThat(id(journalId)&&instant(at),'invalid_journal_identity');return immutable({schemaVersion:JOURNAL_SCHEMA,journalId,createdAt:at,revision:0,events:[]});}
// Capture the complete caller-owned input before the first asynchronous boundary.
// Validate and accept only that snapshot; later caller edits belong to a new call.
export async function validateJournal(value){
  try {requireThat(keys(value,['schemaVersion','journalId','createdAt','revision','events'])&&value.schemaVersion===JOURNAL_SCHEMA&&id(value.journalId)&&instant(value.createdAt)&&Array.isArray(value.events)&&value.revision===value.events.length,'invalid_journal');requireThat(value.events.length<=MAX_EVENTS,'journal_capacity_exceeded');requireThat(safeJSON(value)&&JSON.stringify(value).length<=MAX_BYTES,'journal_limits');const snapshot=clone(value),journal={...snapshot,events:[]},eventIds=new Set(),actualValidation=createActualValidation(),lookup=createEventLookup();for(const e of snapshot.events){await validateEvent(e,journal,eventIds,actualValidation,lookup);const validated=e;journal.events.push(validated);eventIds.add(validated.id);lookup.accept(validated);actualValidation.accept(validated);}return {ok:true,journal:immutable(journal)};}catch(error){return failure(error.message||'invalid_journal');}
}
export function checkAppendOnly(previous,next,{allowEmptyRestore=false}={}){try{requireThat(next?.schemaVersion===JOURNAL_SCHEMA,'invalid_journal');if(previous&&!(allowEmptyRestore&&previous.revision===0&&previous.events.length===0)){requireThat(previous.journalId===next.journalId&&previous.createdAt===next.createdAt&&next.revision>=previous.revision&&previous.events.every((e,i)=>same(e,next.events[i])),'append_only_conflict');}return {ok:true,errors:[]};}catch(error){return failure(error.message);}}
async function append(journal,events){
  const validation=validateJournal(journal);let additions,snapshotError;
  // Capture additions in the same call as the base, but retain base-error precedence.
  try{additions=clone(events);}catch(error){snapshotError=error;}
  const checked=await validation;if(!checked.ok)return checked;if(snapshotError)throw snapshotError;
  const next={...checked.journal,events:[...checked.journal.events,...additions]};next.revision=next.events.length;return validateJournal(next);
}
const event=(id,kind,at,data)=>({id,kind,at,data});
export const appendSettings=(j,{id,at,settings})=>append(j,[event(id,'settings',at,{settings})]);
export async function recordAbstention(j,{id,at,date,horizonId,unrankedCount=0,snapshot={},reason='No eligible published algorithm suggestions.'}){const existing=latest(j,'abstain',e=>e.data.date===date&&e.data.horizonId===horizonId);if(existing)return {ok:true,journal:j,duplicate:true};return append(j,[event(id,'abstain',at,{date,horizonId,unrankedCount,reason,snapshot})]);}
export const recordActualConfirmation=(j,{id,at,intentId,confirmed})=>append(j,[event(id,'actual_confirmation',at,{intentId,confirmed})]);
export const recordActualFill=(j,{id,at,intentId,side,occurredAt,quantity,price,fee,currency='USD'})=>append(j,[event(id,'actual_fill',at,{intentId,fill:{side,occurredAt,quantity,price,fee,currency}})]);
export const revisePaperEvaluation=(j,{id,at,evaluationId,replacement,reason})=>append(j,[event(id,'paper_revision',at,{evaluationId,replacement,reason})]);
export const recordActualActionReview=(j,{id,at,intentId,fromAt,throughAt,coverage,reviewMark})=>append(j,[event(id,'actual_action_review',at,{intentId,fromAt,throughAt,coverage,reviewMark})]);
export const reviseActualFill=(j,{id,at,fillId,replacement,reason})=>append(j,[event(id,'fill_revision',at,{fillId,replacement,reason})]);

export function calculateLongPosition({fills=[],mark=null,actions=[],currency='USD'}={}){
  try {
    requireThat(Array.isArray(fills)&&Array.isArray(actions)&&currency==='USD','invalid_accounting_input');
    // Parsed amounts live only within this accounting call. Every fill retains
    // its original validation position; corrections and new prefixes are rechecked.
    const fillIds=new Set(),amounts=new Map();for(const f of fills){requireThat(id(f.id)&&!fillIds.has(f.id),'duplicate_fill');fillIds.add(f.id);amounts.set(f.id,validateFill(Object.fromEntries(['side','occurredAt','quantity','price','fee','currency'].map(k=>[k,f[k]]))));}
    const actionIds=new Set();for(const a of actions){validateAction(a);requireThat(!actionIds.has(a.id),'duplicate_action');actionIds.add(a.id);}
    const timeline=[...fills.map(f=>({type:'fill',at:f.occurredAt,value:f})),...actions.map(a=>({type:a.type,at:a.effectiveAt,value:a}))].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||({split:0,cash_dividend:1,fill:2}[a.type]-{split:0,cash_dividend:1,fill:2}[b.type]));
    let qty=0n,basis=0n,realized=0n,dividends=0n,fees=0n,invested=0n,proceeds=0n;let lastFill=null,lastAction=null;
    for(const item of timeline){const f=item.value;if(item.type==='split'){if(qty>0n)lastAction=f.effectiveAt;const numerator=BigInt(f.splitRatio.numerator),denominator=BigInt(f.splitRatio.denominator);requireThat(qty*numerator%denominator===0n,'split_quantity_precision_unsupported');qty=qty*numerator/denominator;continue;}
      if(item.type==='cash_dividend'){if(qty>0n)lastAction=f.effectiveAt;const sameSessionSplit=actions.some(a=>a.type==='split'&&a.effectiveSession===f.effectiveSession);requireThat(qty===0n||!sameSessionSplit||f.perShareBasis==='post_split','dividend_share_basis_ambiguous');dividends+=round(qty*decimal(f.cashPerShare),QTY);continue;}
      const {quantity,price,fee}=amounts.get(f.id),gross=round(quantity*price,QTY);fees+=fee;lastFill=f.occurredAt;
      if(f.side==='buy'){qty+=quantity;basis+=gross+fee;invested+=gross+fee;}
      else {requireThat(quantity<=qty,'oversell');const disposed=quantity===qty?basis:round(basis*quantity,qty);qty-=quantity;basis-=disposed;proceeds+=gross-fee;realized+=gross-fee-disposed;}
    }
    let marketValue=null,openPnl=null;const pendingReasons=[];
    if(qty===0n){marketValue=0n;openPnl=0n;}else if(!mark)pendingReasons.push('mark_unavailable');else {requireThat(mark.currency===currency&&instant(mark.eventAt),'invalid_mark');const price=decimal(mark.value,6,{positive:true});if(lastFill&&Date.parse(mark.eventAt)<Date.parse(lastFill))pendingReasons.push('mark_precedes_last_fill');else if(lastAction&&Date.parse(mark.eventAt)<Date.parse(lastAction))pendingReasons.push('mark_precedes_share_action');else {marketValue=round(qty*price,QTY);openPnl=marketValue-basis;}}
    return {ok:true,quantity:format(qty,8),costBasis:format(basis),investedCash:format(invested),netProceeds:format(proceeds),fees:format(fees),dividendAccrual:format(dividends),realizedTradingPnl:format(realized),realizedPnl:format(realized),marketValue:marketValue===null?null:format(marketValue),openPnl:openPnl===null?null:format(openPnl),totalPnl:openPnl===null?null:format(realized+dividends+openPnl),pendingReasons};
  }catch(error){return failure(error.message);}
}

export async function enrollPublication(j,{id:requestId,at,publication,windowResolution,settings}){
  try {
    const checked=await validateJournal(j);if(!checked.ok)return checked;settings=settings||latest(j,'settings')?.data.settings||DEFAULT_PAPER_SETTINGS;validateSettings(settings);
    const existing=latest(j,'publication',e=>e.data.publicationId===publication?.publicationId);
    if(existing){requireThat(same(existing.data,publication),'publication_id_conflict');const duplicateId=`${existing.id}:duplicate`;if(find(j,duplicateId))return {ok:true,journal:j,duplicate:true};return append(j,[event(duplicateId,'duplicate',at,{targetEventId:existing.id,date:at.slice(0,10),reason:'Repeated publication retained; no additional paper position.'})]);}
    const publicationEvent=event(`${requestId}:publication`,'publication',at,publication);let result=await append(j,[publicationEvent]);if(!result.ok)return result;
    const p=publicationPayload(publication);const events=[];
    for(const row of p.rows){let reason=null,window=windowResolution?.status==='resolved'?windowResolution.window:null;
      if(Date.parse(at)>=Date.parse(p.horizon.entry_at))reason='first_observed_after_entry';
      else if(Date.parse(publication.publishedAt)>=Date.parse(p.horizon.entry_at))reason='publication_not_before_entry';
      else if(window){try{validateWindow(window);validateIntentWindow({at},publicationEvent,window);}catch{reason='published_window_calendar_mismatch';}}
      if(reason)events.push(event(`${requestId}:${row.ticker}:no-fill`,'no_fill',at,{publicationEventId:publicationEvent.id,intentId:null,symbol:row.ticker,date:at.slice(0,10),reason}));
      else events.push(event(`${requestId}:${row.ticker}:intent`,'paper_intent',at,{publicationEventId:publicationEvent.id,symbol:row.ticker,settings:clone(settings),window:window?clone(window):null,date:at.slice(0,10)}));
    }
    return append(result.journal,events);
  }catch(error){return failure(error.message);}
}
function fillFromMark(mark,settings,side,quantity){const original=decimal(mark.value,6,{positive:true}),factor=10000n+BigInt(side==='buy'?settings.slippageBps:-settings.slippageBps),price=round(original*factor,10000n);requireThat(price>0n,'paper_price_invalid');const fee=decimal(settings.commissionPerFill);if(quantity===undefined)quantity=(decimal(settings.paperNotional)-fee)*QTY/price;requireThat(quantity>0n,'paper_notional_too_small');return {side,occurredAt:mark.eventAt,quantity:format(quantity,8),price:format(price),fee:format(fee),currency:'USD'};}
function paperAccounting(intent,data,benchmark=false,evaluatedAt=null){
  const input=benchmark?data?.benchmark:data;if(!input?.entryMark)return {ok:true,status:'pending',quantity:null,entryPrice:null,exitPrice:null,costs:null,realizedPnl:null,openPnl:null,totalPnl:null,pendingReasons:data?.reasons||['entry_mark_pending']};
  if(!input.actions)return {ok:true,status:'pending',quantity:null,entryPrice:null,exitPrice:null,costs:null,realizedPnl:null,openPnl:null,totalPnl:null,pendingReasons:['action_coverage_missing']};
  try {const buy=fillFromMark(input.entryMark,intent.data.settings,'buy');const actions=input.actions.items.filter(a=>Date.parse(a.effectiveAt)>Date.parse(buy.occurredAt)&&Date.parse(a.effectiveAt)<=Date.parse(input.exitMark?.eventAt||evaluatedAt||input.entryMark.eventAt));
    const fills=[{id:'paper-entry',...buy}];let sell=null;
    if(input.exitMark){const before=calculateLongPosition({fills,actions});requireThat(before.ok,before.errors?.[0]);sell=fillFromMark(input.exitMark,intent.data.settings,'sell',decimal(before.quantity,8));fills.push({id:'paper-exit',...sell});}
    const accounting=calculateLongPosition({fills,actions,mark:input.exitMark||input.mark});if(!accounting.ok)return accounting;
    const slippage=round((decimal(buy.price)-decimal(input.entryMark.value))*decimal(buy.quantity,8),QTY)+(sell?round((decimal(input.exitMark.value)-decimal(sell.price))*decimal(sell.quantity,8),QTY):0n);return {...accounting,executionBasis:'daily_bar_paper_reference',status:sell?'closed':'open',entryPrice:buy.price,exitPrice:sell?.price||null,commissionCosts:accounting.fees,slippageCosts:format(slippage),costs:format(decimal(accounting.fees)+slippage),pendingReasons:sell?[]:[...accounting.pendingReasons,...(data.reasons||[])]};
  }catch(error){return failure(error.message);}
}
export async function evaluatePaper(j,{at,eventIdPrefix,calendar,seriesBySymbol={},reviewsBySymbol={},resolvers={}}={}){
  try {requireThat(instant(at)&&id(eventIdPrefix),'invalid_evaluation_request');let result=await validateJournal(j);if(!result.ok)return result;let next=result.journal;
    for(const intent of j.events.filter(e=>e.kind==='paper_intent')){
      if(latest(next,'no_fill',e=>e.data.intentId===intent.id))continue;const pub=contextFor(next,intent);let w=scheduleFor(next,intent);const prior=latestEvaluation(next,intent.id);if(prior?.data.exitMark&&prior?.data.benchmark?.exitMark)continue;
      if(!w){requireThat(typeof resolvers.resolvePaperWindow==='function','calendar_resolver_unavailable');const resolved=await resolvers.resolvePaperWindow({publishedAt:pub.data.publishedAt,horizonSessions:pub.data.horizonId==='next_week'?5:1,calendar,at});if(resolved?.status!=='resolved')continue;w=resolved.window;try{validateWindow(w);validateIntentWindow(intent,pub,w);}catch{result=await append(next,[event(`${eventIdPrefix}:${intent.id}:no-fill`,'no_fill',at,{publicationEventId:pub.id,intentId:intent.id,symbol:intent.data.symbol,date:intent.data.date,reason:'published_window_calendar_mismatch'})]);if(!result.ok)return result;next=result.journal;continue;}result=await append(next,[event(`${eventIdPrefix}:${intent.id}:schedule`,'paper_schedule',at,{intentId:intent.id,window:w})]);if(!result.ok)return result;next=result.journal;}
      if(Date.parse(at)<Date.parse(w.entryAt))continue;requireThat(typeof resolvers.resolvePriceMark==='function','price_resolver_unavailable');const reasons=[];
      const marks=async(ticker,old,benchmark=false)=>{if(benchmark&&!intent.data.settings.benchmarkEntityId){reasons.push('benchmark_identity_missing');return {entryMark:null,exitMark:null,mark:null,actions:null};}const resolve=async(session,kind)=>resolvers.resolvePriceMark(seriesBySymbol[ticker],{session,kind,calendar,review:reviewsBySymbol[ticker],window:w,at});let entry=old?.entryMark||null,exit=old?.exitMark||null,mark=null,actions=old?.actions||null;
        if(!entry){const found=await resolve(w.entrySession,'open');if(found?.status==='available'){entry=found.mark;actions=found.actions;}else reasons.push(...(found?.reasons||['entry_mark_pending']));}
        if(entry&&!exit&&Date.parse(at)>=Date.parse(w.exitAt)){const found=await resolve(w.exitSession,'close');if(found?.status==='available'){exit=found.mark;actions=found.actions;}else reasons.push(...(found?.reasons||['exit_mark_pending']));}
        if(entry&&!exit){const closed=w.sessions.filter(s=>Date.parse(s.closeAt)<=Date.parse(at)).at(-1);if(closed){const found=await resolve(closed.date,'close');if(found?.status==='available'){mark=found.mark;actions=found.actions;}}}
        return {entryMark:entry,exitMark:exit,mark,actions};};
      const own=prior?.data.exitMark?Object.fromEntries(['entryMark','exitMark','mark','actions'].map(key=>[key,prior.data[key]])):await marks(intent.data.symbol,prior?.data),benchmark=await marks(intent.data.settings.benchmarkSymbol,prior?.data.benchmark,true);const data={intentId:intent.id,...own,benchmark,reasons:[...new Set(reasons)]};if(prior&&same(prior.data,data))continue;
      result=await append(next,[event(`${eventIdPrefix}:${intent.id}:evaluation`,'paper_evaluation',at,data)]);if(!result.ok)return result;next=result.journal;
    }
    return {ok:true,journal:next};
  }catch(error){return failure(error.message);}
}

export function projectJournal(j,{storage={state:'unsaved',message:'Not saved.'}}={}){
  const entries=[];const unknownActual={confirmed:false,confirmedAt:null,quantity:null,realizedPnl:null,openPnl:null,pendingReasons:[],fills:[]};
  for(const e of j.events){
    if(e.kind==='abstain'){entries.push({id:e.id,date:e.data.date,status:'abstain',symbol:null,company:null,horizonId:e.data.horizonId,reason:e.data.reason,context:{observedAt:e.at,publishedAt:null,publicationId:null,payloadHash:null,policyVersion:null,snapshotVersion:null,entryAt:null,exitAt:null,unrankedCount:e.data.unrankedCount,snapshot:clone(e.data.snapshot)},paper:null,actual:clone(unknownActual),revisions:[]});continue;}
    if(e.kind==='duplicate'){entries.push({id:e.id,date:e.data.date,status:'duplicate',symbol:null,company:null,horizonId:null,reason:e.data.reason,context:{observedAt:e.at,publishedAt:null,publicationId:null,payloadHash:null,policyVersion:null,snapshotVersion:null,entryAt:null,exitAt:null},paper:null,actual:clone(unknownActual),revisions:[]});continue;}
    if(e.kind!=='paper_intent'&&!(e.kind==='no_fill'&&!e.data.intentId))continue;
    const pub=find(j,e.data.publicationEventId),payload=publicationPayload(pub.data),row=payload.rows.find(r=>r.ticker===e.data.symbol),w=e.kind==='paper_intent'?scheduleFor(j,e):null;
    const noFill=e.kind==='no_fill'?e:latest(j,'no_fill',x=>x.data.intentId===e.id),evaluation=latestEvaluation(j,e.id),accounting=paperAccounting(e,evaluation?.data,false,evaluation?.at),benchmark=paperAccounting(e,evaluation?.data,true,evaluation?.at);
    const ownMark=evaluation?.data.exitMark||evaluation?.data.mark,benchmarkMark=evaluation?.data.benchmark?.exitMark||evaluation?.data.benchmark?.mark;
    const benchmarkMatches=benchmark.ok&&accounting.status===benchmark.status&&ownMark&&benchmarkMark&&Date.parse(ownMark.eventAt)===Date.parse(benchmarkMark.eventAt);
    const paper=noFill?null:accounting.ok?{...accounting,assumptions:clone(e.data.settings),returnBasis:'net_total_return_with_ex_date_dividend_accrual',budgetPolicy:'Entry costs included; quantity rounded down to eight decimals.',benchmarkPnl:benchmarkMatches?benchmark.totalPnl:null,excessPnl:accounting.totalPnl!==null&&benchmarkMatches&&benchmark.totalPnl!==null?format(signedCash(accounting.totalPnl)-signedCash(benchmark.totalPnl)):null}: {status:'pending',quantity:null,entryPrice:null,exitPrice:null,costs:null,realizedPnl:null,openPnl:null,benchmarkPnl:null,excessPnl:null,pendingReasons:accounting.errors};
    const confirmation=latest(j,'actual_confirmation',x=>x.data.intentId===e.id),fills=e.kind==='paper_intent'?effectiveFills(j,e.id):[];let actual={...clone(unknownActual),confirmed:Boolean(confirmation),confirmedAt:confirmation?.at||null,fills};
    if(confirmation){if(fills.length){const review=actualReview(j,e.id,fills);if(review){
      // Saved reviews may cover all fills but stop before their price mark.
      // Preserve those records; open valuation needs actions through the mark.
      const markCovered=Date.parse(review.reviewMark.eventAt)<=Date.parse(review.throughAt);
      const a=calculateLongPosition({fills,mark:markCovered?review.reviewMark:null,actions:actualActions(review)});
      if(a.ok&&!markCovered)a.pendingReasons=a.pendingReasons.map(reason=>reason==='mark_unavailable'?'actual_action_coverage_before_mark':reason);
      actual={...actual,...(a.ok?a:{pendingReasons:a.errors})};
    }else actual.pendingReasons=['actual_action_coverage_missing'];}else actual.pendingReasons=['actual_fills_unknown'];}
    const revisions=j.events.filter(x=>x.kind==='fill_revision'&&fills.some(f=>f.id===x.data.fillId)||x.kind==='paper_revision'&&x.data.replacement.intentId===e.id).map(x=>({id:x.id,at:x.at,reason:x.data.reason}));
    entries.push({id:e.id,date:e.data.date,status:noFill?'no_fill':paper.status,symbol:e.data.symbol,company:row.company,horizonId:pub.data.horizonId,reason:noFill?.data.reason||paper.pendingReasons.join('; '),context:{observedAt:e.at,publishedAt:pub.data.publishedAt,publicationId:pub.data.publicationId,payloadHash:pub.data.payloadHash,policyVersion:pub.data.policyVersion,snapshotVersion:pub.data.snapshotVersion,caseSummary:row.catalyst?.label||null,positiveCase:row.thesis||null,counterCase:row.downside||null,invalidationTrigger:row.invalidation_trigger||null,sourceRefs:clone(row.sources||[]),entryAt:w?.entryAt||null,exitAt:w?.exitAt||null},paper,actual,revisions});
  }
  return {schemaVersion:'cribscore_journal_view_v1',settings:clone(latest(j,'settings')?.data.settings||DEFAULT_PAPER_SETTINGS),storage:clone(storage),summary:{decisions:entries.filter(e=>e.status!=='duplicate').length,abstentions:entries.filter(e=>e.status==='abstain').length,pending:entries.filter(e=>e.status==='pending').length,open:entries.filter(e=>e.status==='open').length,closed:entries.filter(e=>e.status==='closed').length,noFill:entries.filter(e=>e.status==='no_fill').length,actualConfirmations:entries.filter(e=>e.actual.confirmed).length},entries:entries.reverse(),assumptions:['Paper uses fixed notional including entry costs, fractional quantity rounded down to eight decimals, and frozen commission/slippage assumptions.','Actual trades require explicit confirmation and user-reported fills.','Dividends accrue at the verified ex-date open for shares already held; they are not recorded as cash paid. Benchmark uses the same net total-return convention.', 'Missing prices, benchmark or action coverage remain unavailable.','Updates occur while the app is open; publication and enrolled intent remain distinct.']};
}
function signedCash(v){return v.startsWith('-')?-decimal(v.slice(1)):decimal(v);}

export async function exportJournal(j){const checked=await validateJournal(j);return checked.ok?{ok:true,text:canonical(checked.journal),filename:`cribscore-journal-${j.journalId}-r${j.revision}.json`}:checked;}
const previews=new WeakMap();
export async function previewImport(current,text,{mode='merge'}={}){
  try {requireThat(typeof text==='string'&&text.length<=MAX_BYTES,'import_too_large');const parsed=JSON.parse(text);requireThat(JSON.stringify(parsed)===text.trim()||JSON.stringify(parsed,null,2)===text.trim(),'import_noncanonical_or_duplicate_keys');const base=await validateJournal(current),incoming=await validateJournal(parsed);if(!base.ok)return base;if(!incoming.ok)return incoming;requireThat(['merge','restore'].includes(mode),'invalid_import_mode');if(mode==='restore')requireThat(current.revision===0&&current.events.length===0,'restore_requires_empty_journal');else requireThat(current.journalId===parsed.journalId&&current.createdAt===parsed.createdAt,'different_journal_identity');const conflicts=[],additions=[],duplicates=[];for(const e of parsed.events){const old=find(current,e.id);if(old){(same(old,e)?duplicates:conflicts).push(e.id);}else additions.push(e);}
    const proposed=mode==='restore'?clone(parsed):{...clone(current),events:[...clone(current.events),...clone(additions)],revision:current.revision+additions.length};const merged=await validateJournal(proposed);if(!merged.ok)conflicts.push(...merged.errors);const preview=immutable({mode,adoptsJournalIdentity:mode==='restore',baseRevision:current.revision,importRevision:parsed.revision,additions:additions.map(e=>e.id),duplicates,conflicts,canApply:conflicts.length===0});previews.set(preview,{base:canonical(current),journal:merged.ok?merged.journal:null});return {ok:true,preview};
  }catch(error){return failure(error.message||'invalid_import');}
}
export async function applyImport(current,preview){const saved=previews.get(preview);if(!saved||!preview.canApply)return failure('import_preview_required');if(saved.base!==canonical(current))return failure('stale_import_preview');previews.delete(preview);return {ok:true,journal:saved.journal,mode:preview.mode};}

export function createLocalJournalStore({storage,key='cribscore.journal.v1'}={}){
  let observedRaw;
  return {
    async load(){try{const raw=storage.getItem(key);observedRaw=raw;if(raw===null)return {ok:true,journal:null,revision:0,state:'local_only'};const checked=await validateJournal(JSON.parse(raw));return checked.ok?{...checked,revision:checked.journal.revision,state:'local_only'}:{...checked,state:'unavailable',error:'corrupt_local_journal'};}catch(error){return {ok:false,error:'local_read_failed',detail:error.message,state:'unavailable'};}},
    async commit(journal,{expectedRevision,mode='append'}={}){const checked=await validateJournal(journal);if(!checked.ok)return checked;journal=checked.journal;try{const currentRaw=storage.getItem(key);if(observedRaw===undefined)return {ok:false,error:'load_required',state:'unsaved'};if(currentRaw!==observedRaw)return {ok:false,error:'revision_conflict',state:'conflict'};const previous=currentRaw===null?null:JSON.parse(currentRaw);if((previous?.revision||0)!==expectedRevision)return {ok:false,error:'revision_conflict',state:'conflict'};const appendCheck=checkAppendOnly(previous,journal,{allowEmptyRestore:mode==='restore'&&expectedRevision===0});if(!appendCheck.ok)return {...appendCheck,state:'unsaved'};const bytes=canonical(journal);storage.setItem(key,bytes);const verified=storage.getItem(key);if(verified!==bytes)return {ok:false,error:'local_write_unconfirmed',state:'unsaved'};observedRaw=verified;return {ok:true,journal:checked.journal,revision:journal.revision,state:'local_only'};}catch(error){return {ok:false,error:'local_write_failed',detail:error.message,state:'unsaved'};}}
  };
}
export function createHttpJournalStore({fetch:request=globalThis.fetch,url='/api/journal'}={}){
  const decode=async(response)=>{let body;try{body=await response.json();}catch{return {ok:false,error:'invalid_server_response',state:'unsaved'};}if(!response.ok)return {ok:false,error:body?.error||'server_unavailable',revision:body?.revision,journal:body?.journal,state:response.status===409?'conflict':'unsaved'};if(body?.ok!==true)return {ok:false,error:'invalid_server_response',state:'unsaved'};if(body.journal===null&&body.revision===0)return {ok:true,journal:null,revision:0,state:'synced'};const checked=await validateJournal(body.journal);if(!checked.ok||body.revision!==body.journal?.revision)return {ok:false,error:'invalid_server_journal',state:'unsaved'};return {...checked,revision:body.revision,state:'synced'};};
  return {async load(){try{return await decode(await request(url,{method:'GET',credentials:'same-origin',cache:'no-store'}));}catch(error){return {ok:false,error:'server_unavailable',detail:error.message,state:'unavailable'};}},async commit(journal,{expectedRevision,mode='append'}={}){const checked=await validateJournal(journal);if(!checked.ok)return checked;journal=checked.journal;try{const result=await decode(await request(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision,journal,...(mode==='restore'?{mode}: {})})}));if(result.ok&&(!result.journal||!same(result.journal,journal)))return {ok:false,error:'server_commit_unconfirmed',state:'unsaved'};return result;}catch(error){return {ok:false,error:'server_commit_uncertain',detail:error.message,state:'unsaved'};}}};
}
