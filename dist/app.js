import { buildStockSnapshot } from './lib/candidates.js';
import { renderStockView } from './lib/stock-view.js';
import { summarizeSourceChecks } from './lib/source-freshness.js';
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const safeURL = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
const text = value => escapeHTML(value);
const link = (url, label, className = 'source-link') => { const safe = safeURL(url); return safe ? `<a class="${className}" href="${text(safe)}" target="_blank" rel="noopener noreferrer">${text(label)} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>` : `<span class="${className}">${text(label)} unavailable</span>`; };
const dateText = value => { if (!value) return 'Not recorded'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Not recorded' : `${new Intl.DateTimeFormat('en-GB', {day:'2-digit', month:'short', year:'numeric', timeZone:'UTC'}).format(date)}${String(value).includes('T') ? ` · ${new Intl.DateTimeFormat('en-GB', {hour:'2-digit', minute:'2-digit', timeZone:'UTC', hour12:false}).format(date)} UTC` : ' · UTC date'}`; };
const titles = {prices:['PRICE ACTION','Prices in context.','Explore market charts and inspect the source of imported daily data.'],journal:['DECISION HISTORY','The trading journal.','Paper decisions, actual confirmations and their original context.'],research:['STOCK RESEARCH','The stock desk.','Company cases for the next day or five sessions.'],evidence:['EVERY OBSERVATION HAS A SOURCE','The evidence room.','Inspect original observations, their availability, and the limits on what they can support.'],library:['IDEAS WORTH UNDERSTANDING','The Nobel library.','Research mechanisms, their assumptions, and the distance between an idea and a tested investment view.'],methodology:['MAKE THE REASONING VISIBLE','A careful method.','A useful research view should make uncertainty legible and let you follow the evidence yourself.']};
const params = new URLSearchParams(location.search);
const state = { view: Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : 'research', horizon: ['next_week','weekly'].includes(params.get('horizon')) ? 'next_week' : 'next_day', query:'', topic:'All', sources:[], library:[], study:{}, facts:[], rawRecords:[], dataState:'loading', evidenceState:'loading', evidenceReasons:[], contract:null, stockPayload:null, stockState:'loading', approvedSlateSlot:null };
let deskTools=null,deskToolsState='loading',deskToolsAttempt=0;
let lastFocus;
let renderedView;
let renderedContentHTML;
let observedDisplayTime = Date.now();
// Local display checks never move backwards after an observed boundary. This
// does not change source, capture, review or approved-publisher timestamps.
const displayTime = () => { observedDisplayTime = Math.max(observedDisplayTime, Date.now()); return new Date(observedDisplayTime).toISOString(); };
const loadConfig = {
  stocks: {field:'stockState', label:'Stock snapshot', views:['research']},
  evidence: {field:'evidenceState', label:'Evidence records', views:['evidence']},
  research: {field:'dataState', label:'Research notes', views:['evidence','library','methodology']}
};
const loadRuns = new Map();
const disclosureState = new Map();
const currentRun = run => loadRuns.get(run.kind) === run && !run.cancelled;
const loadKindsForView = () => Object.keys(loadConfig).filter(kind=>loadConfig[kind].views.includes(state.view));
function announce(message) { const live=$('#workspace-status'); if(live && live.textContent!==message)live.textContent=message; }
function loadStatus(kind) {
  if(kind!=='stocks')return state[loadConfig[kind].field];
  if(state.stockRenderFailed)return 'unavailable';
  if(stockSnapshot())return 'ready';
  return state.stockState==='loading'?'loading':'unavailable';
}
function loadFeedback(kind) {
  const config=loadConfig[kind], status=loadStatus(kind), delayed=loadRuns.get(kind)?.delayed;
  if(status==='ready')return '';
  const message=status==='loading' ? delayed ? `${config.label} is taking longer than expected.` : `Loading ${config.label.toLowerCase()}…` : `${config.label} could not be loaded.`;
  return `<div class="load-feedback" data-load-state="${text(status)}"><p>${text(message)}</p>${status==='unavailable'||delayed?`<div class="load-feedback-actions"><button class="quiet-button" data-retry="${text(kind)}">Retry ${text(config.label.toLowerCase())}</button><span>Reloads this workspace file. Source dates stay unchanged.</span></div>`:''}</div>`;
}
function updateLoadStatus() {
  const kinds=loadKindsForView(), pending=kinds.filter(kind=>loadStatus(kind)==='loading');
  $('#view-content').setAttribute('aria-busy',String(pending.length>0));
  const failed=kinds.filter(kind=>loadStatus(kind)==='unavailable');
  const deskFeedback=['journal','prices'].includes(state.view)&&$('#view-content').querySelector('.desk-feedback[role="status"]');
  announce(pending.length ? pending.map(kind=>`${loadConfig[kind].label} ${loadRuns.get(kind)?.delayed?'is taking longer than expected':'loading'}.`).join(' ') : failed.length ? failed.map(kind=>`${loadConfig[kind].label} unavailable. Retry is available.`).join(' ') : deskFeedback ? '' : `${$('#breadcrumb-current').textContent} ready${state.query?` for “${state.query}”`:''}.`);
}
async function startLoad(kind, retry=false) {
  const config=loadConfig[kind];if(!config)return;
  const previous=loadRuns.get(kind);
  if(previous){previous.cancelled=true;previous.controller?.abort();clearTimeout(previous.warning);clearTimeout(previous.timeout);previous.cancel?.();}
  const run={kind,attempt:(previous?.attempt||0)+1,cancelled:false,delayed:false,controller:typeof AbortController==='function'?new AbortController():null};
  loadRuns.set(kind,run);state[config.field]='loading';
  if(kind==='stocks')state.stockRenderFailed=false;
  if(kind==='evidence'){state.evidenceReasons=[];state.rawRecords=[];state.facts=[];state.secPayload=null;state.contract=null;}
  if(retry && config.views.includes(state.view))render();
  run.warning=setTimeout(()=>{if(currentRun(run)){run.delayed=true;finishInitialLoad(config.views);}},12000);
  try {
    const timeout=new Promise((_,reject)=>{run.timeout=setTimeout(()=>reject(new Error('load_timeout')),30000);run.cancel=()=>reject(new Error('load_replaced'));});
    await Promise.race([{stocks:loadStocks,evidence:loadEvidence,research:loadResearch}[kind](run),timeout]);
  } catch {
    if(currentRun(run))state[config.field]='unavailable';
  } finally {
    clearTimeout(run.warning);clearTimeout(run.timeout);
    if(currentRun(run)){run.cancelled=true;run.controller?.abort();finishInitialLoad(config.views);}
  }
}
function disclosureKey(element) {
  if(element.dataset?.stateKey)return element.dataset.stateKey;
  if(['window-details','eligibility-details','research-context'].some(name=>(element.className||'').split(/\s+/).includes(name)))return element.className;
  const scope=element.closest?.('article')?.getAttribute('aria-label')||'';
  return `${scope}|${element.className||''}|${element.querySelector?.('summary')?.textContent?.trim()||''}`;
}
function focusKey(element) {
  if(!element)return null;
  if(element.id)return `id:${element.id}`;
  for(const name of ['detail','topic','retry','go'])if(element.dataset?.[name])return `${name}:${element.dataset[name]}`;
  const detail=element.closest?.('details'), scope=detail?disclosureKey(detail):element.closest?.('article')?.getAttribute('aria-label')||'';
  if(detail && element.tagName==='SUMMARY')return `${scope}|SUMMARY`;
  return `${scope}|${element.tagName}|${element.getAttribute?.('href')||''}|${element.textContent?.trim()||''}`;
}
// Only the latest dirty form nodes for the two desk views survive navigation.
// Keep them detached from discarded view trees; no draft is written to storage.
const deskFormDrafts=new Map();
function renderContent(html) {
  const content=$('#view-content'), sameView=renderedView===state.view;
  for(const [view,forms] of deskFormDrafts){
    for(const [key,form] of forms)if(form.dataset.deskDirty!=='true')forms.delete(key);
    if(!forms.size)deskFormDrafts.delete(view);
  }
  // Compare the last template, not live DOM enriched by mounted widgets or forms.
  // Replacing identical output would destroy an iframe’s browsing context.
  if(sameView && renderedContentHTML===html)return;
  const oldDetails=content.querySelectorAll?[...content.querySelectorAll('details')]:[];
  if(renderedView)for(const detail of oldDetails)disclosureState.set(`${renderedView}:${disclosureKey(detail)}`,detail.open);
  const oldFocus=document.activeElement, hadFocus=content.contains?.(oldFocus), key=hadFocus?focusKey(oldFocus):null;
  const formKey=form=>JSON.stringify([form.dataset.journalForm||form.dataset.priceForm,form.dataset.journalId||'',form.dataset.journalFillId||'']);
  const openerKey=content.contains?.(lastFocus)?focusKey(lastFocus):null;
  if(['journal','prices'].includes(renderedView)&&content.querySelectorAll){
    const forms=new Map([...content.querySelectorAll('[data-journal-form],[data-price-form]')].filter(form=>form.dataset.deskDirty==='true').map(form=>[formKey(form),form]));
    for(const form of forms.values())form.remove();
    deskFormDrafts.set(renderedView,forms);
  }
  const dirtyForms=deskFormDrafts.get(state.view)||new Map();
  deskFormDrafts.delete(state.view);
  content.innerHTML=html;
  if(content.querySelectorAll){
    for(const form of content.querySelectorAll('[data-journal-form],[data-price-form]')){const previous=dirtyForms.get(formKey(form));if(previous?.dataset.deskDirty==='true'&&typeof form.replaceWith==='function')form.replaceWith(previous);}
    for(const detail of content.querySelectorAll('details'))detail.open=disclosureState.get(`${state.view}:${disclosureKey(detail)}`)||false;
    const controls=[...content.querySelectorAll('button,a,summary,input,select,textarea,[tabindex]')];
    if(sameView && openerKey)lastFocus=controls.find(element=>focusKey(element)===openerKey)||lastFocus;
    if(sameView && hadFocus){
      const replacement=controls.find(element=>focusKey(element)===key);
      (replacement||$('#main')).focus({preventScroll:true});
    }
  }
  renderedView=state.view;
  renderedContentHTML=html;
}
let rightsExpiryTimer;
let renderedWindowStatus;
let renderedEvidenceKey;
let renderedSlateKey;
let renderedSourceKey;
function sourceStatus(){try{return summarizeSourceChecks(state.stockPayload?.operating_evidence?.source_checks||[],{at:displayTime(),maxCaptureAgeHours:12});}catch{return null;}}
const sourceKey=()=>{const status=sourceStatus();return JSON.stringify(status&&[status.status,status.total,status.staleCount,status.invalidCount,status.missingCount]);};
let slateExpiryTimer;
const slateKey=()=>state.approvedSlateSlot?.stateKey(state.horizon)||'fallback';
function scheduleSlateExpiry(){
  clearTimeout(slateExpiryTimer);
  const snapshot=stockSnapshot();
  const windowDeadline=snapshot?.status==='upcoming'?Date.parse(snapshot.window.entry_at):snapshot?.status==='in_progress'?Date.parse(snapshot.window.exit_at):NaN;
  const deadlines=[state.approvedSlateSlot?.nextBoundaryAt(state.horizon),windowDeadline,Date.parse(sourceStatus()?.nextTransitionAt)].filter(Number.isFinite);
  const deadline=deadlines.length?Math.min(...deadlines):null;
  if(Number.isFinite(deadline))slateExpiryTimer=setTimeout(refreshTimeSensitiveView,Math.min(2147483647,Math.max(1,deadline-Date.now())));
}
function stockSourceReferencesPresent(snapshot) {
  const catalog=snapshot?.sources;
  if(!catalog || typeof catalog!=='object' || Array.isArray(catalog))return false;
  const resolves=ref=>{
    if(typeof ref!=='string' || !ref.trim() || !Object.hasOwn(catalog,ref))return false;
    try {const url=new URL(catalog[ref]?.url);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
  };
  // A retained case must keep its cited source links. This structural check
  // establishes neither source truth, reachability, rights nor completeness.
  return snapshot.hypotheses.every(item=>Array.isArray(item.source_refs)&&item.source_refs.length>0&&item.source_refs.every(resolves))
    && snapshot.macro_context.every(item=>resolves(item.source_ref));
}
function stockSnapshot(payload=state.stockPayload,horizonId=state.horizon) {
  try {
    const snapshot=buildStockSnapshot(payload,horizonId,displayTime());
    return snapshot && snapshot.status!=='unavailable' && stockSourceReferencesPresent(snapshot)?snapshot:null;
  } catch {return null;}
}
function evidenceKey() {
  return JSON.stringify(state.facts.map(fact=>[state.rawRecords.indexOf(fact.record),fact.claim]));
}
function refreshTimeSensitiveView() {
  void deskTools?.observe();
  refreshFactEligibility();
  const evidenceChanged=evidenceKey()!==renderedEvidenceKey;
  const stockChanged=stockSnapshot()?.status!==renderedWindowStatus || slateKey()!==renderedSlateKey || sourceKey()!==renderedSourceKey;
  if(evidenceChanged && $('#detail-dialog').open && $('#detail-dialog').dataset.detailId?.startsWith('fact-'))$('#detail-dialog').close();
  if((state.view==='evidence' && evidenceChanged)||(state.view==='research' && stockChanged))render();
  else {renderedWindowStatus=stockSnapshot()?.status;renderedEvidenceKey=evidenceKey();renderedSlateKey=slateKey();renderedSourceKey=sourceKey();scheduleSlateExpiry();}
}
function refreshFactEligibility() {
  state.facts=[];
  clearTimeout(rightsExpiryTimer);
  if(typeof state.contract?.inspectEvidence!=='function') return;
  const at=displayTime();
  for(const record of state.rawRecords) {
    try {const inspection=state.contract.inspectEvidence(record,{operation:'display',at}); if(inspection?.eligible&&inspection.claim) state.facts.push({record,inspection,claim:inspection.claim});} catch {}
  }
  const now=Date.now();
  const boundaries=state.rawRecords.flatMap(record=>(Array.isArray(record?.rights)?record.rights:[record?.rights]).filter(Boolean)).flatMap(right=>[right.reviewedAt,right.validFrom,right.expiresAt]).map(Date.parse).filter(time=>Number.isFinite(time)&&time>now);
  if(boundaries.length) rightsExpiryTimer=setTimeout(refreshTimeSensitiveView,Math.min(2147483647,Math.max(1,Math.min(...boundaries)-now)));
}
function availabilityTime(source) {return source.publishedAt || source.publicAvailabilityObservedAt || null;}
function publicationDescription(source) {return source.publishedAt ? dateText(source.publishedAt) : source.publishedDate ? `${source.publishedDate} · exact time unknown` : 'Unknown';}

function researchModulesUsable(data,corpus) {
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const label=value=>typeof value==='string'&&value.trim().length>0;
  const optionalText=(row,fields)=>fields.every(field=>row[field]==null||typeof row[field]==='string');
  const rows=(value,valid)=>Array.isArray(value)&&value.every(row=>object(row)&&valid(row));
  const source=row=>label(row.id)&&label(row.name)&&optionalText(row,['type','url','status','rightsStatus','checkedAt','verificationScope']);
  const library=row=>label(row.id)&&label(row.title)&&label(row.topic)
    && (row.year==null||typeof row.year==='string'||Number.isFinite(row.year))
    && Array.isArray(row.laureates??[])&&(row.laureates??[]).every(name=>typeof name==='string')
    && optionalText(row,['mechanism','takeaway','limits','sourceUrl','checkedAt','verificationStatus','verificationScope']);
  if(!rows(data.sources,source)||!rows(corpus.sources,source)||!rows(corpus.nobelLibrary,library))return false;
  if(data.studyState!=null&&!object(data.studyState))return false;
  if(corpus.methodologyPublic!=null&&!object(corpus.methodologyPublic))return false;
  return rows(data.studyState?.gates??[],row=>['label','state','detail'].every(field=>typeof row[field]==='string'))
    && rows(corpus.methodologyPublic?.concentric_layers??[],row=>['label','question','result'].every(field=>typeof row[field]==='string'));
}
async function loadResearch(run) {
  const data=await (run.attempt===1?import('./data/research.js'):import(`./data/research.js?retry=${run.attempt}`));
  if(!currentRun(run))return;
  const corpus=await (run.attempt===1?import('./data/nobel-corpus.js'):import(`./data/nobel-corpus.js?retry=${run.attempt}`));
  // Validate only fields consumed by these views before any module data commits.
  // This checks renderable shape, not research truth or source authority.
  if(!researchModulesUsable(data,corpus))throw new Error('invalid_research');
  if(!currentRun(run))return;
  state.sources=[...data.sources,...corpus.sources].filter((source,index,all)=>all.findIndex(s=>s.id===source.id)===index);
  state.library=corpus.nobelLibrary;state.study=data.studyState||{};state.methodology=corpus.methodologyPublic;state.dataState='ready';
}
async function loadEvidence(run) {
  const loadedContract=await (run.attempt===1?import('./lib/evidence.js'):import(`./lib/evidence.js?retry=${run.attempt}`));
  if(!currentRun(run))return;
  if(typeof loadedContract.inspectEvidence!=='function')throw new Error('invalid_contract');
  const response=await fetch('./data/sec-evidence.json',{cache:'no-store',...(run.controller?{signal:run.controller.signal}:{})});
  if(!currentRun(run))return;
  if(!response.ok)throw new Error('unavailable');
  const body=await response.json();
  const records=Array.isArray(body)?body:[body?.records,body?.evidence,body?.facts].find(Array.isArray)||(body?.record?[body.record]:null);
  if(!records)throw new Error('invalid_evidence');
  if(!currentRun(run))return;
  state.contract=loadedContract;state.secPayload=body;state.rawRecords=records;state.evidenceState='ready';
  for(const record of records){try{const result=loadedContract.inspectEvidence(record,{operation:'display',at:displayTime()});if(!result?.eligible)state.evidenceReasons.push(...(result?.reasons||['The observation did not pass display validation.']));}catch{state.evidenceReasons.push('The observation could not be validated for display.');}}
}
function utcStamp(value) { return new Date(value).toISOString().replace('T',' ').replace('Z',' UTC'); }
const horizon = () => {const window=stockSnapshot()?.window;return {label:state.horizon==='next_week'?'Next week · 5-session target':'Next trading day',description:window?`Retained manual snapshot: ${utcStamp(window.entry_at)} through ${utcStamp(window.exit_at)}.`:'Retained manual snapshot: timing unavailable for the selected horizon.'};};
async function loadStocks(run) {
  const response=await fetch('./data/stock-evidence.json',{cache:'no-store',...(run.controller?{signal:run.controller.signal}:{})});
  if(!currentRun(run))return;
  if(!response.ok)throw new Error('unavailable');
  const payload=await response.json();
  if(!currentRun(run))return;
  const usable=['next_day','next_week'].some(horizonId=>{
    const snapshot=stockSnapshot(payload,horizonId);if(!snapshot)return false;
    try {renderStockView(snapshot);return true;}catch{return false;}
  });
  if(!usable)throw new Error('invalid_stocks');
  state.stockPayload=payload;state.stockState='ready';state.stockRenderFailed=false;
  void deskTools?.observe();
}
const matches = value => !state.query || JSON.stringify(value).toLowerCase().includes(state.query.toLowerCase());
const sectionHead = (name,count,extra='') => `<div class="section-label-row"><h2>${text(name)}${count !== undefined ? `<span class="section-count">${text(count)}</span>`:''}</h2>${extra}</div>`;
function statusBanner() { return `<section class="state-banner" aria-label="Current research status"><div><div class="state-heading"><span class="status-dot"></span> CURRENT RESEARCH STATE</div><h2>No current ${text(horizon().label.toLowerCase())} view.</h2><p>${text(horizon().description)} Source observations are historical evidence. An investment edge remains unproven.</p></div><span class="state-badge">Unvalidated research</span></section>`; }
function sourceNoteCard() {
  const note=state.secPayload?.sourceNote;
  if(!note)return '';
  return `<article class="card evidence-card source-note"><div class="card-top"><div class="company-monogram" aria-hidden="true">${text(note.issuer?.slice(0,1)||'S')}</div><div class="company-info"><h3>${text(note.issuer)}</h3><p>CIK ${text(note.cik)} · Original Form ${text(note.form)}</p></div><span class="tag caution">Capture incomplete</span></div><p class="fact-label">ORIGINAL FILING · METADATA REVIEW</p><h3 class="bound-claim">A filing to inspect. Financial facts still withheld.</h3><p class="source-note-copy">The original filing was reviewed. Raw document bytes, exact fact context and content identity remain unverified.</p><dl class="fact-context"><div><dt>Reporting period ended</dt><dd>${text(note.periodEnd)}</dd></div><div><dt>Original accession</dt><dd>${text(note.accession)}</dd></div><div><dt>Metadata reviewed</dt><dd>${text(dateText(note.checkedAt))}</dd></div></dl><div class="card-bottom">${link(note.url,'Original SEC filing')}<button class="detail-button" data-detail="source-note">Review scope & provenance <span aria-hidden="true">↗</span></button></div></article>`;
}
function emptyEvidence() { const reason = state.evidenceState === 'loading' ? 'The evidence record is being checked.' : state.evidenceState === 'unavailable' ? 'An original filing has not been captured and validated for display in this workspace.' : 'No captured observation has passed the full display contract. The original record, context and operation rights must agree.'; return `<article class="card empty-evidence"><span class="empty-icon" aria-hidden="true">▤</span><h3>A source comes before a conclusion.</h3><p>${text(reason)} No financial value is substituted for missing evidence.</p><div class="empty-foot"><span>Historical observations · Not yet available</span><button class="text-button" data-detail="evidence-state">Inspect evidence state <span aria-hidden="true">↗</span></button></div></article>`; }
function claimText(claim) { return typeof claim === 'string' ? claim : String(claim.text || claim.statement || claim.renderedText || ''); }
function factCard(fact,index) {
  const r = fact.record, c = fact.claim;
  const issuer = r.entity?.name || r.issuer?.name || r.entityName || r.issuerName || r.issuer || 'Captured issuer';
  const ticker = r.entity?.ticker || r.issuer?.ticker || r.ticker || 'SEC filing';
  const filing = r.filing || r.source || {};
  const period = r.period || r.fact?.period || {};
  const sourceURL = filing.url || r.sourceUrl || r.filingUrl;
  const statement = claimText(c);
  const provenance = r.provenance || {};
  return `<article class="card evidence-card"><div class="card-top"><div class="company-monogram" aria-hidden="true">${text(String(issuer).slice(0,1))}</div><div class="company-info"><h3>${text(issuer)}</h3><p>${text(ticker)} · ${text(filing.form || r.form || 'Original filing')}</p></div><span class="tag">Historical observation</span></div><p class="fact-label">VALIDATED SOURCE OBSERVATION</p><h3 class="bound-claim">${text(statement)}</h3><dl class="fact-context"><div><dt>Observation period</dt><dd>${text(period.label || (period.start && period.end ? `${period.start} to ${period.end}` : period.end || r.periodEnd || 'See source record'))}</dd></div><div><dt>Units</dt><dd>${text(r.units || r.unit || r.fact?.unit || 'See validated claim')}</dd></div><div><dt>Public availability observed</dt><dd>${text(dateText(availabilityTime(filing)))}</dd></div><div><dt>SEC acceptance</dt><dd>${text(dateText(filing.acceptedAt))}</dd></div></dl><div class="card-bottom">${link(sourceURL,'Original SEC filing')}<button class="detail-button" data-detail="fact-${index}">Evidence & provenance <span aria-hidden="true">↗</span></button></div></article>`;
}
function rail() { return `<aside class="rail" aria-label="Research context"><section class="card rail-card"><h2 class="rail-heading"><span class="status-dot"></span> RESEARCH PARAMETERS</h2><dl class="rail-data"><div><dt>Selected horizon</dt><dd>${text(horizon().label)}</dd></div><div><dt>Return forecast</dt><dd>Unavailable</dd></div><div><dt>Planned source cadence</dt><dd>Daily</dd></div><div><dt>Refresh schedule</dt><dd>Not configured</dd></div><div><dt>Last source capture</dt><dd>${text(state.secPayload?.status==='verified'?dateText(state.secPayload.observedAt):'Not recorded')}</dd></div><div><dt>Next earnings</dt><dd>Unknown</dd></div></dl><p class="rail-note">Refresh runs are manual in this preview. A planned daily check does not create a daily forecast or a new company event.</p><button class="text-button rail-detail" data-detail="timing">Retained snapshot timing <span aria-hidden="true">↗</span></button></section><section class="library-feature"><span class="eyebrow">THE NOBEL LIBRARY</span><h3>Good research starts with a better question.</h3><p>Explore economic mechanisms before making assumptions about an individual company.</p><button data-go="library">Explore the library <span aria-hidden="true">↗</span></button><span class="book-glyph" aria-hidden="true"></span></section><section class="principle-card"><span>OUR RESEARCH PRINCIPLE</span><p>Make the assumptions as visible as the evidence.</p><button class="text-button" data-go="methodology">Read the method <span aria-hidden="true">↗</span></button></section></aside>`; }
function unavailableStocks(){
  const reason=state.stockPayload?'The selected horizon has missing or invalid window or source data.':'';
  return `<section class="card stock-empty"><h2>Stock research unavailable</h2>${reason?`<p>${text(reason)}</p>`:''}${loadFeedback('stocks')}</section>`;
}
function researchView() {
  state.stockRenderFailed=false;
  const status=loadStatus('stocks');
  if(status==='loading')return `<section class="card stock-empty"><h2>Loading the stock desk</h2>${loadFeedback('stocks')}</section>`;
  if(status==='unavailable')return unavailableStocks();
  try {return renderStockView(stockSnapshot(),state.query,{slateSlot:state.approvedSlateSlot,horizonId:state.horizon,sourceFreshness:sourceStatus(),priceSymbols:deskTools?.priceSymbols?.()||[]});}
  catch {state.stockRenderFailed=true;return unavailableStocks();}
}
function searchEmpty() { return `<div class="search-empty"><h3>No matching research.</h3><p>Try a company, source, topic, or a shorter search.</p><button class="text-button" data-clear-search>Clear search <span aria-hidden="true">↗</span></button></div>`; }
function evidenceView() {
  const facts = state.facts.filter(matches), sourceList = state.sources.filter(matches);
  return `<p class="view-intro">A historical fact can remain useful even when a forecast is unavailable. Each displayed observation must pass an entity, period, unit, availability, provenance and source-operation check.</p><div class="evidence-summary"><div class="summary-item"><strong>${state.facts.length}</strong><span>Validated observations</span></div><div class="summary-item"><strong>${state.sources.length}</strong><span>Registered sources</span></div><div class="summary-item"><strong>0</strong><span>Validated investment views</span></div></div><div class="desk-layout"><div class="main-column"><section>${sectionHead('Original filing observations',facts.length)}<div class="evidence-grid">${facts.length ? facts.map(f=>factCard(f,state.facts.indexOf(f))).join('') : state.query ? searchEmpty() : sourceNoteCard() || emptyEvidence()}</div></section><section>${sectionHead('Source registry',sourceList.length)}<div class="source-registry">${sourceList.map(source=>`<article class="card registry-card"><div><span class="registry-kind">${text(source.type)}</span><h3>${text(source.name)}</h3><p>${text(source.status)}</p></div><button class="detail-button" data-detail="source-${text(source.id)}">Source details <span aria-hidden="true">↗</span></button></article>`).join('') || searchEmpty()}</div></section></div>${rail()}</div>`;
}
function libraryView() {
  const topics = ['All', ...new Set(state.library.map(item => item.topic))];
  const entries = state.library.filter(item => (state.topic === 'All' || item.topic === state.topic) && matches(item));
  return `<p class="view-intro">A small reading room for foundational economic ideas. These original summaries retain the limits of the reviewed sources. A Nobel Prize is context, not evidence that a Cribscore signal works.</p><div class="filter-row" role="group" aria-label="Filter library by topic">${topics.map(topic=>`<button class="filter-button" data-topic="${text(topic)}" aria-pressed="${state.topic===topic}">${text(topic)}</button>`).join('')}<span class="count-label">${entries.length} ${entries.length===1?'reading':'readings'}</span></div><div class="library-grid">${entries.map(item=>`<article class="card library-card"><div class="library-year">ECONOMIC SCIENCES · ${text(item.year)}</div><h3>${text(item.title)}</h3><p class="authors">${text((item.laureates||[]).join(' · '))}</p><p>${text(item.mechanism)}</p><span class="tag neutral library-status">${text(item.verificationStatus)}</span><div class="card-bottom"><button class="text-button" data-detail="library-${text(item.id)}">Read research note <span aria-hidden="true">↗</span></button>${link(item.sourceUrl,'Primary source')}</div></article>`).join('') || (state.query ? searchEmpty() : `<div class="search-empty"><h3>${state.dataState==='loading'?'Loading the library':state.dataState==='unavailable'?'Research notes unavailable':'No research notes available'}</h3><p>${state.dataState==='unavailable'?'Use Retry research notes above to try this workspace file again.':'Primary research notes appear when their source records are available.'}</p></div>`)}</div>`;
}
function methodologyView() {
  const methods = [{title:'Start at the source.',body:'Use an original filing or primary research document. Preserve issuer identity, exact observation period, units and filing context. A matching number alone is not sufficient support.'},{title:'Keep the clocks separate.',body:'An observation period, public availability time and successful ingestion time answer different questions. A later retrieval cannot establish that data was usable earlier.'},{title:'Match the claim to the evidence.',body:'Final wording comes from a validated structured observation. A derived value needs sourced inputs, a registered formula and a fixed display policy. Unsupported narrative cannot inherit a supported badge.'},{title:'Let an unknown stay unknown.',body:'Missing earnings timing withholds timing-dependent investment actions. Valid historical observations remain visible. Next-day and five-session horizons need separate timing and evidence checks.'},{title:'Test before making a forecast.',body:'Freeze a target, baseline, loss, materiality and confirmation schedule. Account for failed trials, missing companies and statistical dependence. The retained calibration test failed; no investment edge is validated.'},{title:'Review rights at each operation.',body:'Fetching, storing, transforming and displaying source content are separate operations. Unknown or expired rights block the dependent action. A cached copy does not establish ongoing permission.'}];
  const layers=state.methodology?.concentric_layers||[]; return `<section class="card method-application"><div><span class="eyebrow">CONCENTRIC PROCESS · PUBLIC METHODOLOGY</span><h2>From the economy to each share</h2>${layers.map(layer=>`<h3>${text(layer.label)}</h3><p>${text(layer.question)} ${text(layer.result)}</p>`).join('')}</div><div><span class="eyebrow">NOBEL LENSES · PROCESS APPLICATIONS</span><h2>Mechanisms, not return coefficients</h2><p>2011: identify actual policy exposure and rival explanations. 2013: match the horizon and distinguish known news from an unpriced surprise. 2017: retain counter-theses and revisions. 2022: inspect financing and dilution. These are design interpretations; no validated one-day edge follows from an award.</p><p>Proposed research order: required gates and a qualifying guidance or information-event route come first. Separately reviewed fundamentals, catalyst, historical price action and macro each receive 0, 1 or 2 points. The equal-weight research score is 12.5 times their sum, from 0 to 100. Equal scores remain tied, including peers outside the displayed shortlist. This rubric is unvalidated; it estimates neither stock returns nor gain probabilities.</p><button class="text-button" data-go="library">Read retained research notes ↗</button></div></section><p class="view-intro">The stock desk applies a proposed research-priority rule to company evidence. Missing hard inputs block ranking. Expected returns and probabilities remain unavailable; the earlier five/21-session protocol does not validate these one/five-session targets.</p><div class="method-grid">${methods.filter(matches).map((m,i)=>`<article class="card method-card"><div class="method-number">0${i+1} / RESEARCH PRACTICE</div><h3>${text(m.title)}</h3><p>${text(m.body)}</p></article>`).join('') || searchEmpty()}<article class="card method-card wide-note"><div class="method-number">OPEN RESEARCH</div><div><h3>What still needs to be established.</h3><p>Complete primary-source coverage, source-operation review, earnings timing, point-in-time data provenance, calibrated statistical inference and prospective confirmation. Published research describes mechanisms; it does not validate a company-specific investment view.</p><button class="text-button rail-detail" data-detail="gates">Inspect the current research gates <span aria-hidden="true">↗</span></button></div></article></div>`;
}
function render() {
  refreshFactEligibility();
  renderedWindowStatus=stockSnapshot()?.status;
  renderedEvidenceKey=evidenceKey();
  renderedSlateKey=slateKey();
  renderedSourceKey=sourceKey();
  scheduleSlateExpiry();
  const [eyebrow,title,description]=titles[state.view];
  $('#page-eyebrow').textContent=eyebrow;
  $('#page-title').innerHTML=`${text(title.slice(0,-1))}<span>.</span>`;
  $('#page-description').textContent=description;
  $('#breadcrumb-current').textContent={prices:'Prices',journal:'Journal',research:'Stock desk',evidence:'Evidence',library:'Nobel library',methodology:'Methodology'}[state.view];
  document.title=`Cribscore · ${$('#breadcrumb-current').textContent}`;
  $$('.nav-item').forEach(button=>{ const active=button.dataset.view===state.view; button.classList.toggle('active',active); if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current'); });
  $$('[data-horizon]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.horizon===state.horizon)));
  const utilityView=['prices','journal'].includes(state.view);
  const toolbar=$('.research-toolbar');if(toolbar)toolbar.hidden=utilityView;
  const feedback=state.view==='research'?'':loadKindsForView().map(loadFeedback).join('');
  renderContent(feedback+({research:researchView,prices:toolsView,journal:toolsView,evidence:evidenceView,library:libraryView,methodology:methodologyView})[state.view]());
  updateLoadStatus();
  deskTools?.mount(state.view);
}
function toolsView(){return deskTools?deskTools.html(state.view):`<section class="card desk-panel desk-empty"><h2>${deskToolsState==='loading'?'Loading this workspace':'Workspace unavailable'}</h2><p>${deskToolsState==='loading'?'Opening charts and the private journal.':'The workspace module could not be loaded. Existing saved records remain unchanged.'}</p><button class="quiet-button" type="button" data-retry-tools>Retry workspace</button></section>`;}
async function startDeskTools(){
  const attempt=++deskToolsAttempt;deskToolsState='loading';let timer;
  try{
    const module=await Promise.race([attempt===1?import('./lib/desk-tools.js'):import(`./lib/desk-tools.js?retry=${attempt}`),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('workspace_timeout')),30000);})]);
    if(attempt!==deskToolsAttempt)return;
    deskTools?.destroy();
    deskTools=module.createDeskTools({now:displayTime,onChange:()=>{if(['prices','journal'].includes(state.view))render();}});deskToolsState='ready';
    if(['research','prices','journal'].includes(state.view))render();
    await deskTools.start();
  }catch{if(attempt===deskToolsAttempt){deskToolsState='unavailable';if(['prices','journal'].includes(state.view))render();}}finally{clearTimeout(timer);}
}
function navigate(view,{historyMode='push'}={}) {
  if(!Object.hasOwn(titles,view))return;
  if(state.view===view&&historyMode==='push')historyMode='replace';
  if(state.view!==view)state.topic='All';
  state.view=view;
  if(historyMode!=='none'){
    const url=new URL(location.href);url.hash=view;
    if(historyMode==='push' && typeof history.pushState==='function')history.pushState(null,'',url);else history.replaceState(null,'',url);
  }
  lastFocus=null;
  if($('#detail-dialog').open)$('#detail-dialog').close();
  render();$('#main').focus({preventScroll:true});globalThis.scrollTo?.({top:0,left:0,behavior:'instant'});
}
function details(title,content,kicker='RESEARCH DETAIL') { lastFocus=document.activeElement;$('#detail-title').textContent=title;$('#detail-kicker').textContent=kicker;$('#detail-content').innerHTML=content;$('#detail-dialog').showModal(); }
function detailRows(rows) { return `<dl class="provenance-list">${rows.map(([key,value])=>`<div><dt>${text(key)}</dt><dd>${text(value)}</dd></div>`).join('')}</dl>`; }
function timingContent() {
  const snapshot=stockSnapshot(), window=snapshot?.window;
  const timing=window?`${detailRows([['Selected horizon',horizon().label],['Entry',utcStamp(window.entry_at)],['Exit and expiry',utcStamp(window.exit_at)]])}<p>These dates describe the retained manual snapshot. Any separately displayed research priorities show their own entry, exit, source cutoff and display expiry on the stock desk.</p>`:'<p>Entry and exit timestamps are unavailable for this selected horizon. Return to the stock desk to inspect its loading state or retry the workspace file.</p>';
  return `<div class="detail-copy"><p>${text(horizon().description)}</p>${timing}<p>A prior close is only a historical reference; no close-to-open gap is earned. A usable manual snapshot becomes Window in progress after entry and Archived after exit. A new entry needs a new snapshot.</p><p>Daily collection is separate from the holding window. The current preview does not establish a collector or refresh schedule.</p></div>`;
}
function showDetail(id) {
  $('#detail-dialog').dataset.detailId=id;
  if (id==='source-note') {const note=state.secPayload?.sourceNote;if(!note)return;return details(note.title,`<div class="detail-copy"><p>${text(note.note)}</p>${detailRows([['Entity',note.issuer],['CIK',note.cik],['Original accession',note.accession],['Form',note.form],['Reporting period ended',note.periodEnd],['Review attempt',dateText(note.checkedAt)],['Review timing meaning',note.checkSemantics],['Capture state',note.captureStatus==='raw_document_bytes_unavailable'?'Original document not captured':note.captureStatus],['Content identity','Not captured'],['Numeric display eligibility','Withheld']])}${link(note.url,'Open original filing')}<br>${link(note.indexUrl,'Open SEC filing index')}<h3>What remains missing</h3><p>Original raw bytes, exact inline financial context, source-byte hash and complete operation evidence. No financial value is eligible for display.</p></div>`,'MANUAL METADATA REVIEW');}
  if(id==='timing') return details('Retained snapshot entry, exit and expiry',timingContent(),'TIMING & HORIZONS');
  if (id==='evidence-state') return details('Evidence is not yet ready to display.',`<div class="detail-copy"><p>Financial observations are shown only after the original record passes the display contract. No placeholder value is presented as a fact.</p>${detailRows([['Source capture',state.evidenceState==='ready'?'A record file is present.':'No successful source capture recorded.'],['Validated observations',String(state.facts.length)],['Contract module',state.contract?'Loaded':'Unavailable'],['Display state',state.facts.length?'Eligible observations available':'Withheld']])}<h3>Current limitations</h3><ul>${[...new Set(state.evidenceReasons)].map(reason=>`<li>${text(reason)}</li>`).join('')||'<li>The source, exact fact context, operation rights and successful ingestion must be recorded before display.</li>'}</ul><p>Missing data does not imply a problem at an issuer. It describes the coverage of this workspace.</p></div>`,'EVIDENCE STATE');
  if(id==='gates') return details('Research gates remain open.',`<div class="detail-copy">${(state.study.gates||[]).map(gate=>`<h3>${text(gate.label)} · ${text(gate.state)}</h3><p>${text(gate.detail)}</p>`).join('')}<p>No empirical forecast study is validated or frozen.</p></div>`,'METHOD & LIMITS');
  if(id.startsWith('source-')) {const s=state.sources.find(item=>item.id===id.slice(7));if(!s)return;return details(s.name,`<div class="detail-copy">${detailRows([['Source type',s.type],['Registry status',s.status],['Rights / operations',s.rightsStatus],['Review attempt',dateText(s.checkedAt)]])}<h3>Verification scope</h3><p>${text(s.verificationScope)}</p>${link(s.url,'Open original source')}</div>`,'SOURCE REGISTRY');}
  if(id.startsWith('library-')) {const item=state.library.find(item=>item.id===id.slice(8));if(!item)return;return details(item.title,`<div class="detail-copy"><p>${text((item.laureates||[]).join(' · '))} · ${text(item.year)}</p><h3>The mechanism</h3><p>${text(item.mechanism)}</p><h3>Research implication</h3><p>${text(item.takeaway)}</p><h3>What this does not establish</h3><p>${text(item.limits)}</p>${detailRows([['Review state',item.verificationStatus],['Review attempt',dateText(item.checkedAt)],['Source scope',item.verificationScope]])}${link(item.sourceUrl,'Open primary source')}</div>`,'NOBEL RESEARCH NOTE');}
  if(id.startsWith('fact-')) { const f=state.facts[Number(id.slice(5))];if(!f)return;const r=f.record;let current;try{current=state.contract?.inspectEvidence(r,{operation:'display',at:displayTime()});}catch{}if(!current?.eligible){render();return details('This observation is currently withheld.','<div class="detail-copy"><p>The observation no longer passes its display contract at the current time. Operation rights and context must be valid when the evidence is displayed.</p></div>','EVIDENCE STATE');}return details('The source behind the observation.',`<div class="detail-copy"><p>${text(claimText(f.claim))}</p><p>This is an as-reported historical observation. It is not an unqualified current assertion or a forecast.</p>${detailRows([['Entity',r.entity?.name||r.issuer?.name||r.entityName||r.issuerName||'See record'],['SEC acceptance',dateText(r.source?.acceptedAt||r.filing?.acceptedAt)],['Publication',publicationDescription(r.source||r.filing||{})],['Public availability observed',dateText(availabilityTime(r.source||r.filing||{}))],['Successful ingestion',dateText(r.source?.ingestedAt||r.provenance?.ingestedAt||r.ingestedAt)],['Original accession',r.source?.accession||r.filing?.accession||r.accession||'See source record'],['Observation context',JSON.stringify(r.period||r.fact?.period||{})],['Content identity',r.source?.sha256||r.provenance?.sha256||r.snapshot?.sha256||r.contentHash||'See capture record'],['Parser version',r.source?.parserVersion||r.provenance?.parserVersion||r.parserVersion||'See capture record'],['Display state','Eligible under the loaded evidence contract']])}<h3>Source record</h3><pre class="record-code">${text(JSON.stringify(r,null,2))}</pre></div>`,'SOURCE & PROVENANCE');}
}
document.addEventListener('click',event=>{
  const skip=event.target.closest('a.skip-link[href="#main"]');
  if(skip&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();$('#main').focus({preventScroll:true});globalThis.scrollTo?.({top:0,left:0,behavior:'instant'});return;}
  const price=event.target.closest('[data-price-symbol]');
  if(price){if(state.view==='research'&&deskTools?.selectPriceSymbol?.(price.dataset.priceSymbol)){deskFormDrafts.get('prices')?.delete(JSON.stringify(['selection','','']));navigate('prices');}return;}
  const nav=event.target.closest('[data-view],[data-go]');if(nav){navigate(nav.dataset.view||nav.dataset.go);return;}
  const h=event.target.closest('[data-horizon]');if(h && ['next_day','next_week'].includes(h.dataset.horizon)){state.horizon=h.dataset.horizon;const url=new URL(location.href);url.searchParams.set('horizon',state.horizon);history.replaceState(null,'',url);render();return;}
  const topic=event.target.closest('[data-topic]');if(topic){state.topic=topic.dataset.topic;render();$$('[data-topic]').find(button=>button.dataset.topic===state.topic)?.focus();return;}
  const detail=event.target.closest('[data-detail]');if(detail){showDetail(detail.dataset.detail);return;}
  if(event.target.closest('[data-retry-tools]')){void startDeskTools();return;}
  const retry=event.target.closest('[data-retry]');if(retry){void startLoad(retry.dataset.retry,true);return;}
  if(event.target.closest('[data-clear-search]')){state.query='';$('#research-search').value='';render();$('#research-search').focus();}
});
$('#research-search').addEventListener('input',event=>{state.query=event.target.value.trim();render();});
$('#research-search').addEventListener('keydown',event=>{if(event.key==='Escape' && event.target.value){event.preventDefault();event.target.value='';state.query='';render();announce('Search cleared.');}});
$('#close-detail').addEventListener('click',()=>$('#detail-dialog').close());
$('#detail-dialog').addEventListener('close',()=>{const target=lastFocus?.isConnected===false?$('#main'):lastFocus;target?.focus({preventScroll:true});});
$('#detail-dialog').addEventListener('click',event=>{if(event.target===$('#detail-dialog')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close();}});
document.addEventListener('keydown',event=>{
  const active=document.activeElement, editing=['INPUT','TEXTAREA','SELECT'].includes(active?.tagName)||active?.isContentEditable||active?.closest?.('[contenteditable="true"],[contenteditable=""],[role="textbox"],[role="combobox"]');
  if(event.key==='/'&&!['prices','journal'].includes(state.view)&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.isComposing&&!editing&&!$('#detail-dialog').open){event.preventDefault();$('#research-search').focus();}
});
function syncLocation(){
  const view=location.hash.slice(1), params=new URLSearchParams(location.search);
  const nextHorizon=['next_week','weekly'].includes(params.get('horizon'))?'next_week':'next_day';
  const nextView=Object.hasOwn(titles,view)?view:view?state.view:'research';
  if(nextView===state.view && nextHorizon===state.horizon)return;
  state.horizon=nextHorizon;navigate(nextView,{historyMode:'none'});
}
window.addEventListener('hashchange',syncLocation);
window.addEventListener('popstate',syncLocation);
function finishInitialLoad(views) {
  if($('#detail-dialog').open && $('#detail-dialog').dataset.detailId==='timing')$('#detail-content').innerHTML=timingContent();
  const previousEvidenceKey=evidenceKey();
  refreshFactEligibility();
  const currentEvidenceKey=evidenceKey();
  const windowStatus=stockSnapshot()?.status;
  const currentSlateKey=slateKey();
  const currentSourceKey=sourceKey();
  // A late loader can also wake a tab after an evidence-rights boundary.
  if($('#detail-dialog').open && $('#detail-dialog').dataset.detailId?.startsWith('fact-') && currentEvidenceKey!==previousEvidenceKey)$('#detail-dialog').close();
  const currentViewChanged=(state.view==='research' && (windowStatus!==renderedWindowStatus || currentSlateKey!==renderedSlateKey || currentSourceKey!==renderedSourceKey)) || (state.view==='evidence' && currentEvidenceKey!==renderedEvidenceKey);
  if(views.includes(state.view) || currentViewChanged) {
    render();
  } else {
    // Off-view data must not replace the current DOM or reset its disclosures/focus.
    renderedWindowStatus=windowStatus;
    renderedEvidenceKey=currentEvidenceKey;
    renderedSlateKey=currentSlateKey;
    renderedSourceKey=currentSourceKey;
    scheduleSlateExpiry();
  }
}
for(const type of ['input','change'])document.addEventListener(type,event=>{const form=event.target.closest?.('[data-journal-form],[data-price-form]');if(form){form.dataset.deskDirty='true';form.dataset.deskEditVersion=String(Number(form.dataset.deskEditVersion||0)+1);}});
$('#workspace-date').textContent='Private working preview';
render();

// Install recovery before loading: one pending source must not block clock checks.
setInterval(()=>{if(!document.hidden)refreshTimeSensitiveView();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshTimeSensitiveView();});
void startDeskTools();
await Promise.allSettled([
  startLoad('research'),
  startLoad('evidence'),
  startLoad('stocks')
]);
