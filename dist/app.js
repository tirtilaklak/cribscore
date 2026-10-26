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
const titles = {prices:['Daily work','Prices in context.','Open a company chart, or load your own daily prices.'],journal:['Daily work','The decision journal.','A dated record of each assessment and any trade you report.'],research:['Daily work','The stock desk.','Company cases from the last dated research review.'],evidence:['Reference','Sources and filings.','Every source on file, with its review state.'],library:['Reference','The Nobel library.','Short notes on Nobel-winning ideas in economics.'],methodology:['Reference','The method.','How the desk builds a case, and what is still unproven.']};
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
// Each load gives up after this long. A run records its deadline so optional parts can stop waiting in time.
const loadTimeoutMs = 30000;
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
  // A desk panel marks its own loading or failure state in the DOM. Read that
  // mark, never a module variable, so the live region matches the screen.
  const deskPanel=['journal','prices'].includes(state.view)?$('#view-content').querySelector?.('[data-desk-state]'):null, deskState=deskPanel?.getAttribute?.('data-desk-state');
  $('#view-content').setAttribute('aria-busy',String(pending.length>0||deskState==='loading'));
  const failed=kinds.filter(kind=>loadStatus(kind)==='unavailable');
  const deskHeading=deskPanel?.querySelector?.('h2')?.textContent?.trim();
  const deskStatus=!deskHeading?'':deskState==='loading'?`${deskHeading}.`:deskState==='unavailable'?`${deskHeading}. ${deskPanel.querySelector?.('p')?.textContent?.trim()||''}`.trim():'';
  const deskFeedback=['journal','prices'].includes(state.view)&&$('#view-content').querySelector('.desk-feedback');
  const setupStatus=state.view==='prices'&&$('#view-content').querySelector('[data-price-setup-status]');
  const activeSetup=setupStatus&&setupStatus.getAttribute('data-price-setup-status')!=='unchecked';
  // While a search or filter is active, the ready message also counts the results on screen.
  const results=state.query||(state.topic&&state.topic!=='All')?$('#view-content').querySelectorAll?.('.stock-card,.event-item,.registry-card,.library-card,.evidence-card'):null;
  const count=results&&typeof results.length==='number'?[...results].filter(card=>!/\bsource-note\b/.test(card.className||'')).length:null;
  // One persistent live region carries feedback. The inline copy remains plain
  // text so a rerender cannot create a competing or missed live announcement.
  announce(pending.length ? pending.map(kind=>`${loadConfig[kind].label} ${loadRuns.get(kind)?.delayed?'is taking longer than expected':'loading'}.`).join(' ') : failed.length ? failed.map(kind=>`${loadConfig[kind].label} unavailable. Retry is available.`).join(' ') : deskStatus ? deskStatus : deskFeedback ? deskFeedback.textContent : activeSetup ? setupStatus.textContent : `${$('#breadcrumb-current').textContent} ready${state.query?` for “${state.query}”`:''}.${count===null?'':` ${count} ${count===1?'result':'results'} shown.`}`);
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
    const timeout=new Promise((_,reject)=>{run.deadline=Date.now()+loadTimeoutMs;run.timeout=setTimeout(()=>reject(new Error('load_timeout')),loadTimeoutMs);run.cancel=()=>reject(new Error('load_replaced'));});
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
  // A disclosure that a search opened is not the reader's choice, so its state is not saved.
  if(renderedView)for(const detail of oldDetails)if(detail.dataset?.searchOpen!=='true')disclosureState.set(`${renderedView}:${disclosureKey(detail)}`,detail.open);
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
    for(const detail of content.querySelectorAll('details'))detail.open=detail.dataset?.searchOpen==='true'||disclosureState.get(`${state.view}:${disclosureKey(detail)}`)||false;
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
  // Plain wording is optional. A failed, malformed, throwing or stalled plain module leaves every original in place.
  const plain=(run.attempt===1?import('./data/plain-language.js'):import(`./data/plain-language.js?retry=${run.attempt}`)).then(usablePlain).catch(()=>new Map());
  const data=await (run.attempt===1?import('./data/research.js'):import(`./data/research.js?retry=${run.attempt}`));
  if(!currentRun(run))return;
  const corpus=await (run.attempt===1?import('./data/nobel-corpus.js'):import(`./data/nobel-corpus.js?retry=${run.attempt}`));
  // Validate only fields consumed by these views before any module data commits.
  // This checks renderable shape, not research truth or source authority.
  if(!researchModulesUsable(data,corpus))throw new Error('invalid_research');
  // Once the originals are usable, wait at most 2 seconds more for plain wording, and stop
  // 1 second before the load deadline so slow originals still arrive in time. A later
  // arrival is ignored for this load, so the text never changes under the reader.
  const wait=Math.max(0,Math.min(2000,(Number.isFinite(run.deadline)?run.deadline:Infinity)-Date.now()-1000));
  let plainWait;
  const plainEntries=await Promise.race([plain,new Promise(resolve=>{plainWait=setTimeout(()=>resolve(new Map()),wait);})]);
  clearTimeout(plainWait);
  if(!currentRun(run))return;
  plainTexts=plainEntries;
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
function sourceNoteCard() {
  const note=state.secPayload?.sourceNote;
  if(!note)return '';
  return `<article class="card evidence-card source-note"><div class="card-top"><div class="company-monogram" aria-hidden="true">${text(note.issuer?.slice(0,1)||'S')}</div><div class="company-info"><h3>${text(note.issuer)}</h3><p>SEC company ID ${text(note.cik)} · Original Form ${text(note.form)}</p></div><span class="tag caution">Capture incomplete</span></div><p class="fact-label">Original filing · metadata review</p><h3 class="bound-claim">A filing to inspect. Financial facts still withheld.</h3><p class="source-note-copy">We reviewed the original filing. We have not verified its raw file, the exact context of each fact or its file fingerprint.</p><dl class="fact-context"><div><dt>Reporting period ended</dt><dd>${text(note.periodEnd)}</dd></div><div><dt>SEC filing ID</dt><dd>${text(note.accession)}</dd></div><div><dt>Metadata reviewed</dt><dd>${text(dateText(note.checkedAt))}</dd></div></dl><div class="card-bottom">${link(note.url,'Original SEC filing')}<button class="detail-button" data-detail="source-note" aria-haspopup="dialog">Review scope and provenance</button></div></article>`;
}
function emptyEvidence() {
  const loading=state.evidenceState==='loading', ready=state.evidenceState==='ready', records=ready?state.rawRecords.length:0, hidden=records-state.facts.length;
  const [title,copy]=loading?['Checking the filing record','']:!ready?['The evidence records did not load','No filing fact is shown. Use Retry evidence records above.']:!records?['No filing fact can be shown right now','No SEC filing has been captured for this desk yet.']:['No filing fact can be shown right now',`${[...new Set(withheldReasons().map(reason=>reason.sentence))].join(' ')} Until a new review allows it, ${hidden>1?'the records stay':'the record stays'} hidden.`];
  return `<article class="card empty-evidence"><h3>${text(title)}</h3><p>${copy?`${text(copy)} `:''}No number is shown in place of missing evidence.</p><div class="empty-foot"><span>Filing facts · none shown</span><button class="text-button" data-detail="evidence-state" aria-haspopup="dialog">See why</button></div></article>`;
}
// Plain words for the evidence contract's reason codes. The codes stay in the
// evidence-state dialog; the page names neither a code nor the withheld issuer.
function rightsEndedAt() {
  const now=Date.now(), ended=state.rawRecords.flatMap(record=>(Array.isArray(record?.rights)?record.rights:[record?.rights]).filter(Boolean)).map(right=>Date.parse(right.expiresAt)).filter(time=>Number.isFinite(time)&&time<=now);
  return ended.length?new Date(Math.max(...ended)).toISOString():null;
}
function reasonSentence(reason) {
  const value=String(reason??'');
  if(!/^[a-z0-9_]+$/.test(value))return value;
  const [,operation,kind]=value.match(/^(?:([a-z]+)_)?rights_(expired|unknown|expiry_unknown|audit_incomplete|denied|revoked)$/)||[];
  if(!kind)return 'A display check did not pass.';
  const verb={fetch:'fetch',store:'store',transform:'change'}[operation]||'show', ended=kind==='expired'?rightsEndedAt():null;
  if(kind==='expired')return ended?`The permission to ${verb} the saved SEC record ended on ${dateText(ended)}.`:`The permission to ${verb} the saved SEC record has expired.`;
  return ['denied','revoked'].includes(kind)?`Permission to ${verb} the saved SEC record was refused.`:`Permission to ${verb} the saved SEC record has not been fully reviewed.`;
}
function withheldReasons() {
  const reasons=[...new Set(state.evidenceReasons)].map(reason=>({code:/^[a-z0-9_]+$/.test(String(reason??''))?String(reason):'',sentence:reasonSentence(reason)}));
  if(reasons.length||!state.rawRecords.length||state.facts.length)return reasons;
  // Rights can end after the file loaded; the record's own expiry then explains it.
  return [{code:'',sentence:rightsEndedAt()?reasonSentence('display_rights_expired'):'A display check did not pass.'}];
}
function visibleMatch(...fields) { const query=state.query.toLowerCase(); return !query||fields.some(field=>String(field??'').toLowerCase().includes(query)); }
function plainStatus(status) { return status==='metadata_pending'?'Awaiting primary check':status?String(status).replaceAll('_',' '):'Not recorded'; }
// Plain wording for long research passages (data/plain-language.js). Each entry
// carries the sha256 of the exact original it was checked against. It shows only
// while that fingerprint matches the current original; otherwise the original
// renders alone, exactly as it did before plain wording existed.
let plainTexts=new Map();
const fingerprints=new Map();
function usablePlain(module) {
  const entries=module?.plainLanguage, usable=new Map();
  if(entries===null||typeof entries!=='object')return usable;
  for(const [id,entry] of Object.entries(entries))if(entry&&typeof entry.plain==='string'&&entry.plain.trim()&&/^[0-9a-f]{64}$/.test(String(entry.original_sha256)))usable.set(id,entry);
  return usable;
}
function sha256Hex(value) {
  const k=[],h=[],words=[],bytes=[];let prime=2;
  while(k.length<64){let composite=false;for(let d=2;d*d<=prime;d++)if(prime%d===0){composite=true;break;}if(!composite){const frac=x=>(x-Math.floor(x))*4294967296|0;if(h.length<8)h.push(frac(prime**(1/2)));k.push(frac(prime**(1/3)));}prime++;}
  for(const ch of String(value)){const c=ch.codePointAt(0);if(c<128)bytes.push(c);else if(c<2048)bytes.push(192|c>>6,128|c&63);else if(c<65536)bytes.push(224|c>>12,128|c>>6&63,128|c&63);else bytes.push(240|c>>18,128|c>>12&63,128|c>>6&63,128|c&63);}
  const bits=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0);for(let i=7;i>=0;i--)bytes.push(Math.floor(bits/2**(8*i))&255);
  for(let i=0;i<bytes.length;i+=4)words.push(bytes[i]<<24|bytes[i+1]<<16|bytes[i+2]<<8|bytes[i+3]);
  const rotate=(x,n)=>x>>>n|x<<32-n;
  for(let block=0;block<words.length;block+=16){
    const w=words.slice(block,block+16);let [a,b,c,d,e,f,g,j]=h;
    for(let i=0;i<64;i++){
      if(i>=16){const s0=rotate(w[i-15],7)^rotate(w[i-15],18)^w[i-15]>>>3,s1=rotate(w[i-2],17)^rotate(w[i-2],19)^w[i-2]>>>10;w[i]=w[i-16]+s0+w[i-7]+s1|0;}
      const t1=j+(rotate(e,6)^rotate(e,11)^rotate(e,25))+(e&f^~e&g)+k[i]+w[i]|0,t2=(rotate(a,2)^rotate(a,13)^rotate(a,22))+(a&b^a&c^b&c)|0;
      j=g;g=f;f=e;e=d+t1|0;d=c;c=b;b=a;a=t1+t2|0;
    }
    [a,b,c,d,e,f,g,j].forEach((x,i)=>{h[i]=h[i]+x|0;});
  }
  return h.map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
}
// Ids are built only from non-empty string parts, so a missing id shows the original.
const plainKey=(...parts)=>parts.every(part=>typeof part==='string'&&part.length>0)?parts.join(':'):null;
function plainFor(key,original) {
  const entry=key&&typeof original==='string'&&original?plainTexts.get(key):null;
  if(!entry)return null;
  if(!fingerprints.has(original))fingerprints.set(original,sha256Hex(original));
  return fingerprints.get(original)===entry.original_sha256?entry.plain:null;
}
// A search can match a passage's original wording and miss its plain text. That
// original then opens on render, so the matched words are on screen. renderContent()
// never saves this forced state, so clearing the search restores the reader's own.
function searchOpens(original,plain) { const query=state.query.toLowerCase(); return Boolean(query)&&String(original).toLowerCase().includes(query)&&!String(plain).toLowerCase().includes(query); }
// Every disclosure shows the same label. Hidden context names its passage for screen readers.
function originalWording(key,original,context,searchOpen=false) { return `<details class="original-wording" data-state-key="${text(key)}"${searchOpen?' data-search-open="true"':''}><summary>Original wording${context?`<span class="sr-only"> for ${text(context)}</span>`:''}</summary><p>${text(original)}</p></details>`; }
// One passage: the plain version first, then the exact original one click away.
// A searched passage (a card the search filters) opens its original on a match there alone.
function passage(key,original,fallback,className='',context='',searched=false) {
  const plain=plainFor(key,original), attribute=className?` class="${className}"`:'';
  return plain?`<p${attribute}>${text(plain)}</p>${originalWording(key,original,context,searched&&searchOpens(original,plain))}`:`<p${attribute}>${text(original||fallback)}</p>`;
}
// detailRows with optional plain wording: a row is [label, value, plain key].
function plainRows(rows) { return `<dl class="provenance-list">${rows.map(([label,value,key])=>{const plain=plainFor(key,value);return `<div><dt>${text(label)}</dt><dd>${text(plain||value)}${plain?originalWording(key,value,label):''}</dd></div>`;}).join('')}</dl>`; }
function registryRow(source) { return `<article class="card registry-card"><div><span class="registry-kind">${text(source.type||'Type not recorded')}</span><h3>${text(source.name)}</h3>${passage(plainKey('registry',source.id,'status'),source.status,'Status not recorded','',source.name,true)}</div><button class="detail-button" data-detail="source-${text(source.id)}" aria-haspopup="dialog">Source details<span class="sr-only"> for ${text(source.name)}</span></button></article>`; }
function libraryCard(item) {
  const laureates=(item.laureates||[]).join(' · '), year=item.year==null||item.year===''?'Prize year not recorded':`${item.year} prize`;
  return `<article class="card library-card"><div class="library-year">${text(year)}</div><h3>${text(item.title)}</h3><p class="authors">${text(laureates||'Laureates not confirmed')}</p>${passage(plainKey('library',item.id,'mechanism'),item.mechanism,'Summary not recorded','library-mechanism',item.title,true)}<p class="library-use">Used for: ${text(item.topic)}</p><p class="library-status">${text(plainStatus(item.verificationStatus))}</p><div class="card-bottom"><button class="text-button" data-detail="library-${text(item.id)}" aria-haspopup="dialog">Read the note<span class="sr-only">: ${text(item.title)}</span></button>${link(item.sourceUrl,'Primary source')}</div></article>`;
}
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
  const periodText = period.label || (period.start && period.end ? `${period.start} to ${period.end}` : period.end || r.periodEnd || 'See source record');
  return `<article class="card evidence-card"><div class="card-top"><div class="company-monogram" aria-hidden="true">${text(String(issuer).slice(0,1))}</div><div class="company-info"><h3>${text(issuer)}</h3><p>${text(ticker)} · ${text(filing.form || r.form || 'Original filing')}</p></div><span class="tag">Historical observation</span></div><p class="fact-label">Passed every display check</p><h3 class="bound-claim">${text(statement)}</h3><dl class="fact-context"><div><dt>Observation period</dt><dd>${text(periodText)}</dd></div><div><dt>Units</dt><dd>${text(r.units || r.unit || r.fact?.unit || 'See validated claim')}</dd></div><div><dt>Public availability observed</dt><dd>${text(dateText(availabilityTime(filing)))}</dd></div><div><dt>SEC acceptance</dt><dd>${text(dateText(filing.acceptedAt))}</dd></div></dl><div class="card-bottom">${link(sourceURL,'Original SEC filing')}<button class="detail-button" data-detail="fact-${index}" aria-haspopup="dialog">Evidence and provenance<span class="sr-only"> for ${text(issuer)}, ${text(r.metric?.label||statement)}, ${text(periodText)}</span></button></div></article>`;
}
function rail() { return `<aside class="rail" aria-label="Research status"><section class="card rail-card"><h2 class="rail-heading">Research status</h2><dl class="rail-data"><div><dt>Return forecast</dt><dd>Unavailable</dd></div><div><dt>Source checks</dt><dd>By hand</dd></div><div><dt>Refresh schedule</dt><dd>Not configured</dd></div><div><dt>Last SEC capture</dt><dd>${text(state.secPayload?.status==='verified'?dateText(state.secPayload.observedAt):'Not recorded')}</dd></div><div><dt>Next earnings release time</dt><dd>Not confirmed</dd></div></dl><p class="rail-note">We run source checks by hand for now. A daily check is planned. It would not create a daily forecast or a new company event.</p><div class="rail-actions"><button class="text-button rail-detail" data-detail="timing" aria-haspopup="dialog">Window dates</button><button class="text-button" id="rail-library" data-go="library">Open the library <span aria-hidden="true">→</span></button><button class="text-button" data-go="methodology">How the method works <span aria-hidden="true">→</span></button></div></section></aside>`; }
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
function searchEmpty() { return `<div class="search-empty"><h3>No matches for this search.</h3><p>Try a shorter search, or clear it.</p><button class="text-button" data-clear-search>Clear search</button></div>`; }
function evidenceView() {
  const facts=state.facts.filter(matches), evidenceReady=state.evidenceState==='ready', sourcesReady=state.dataState==='ready', note=state.secPayload?.sourceNote;
  const isData=source=>['Issuer filings','Economic time series'].includes(source.type), shown=state.sources.filter(source=>visibleMatch(source.name,source.type,source.status,plainFor(plainKey('registry',source.id,'status'),source.status)));
  const dataRows=shown.filter(isData), researchRows=shown.filter(source=>!isData(source)), dataTotal=state.sources.filter(isData).length, researchTotal=state.sources.length-dataTotal;
  const withheld=state.rawRecords.filter(record=>!state.facts.some(fact=>fact.record===record)).length, plural=(n,one,many)=>`${n} ${n===1?one:many}`;
  const count=(ready,n,one,many,label)=>ready?`<li><strong>${n}</strong> ${n===1?one:many}</li>`:`<li>${label}: <strong>Not loaded</strong></li>`;
  const counts=`<ul class="evidence-counts">${count(evidenceReady,state.facts.length,'filing fact shown','filing facts shown','Filing facts shown')}${count(evidenceReady,withheld,'record withheld','records withheld','Records withheld')}${count(sourcesReady,state.sources.length,'source','sources','Sources')}<li><strong>0</strong> validated investment views</li></ul>`;
  // The lede is a status, so a search never hides it. Only real fact cards filter.
  const filing=facts.length?facts.map(f=>factCard(f,state.facts.indexOf(f))).join(''):state.facts.length?searchEmpty():emptyEvidence()+(note&&visibleMatch(note.issuer,note.form,note.accession,note.periodEnd)?sourceNoteCard():'');
  const summary=!sourcesReady?'':state.query?`<p class="registry-summary">${shown.length} of ${plural(state.sources.length,'source','sources')} ${shown.length===1?'matches':'match'} this search.</p>`:`<p class="registry-summary">${plural(state.sources.length,'source','sources')}. ${dataTotal} ${dataTotal===1?'covers':'cover'} company and economic data. ${researchTotal} ${researchTotal===1?'is':'are'} research behind the library.</p>`;
  const dataGroup=dataRows.length?`<section class="registry-group" aria-labelledby="registry-data-title"><h3 id="registry-data-title" class="registry-group-title">Company and economic data</h3><div class="source-registry">${dataRows.map(registryRow).join('')}</div><button class="text-button registry-link" data-go="research">Each company case lists its sources on the stock desk <span aria-hidden="true">→</span></button></section>`:'';
  const researchBody=`<div class="source-registry">${researchRows.map(registryRow).join('')}</div><button class="text-button registry-link" data-go="library">Open the library <span aria-hidden="true">→</span></button>`;
  const researchGroup=!researchRows.length?'':state.query?`<section class="registry-group" aria-labelledby="registry-research-title"><h3 id="registry-research-title" class="registry-group-title">Research behind the library · ${researchRows.length}</h3>${researchBody}</section>`:`<details class="registry-group" data-state-key="evidence:research-sources"><summary>Research behind the library · ${researchRows.length}</summary>${researchBody}</details>`;
  const registry=!sourcesReady?`<div class="search-empty"><h3>${state.dataState==='loading'?'Loading the source list':'The source list did not load'}</h3>${state.dataState==='loading'?'':'<p>Use Retry research notes above.</p>'}</div>`:shown.length?dataGroup+researchGroup:state.query?searchEmpty():'<div class="search-empty"><h3>No sources are listed yet</h3></div>';
  return `<p class="view-intro">A filing fact appears here only after it passes six checks. They cover the company, the period, the units and when it became public. The other two cover its provenance (where a number came from and how it was saved) and our permission to show it. A past fact can still be useful when no forecast exists.</p>${counts}<div class="desk-layout"><div class="main-column"><section class="evidence-section">${sectionHead('Filing facts',evidenceReady?facts.length:undefined)}<div class="evidence-grid">${filing}</div></section><section class="evidence-section">${sectionHead('Sources',sourcesReady?shown.length:undefined)}${summary}${registry}</section></div>${rail()}</div>`;
}
function libraryView() {
  const ready=state.dataState==='ready', entries=state.library.filter(item=>visibleMatch(item.year,item.year==null?'':`${item.year} prize`,item.title,(item.laureates||[]).join(' '),item.topic,item.mechanism,plainFor(plainKey('library',item.id,'mechanism'),item.mechanism),plainStatus(item.verificationStatus)));
  const pending=state.library.filter(item=>item.verificationStatus==='metadata_pending').map(item=>item.year==null||item.year===''?' One entry is waiting for its source check.':` The ${text(item.year)} entry is waiting for its source check.`).join('');
  const fallback=ready&&state.query?searchEmpty():`<div class="search-empty"><h3>${state.dataState==='loading'?'Loading the library':state.dataState==='unavailable'?'Research notes unavailable':'No research notes available'}</h3>${state.dataState==='unavailable'?'<p>The library did not load. Use Retry research notes above.</p>':state.dataState==='loading'?'':'<p>Notes appear when their source records are available.</p>'}</div>`;
  return `<p class="view-intro">Each note keeps the limits of its source. A prize is background only. It does not show that any Cribscore method works.${pending}</p>${sectionHead('Notes by prize year',ready?entries.length:undefined)}<div class="library-grid">${entries.map(libraryCard).join('')||fallback}</div>`;
}
function methodologyView() {
  const methods = [{title:'Start at the source.',body:'Use the original filing or research paper. Keep the company name, the exact period, the units and the filing details. A matching number alone is not enough.'},{title:'Keep the clocks separate.',body:'A number covers a period. It also has the time it became public and the time we saved it. Each answers a different question. Fetching data later does not prove it was usable earlier.'},{title:'Match the claim to the evidence.',body:'The words for a fact come from a checked record. A calculated number needs sourced inputs and a fixed formula. A claim without support never gets a supported label.'},{title:'Let an unknown stay unknown.',body:'If an earnings time is unknown, any action that depends on it waits. Past facts that passed their checks stay visible. Each window, 1 trading day or 5 trading days, needs its own timing and evidence checks.'},{title:'Test before making a forecast.',body:'Before testing, fix the goal, the baseline, the scoring rule and the review dates. Count failed trials and dropped companies. Allow for results that move together. Our calibration test (a check that stated odds match what really happens) failed. No investment edge is validated.'},{title:'Check permission at each step.',body:'Fetching, storing, changing and showing a source are separate steps. Each needs its own permission. If a permission is unknown or expired, that step is blocked. A saved copy does not mean we may keep using it.'}];
  const layers=state.methodology?.concentric_layers||[], gates=state.study?.gates||[], missing=(loading,failed,absent)=>state.dataState==='loading'?loading:state.dataState==='unavailable'?failed:absent;
  // The status comes first and renders in every data state, so its dialog stays reachable.
  const status=`<section class="card method-status" aria-labelledby="method-status-title"><h2 id="method-status-title">Where the method stands</h2><p>This method is unproven. No investment edge (a lasting advantage over the market) is validated. The desk shows research only. It does not rank stocks or forecast returns.</p>${gates.length?`<p class="method-gates-label">Open checks</p><dl class="method-gates">${gates.map(gate=>`<div><dt>${text(gate.label)}</dt><dd>${text(gate.state)}</dd></div>`).join('')}</dl>`:`<p class="method-gates-status">${missing('Loading the open checks.','The open checks did not load. Use Retry research notes above.','The list of open checks is missing from this file.')}</p>`}<button class="text-button" data-detail="gates" aria-haspopup="dialog">What each check means</button></section>`;
  const step=layer=>{const question=plainFor(plainKey('method','layer',layer.id,'question'),layer.question), result=plainFor(plainKey('method','layer',layer.id,'result'),layer.result);return `<h3>${text(layer.label)}</h3><p>${text(question||layer.question)} ${text(result||layer.result)}</p>${question||result?originalWording(plainKey('method','layer',layer.id),`${layer.question} ${layer.result}`,layer.label):''}`;};
  const steps=layers.length?layers.map(step).join(''):`<p>${missing('Loading the seven steps.','The seven steps did not load. Use Retry research notes above.','The seven steps are missing from this file.')}</p>`;
  return `${status}<p class="view-intro">The stock desk uses a proposed rule to order stocks for research. A missing required input blocks ranking. There are no expected returns or probabilities. The desk has two windows (the trading days this research covers): 1 trading day and 5 trading days. An earlier test used windows of 5 and 21 trading days. It proves nothing about these two windows.</p><section class="card method-application"><div><span class="eyebrow">The seven steps</span><h2>From the economy to each share</h2>${steps}</div><div><span class="eyebrow">Nobel ideas as research questions</span><h2>How we use Nobel ideas</h2><ul class="method-lenses"><li>2011 prize: find the real effect of policy on the company, and other possible causes.</li><li>2013 prize: match the time frame, and tell known news from a true surprise.</li><li>2017 prize: keep the case against, and record each change of view.</li><li>2022 prize: check funding and new shares.</li></ul><p>These are our own readings of the prizes. We do not use them as return formulas. No prize proves an investment edge in either window.</p><p><strong>How stocks would be ordered.</strong> A stock must first pass every required check. It also needs new company guidance or a dated company event. Then four areas get 0, 1 or 2 points each: business results, the event, price history and the economy. The research score is 12.5 times the total, so it runs from 0 to 100. Equal scores stay tied, including stocks not shown here. This rubric is unvalidated (not proven to work; a test may have failed). It does not estimate returns or the chance of a gain.</p><button class="text-button" data-go="library">Open the library <span aria-hidden="true">→</span></button></div></section>${sectionHead('Research practices')}<div class="method-grid">${methods.map((m,i)=>`<article class="card method-card"><div class="method-number">0${i+1}</div><h3>${text(m.title)}</h3><p>${text(m.body)}</p></article>`).join('')}<article class="card method-card wide-note"><div class="method-number">Still open</div><div><h3>What is not done yet.</h3><p>Read every original source. Check permission for each use of a source. Confirm earnings release times. Record what was known on each date, and where it came from. Calibrate the statistics. Confirm results on new data. Published research explains how things work. It does not validate a view on any one company.</p></div></article></div>`;
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
  $('#breadcrumb-current').textContent={prices:'Prices',journal:'Journal',research:'Stock desk',evidence:'Sources',library:'Library',methodology:'Method'}[state.view];
  document.title=`${$('#breadcrumb-current').textContent} · Cribscore`;
  $$('.nav-item').forEach(button=>{ const active=button.dataset.view===state.view; button.classList.toggle('active',active); if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current'); });
  $$('[data-horizon]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.horizon===state.horizon)));
  // Each view shows only the controls that act on it. The window buttons stay in
  // the DOM on every view, so aria-pressed keeps tracking the selected window.
  const searchText={research:'Search stocks and events',evidence:'Search sources',library:'Search notes'}[state.view];
  const toolbar=$('.research-toolbar');if(toolbar)toolbar.hidden=!searchText;
  const horizonGroup=$('.horizon-group');if(horizonGroup)horizonGroup.hidden=state.view!=='research';
  const searchBox=$('.search-box');if(searchBox)searchBox.hidden=!searchText;
  const field=$('#research-search');if(field&&searchText)field.setAttribute('placeholder',searchText);
  const searchLabel=$('#search-label');if(searchLabel&&searchText)searchLabel.textContent=searchText;
  const feedback=state.view==='research'?'':loadKindsForView().map(loadFeedback).join('');
  const hadFocus=$('#view-content')?.contains?.(document.activeElement);
  renderContent(feedback+({research:researchView,prices:toolsView,journal:toolsView,evidence:evidenceView,library:libraryView,methodology:methodologyView})[state.view]());
  updateLoadStatus();
  deskTools?.mount(state.view);
  // Focus that sat inside a replaced view goes to that view's own fallback target
  // instead of the page or the main region.
  if(hadFocus){const active=document.activeElement;if(!active||active.tagName==='BODY'||active.id==='main')$('#view-content').querySelector?.('[data-focus-fallback]')?.focus({preventScroll:true});}
}
function toolsView(){return deskTools?deskTools.html(state.view):deskToolsState==='loading'?`<section class="card desk-panel desk-empty" data-desk-state="loading"><h2 tabindex="-1" data-focus-fallback>${state.view==='journal'?'Loading the journal':'Loading prices'}</h2><p>This can take a few seconds on a slow connection.</p></section>`:`<section class="card desk-panel desk-empty" data-desk-state="unavailable"><h2 tabindex="-1" data-focus-fallback>Workspace unavailable</h2><p>Prices and the journal did not load. Your saved records are unchanged. Press Retry, or reload the page.</p><button class="quiet-button" type="button" data-retry-tools>Retry</button></section>`;}
async function startDeskTools(){
  const attempt=++deskToolsAttempt;deskToolsState='loading';let timer;
  // A retry replaces the failure panel with the loading panel at once.
  if(attempt>1&&['prices','journal'].includes(state.view))render();
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
  if(state.view!==view){state.topic='All';state.queries={...state.queries,[state.view]:state.query};state.query=state.queries?.[view]||'';const field=$('#research-search');if(field)field.value=state.query;}
  state.view=view;
  if(historyMode!=='none'){
    const url=new URL(location.href);url.hash=view;
    if(historyMode==='push' && typeof history.pushState==='function')history.pushState(null,'',url);else history.replaceState(null,'',url);
  }
  lastFocus=null;
  if($('#detail-dialog').open)$('#detail-dialog').close();
  render();$('#main').focus({preventScroll:true});globalThis.scrollTo?.({top:0,left:0,behavior:'instant'});
}
function details(title,content,kicker='RESEARCH DETAIL') { lastFocus=document.activeElement;$('#detail-title').textContent=title;$('#detail-kicker').textContent=kicker;$('#detail-content').innerHTML=content;$('#detail-dialog').showModal();$('#detail-dialog').scrollTop=0; }
function detailRows(rows) { return `<dl class="provenance-list">${rows.map(([key,value])=>`<div><dt>${text(key)}</dt><dd>${text(value)}</dd></div>`).join('')}</dl>`; }
function timingContent() {
  const snapshot=stockSnapshot(), window=snapshot?.window, selected=['Selected window',state.horizon==='next_week'?'5 trading days':'1 trading day'];
  const timing=window?`${detailRows([selected,['Entry',utcStamp(window.entry_at)],['Exit and expiry',utcStamp(window.exit_at)]])}<p>These dates describe the retained manual snapshot. Any separately displayed research priorities show their own entry, exit, source cutoff and display expiry on the stock desk.</p>`:`${detailRows([selected])}<p>Entry and exit timestamps are unavailable for this window. Return to the stock desk to see its loading state, or retry the research file.</p>`;
  return `<div class="detail-copy"><p>${text(horizon().description)}</p>${timing}<p>A prior close is only a historical reference. Under this rule, no close-to-open gap is earned. A usable manual snapshot becomes Window in progress after entry and Archived snapshot after exit. A new window needs a new snapshot.</p><p>Collecting data each day is separate from the window. The current preview does not establish a collector or refresh schedule.</p></div>`;
}
function showDetail(id) {
  $('#detail-dialog').dataset.detailId=id;
  if (id==='source-note') {const note=state.secPayload?.sourceNote;if(!note)return;return details(note.title,`<div class="detail-copy"><p>${text(note.note)}</p>${detailRows([['Entity',note.issuer],['SEC company ID',note.cik],['SEC filing ID',note.accession],['Form',note.form],['Reporting period ended',note.periodEnd],['Review attempt',dateText(note.checkedAt)],['Review timing meaning',note.checkSemantics],['Capture state',note.captureStatus==='raw_document_bytes_unavailable'?'Original document not captured':note.captureStatus],['File fingerprint','Not captured'],['Numeric display eligibility','Withheld']])}${link(note.url,'Open original filing')}<br>${link(note.indexUrl,'Open SEC filing index')}<h3>What remains missing</h3><p>The original raw file, the exact context of each financial fact, the file fingerprint and full permission records for each step. No financial value may be shown.</p></div>`,'Manual metadata review');}
  if(id==='timing') return details('Retained snapshot: window dates',timingContent(),'Timing');
  if (id==='evidence-state') return details('Why no filing fact is shown',`<div class="detail-copy"><p>A filing fact appears only after it passes every display check. No placeholder value is shown as a fact.</p>${detailRows([['Source capture',state.evidenceState==='ready'?'A record file is present.':'No successful source capture recorded.'],['Facts shown',state.evidenceState==='ready'?String(state.facts.length):'Not loaded'],['Display rules',state.contract?'Loaded':'Unavailable'],['Shown on the page',state.facts.length?'Yes':state.rawRecords.length?'No, withheld':'No']])}<h3>Current limitations</h3><ul>${withheldReasons().map(reason=>`<li>${text(reason.sentence)}${reason.code?` <code class="reason-code">${text(reason.code)}</code>`:''}</li>`).join('')||'<li>A fact needs its source, its exact context, permission to show it and a saved copy before it can appear.</li>'}</ul><p>Missing data does not imply a problem at an issuer. It describes the coverage of this workspace.</p></div>`,'Filing facts');
  if(id==='gates') {const gates=state.study.gates||[];return details('Open checks',`<div class="detail-copy">${gates.length?gates.map(gate=>`<h3>${text(gate.label)} · ${text(gate.state)}</h3>${passage(plainKey('gate',gate.id,'detail'),gate.detail,'','',gate.label)}`).join(''):`<p>${state.dataState==='loading'?'The list of open checks has not loaded yet.':state.dataState==='unavailable'?'The list of open checks did not load. Use Retry research notes on the page.':'The list of open checks is missing from this file.'}</p>`}<p>No empirical forecast study is validated or frozen.</p></div>`,'Method and limits');}
  if(id.startsWith('source-')) {const s=state.sources.find(item=>item.id===id.slice(7));if(!s)return;return details(s.name,`<div class="detail-copy">${plainRows([['Source type',s.type||'Not recorded'],['Status',s.status||'Not recorded',plainKey('registry',s.id,'status')],['What we may do with it',s.rightsStatus||'Not recorded',plainKey('registry',s.id,'rightsStatus')],['Last reviewed',dateText(s.checkedAt)]])}<h3>What was checked</h3>${passage(plainKey('registry',s.id,'verificationScope'),s.verificationScope,'Not recorded','','What was checked')}${link(s.url,'Open original source')}</div>`,'Source');}
  if(id.startsWith('library-')) {const item=state.library.find(item=>item.id===id.slice(8));if(!item)return;const laureates=(item.laureates||[]).join(' · '), year=item.year==null||item.year===''?'Prize year not recorded':`${item.year} prize`;return details(item.title,`<div class="detail-copy"><p>${text(laureates||'Laureates not confirmed')} · ${text(year)}</p><h3>The idea</h3>${passage(plainKey('library',item.id,'mechanism'),item.mechanism,'Not recorded','','The idea')}<h3>What it means for our research</h3>${passage(plainKey('library',item.id,'takeaway'),item.takeaway,'Not recorded','','What it means for our research')}<h3>What this does not establish</h3>${passage(plainKey('library',item.id,'limits'),item.limits,'Not recorded','','What this does not establish')}${plainRows([['Status',plainStatus(item.verificationStatus)],['Last reviewed',dateText(item.checkedAt)],['What was read',item.verificationScope||'Not recorded',plainKey('library',item.id,'verificationScope')]])}${link(item.sourceUrl,'Open primary source')}</div>`,'Nobel research note');}
  if(id.startsWith('fact-')) { const f=state.facts[Number(id.slice(5))];if(!f)return;const r=f.record;let current;try{current=state.contract?.inspectEvidence(r,{operation:'display',at:displayTime()});}catch{}if(!current?.eligible){render();return details('This fact is now withheld','<div class="detail-copy"><p>This fact no longer passes its display checks. Permission to show it, and its context, must be valid at the moment it is shown.</p></div>','Filing facts');}return details('The source behind this fact',`<div class="detail-copy"><p>${text(claimText(f.claim))}</p><p>This is a past figure, as the company reported it. It is not a claim about today. It is not a forecast.</p>${detailRows([['Entity',r.entity?.name||r.issuer?.name||r.entityName||r.issuerName||'See record'],['SEC acceptance',dateText(r.source?.acceptedAt||r.filing?.acceptedAt)],['Publication',publicationDescription(r.source||r.filing||{})],['Public availability observed',dateText(availabilityTime(r.source||r.filing||{}))],['Saved on',dateText(r.source?.ingestedAt||r.provenance?.ingestedAt||r.ingestedAt)],['SEC filing ID',r.source?.accession||r.filing?.accession||r.accession||'See source record'],['Observation context',JSON.stringify(r.period||r.fact?.period||{})],['File fingerprint',r.source?.sha256||r.provenance?.sha256||r.snapshot?.sha256||r.contentHash||'See capture record'],['Reader version',r.source?.parserVersion||r.provenance?.parserVersion||r.parserVersion||'See capture record'],['Display state','Passed every display check']])}<h3>Source record</h3><pre class="record-code">${text(JSON.stringify(r,null,2))}</pre></div>`,'Source and provenance');}
}
document.addEventListener('click',event=>{
  const skip=event.target.closest('a.skip-link[href="#main"]');
  if(skip&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();$('#main').focus({preventScroll:true});globalThis.scrollTo?.({top:0,left:0,behavior:'instant'});return;}
  const price=event.target.closest('[data-price-symbol]');
  if(price){if(state.view==='research'&&deskTools?.selectPriceSymbol?.(price.dataset.priceSymbol)){deskFormDrafts.get('prices')?.delete(JSON.stringify(['selection','','']));navigate('prices');}return;}
  const nav=event.target.closest('[data-view],[data-go]');if(nav){if(nav.tagName==='A'&&(event.button>0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey))return;event.preventDefault?.();navigate(nav.dataset.view||nav.dataset.go);return;}
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
  if(event.key==='/'&&['research','evidence','library'].includes(state.view)&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.isComposing&&!editing&&!$('#detail-dialog').open){event.preventDefault();$('#research-search').focus();}
});
function syncLocation(){
  const view=location.hash.slice(1), params=new URLSearchParams(location.search);
  const nextHorizon=['next_week','weekly'].includes(params.get('horizon'))?'next_week':'next_day';
  const nextView=Object.hasOwn(titles,view)?view:view?state.view:'research';
  // An unknown hash keeps the current view, and the address shows that view again.
  if(view&&nextView!==view)globalThis.history?.replaceState?.(null,'',`#${nextView}`);
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
$('#workspace-date').textContent='Private preview of unvalidated research. Nothing here is a forecast or a recommendation.';
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
