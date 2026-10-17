// Presentation boundary only. The injected reader must obtain bytes from an owner-authenticated,
// exact-output-approved publisher. Neither this slot nor payload fields authorize publication.
const slots=new WeakMap();
const schema='cribscore_research_slate_v2',policy='research_evidence_v0_1_unvalidated';
const rootKeys=['schema_version','policy_version','audience','predictive_status','label','score_label','generated_at','source_cutoff_at','display_expires_at','horizon','metadata','rows','withheld_count'];
const rowKeys=['ticker','company','research_rank','research_score','tied_priority','catalyst','thesis','downside','invalidation_trigger','sources'];
const keys=(value,names)=>value!==null && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===names.length && names.every(name=>Object.hasOwn(value,name));
const clean=(value,max=500)=>typeof value==='string' && value.trim()===value && value.length>0 && value.length<=max && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/.test(value);
const validInvalidation=value=>clean(value) && value.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu,'').length>0;
const instant=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19)===value.slice(0,19);
const day=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && instant(`${value}T00:00:00Z`);
const zone=value=>typeof value==='string' && value.length<=80 && /^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(value) && (()=>{try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format(0);return true;}catch{return false;}})();
const localDay=(at,timeZone)=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');};
function validTiming(t){
  return t?.precision==='exact' ? keys(t,['precision','at'])&&instant(t.at) :
    t?.precision==='date_only' ? keys(t,['precision','date','time_zone'])&&day(t.date)&&zone(t.time_zone) :
    t?.precision==='interval' ? keys(t,['precision','start_at','end_at'])&&instant(t.start_at)&&instant(t.end_at)&&Date.parse(t.start_at)<Date.parse(t.end_at) : false;
}
function timingPosition(t,window){
  if(t.precision==='date_only'){
    const entry=localDay(window.entry_at,t.time_zone),exit=localDay(window.exit_at,t.time_zone);
    return t.date<entry?'before_window':t.date>exit?'after_window':t.date>entry&&t.date<exit?'in_window':'boundary_uncertain';
  }
  const start=Date.parse(t.at||t.start_at),end=Date.parse(t.at||t.end_at),entry=Date.parse(window.entry_at),exit=Date.parse(window.exit_at);
  return end<entry?'before_window':start>exit?'after_window':start>=entry&&end<=exit?'in_window':'boundary_uncertain';
}
const knownBy=(t,cutoff)=>t.precision==='date_only'?t.date<=localDay(cutoff,t.time_zone):Date.parse(t.at||t.end_at)<=Date.parse(cutoff);
function validMetadata(m,p){
  if(!keys(m,['universe_version','counts','price_session','source_health']) || !clean(m.universe_version,120) || !/^[A-Za-z][A-Za-z0-9._:-]*$/.test(m.universe_version) ||
    !keys(m.counts,['roster','screened','blocked','eligible']) || !Object.values(m.counts).every(v=>Number.isSafeInteger(v)&&v>=0) ||
    m.counts.screened>m.counts.roster || m.counts.blocked>m.counts.screened || m.counts.eligible!==m.counts.screened-m.counts.blocked || p.rows.length+p.withheld_count>m.counts.eligible ||
    !keys(m.price_session,['date','closed_at']) || !day(m.price_session.date) || !instant(m.price_session.closed_at) || m.price_session.closed_at.slice(0,10)!==m.price_session.date || Date.parse(m.price_session.closed_at)>Date.parse(p.source_cutoff_at) ||
    !keys(m.source_health,['state','label']) || !['reviewed_at_cutoff','partial_at_cutoff','unavailable_at_cutoff'].includes(m.source_health.state) || !clean(m.source_health.label,240) ||
    (m.source_health.state==='unavailable_at_cutoff'&&m.counts.eligible!==0))return false;
  return true;
}
function publicURL(value){
  if(!clean(value,2048)||!/^[\x21-\x7e]+$/.test(value))return false;
  try{
    const u=new URL(value),host=u.hostname.toLowerCase(),path=decodeURIComponent(u.pathname);
    return u.protocol==='https:' && !u.username && !u.password && !u.search && !u.hash && !u.port && host.includes('.') &&
      !/^[\d.]+$/.test(host) && !host.includes(':') && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) &&
      !/(?:^|[\/._-])(?:token|api[_-]?key|access[_-]?key|authorization|secret|password)(?:$|[\/._=-])/i.test(path) && u.href===value;
  }catch{return false;}
}
function decode(serialized){
  // The canonical serializer emits compact JSON. Do not accept wrappers, duplicate keys, or drafts.
  if(typeof serialized!=='string'||serialized.length>350000)return null;
  try{
    const p=JSON.parse(serialized);
    if(JSON.stringify(p)!==serialized || !keys(p,rootKeys) || p.schema_version!==schema || p.policy_version!==policy ||
      p.audience!=='owner_private' || p.predictive_status!=='unvalidated' ||
      p.label!=='Unvalidated research priorities; not a return forecast.' || p.score_label!=='Research evidence score (0–100)' ||
      ![p.generated_at,p.source_cutoff_at,p.display_expires_at].every(instant) || !keys(p.horizon,['id','entry_at','exit_at']) ||
      !['next_day','next_week'].includes(p.horizon.id) || ![p.horizon.entry_at,p.horizon.exit_at].every(instant) ||
      !Array.isArray(p.rows) || !Number.isInteger(p.withheld_count) || p.withheld_count<0 || p.rows.length+p.withheld_count>10)return null;
    const entry=Date.parse(p.horizon.entry_at),exit=Date.parse(p.horizon.exit_at),generated=Date.parse(p.generated_at),expiry=Date.parse(p.display_expires_at);
    if(Date.parse(p.source_cutoff_at)>generated || generated>=entry || entry>=exit || expiry<=generated || expiry>exit)return null;
    if(!validMetadata(p.metadata,p))return null;
    const tickers=new Set();
    for(let i=0;i<p.rows.length;i++){
      const r=p.rows[i],previous=p.rows[i-1],c=r?.catalyst;
      if(!keys(r,rowKeys) || typeof r.ticker!=='string' || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(r.ticker) || tickers.has(r.ticker) ||
        !clean(r.company,160) || !clean(r.thesis) || !clean(r.downside) || !validInvalidation(r.invalidation_trigger) || !Number.isInteger(r.research_rank) || r.research_rank<1 || r.research_rank>p.rows.length+p.withheld_count ||
        !Number.isFinite(r.research_score) || r.research_score<0 || r.research_score>100 || !Number.isInteger(r.research_score/12.5) || typeof r.tied_priority!=='boolean' ||
        (previous && (r.research_score>previous.research_score || (r.research_score===previous.research_score ? r.research_rank!==previous.research_rank : r.research_rank<=previous.research_rank))) ||
        (previous && r.research_score===previous.research_score && (!r.tied_priority||!previous.tied_priority)) ||
        !keys(c,['label','kind','timing','window_position','source_url']) || !clean(c.label,200) || !['known_information','scheduled_event'].includes(c.kind) || !validTiming(c.timing) || !publicURL(c.source_url) ||
        !Array.isArray(r.sources) || r.sources.length<1 || r.sources.length>12)return null;
      const position=timingPosition(c.timing,p.horizon);
      if(c.window_position!==position)return null;
      if(c.kind==='known_information'&&!knownBy(c.timing,p.source_cutoff_at))return null;
      const urls=new Set();
      for(const s of r.sources){
        if(!keys(s,['label','url']) || !clean(s.label,160) || !publicURL(s.url) || urls.has(s.url))return null;
        urls.add(s.url);
      }
      if(!urls.has(c.source_url))return null;
      tickers.add(r.ticker);
    }
    return p;
  }catch{return null;}
}
const current=(p,now)=>Number.isFinite(now) && now>=Date.parse(p.generated_at) && now<Date.parse(p.display_expires_at) && now<Date.parse(p.horizon.entry_at);
function eligible(slot,horizonId){
  const state=slots.get(slot);
  if(!state?.payload)return null;
  let now;try{now=state.clock();}catch{return null;}
  const p=state.payload;
  if(Number.isFinite(now) && (now>=Date.parse(p.display_expires_at)||now>=Date.parse(p.horizon.entry_at))){
    state.payload=null;state.serialized=null;state.revision++;return null;
  }
  return current(p,now) && p.horizon.id===horizonId && p.rows.length>0 ? p : null;
}

export function createApprovedSlateSlot({readApprovedBytes,clock=Date.now}={}){
  const state={payload:null,serialized:null,revision:0,request:0,clock};
  const replace=serialized=>{
    let payload=decode(serialized),now;try{now=state.clock();}catch{}
    if(payload&&!current(payload,now))payload=null;
    const bytes=payload?serialized:null;
    if(bytes!==state.serialized){state.revision++;state.serialized=bytes;state.payload=payload;}
    return Boolean(payload);
  };
  const slot=Object.freeze({
    async refresh(){
      const request=++state.request;
      let bytes=null;try{if(typeof readApprovedBytes==='function')bytes=await readApprovedBytes();}catch{}
      return request===state.request ? replace(bytes) : false;
    },
    clear(){state.request++;replace(null);},
    stateKey(horizonId){return eligible(slot,horizonId)?`slate:${state.revision}:${horizonId}`:'fallback';},
    nextBoundaryAt(horizonId){const p=eligible(slot,horizonId);return p?Math.min(Date.parse(p.display_expires_at),Date.parse(p.horizon.entry_at)):null;},
  });
  slots.set(slot,state);return slot;
}

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/New_York',timeZoneName:'short'}).format(new Date(value));
const time=value=>`<time datetime="${escape(value)}">${escape(date(value))}</time>`;
const utc=value=>escape(value.replace('T',' ').replace('Z',' UTC'));
const link=(url,label)=>`<a class="source-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`;
const dateLabel=value=>`${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(value.slice(5,7))-1]} ${Number(value.slice(8,10))}, ${value.slice(0,4)}`;
const timingHTML=t=>t.precision==='exact'?time(t.at):t.precision==='date_only'?`<time datetime="${escape(t.date)}">${dateLabel(t.date)}</time> · Time unknown (${escape(t.time_zone)})`:`${time(t.start_at)} – ${time(t.end_at)} · Time interval`;
function card(row,p,priceSymbols){
  const position={before_window:'Before this holding window',in_window:'Within this holding window',after_window:'After this holding window',boundary_uncertain:'Window boundary uncertain'}[row.catalyst.window_position];
  return `<article class="card stock-card" aria-label="${escape(row.ticker)} ${escape(row.company)} research priority">
    <div class="stock-card-header"><div class="stock-identity"><span class="ticker">${escape(row.ticker)}</span><h3>${escape(row.company)}</h3></div><span class="tag neutral">Research rank ${row.research_rank}${row.tied_priority?' · tied':''}</span></div>
    <p class="stock-thesis">${escape(row.thesis)}</p><p class="stock-catalyst"><strong>${escape(row.catalyst.label)}</strong> · ${timingHTML(row.catalyst.timing)}<br>${row.catalyst.kind==='known_information'?'Known information':'Scheduled event'} · ${position}</p>
    <p class="stock-risk"><strong>Downside:</strong> ${escape(row.downside)}</p>
    <p class="stock-status">Research evidence score ${row.research_score}/100 · Unvalidated</p>
    <p class="source-date"><strong>Entry · open:</strong> ${time(p.horizon.entry_at)}<br><strong>Exit · close:</strong> ${time(p.horizon.exit_at)}</p>
${priceSymbols.includes(row.ticker)?`<button type="button" class="desk-button desk-button-secondary" data-price-symbol="${escape(row.ticker)}">View price action<span class="sr-only"> for ${escape(row.ticker)}</span><span aria-hidden="true">→</span></button>\n`:''}    <details class="stock-details"><summary>Evidence & sources<span class="sr-only"> for ${escape(row.ticker)}</span></summary><div class="expanded-stock">
      <h4>What would invalidate the thesis?</h4><p>${escape(row.invalidation_trigger)}</p>
      <p>${link(row.catalyst.source_url,row.catalyst.kind==='known_information'?'Dated information source':'Dated catalyst source')}</p><ul class="stock-sources">${row.sources.map(s=>`<li>${link(s.url,s.label)}</li>`).join('')}</ul>
    </div></details>
  </article>`;
}
export function renderApprovedResearchView(slot,{horizonId,query='',priceSymbols=[]}={}){
  const p=eligible(slot,horizonId);
  if(!p)return null;
  priceSymbols=Array.isArray(priceSymbols)?priceSymbols:[];
  const needle=typeof query==='string'?query.trim().toLowerCase():'';
  const exactTicker=p.rows.some(r=>r.ticker.toLowerCase()===needle);
  const rows=p.rows.filter(r=>!needle||(exactTicker?r.ticker.toLowerCase()===needle:[r.ticker,r.company,r.thesis,r.downside,r.invalidation_trigger,r.catalyst.label,...r.sources.map(s=>s.label)].join(' ').toLowerCase().includes(needle)));
  const m=p.metadata,health={reviewed_at_cutoff:'Sources reviewed at cutoff',partial_at_cutoff:'Partial source coverage at cutoff',unavailable_at_cutoff:'Source coverage unavailable at cutoff'}[m.source_health.state];
  return `<div class="stock-desk approved-research-slate">
    <section class="window-card card" aria-label="Exact research holding window"><div class="window-title"><span class="eyebrow">${horizonId==='next_day'?'ONE SESSION':'FIVE EXCHANGE SESSIONS'}</span><span class="tag neutral">Unvalidated research</span></div><h2>Research priorities</h2>
      <div class="window-times"><div><span>ENTRY · OPEN</span><strong>${time(p.horizon.entry_at)}</strong><small>${utc(p.horizon.entry_at)}</small></div><span class="window-arrow" aria-hidden="true">→</span><div><span>EXIT · CLOSE</span><strong>${time(p.horizon.exit_at)}</strong><small>${utc(p.horizon.exit_at)}</small></div></div>
      <div class="snapshot-meta"><span>Source cutoff: ${time(p.source_cutoff_at)} · ${utc(p.source_cutoff_at)}</span><span>Display expires: ${time(p.display_expires_at)} · ${utc(p.display_expires_at)}</span></div>
      <div class="snapshot-meta"><span>Completed price session: <time datetime="${escape(m.price_session.date)}">${dateLabel(m.price_session.date)}</time> · closed ${time(m.price_session.closed_at)}</span><span>${health}: ${escape(m.source_health.label)}</span></div>
      <p class="section-intro">${escape(p.label)}</p>
    </section>
    <p class="coverage-strip" aria-label="Declared universe and research coverage">Universe ${escape(m.universe_version)} · ${m.counts.roster} roster · ${m.counts.screened} screened · ${m.counts.blocked} blocked · ${m.counts.eligible} research eligible</p>
    <p class="section-intro"><a class="source-link" href="#methodology">Retained method & limits</a></p>
    <section aria-label="Research priorities"><div class="section-label-row"><h2>Stocks to investigate <span class="section-count">${rows.length}</span></h2><span>Research order · ties stay tied</span></div>
      <div class="stock-list">${rows.map(r=>card(r,p,priceSymbols)).join('')||'<p>No matching research priorities.</p>'}</div>
    </section>
  </div>`;
}
