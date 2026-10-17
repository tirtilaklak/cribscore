/** Pure price display/import and paper-mark contract. No IO or generated clocks.
 * Caller-supplied source/review metadata is not independently authenticated here.
 * Shape-valid data never passes a ranking gate or authorizes a broker action.
 */
export const PRICE_SERIES_VERSION = 'cribscore-price-series-v1';
export const PRICE_EVALUATOR_VERSION = 'price-domain-v1.2';
const LIMITS = Object.freeze({eligibleForRanking:false,paperMarksEligible:false,automaticTrading:false});
const PAPER_LIMITS = Object.freeze({eligibleForRanking:false,automaticTrading:false});
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonblank = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 500;
const symbol = x => typeof x === 'string' && /^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const unique = x => [...new Set(x)];
const copy = x => structuredClone(x);
// JSON persistence can reorder record keys. Compare the exact structure and
// values, keeping array positions, sparse entries and extra fields significant.
function sameStructure(left,right) {
  if(Object.is(left,right))return true;
  if(left===null||right===null||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;
  const leftKeys=Object.keys(left).sort(),rightKeys=Object.keys(right).sort();
  if(Array.isArray(left)&&left.length!==right.length||leftKeys.length!==rightKeys.length)return false;
  return leftKeys.every((key,index)=>key===rightKeys[index]&&sameStructure(left[key],right[key]));
}
function day(x) {return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x+'T00:00:00Z')) && new Date(x+'T00:00:00Z').toISOString().slice(0,10) === x;}
function instant(x) {
  if(typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x))return NaN;
  const t=Date.parse(x);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,19)===x.slice(0,19)?t:NaN;
}
function zone(x) {try {return typeof x==='string'&&x.includes('/')&&!!new Intl.DateTimeFormat('en-US',{timeZone:x});}catch{return false;}}
function localDate(at,timeZone) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));
  const get=type=>parts.find(p=>p.type===type).value;return `${get('year')}-${get('month')}-${get('day')}`;
}
function safeURL(x) {
  try {const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&![...u.searchParams.keys()].some(k=>k!=='page_token'&&/key|token|secret|password|auth|credential/i.test(k));}catch{return false;}
}
function decimal(value,{zero=false}={}) {
  const raw=typeof value==='number'&&Number.isFinite(value)&&value!==0&&Math.abs(value)>=1e-12&&Math.abs(value)<1&&String(value).includes('e')?value.toFixed(12):typeof value==='number'?String(value):value;
  if(typeof raw!=='string'||!/^\d{1,15}(?:\.\d{1,12})?$/.test(raw))return null;
  const n=Number(raw);if(!Number.isFinite(n)||n<0||(!zero&&n===0)||n>1e12)return null;
  const normalized=raw.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
  const [whole,fraction='']=normalized.split('.');
  const scaled=BigInt(whole)*1000000000000n+BigInt(fraction.padEnd(12,'0'));
  if(scaled>1000000000000000000000000n)return null;
  return {number:n,text:normalized,scaled};
}
function sourceFields(source,issues) {
  if(!object(source)){issues.push('source_metadata_required');return null;}
  if(!nonblank(source.provider)||!nonblank(source.dataset))issues.push('source_identity_required');
  if(source.url!=null&&!safeURL(source.url))issues.push('source_url_invalid');
  for(const key of ['capturedAt','publishedAt'])if(source[key]!=null&&!Number.isFinite(instant(source[key])))issues.push(`source_${key}_invalid`);
  if(source.capturedAt&&source.publishedAt&&instant(source.publishedAt)>instant(source.capturedAt))issues.push('publication_after_capture');
  if(source.responseSha256!=null&&!hash(source.responseSha256))issues.push('source_digest_invalid');
  if(!['manual_import','retained_capture'].includes(source.channel))issues.push('source_channel_invalid');
  if(source.declaredDelayMinutes!=null&&(!Number.isFinite(source.declaredDelayMinutes)||source.declaredDelayMinutes<0))issues.push('source_delay_invalid');
  if(source.priceSession!=null&&!['regular_daily_aggregate','unknown'].includes(source.priceSession))issues.push('source_price_session_invalid');
  if(source.paginationComplete!=null&&typeof source.paginationComplete!=='boolean')issues.push('source_pagination_status_invalid');
  return {provider:source.provider,dataset:source.dataset,url:source.url??null,capturedAt:source.capturedAt??null,publishedAt:source.publishedAt??null,responseSha256:source.responseSha256??null,channel:source.channel,declaredDelayMinutes:source.declaredDelayMinutes??null,
    feed:source.feed??null,requestedAdjustment:source.requestedAdjustment??null,symbolAsOf:source.symbolAsOf??null,requestStartedAt:source.requestStartedAt??null,requestEnd:source.requestEnd??null,paginationComplete:source.paginationComplete??null,volumeSession:source.volumeSession??'unknown',priceSession:source.priceSession??'unknown'};
}
function cleanActions(actions,warnings,issues) {
  if(actions==null)return {status:'unknown',fromSession:null,throughSession:null,source:{url:null,capturedAt:null,responseSha256:null},items:[]};
  if(!object(actions)||!['unknown','partial','complete'].includes(actions.status)||!Array.isArray(actions.items)||actions.items.length>1000){issues.push('actions_shape_invalid');return null;}
  if(actions.fromSession!=null&&!day(actions.fromSession)||actions.throughSession!=null&&!day(actions.throughSession))issues.push('action_coverage_invalid');
  if(actions.status==='complete'&&(!day(actions.fromSession)||!day(actions.throughSession)||actions.fromSession>actions.throughSession))issues.push('action_coverage_invalid');
  const ids=new Set(),items=[];
  for(const a of actions.items){
    if(!object(a)||!nonblank(a.id)||ids.has(a.id)||!day(a.effectiveSession)){issues.push('action_identity_invalid');continue;}
    ids.add(a.id);
    if(!['split','cash_dividend'].includes(a.type)){warnings.push('unsupported_corporate_action');items.push({id:a.id,type:'unsupported',originalType:typeof a.type==='string'?a.type:'unknown',effectiveSession:a.effectiveSession});continue;}
    if(a.type==='split'){
      const ratio=a.splitRatio;
      if(!object(ratio)||!['numerator','denominator'].every(k=>typeof ratio[k]==='string'&&/^[1-9]\d{0,8}$/.test(ratio[k]))){issues.push('split_ratio_invalid');continue;}
      items.push({id:a.id,type:a.type,effectiveSession:a.effectiveSession,splitRatio:{numerator:ratio.numerator,denominator:ratio.denominator}});
    }else{
      const cash=decimal(a.cashPerShare,{zero:true});
      if(!cash||!['post_split','current_shares','pre_split','unknown'].includes(a.perShareBasis)||!/^[A-Z]{3}$/.test(a.currency??'')){issues.push('dividend_invalid');continue;}
      items.push({id:a.id,type:a.type,effectiveSession:a.effectiveSession,cashPerShare:cash.text,currency:a.currency,perShareBasis:a.perShareBasis});
    }
  }
  const src=object(actions.source)?actions.source:{};
  if(src.url!=null&&!safeURL(src.url)||src.capturedAt!=null&&!Number.isFinite(instant(src.capturedAt))||src.responseSha256!=null&&!hash(src.responseSha256))issues.push('action_source_invalid');
  return {status:actions.status,fromSession:actions.fromSession??null,throughSession:actions.throughSession??null,source:{url:src.url??null,capturedAt:src.capturedAt??null,responseSha256:src.responseSha256??null},items};
}

export function normalizePriceSeries(input,{at}={}) {
  const result=(status,series,issues=[],warnings=[])=>({status,series,issues:unique(issues),warnings:unique(warnings),...LIMITS});
  if(!Number.isFinite(instant(at)))return result('invalid',null,['assessment_clock_invalid']);
  if(input==null)return result('missing',null,['price_series_missing']);
  if(!object(input))return result('invalid',null,['price_series_invalid']);
  const issues=[],warnings=[];
  if(input.schemaVersion!==PRICE_SERIES_VERSION)issues.push('schema_version_unsupported');
  if(!nonblank(input.id)||!symbol(input.symbol)||!/^[A-Z]{3}$/.test(input.currency??''))issues.push('security_identity_invalid');
  if(input.originalSymbol!=null&&!symbol(input.originalSymbol)||input.entityId!=null&&!nonblank(input.entityId))issues.push('security_mapping_invalid');
  if(input.exchange!=null&&!nonblank(input.exchange))issues.push('exchange_invalid');
  if(!zone(input.sessionTimezone))issues.push('session_timezone_invalid');
  if(input.interval!=='1d')issues.push('daily_interval_required');
  if(!['unadjusted','split_adjusted','total_return_adjusted','unknown'].includes(input.priceBasis))issues.push('price_basis_invalid');
  if(!['shares','split_adjusted_shares','unknown'].includes(input.volumeBasis))issues.push('volume_basis_invalid');
  const source=sourceFields(input.source,issues);
  if(!Array.isArray(input.bars)||input.bars.length>5000)return result('invalid',null,[...issues,'bars_shape_invalid']);
  if(!input.bars.length)warnings.push('bars_missing');
  const dates=new Set(),bars=[];
  for(const b of input.bars){
    if(!object(b)||!day(b.session)||dates.has(b.session)){issues.push('bar_session_invalid_or_duplicate');continue;}
    dates.add(b.session);
    const priceKeys=['open','high','low','close'];
    // Normalization projects exact decimal strings to numeric chart values.
    // Re-reading that projection must preserve the exact strings for accounting,
    // while rejecting a stale or contradictory numeric/decimal pair.
    if(b.decimals!=null&&(!object(b.decimals)||Object.keys(b.decimals).length!==4||priceKeys.some(k=>!Object.hasOwn(b.decimals,k)||typeof b.decimals[k]!=='string'))){issues.push('bar_decimal_projection_invalid');continue;}
    const decimals=Object.fromEntries(priceKeys.map(k=>[k,decimal(b.decimals?b.decimals[k]:b[k])]));
    if(Object.values(decimals).some(x=>x===null)){issues.push('bar_price_invalid');continue;}
    if(b.decimals&&priceKeys.some(k=>typeof b[k]==='number'?b[k]!==decimals[k].number:decimal(b[k])?.text!==decimals[k].text)){issues.push('bar_decimal_projection_invalid');continue;}
    const {open,high,low,close}=Object.fromEntries(Object.entries(decimals).map(([k,v])=>[k,v.number]));
    if(decimals.low.scaled>decimals.open.scaled||decimals.low.scaled>decimals.close.scaled||decimals.high.scaled<decimals.open.scaled||decimals.high.scaled<decimals.close.scaled||decimals.low.scaled>decimals.high.scaled){issues.push('bar_ohlc_inconsistent');continue;}
    if(b.volume!=null&&(!Number.isFinite(b.volume)||b.volume<0||b.volume>Number.MAX_SAFE_INTEGER||input.volumeBasis!=='split_adjusted_shares'&&!Number.isSafeInteger(b.volume))){issues.push('bar_volume_invalid');continue;}
    if(b.volume==null)warnings.push('volume_missing');
    if(b.availableAt!=null&&(!Number.isFinite(instant(b.availableAt))||source?.capturedAt&&instant(b.availableAt)>instant(source.capturedAt)||source?.publishedAt&&instant(b.availableAt)<instant(source.publishedAt))){issues.push('bar_availability_invalid');continue;}
    bars.push({session:b.session,open,high,low,close,volume:b.volume??null,decimals:Object.fromEntries(Object.entries(decimals).map(([k,v])=>[k,v.text])),availableAt:b.availableAt??source?.capturedAt??source?.publishedAt??null,providerTimestamp:b.providerTimestamp??null});
  }
  bars.sort((a,b)=>a.session.localeCompare(b.session));
  const actions=cleanActions(input.actions,warnings,issues);
  if(issues.length)return result('invalid',null,issues,warnings);
  if(!source.url||!source.capturedAt||!source.responseSha256)warnings.push('capture_provenance_incomplete');
  if(source.capturedAt&&instant(source.capturedAt)>instant(at))warnings.push('capture_in_future');
  if(input.priceBasis==='unknown')warnings.push('adjustment_status_unknown');
  if(actions.status!=='complete')warnings.push('corporate_action_coverage_unknown');
  if(source.channel==='manual_import')warnings.push('manual_import_unreviewed');
  if(source.paginationComplete===false)warnings.push('pagination_incomplete');
  return result(warnings.length?'partial':'ready',{schemaVersion:PRICE_SERIES_VERSION,id:input.id,symbol:input.symbol,originalSymbol:input.originalSymbol??input.symbol,entityId:input.entityId??null,currency:input.currency,exchange:input.exchange??null,sessionTimezone:input.sessionTimezone,interval:'1d',priceBasis:input.priceBasis,volumeBasis:input.volumeBasis,source,bars,actions},[],warnings);
}

function csvRows(text) {
  const rows=[];let row=[],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw Error('csv_invalid');quoted=true;continue;}
    if(c===','||c==='\n'||c==='\r'){
      row.push(field);field='';closed=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==''))rows.push(row);row=[];}continue;
    }
    if(closed)throw Error('csv_invalid');field+=c;
  }
  if(quoted)throw Error('csv_invalid');
  if(field||closed||row.length){row.push(field);if(row.some(v=>v!==''))rows.push(row);}
  return rows;
}
// Native JSON.parse discards duplicate member names. A bounded structural scan
// rejects that ambiguity first, including differently escaped spellings of a key.
function parseUniqueJSON(text) {
  let cursor=0;
  const whitespace=()=>{while(/[\x20\t\r\n]/.test(text[cursor]??'!'))cursor++;};
  const fail=code=>{throw new Error(code);};
  function string(){
    if(text[cursor]!=='"')fail('import_parse_failed');
    const start=cursor++;
    while(cursor<text.length){
      const ch=text[cursor++];
      if(ch==='"')return JSON.parse(text.slice(start,cursor));
      if(ch==='\\')cursor++;
    }
    fail('import_parse_failed');
  }
  function value(depth){
    if(depth>64)fail('import_nesting_too_deep');whitespace();
    const ch=text[cursor];
    if(ch==='"'){string();return;}
    if(ch==='{'){
      cursor++;whitespace();const keys=new Set();
      if(text[cursor]==='}'){cursor++;return;}
      while(cursor<text.length){
        whitespace();const key=string();if(keys.has(key))fail('import_duplicate_key');keys.add(key);
        whitespace();if(text[cursor++]!==':')fail('import_parse_failed');value(depth+1);whitespace();
        const delimiter=text[cursor++];if(delimiter==='}')return;if(delimiter!==',')fail('import_parse_failed');
      }
      fail('import_parse_failed');
    }
    if(ch==='['){
      cursor++;whitespace();if(text[cursor]===']'){cursor++;return;}
      while(cursor<text.length){value(depth+1);whitespace();const delimiter=text[cursor++];if(delimiter===']')return;if(delimiter!==',')fail('import_parse_failed');}
      fail('import_parse_failed');
    }
    const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(cursor));
    if(!match)fail('import_parse_failed');cursor+=match[0].length;
  }
  value(0);whitespace();if(cursor!==text.length)fail('import_parse_failed');
  return JSON.parse(text);
}
export function parsePriceImport(text,{at,format='json',metadata}={}) {
  const fail=code=>({status:'invalid',series:[],issues:[code],warnings:[],...LIMITS});
  if(typeof text!=='string'||new TextEncoder().encode(text).length>2*1024*1024)return fail('import_size_invalid');
  let inputs;
  try{
    const clean=text.replace(/^\uFEFF/,'');
    if(format==='json'){
      const parsed=parseUniqueJSON(clean);
      inputs=parsed?.schemaVersion==='cribscore-price-import-v1'?parsed.series:[parsed];
    }else if(format==='csv'){
      if(!object(metadata))return fail('csv_metadata_required');
      const rows=csvRows(clean),header=['session','open','high','low','close','volume'];
      if(JSON.stringify(rows.shift())!==JSON.stringify(header))return fail('csv_header_invalid');
      inputs=[{...metadata,bars:rows.map(row=>{if(row.length!==6)throw Error('csv_row_invalid');return {session:row[0],open:row[1],high:row[2],low:row[3],close:row[4],volume:row[5]===''?null:/^\d+$/.test(row[5])?Number(row[5]):NaN};})}];
    }else return fail('import_format_unsupported');
  }catch(error){return fail(['import_duplicate_key','import_nesting_too_deep'].includes(error?.message)?error.message:'import_parse_failed');}
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>16)return fail('import_series_count_invalid');
  if(inputs.reduce((sum,x)=>sum+(Array.isArray(x?.bars)?x.bars.length:0),0)>40000)return fail('import_bar_count_invalid');
  const results=inputs.map(input=>normalizePriceSeries(object(input)?{...input,source:{...input.source,channel:'manual_import'}}:input,{at}));
  const issues=unique(results.flatMap(r=>r.issues));
  if(results.some(r=>!r.series))return {...fail('import_validation_failed'),issues:['import_validation_failed',...issues]};
  if(new Set(results.map(r=>r.series.symbol)).size!==results.length||new Set(results.map(r=>r.series.id)).size!==results.length)return fail('import_duplicate_series');
  return {status:results.some(r=>r.status==='partial')?'partial':'ready',series:results.map(r=>r.series),issues:[],warnings:unique(results.flatMap(r=>r.warnings)),...LIMITS};
}

function inspectCalendar(calendar,{at,timeZone}={}) {
  const reasons=[];
  if(!object(calendar)||calendar.status!=='verified_complete')return {valid:false,reasons:['verified_calendar_missing'],sessions:[]};
  if(!nonblank(calendar.id)||!zone(calendar.timeZone)||timeZone&&calendar.timeZone!==timeZone||!day(calendar.coverageStart)||!day(calendar.coverageEnd)||calendar.coverageStart>calendar.coverageEnd)reasons.push('calendar_identity_invalid');
  const src=calendar.source;
  if(!object(src)||!safeURL(src.url)||!hash(src.responseSha256)||!Number.isFinite(instant(src.capturedAt))||!Number.isFinite(instant(calendar.reviewedAt))||instant(src.capturedAt)>instant(calendar.reviewedAt)||instant(calendar.reviewedAt)>instant(at))reasons.push('calendar_provenance_invalid');
  if(!Array.isArray(calendar.sessions)||calendar.sessions.length>5000)return {valid:false,reasons:[...reasons,'calendar_sessions_invalid'],sessions:[]};
  let previous=null;
  for(const s of calendar.sessions){
    if(!object(s)||!day(s.date)||!Number.isFinite(instant(s.openAt))||!Number.isFinite(instant(s.closeAt))||instant(s.openAt)>=instant(s.closeAt)||s.date<calendar.coverageStart||s.date>calendar.coverageEnd||previous&&(s.date<=previous.date||instant(s.openAt)<=instant(previous.closeAt)))reasons.push('calendar_sessions_invalid');
    else if(zone(calendar.timeZone)&&(localDate(s.openAt,calendar.timeZone)!==s.date||localDate(s.closeAt,calendar.timeZone)!==s.date))reasons.push('calendar_session_timezone_mismatch');
    previous=s;
  }
  return {valid:!reasons.length,reasons:unique(reasons),sessions:reasons.length?[]:calendar.sessions.map(s=>({date:s.date,openAt:s.openAt,closeAt:s.closeAt}))};
}

export function resolvePaperWindow({publishedAt,horizonSessions,calendar,at}={}) {
  const result=(status,reasons,window=null)=>({status,reasons,window,evaluationVersion:PRICE_EVALUATOR_VERSION,...PAPER_LIMITS});
  if(!Number.isFinite(instant(at))||!Number.isFinite(instant(publishedAt))||instant(publishedAt)>instant(at)||![1,5].includes(horizonSessions))return result('blocked',['publication_or_horizon_invalid']);
  const inspected=inspectCalendar(calendar,{at});
  if(!inspected.valid)return result('pending',inspected.reasons);
  const publicationDay=localDate(publishedAt,calendar.timeZone);
  if(publicationDay<calendar.coverageStart||publicationDay>calendar.coverageEnd)return result('pending',['calendar_publication_coverage_missing']);
  const sessions=inspected.sessions.filter(s=>instant(s.openAt)>instant(publishedAt)).slice(0,horizonSessions);
  if(sessions.length!==horizonSessions)return result('pending',['calendar_future_sessions_missing']);
  return result('resolved',[],{calendarId:calendar.id,calendarSha256:calendar.source.responseSha256,timeZone:calendar.timeZone,publishedAt,horizonSessions,entrySession:sessions[0].date,exitSession:sessions.at(-1).date,entryAt:sessions[0].openAt,exitAt:sessions.at(-1).closeAt,sessions});
}

function actionInspection(series,review,window,calendar,at) {
  const a=series.actions,source=a.source;
  const from=window?.entrySession,through=window?.exitSession;
  if(!day(from)||!day(through)||from>through)return {status:'blocked',reasons:['paper_window_missing'],actions:null};
  if(a.status!=='complete'||a.fromSession>from||a.throughSession<through)return {status:'pending',reasons:['corporate_action_coverage_missing'],actions:null};
  if(!safeURL(source.url)||!hash(source.responseSha256)||source.responseSha256!==review.actionsSha256||!Number.isFinite(instant(source.capturedAt))||instant(source.capturedAt)>instant(review.reviewedAt)||instant(source.capturedAt)>instant(at))return {status:'blocked',reasons:['corporate_action_review_binding_invalid'],actions:null};
  const items=[];
  for(const item of a.items.filter(a=>a.effectiveSession>=from&&a.effectiveSession<=through)){
    const session=calendar.sessions.find(s=>s.date===item.effectiveSession);
    if(!session)return {status:'blocked',reasons:['action_session_not_in_calendar'],actions:null};
    if(item.type==='unsupported')return {status:'blocked',reasons:['corporate_action_unsupported'],actions:null};
    if(item.type==='cash_dividend'){
      const sameDaySplit=a.items.some(x=>x.type==='split'&&x.effectiveSession===item.effectiveSession);
      if(item.currency!==series.currency||item.cashPerShare.split('.')[1]?.length>6||!['post_split','current_shares'].includes(item.perShareBasis)||sameDaySplit&&item.perShareBasis!=='post_split')return {status:'blocked',reasons:['distribution_basis_unsupported'],actions:null};
    }
    items.push({...copy(item),effectiveAt:session.openAt,...(item.type==='cash_dividend'?{entitlementAt:session.openAt}: {})});
  }
  if(items.filter(x=>x.type==='split').some((x,i,all)=>all.findIndex(y=>y.effectiveSession===x.effectiveSession)!==i))return {status:'blocked',reasons:['multiple_splits_same_session'],actions:null};
  return {status:'available',reasons:[],actions:{coverage:'verified_complete',fromSession:from,throughSession:through,items}};
}
export function resolvePriceMark(input,{session,kind,calendar,review,window,at}={}) {
  const result=(status,reasons,mark=null,actions=null)=>({status,reasons,mark,actions,evaluationVersion:PRICE_EVALUATOR_VERSION,...PAPER_LIMITS});
  if(!day(session)||!['open','close'].includes(kind)||!Number.isFinite(instant(at)))return result('blocked',['mark_request_invalid']);
  const inspected=normalizePriceSeries(input,{at});
  if(!inspected.series)return result(inspected.status==='missing'?'pending':'blocked',inspected.issues);
  const s=inspected.series,src=s.source;
  if(src.channel!=='retained_capture'||s.priceBasis!=='unadjusted'||src.priceSession!=='regular_daily_aggregate')return result('blocked',['reviewed_raw_capture_required']);
  if(!object(review)||review.status!=='verified'||review.allowedUse!=='paper_marks'||!nonblank(review.id)||!Number.isFinite(instant(review.reviewedAt))||instant(review.reviewedAt)>instant(at))return result('pending',['paper_source_review_missing']);
  const bindings={seriesId:s.id,symbol:s.symbol,entityId:s.entityId,currency:s.currency,sessionTimezone:s.sessionTimezone,provider:src.provider,dataset:src.dataset,sourceUrl:src.url,capturedAt:src.capturedAt,responseSha256:src.responseSha256,priceBasis:s.priceBasis,priceSession:src.priceSession};
  if(Object.entries(bindings).some(([k,v])=>review[k]!==v)||!nonblank(s.entityId)||!safeURL(src.url)||!hash(src.responseSha256)||!Number.isFinite(instant(src.capturedAt))||instant(src.capturedAt)>instant(review.reviewedAt)||src.paginationComplete!==true)return result('blocked',['paper_source_review_binding_invalid']);
  const cal=inspectCalendar(calendar,{at,timeZone:s.sessionTimezone});
  if(!cal.valid)return result('pending',cal.reasons);
  const scheduled=cal.sessions.find(s=>s.date===session);
  if(!scheduled)return result('pending',['mark_session_calendar_missing']);
  const resolved=resolvePaperWindow({publishedAt:window?.publishedAt,horizonSessions:window?.horizonSessions,calendar,at});
  if(!window||resolved.status!=='resolved'||!sameStructure(window,resolved.window)||session<window.entrySession||session>window.exitSession)return result('blocked',['frozen_window_calendar_mismatch']);
  // A completed partial mark needs actions only through that marked session.
  // Terminal accounting must request the frozen exit close, which requires the
  // entire interval; no future no-actions coverage is assumed for an open mark.
  const actions=actionInspection(s,review,{...window,exitSession:session},calendar,at);
  if(actions.status!=='available')return result(actions.status,actions.reasons);
  const bar=s.bars.find(b=>b.session===session);
  if(!bar)return result('pending',['session_price_missing'],null,actions.actions);
  // A final daily bar supplies an opening reference only after it was observed.
  // It is a hypothetical paper proxy, not an opening-auction fill guarantee.
  if(instant(at)<instant(scheduled.closeAt)||!Number.isFinite(instant(bar.availableAt))||instant(bar.availableAt)>instant(at))return result('pending',['daily_bar_not_available'],null,actions.actions);
  if(instant(bar.availableAt)<instant(scheduled.closeAt)||instant(src.capturedAt)<instant(scheduled.closeAt))return result('blocked',['daily_bar_availability_before_close']);
  const value=bar.decimals[kind];
  if(value.split('.')[1]?.length>6)return result('blocked',['paper_price_precision_unsupported']);
  return result('available',[],{seriesId:s.id,symbol:s.symbol,originalSymbol:s.originalSymbol,entityId:s.entityId,currency:s.currency,session,kind,eventAt:kind==='open'?scheduled.openAt:scheduled.closeAt,availableAt:bar.availableAt,priceTimestamp:null,value,priceBasis:'unadjusted',executionBasis:'daily_bar_paper_reference',source:{provider:src.provider,dataset:src.dataset,url:src.url,capturedAt:src.capturedAt,responseSha256:src.responseSha256,priceSession:src.priceSession},reviewId:review.id},actions.actions);
}

function displayPoints(series,{at,calendar,rangeSessions}) {
  const cal=inspectCalendar(calendar,{at,timeZone:series.sessionTimezone});
  const dates=new Map(cal.sessions.map(s=>[s.date,s]));
  const today=localDate(at,series.sessionTimezone);
  const eligible=series.bars.filter(b=>b.session<=today&&(!b.availableAt||instant(b.availableAt)<=instant(at))&&(!cal.valid||dates.has(b.session)&&instant(dates.get(b.session).closeAt)<=instant(at)));
  const bars=rangeSessions==='all'?eligible:eligible.slice(-rangeSessions);
  const points=bars.map((b,index)=>{
    const missing=index&&cal.valid?cal.sessions.filter(s=>s.date>bars[index-1].session&&s.date<b.session).map(s=>s.date):[];
    const actions=series.actions.items.filter(a=>a.effectiveSession===b.session);
    return {session:b.session,open:b.open,high:b.high,low:b.low,close:b.close,decimals:copy(b.decimals),volume:b.volume,availableAt:b.availableAt,breakBefore:missing.length>0||index>0&&actions.some(a=>a.type==='split')&&['unadjusted','unknown'].includes(series.priceBasis),missingSessionsBefore:missing,actions:copy(actions)};
  });
  const coverage=cal.valid&&bars.length&&calendar.coverageStart<=bars[0].session&&calendar.coverageEnd>=today;
  const expected=coverage?cal.sessions.filter(s=>s.date>=bars[0].session&&instant(s.closeAt)<=instant(at)):[];
  const missing=expected.filter(s=>!bars.some(b=>b.session===s.date)).map(s=>s.date);
  return {points,cal,dates,coverage,missing,expectedLatestSession:coverage?expected.at(-1)?.date??null:null};
}
function indexedComparison(target,benchmark,options,targetPoints) {
  const empty=reason=>({status:'unavailable',reason,benchmarkSymbol:benchmark?.symbol??null,points:[],basis:null});
  if(!benchmark)return empty('benchmark_missing');
  const parsed=normalizePriceSeries(benchmark,{at:options.at});
  if(!parsed.series)return empty('benchmark_invalid');
  const b=parsed.series;
  if(b.currency!==target.currency||b.sessionTimezone!==target.sessionTimezone||b.priceBasis!==target.priceBasis)return empty('benchmark_basis_mismatch');
  if(target.priceBasis==='unknown')return empty('adjustment_basis_unknown');
  const bp=displayPoints(b,options).points;
  if(targetPoints.length<2||bp.length!==targetPoints.length||bp.some((p,i)=>p.session!==targetPoints[i].session))return empty('benchmark_sessions_mismatch');
  if([...targetPoints,...bp].some(p=>p.missingSessionsBefore.length))return empty('benchmark_session_gaps');
  if(target.priceBasis==='unadjusted'){
    const start=targetPoints[0].session,end=targetPoints.at(-1).session;
    for(const s of [target,b])if(s.actions.status!=='complete'||s.actions.fromSession>start||s.actions.throughSession<end||s.actions.items.some(a=>a.effectiveSession>start&&a.effectiveSession<=end))return empty('unadjusted_action_comparison_withheld');
  }
  const points=targetPoints.map((p,i)=>({session:p.session,targetIndex:p.close/targetPoints[0].close*100,benchmarkIndex:bp[i].close/bp[0].close*100}));
  if(points.some(p=>!Number.isFinite(p.targetIndex)||!Number.isFinite(p.benchmarkIndex)))return empty('comparison_arithmetic_invalid');
  return {status:'available',reason:null,benchmarkSymbol:b.symbol,points,basis:target.priceBasis==='total_return_adjusted'?'provider_total_return_adjusted_index':'descriptive_price_index'};
}
export function buildPriceView(input,{at,rangeSessions=60,calendar,benchmark,maxCaptureAgeHours=24}={}) {
  const empty=(issues,warnings=[])=>({status:'unavailable',symbol:input?.symbol??null,currency:input?.currency??null,sessionTimezone:input?.sessionTimezone??null,interval:'1d',priceBasis:input?.priceBasis??'unknown',volumeBasis:input?.volumeBasis??'unknown',points:[],latest:null,source:null,freshness:{captureStatus:'unknown',captureAgeHours:null,sessionStatus:'calendar_unknown',expectedLatestSession:null,declaredDelayMinutes:null},gaps:{status:'unknown',missingSessions:[]},comparison:{status:'unavailable',reason:'price_series_unavailable',benchmarkSymbol:null,points:[],basis:null},issues,warnings,chartTrust:'unreviewed_source',...LIMITS});
  if(![20,60,120,'all'].includes(rangeSessions)||!Number.isFinite(maxCaptureAgeHours)||maxCaptureAgeHours<=0)return empty(['display_policy_invalid']);
  const parsed=normalizePriceSeries(input,{at});
  if(!parsed.series)return empty(parsed.issues,parsed.warnings);
  const s=parsed.series,shown=displayPoints(s,{at,calendar,rangeSessions});
  const capture=instant(s.source.capturedAt),age=Number.isFinite(capture)&&capture<=instant(at)?(instant(at)-capture)/3600000:null;
  const captureStatus=!s.source.capturedAt?'unknown':age===null?'invalid':age<=maxCaptureAgeHours?'within_policy':'stale';
  const last=shown.points.at(-1),sessionStatus=!shown.coverage?'calendar_unknown':last?.session===shown.expectedLatestSession?'current_completed_session':'behind_completed_session';
  const warnings=unique([...parsed.warnings,...(!shown.cal.valid?['calendar_unverified']:[]),...(shown.missing.length?['trading_sessions_missing']:[]),...(captureStatus==='stale'?['capture_stale']:[]),...(sessionStatus==='behind_completed_session'?['completed_session_missing']:[])]);
  return {status:shown.points.length?(warnings.length?'partial':'available'):'unavailable',symbol:s.symbol,currency:s.currency,sessionTimezone:s.sessionTimezone,interval:s.interval,priceBasis:s.priceBasis,volumeBasis:s.volumeBasis,points:shown.points,
    latest:last?{session:last.session,close:last.close,closeDecimal:last.decimals.close,availableAt:last.availableAt,capturedAt:s.source.capturedAt,sessionCloseAt:shown.dates.get(last.session)?.closeAt??null}:null,source:copy(s.source),freshness:{captureStatus,captureAgeHours:age,sessionStatus,expectedLatestSession:shown.expectedLatestSession,declaredDelayMinutes:s.source.declaredDelayMinutes},gaps:{status:shown.coverage?(shown.missing.length?'incomplete':'complete'):'unknown',missingSessions:shown.missing},comparison:indexedComparison(s,benchmark,{at,calendar,rangeSessions},shown.points),issues:[],warnings,chartTrust:s.source.channel==='manual_import'?'manual_import':'unreviewed_source',...LIMITS};
}

/** Offline response adapter. It never transmits a request or reads a key.
 * Explicit request parameters prevent silently mixing IEX/SIP, adjustments or
 * symbol mappings. Successful parsing does not establish account entitlement.
 */
export function adaptAlpacaDailyBars(body,{request,capture,security,at}={}) {
  const fail=reason=>({status:'invalid',series:null,issues:[reason],warnings:[],accessVerified:false,adapterVersion:'alpaca-daily-response-v1',...LIMITS});
  if(!object(request)||!object(capture)||!object(security)||!object(body))return fail('alpaca_context_missing');
  const adjustments=['raw','split','dividend','spin-off','all'];
  const parts=typeof request.adjustment==='string'?request.adjustment.split(','):[];
  if(request.feed!=='sip'||request.timeframe!=='1Day'||!parts.length||parts.some(x=>!adjustments.includes(x))||unique(parts).length!==parts.length||parts.length>1&&parts.some(x=>['raw','all'].includes(x))||!day(request.asof)&&request.asof!=='-'||!Number.isFinite(instant(request.start))||!Number.isFinite(instant(request.end))||instant(request.start)>=instant(request.end)||!Array.isArray(request.symbols)||!request.symbols.length||request.symbols.some(s=>!symbol(s))||unique(request.symbols).length!==request.symbols.length||!request.symbols.includes(security.symbol)||request.currency!==security.currency)return fail('alpaca_explicit_request_invalid');
  if(!nonblank(capture.id)||!hash(capture.responseSha256)||!Number.isFinite(instant(capture.requestStartedAt))||!Number.isFinite(instant(capture.capturedAt))||instant(capture.requestStartedAt)>instant(capture.capturedAt)||instant(request.end)>instant(capture.requestStartedAt)-15*60000)return fail('alpaca_capture_or_delayed_end_invalid');
  if(!safeURL(capture.url))return fail('alpaca_capture_url_invalid');
  const url=new URL(capture.url);
  if(url.origin!=='https://data.alpaca.markets'||url.pathname!=='/v2/stocks/bars'||['feed','timeframe','adjustment','asof','start','end','currency'].some(k=>url.searchParams.getAll(k).length!==1||url.searchParams.get(k)!==request[k])||url.searchParams.getAll('symbols').length!==1||url.searchParams.get('symbols')!==request.symbols.join(','))return fail('alpaca_request_capture_mismatch');
  if(security.sessionTimezone!=='America/New_York'||!symbol(security.symbol)||security.originalSymbol!=null&&!symbol(security.originalSymbol))return fail('alpaca_security_mapping_invalid');
  if(!object(body.bars)||Object.keys(body.bars).some(k=>!request.symbols.includes(k))||body.next_page_token!=null&&(typeof body.next_page_token!=='string'||!body.next_page_token))return fail('alpaca_response_shape_invalid');
  const incoming=body.bars[security.symbol]??[];
  if(!Array.isArray(incoming))return fail('alpaca_response_shape_invalid');
  const bars=[];
  for(const b of incoming){
    // Daily t is midnight in New York. Preserve the raw stamp as provenance,
    // never as the availability/publication clock for the resulting bar.
    if(!object(b)||typeof b.t!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.0{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(b.t)||!day(b.t.slice(0,10))||!Number.isFinite(Date.parse(b.t)))return fail('alpaca_daily_timestamp_invalid');
    const timeParts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(b.t));
    if(timeParts.filter(p=>['hour','minute','second'].includes(p.type)).some(p=>p.value!=='00')||Date.parse(b.t)<instant(request.start)||Date.parse(b.t)>instant(request.end))return fail('alpaca_bar_outside_requested_daily_range');
    bars.push({session:localDate(b.t,'America/New_York'),open:b.o,high:b.h,low:b.l,close:b.c,volume:b.v,availableAt:capture.capturedAt,providerTimestamp:b.t});
  }
  const priceBasis=request.adjustment==='raw'?'unadjusted':request.adjustment==='split'?'split_adjusted':'unknown';
  // A terminal page fetched with page_token is still only a suffix. A missing
  // token field also cannot certify that a retained response is exhaustive.
  const paginationComplete=Object.hasOwn(body,'next_page_token')&&body.next_page_token===null&&!url.searchParams.has('page_token');
  const result=normalizePriceSeries({schemaVersion:PRICE_SERIES_VERSION,id:capture.id,symbol:security.symbol,originalSymbol:security.originalSymbol??security.symbol,entityId:security.entityId??null,currency:security.currency,exchange:security.exchange??null,sessionTimezone:security.sessionTimezone,interval:'1d',priceBasis,volumeBasis:parts.includes('split')||parts.includes('all')?'split_adjusted_shares':'shares',source:{provider:'Alpaca',dataset:'historical-stock-bars',url:capture.url,capturedAt:capture.capturedAt,publishedAt:null,responseSha256:capture.responseSha256,channel:'retained_capture',declaredDelayMinutes:15,feed:request.feed,requestedAdjustment:request.adjustment,symbolAsOf:request.asof,requestStartedAt:capture.requestStartedAt,requestEnd:request.end,paginationComplete,volumeSession:'daily_including_extended_hours',priceSession:'regular_daily_aggregate'},bars,actions:{status:'unknown',fromSession:null,throughSession:null,source:{url:null,capturedAt:null,responseSha256:null},items:[]}},{at});
  return {...result,warnings:unique([...result.warnings,'account_entitlement_not_verified','daily_ohlc_paper_proxy_not_executable_fill',...(priceBasis==='unknown'?['provider_adjustment_not_total_return']:[])]),accessVerified:false,adapterVersion:'alpaca-daily-response-v1'};
}
