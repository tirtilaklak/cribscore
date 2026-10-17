// Server-only projection. Serialization is not licensing approval or live-input validation.
import {createHash} from 'node:crypto';
export const SLATE_SCHEMA = 'cribscore_research_slate_v2';
export const SUPPORTED_SCORE_POLICY = 'research_evidence_v0_1_unvalidated';
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
// Read only own data properties: ignored getters and inherited/prototype fields never become output.
const own=(value,key)=>plain(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const item=(array,index)=>Object.getOwnPropertyDescriptor(array,String(index))?.value;
const text=(value,max=500)=>typeof value==='string' && value.trim()===value && value.length>0 && value.length<=max && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/.test(value);
const instant=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19)===value.slice(0,19);
const digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
const blocked=reason=>({ok:false,status:'withheld',reasons:[reason],serialized:null});
const score=value=>Number.isFinite(value) && value>=0 && value<=100 && Number.isInteger(value/12.5);
const day=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && instant(`${value}T00:00:00Z`);
const exactKeys=(value,names)=>plain(value) && Object.keys(value).length===names.length && names.every(key=>Object.hasOwn(value,key));
const zone=value=>typeof value==='string' && value.length<=80 && /^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value) && (()=>{try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format(0);return true;}catch{return false;}})();
const localDay=(at,timeZone)=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');};
function prepareTiming(value){
  const precision=own(value,'precision');
  if(precision==='exact' && exactKeys(value,['precision','at']) && instant(own(value,'at')))return {precision,at:own(value,'at')};
  if(precision==='date_only' && exactKeys(value,['precision','date','time_zone']) && day(own(value,'date')) && zone(own(value,'time_zone')))return {precision,date:own(value,'date'),time_zone:own(value,'time_zone')};
  if(precision==='interval' && exactKeys(value,['precision','start_at','end_at']) && instant(own(value,'start_at')) && instant(own(value,'end_at')) && Date.parse(own(value,'start_at'))<Date.parse(own(value,'end_at')))return {precision,start_at:own(value,'start_at'),end_at:own(value,'end_at')};
  return null;
}
function timingPosition(timing,window){
  if(timing.precision==='date_only'){
    const entry=localDay(window.entry_at,timing.time_zone),exit=localDay(window.exit_at,timing.time_zone);
    return timing.date<entry?'before_window':timing.date>exit?'after_window':timing.date>entry&&timing.date<exit?'in_window':'boundary_uncertain';
  }
  const start=Date.parse(timing.at||timing.start_at),end=Date.parse(timing.at||timing.end_at),entry=Date.parse(window.entry_at),exit=Date.parse(window.exit_at);
  return end<entry?'before_window':start>exit?'after_window':start>=entry&&end<=exit?'in_window':'boundary_uncertain';
}
const knownBy=(timing,cutoff)=>timing.precision==='date_only'?timing.date<=localDay(cutoff,timing.time_zone):Date.parse(timing.at||timing.end_at)<=Date.parse(cutoff);

export function prepareSlateMetadata(value){
  const universe_version=own(value,'universe_version'),c=own(value,'counts'),p=own(value,'price_session'),s=own(value,'source_health');
  const counts={roster:own(c,'roster'),screened:own(c,'screened'),blocked:own(c,'blocked'),eligible:own(c,'eligible')};
  if(!text(universe_version,120) || !/^[A-Za-z][A-Za-z0-9._:-]*$/.test(universe_version) ||
    !Object.values(counts).every(v=>Number.isSafeInteger(v)&&v>=0) || counts.screened>counts.roster || counts.blocked>counts.screened || counts.eligible!==counts.screened-counts.blocked ||
    !day(own(p,'date')) || !instant(own(p,'closed_at')) || own(p,'closed_at').slice(0,10)!==own(p,'date') ||
    !['reviewed_at_cutoff','partial_at_cutoff','unavailable_at_cutoff'].includes(own(s,'state')) || !text(own(s,'label'),240) ||
    (own(s,'state')==='unavailable_at_cutoff'&&counts.eligible!==0))return blocked('slate_metadata_invalid');
  const projected={universe_version,counts,price_session:{date:own(p,'date'),closed_at:own(p,'closed_at')},source_health:{state:own(s,'state'),label:own(s,'label')}};
  const serialized=JSON.stringify(projected);return {ok:true,projected,serialized,sha256:digest(serialized)};
}
function reviewedMetadata(value,context,scorerResult,window,cutoff,at,displayExpiresAt){
  const prepared=prepareSlateMetadata(value);if(!prepared.ok)return prepared;
  const m=prepared.projected,r=own(value,'review'),inputRows=own(scorerResult,'rows'),withheld=own(scorerResult,'withheld'),eligible=own(scorerResult,'eligible_count'),limit=own(scorerResult,'limit'),price=own(context,'price_session'),assessedAt=own(context,'assessed_at');
  // Counts are supplied from the reviewed full assessment, never inferred from a displayed shortlist.
  if(own(context,'universe_version')!==m.universe_version || own(price,'date')!==m.price_session.date || own(price,'closed_at')!==m.price_session.closed_at ||
    !instant(assessedAt) || Date.parse(assessedAt)<Date.parse(cutoff) || Date.parse(assessedAt)>Date.parse(at) ||
    !Number.isSafeInteger(eligible) || eligible<0 || eligible!==m.counts.eligible || !Array.isArray(withheld) || withheld.length!==m.counts.blocked ||
    !Array.isArray(inputRows) || inputRows.length!==Math.min(limit,eligible))return blocked('metadata_assessment_mismatch');
  for(let i=0;i<withheld.length;i++)if(own(item(withheld,i),'status')!=='withheld')return blocked('metadata_assessment_mismatch');
  if(Date.parse(m.price_session.closed_at)>Date.parse(cutoff) || own(r,'state')!=='reviewed' || own(r,'audience')!=='owner_private' || !text(own(r,'review_id'),160) ||
    own(r,'horizon_id')!==window.horizon_id || own(r,'entry_at')!==window.entry_at || own(r,'exit_at')!==window.exit_at || own(r,'source_cutoff_at')!==cutoff ||
    // Presentation counts can be reviewed only after the actual assessment; source data remains cutoff-bound.
    !instant(own(r,'reviewed_at')) || Date.parse(own(r,'reviewed_at'))<Date.parse(assessedAt) || Date.parse(own(r,'reviewed_at'))>Date.parse(at) ||
    !instant(own(r,'expires_at')) || Date.parse(own(r,'expires_at'))<=Date.parse(at) || Date.parse(own(r,'expires_at'))<Date.parse(displayExpiresAt) ||
    own(r,'content_sha256')!==prepared.sha256)return blocked('slate_metadata_review_invalid');
  return prepared;
}

function publicURL(value) {
  if(!text(value,2048) || !/^[\x21-\x7e]+$/.test(value))return null;
  try {
    const u=new URL(value),host=u.hostname.toLowerCase(),path=decodeURIComponent(u.pathname);
    // Direct public document links only. Query strings/fragments can contain credentials or private document IDs.
    if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash || u.port || !host.includes('.') ||
      /^[\d.]+$/.test(host) || host.includes(':') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
      /(?:^|[\/._-])(?:token|api[_-]?key|access[_-]?key|authorization|secret|password)(?:$|[\/._=-])/i.test(path))return null;
    return u.href;
  }catch{return null;}
}

// This projection is also the exact content the public-case reviewer must inspect and bind.
// Its hash is review metadata only; it is never included in a publication payload.
export function preparePublicCase(value) {
  const security_id=own(value,'security_id'),ticker=own(value,'ticker'),company=own(value,'company'),
    thesis=own(value,'thesis'),downside=own(value,'downside'),invalidation_trigger=own(value,'invalidation_trigger'),rawCatalyst=own(value,'catalyst'),rawSources=own(value,'sources');
  if(!text(security_id,160) || typeof ticker!=='string' || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker) ||
    !text(company,160) || !text(thesis) || !text(downside) || !text(invalidation_trigger) || invalidation_trigger.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu,'').length===0 || !Array.isArray(rawSources) || rawSources.length<1 || rawSources.length>12)return blocked('public_case_invalid');
  const sources=[],urls=new Set();
  for(let i=0;i<rawSources.length;i++){
    const source=item(rawSources,i),label=own(source,'label'),url=publicURL(own(source,'url'));
    if(!text(label,160) || !url || urls.has(url))return blocked('public_source_invalid');
    sources.push({label,url});urls.add(url);
  }
  const label=own(rawCatalyst,'label'),kind=own(rawCatalyst,'kind'),timing=prepareTiming(own(rawCatalyst,'timing')),source_url=publicURL(own(rawCatalyst,'source_url'));
  if(!text(label,200) || !['known_information','scheduled_event'].includes(kind) || !timing || !source_url || !urls.has(source_url))return blocked('public_catalyst_invalid');
  const projected={security_id,ticker,company,thesis,downside,invalidation_trigger,catalyst:{label,kind,timing,source_url},sources};
  const serialized=JSON.stringify(projected);
  return {ok:true,projected,serialized,sha256:digest(serialized)};
}

function reviewedCase(value,window,cutoff,at,displayExpiresAt) {
  const prepared=preparePublicCase(value);
  if(!prepared.ok)return prepared;
  if(prepared.projected.catalyst.kind==='known_information'&&!knownBy(prepared.projected.catalyst.timing,cutoff))return blocked('known_information_after_cutoff');
  const review=own(value,'public_review');
  if(own(review,'state')!=='reviewed' || own(review,'audience')!=='owner_private' || !text(own(review,'review_id'),160) ||
    own(review,'security_id')!==prepared.projected.security_id || own(review,'horizon_id')!==window.horizon_id ||
    own(review,'entry_at')!==window.entry_at || own(review,'exit_at')!==window.exit_at || own(review,'source_cutoff_at')!==cutoff ||
    // Final public copy review may follow data cutoff. It does not change underlying source eligibility.
    !instant(own(review,'reviewed_at')) || Date.parse(own(review,'reviewed_at'))>Date.parse(at) ||
    !instant(own(review,'expires_at')) || Date.parse(own(review,'expires_at'))<=Date.parse(at) || Date.parse(own(review,'expires_at'))<Date.parse(displayExpiresAt) ||
    own(review,'content_sha256')!==prepared.sha256 || (prepared.projected.catalyst.kind==='known_information'&&!knownBy(prepared.projected.catalyst.timing,own(review,'reviewed_at'))))return blocked('public_case_review_invalid');
  return prepared;
}

export function serializeResearchSlate({scorerResult,publicCases,window,sourceCutoffAt,at,displayExpiresAt,displayBounds,slateMetadata,assessmentContext}={}) {
  const horizon_id=own(window,'horizon_id'),entry_at=own(window,'entry_at'),exit_at=own(window,'exit_at');
  if(!['next_day','next_week'].includes(horizon_id) || !instant(entry_at) || !instant(exit_at) || !instant(sourceCutoffAt) || !instant(at) ||
    Date.parse(sourceCutoffAt)>Date.parse(at) || Date.parse(at)>=Date.parse(entry_at) || Date.parse(entry_at)>=Date.parse(exit_at))return blocked('window_or_clock_invalid');
  // The trusted controller supplies every deadline from its review records; missing bounds are not inferred.
  // These deadlines constrain a proposed asset. They do not approve it or authorize its delivery.
  const bounds=['authorization_expires_at','entitlement_expires_at','derived_review_expires_at','score_review_expires_at'].map(key=>own(displayBounds,key));
  if(!instant(displayExpiresAt) || Date.parse(displayExpiresAt)<=Date.parse(at) ||
    bounds.some(value=>!instant(value) || Date.parse(value)<=Date.parse(at) || Date.parse(displayExpiresAt)>Date.parse(value)) ||
    Date.parse(displayExpiresAt)>Date.parse(exit_at))return blocked('display_expiry_invalid');
  const expectedWindow={horizon_id,entry_at,exit_at};
  if(own(scorerResult,'policy_version')!==SUPPORTED_SCORE_POLICY || own(scorerResult,'audience')!=='owner_private' ||
    own(scorerResult,'predictive_status')!=='unvalidated' || own(scorerResult,'ranking_basis')!=='reviewed_research_evidence')return blocked('scorer_contract_invalid');
  const inputRows=own(scorerResult,'rows'),limit=own(scorerResult,'limit');
  if(!Number.isInteger(limit) || limit<5 || limit>10 || !Array.isArray(inputRows) || inputRows.length>limit ||
    !Array.isArray(publicCases) || publicCases.length>1000)return blocked('input_shape_invalid');
  const metadata=reviewedMetadata(slateMetadata,assessmentContext,scorerResult,expectedWindow,sourceCutoffAt,at,displayExpiresAt);
  if(!metadata.ok)return metadata;
  const rowIds=new Map(),caseIds=new Map(),tickers=new Map(),scoreCounts=new Map();
  for(let i=0;i<inputRows.length;i++){
    const row=item(inputRows,i),id=own(row,'security_id');
    rowIds.set(id,(rowIds.get(id)||0)+1);
    if(!score(own(row,'score')) || (i && own(item(inputRows,i-1),'score')<own(row,'score')))return blocked('score_order_invalid');
    scoreCounts.set(own(row,'score'),(scoreCounts.get(own(row,'score'))||0)+1);
  }
  for(let i=0;i<publicCases.length;i++){
    const value=item(publicCases,i),id=own(value,'security_id'),ticker=own(value,'ticker');
    if(!caseIds.has(id))caseIds.set(id,[]);caseIds.get(id).push(value);
    if(typeof ticker==='string')tickers.set(ticker,(tickers.get(ticker)||0)+1);
  }
  const rows=[],withheld=[];
  for(let i=0;i<inputRows.length;i++){
    const row=item(inputRows,i),id=own(row,'security_id'),value=own(row,'score');
    const reject=reason=>withheld.push({index:i,reason});
    if(!text(id,160) || rowIds.get(id)!==1){reject('score_identity_invalid_or_duplicate');continue;}
    let expectedRank=1;
    while(expectedRank<=i && own(item(inputRows,expectedRank-1),'score')!==value)expectedRank++;
    if(own(row,'status')!=='scored' || own(row,'policy_version')!==SUPPORTED_SCORE_POLICY || own(row,'audience')!=='owner_private' ||
      own(row,'predictive_status')!=='unvalidated' || own(row,'expected_return')!==null || own(row,'gain_probability')!==null ||
      own(row,'horizon_id')!==horizon_id || own(row,'entry_at')!==entry_at || own(row,'exit_at')!==exit_at || own(row,'source_cutoff_at')!==sourceCutoffAt ||
      own(row,'research_rank')!==expectedRank || own(row,'display_order')!==i+1 || typeof own(row,'tied_priority')!=='boolean' ||
      (scoreCounts.get(value)>1 && own(row,'tied_priority')!==true)){reject('scored_row_contract_invalid');continue;}
    const matches=caseIds.get(id);
    if(!matches || matches.length!==1){reject('public_case_missing_or_duplicate');continue;}
    const prepared=reviewedCase(matches[0],expectedWindow,sourceCutoffAt,at,displayExpiresAt);
    if(!prepared.ok){reject(prepared.reasons[0]);continue;}
    const c=prepared.projected;
    if(tickers.get(c.ticker)!==1){reject('public_ticker_duplicate');continue;}
    const position=timingPosition(c.catalyst.timing,expectedWindow);
    // Do not spread input objects. Source hashes, credentials, raw bars and private metadata have no output path.
    // Full-scorer tie status can refer to peers outside this shortlist or withheld public cases.
    rows.push({ticker:c.ticker,company:c.company,research_rank:expectedRank,research_score:value,tied_priority:own(row,'tied_priority'),
      catalyst:{label:c.catalyst.label,kind:c.catalyst.kind,timing:c.catalyst.timing,window_position:position,source_url:c.catalyst.source_url},
      thesis:c.thesis,downside:c.downside,invalidation_trigger:c.invalidation_trigger,sources:c.sources.map(source=>({label:source.label,url:source.url}))});
  }
  const payload={schema_version:SLATE_SCHEMA,policy_version:SUPPORTED_SCORE_POLICY,audience:'owner_private',
    predictive_status:'unvalidated',label:'Unvalidated research priorities; not a return forecast.',
    score_label:'Research evidence score (0–100)',generated_at:at,source_cutoff_at:sourceCutoffAt,display_expires_at:displayExpiresAt,
    horizon:{id:horizon_id,entry_at,exit_at},metadata:metadata.projected,rows,withheld_count:withheld.length};
  return {ok:true,status:'review_required',schemaVersion:SLATE_SCHEMA,methodVersion:SUPPORTED_SCORE_POLICY,
    serialized:JSON.stringify(payload),withheld};
}
