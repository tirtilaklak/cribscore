import {renderApprovedResearchView} from './research-slate-view.js';
const text=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const date=value=>validDate(value)?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/New_York',timeZoneName:'short'}).format(new Date(value)):'Unavailable';
const shortDate=value=>validDate(value)?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/New_York',timeZoneName:'short'}).format(new Date(value)):'Unavailable';
const sessionDate=(value,month='short')=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&validDate(value)&&new Date(value).toISOString().slice(0,10)===value?new Intl.DateTimeFormat('en-US',{month,day:'numeric',timeZone:'UTC'}).format(new Date(value)):'Unavailable';
const utcDate=value=>validDate(value)?new Date(value).toISOString().replace('T',' ').replace(/:00\.000Z$|\.000Z$/,' UTC').replace(/Z$/,' UTC'):'Unavailable';
function windowTitle(window){
  if(!validDate(window?.entry_at)||!validDate(window?.exit_at))return 'Window dates unavailable';
  const parts=value=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'America/New_York'}).formatToParts(new Date(value)).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  const start=parts(window.entry_at),end=parts(window.exit_at),full=value=>`${value.month} ${value.day}, ${value.year}`;
  return start.year===end.year&&start.month===end.month?`${start.month} ${start.day}${start.day===end.day?'':`–${end.day}`}, ${start.year}`:`${full(start)} – ${full(end)}`;
}
function sessionLabel(window){
  const sessions=window?.sessions;
  const exact=Array.isArray(sessions)&&sessions.length>0&&sessions.every((item,index)=>validDate(item?.open)&&validDate(item?.close)&&Date.parse(item.open)<Date.parse(item.close)&&(!index||Date.parse(item.open)>Date.parse(sessions[index-1].close)))&&Date.parse(sessions[0].open)===Date.parse(window.entry_at)&&Date.parse(sessions.at(-1).close)===Date.parse(window.exit_at);
  if(exact)return sessions.length===1?'1 trading day':`${sessions.length} trading days`;
  return window?.horizon_id==='next_day'?'1-day window':'5-day window';
}
function eventRelation(value,window){
  if(!validDate(value)||!validDate(window?.entry_at)||!validDate(window?.exit_at)||Date.parse(window.entry_at)>=Date.parse(window.exit_at))return 'unknown';
  return Date.parse(value)<Date.parse(window.entry_at)?'before_entry':Date.parse(value)>Date.parse(window.exit_at)?'after_exit':'in_window';
}
const link=(url,label)=>{try{const u=new URL(url);return u.protocol==='https:'?`<a class="source-link" href="${text(u.href)}" target="_blank" rel="noopener noreferrer">${text(label)} ↗<span class="sr-only"> (opens in a new tab)</span></a>`:'';}catch{return '';}};
const labels={identity:'Security identity',prices_actions:'Prices and corporate actions',company_evidence:'Latest company evidence',latest_completed_session_OHLCV:'Oct 16 completed-session OHLCV','60_session_consolidated_liquidity':'60-session consolidated liquidity',corporate_actions_security_master:'Security identity and corporate actions',quote_display_rights:'Market-data display rights',all_latest_required_filings_and_later_material_announcements:'Complete filing and announcement coverage'};

// Short editorial questions for the retained cases. They cannot go stale after
// an event date. Full source wording, qualifications and references remain
// below each native disclosure.
const previews={
  IBM:{question:'After its July guidance cut, are delayed deals turning into revenue?',risk:'More delayed deals'},
  JNJ:{question:'Does a small raise to the yearly outlook change the case?',risk:'Legal and acquisition costs'},
  NFLX:{question:'Can pricing and ads lift revenue and margins?',risk:'Weaker retention and higher content costs'},
  PG:{question:'Can sales volume and margins improve together?',risk:'Weak demand and margin pressure'},
  TSLA:{question:'Will deliveries turn into operating profit and cash flow?',risk:'Margin pressure and heavy investment needs'},
  TXN:{question:'Is demand from industrial customers still recovering?',risk:'Weaker orders or too much inventory'},
};
// Source ids such as "ibm_aug14_notes" read as "IBM aug14 notes": the case's own
// ticker is upper-cased; every other id keeps its words.
const sourceLabel=(id,ticker)=>(id.startsWith(`${ticker.toLowerCase()}_`)?`${ticker}${id.slice(ticker.length)}`:id).replaceAll('_',' ');
function sourceLinks(item,snapshot){
  return (item.source_refs||[]).map(id=>{const s=snapshot.sources[id];return s?`<li>${link(s.url,sourceLabel(id,item.ticker))}<span class="source-date">${text(s.published_date||'Publication time not retained')}${s.access_note?` · ${text(s.access_note)}`:''}</span></li>`:'';}).join('');
}
function timing(item,snapshot,compact=false){
  const c=item.catalyst;
  if(c.status==='already_public_not_future_catalyst')return `${sessionDate(c.source_date)} update${compact?' · already public':' already public · no verified new event in this window'}`;
  const when=c.release_at_utc||c.webcast_at_utc;
  const precision=c.release_at_utc?(compact?'results about then':'results expected about then'):(compact?'earnings call':'earnings call confirmed · results time not given');
  const relation=eventRelation(when,snapshot.window);
  const relative=relation==='after_exit'?' · after the window':relation==='before_entry'?' · before the window':relation==='unknown'?' · window dates unknown':'';
  return `${compact?shortDate(when):date(when)} · ${precision}${relative}`;
}
function stockCard(item,snapshot,priceSymbols){
  const preview=previews[item.ticker]||{question:'What evidence would move this case?',risk:'Operating outlook uncertain'};
  return `<article class="card stock-card" aria-label="${text(item.ticker)} case">
    <div class="stock-card-header"><div class="stock-identity"><span class="ticker">${text(item.ticker)}</span><h3>${text(item.company)}</h3></div><span class="tag neutral">Not eligible</span></div>
    <p class="stock-thesis"><strong>Question:</strong> ${text(preview.question)}</p>
    <p class="stock-risk"><strong>Risk:</strong> ${text(preview.risk)}.</p>
    <p class="stock-catalyst"><span aria-hidden="true">◷</span> ${text(timing(item,snapshot,true))}</p>
    <details class="stock-details"><summary>Analysis & sources<span class="sr-only"> for ${text(item.ticker)}</span></summary><div class="expanded-stock">
      <div class="stock-summary"><div><h4>What changed</h4><p>${text(item.what_changed)}</p></div><div><h4>Event timing</h4><p>${text(timing(item,snapshot))}</p></div><div><h4>The case for · analyst interpretation</h4><p>${text(item.positive_case)}</p></div><div><h4>The case against · analyst interpretation</h4><p>${text(item.counter_case)}</p></div></div>
      <h4>What would prove this case wrong?</h4><p>${text(item.invalidation_trigger)}</p>
      <h4>What blocks ranking</h4><ul class="missing-inputs">${item.gate_reasons.map(([id,state])=>`<li><strong>${text(id==='latest_completed_session_OHLCV'?`${sessionDate(snapshot.price_session)} completed-session OHLCV`:labels[id]||id)}</strong>: ${text(state.replaceAll('_',' '))}</li>`).join('')}</ul>
      <p>What the market expects is unknown. How the price reacted is unknown. Nobody has tested whether this case predicts returns. The review covers selected sources only. It does not cover every filing. It does not confirm the stock is easy to trade.</p>
      <dl class="stock-metrics"><div><dt>Window start</dt><dd>${text(date(snapshot.window.entry_at))} open</dd></div><div><dt>Window end</dt><dd>${text(date(snapshot.window.exit_at))} close</dd></div><div><dt>Price</dt><dd>Unavailable</dd></div><div><dt>Expected return</dt><dd>Unavailable</dd></div><div><dt>Chance of gain</dt><dd>Unavailable</dd></div></dl>
      <h4>Macro → industry → company update → event → each share</h4><ol class="evidence-chain">${item.evidence_chain.map(step=>`<li><strong>${text(step.link.replaceAll('_',' '))}</strong><span class="chain-kind">${text(step.kind.replaceAll('_',' '))}</span><p>${text(step.text)}</p></li>`).join('')}</ol>
      ${item.research_application?`<h4>How the research notes shape this case</h4><p>${text(item.research_application.concentric_effect)}</p><p>${text(item.research_application.nobel_effect)}</p><p>${text(item.research_application.ordering_effect)}</p><p class="source-date">Both supplied PDF texts and retained public summaries informed this mapping. Embedded images and the underlying cited paper corpus were not fully reviewed. No predictive validation is claimed.</p>`:''}
      ${item.review_limits?.length?`<h4>Review limits</h4><ul>${item.review_limits.map(limit=>`<li>${text(limit)}</li>`).join('')}</ul>`:''}
      <h4>Funding and new shares</h4><p>${text(item.funding_check)}</p>
      ${item.guidance?`<h4>Company guidance</h4><p>Adjusted diluted EPS (earnings per share) for FY2026, as stated by the company. This is a non-GAAP figure (adjusted by the company, outside standard accounting rules). The stated midpoint moved from $11.04 to $11.10, up $0.06. Source: the company's Q3 2026 results release, linked under Sources read. Guidance is the company's own estimate. It does not estimate the stock's return.</p>`:''}
      <h4>Sources read</h4><ul class="stock-sources">${sourceLinks(item,snapshot)}</ul><p class="source-date">Research checked ${text(date(snapshot.reviewed_at))}. Some publication times are unknown. Some original files were not saved. Permission to use each source is not fully checked. This case has no rank, price, return or probability.</p>
    </div></details>
${priceSymbols.includes(item.ticker)?`    <button type="button" class="desk-button desk-button-secondary" data-price-symbol="${text(item.ticker)}">Price chart<span class="sr-only"> for ${text(item.ticker)}</span><span aria-hidden="true">→</span></button>\n`:''}  </article>`;
}
function eventCard(item){
  return `<article class="event-item"><details class="event-details"><summary class="event-row"><strong class="event-ticker">${text(item.ticker)}</strong><span class="event-time"><strong>${text(shortDate(item.webcast_at_utc))}</strong><span>Earnings call</span></span><span class="event-toggle">Details</span></summary><div class="event-expanded"><h3>${text(item.name)}</h3><p>${text(item.event_summary)}</p><p>Confirmed webcast · ${item.results_release_at_utc?'release approximately '+text(date(item.results_release_at_utc)):'exact release time not specified'}</p>${link(item.primary_source_url,'Issuer event')}<p class="source-date">Checked ${text(date(item.evidence_checked_at_utc))}</p></div></details></article>`;
}
// Source age comes only from the validated projection. A repeated ID or a
// different endpoint kind must never borrow another row's later check.
function sourceChecks(checks,summary){
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const originalValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)&&validDate(value)&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
  const relatedValid=check=>check.related_sources===undefined||(Array.isArray(check.related_sources)&&check.related_sources.every(source=>record(source)&&typeof source.label==='string'&&source.label.trim()&&link(source.url,source.label)));
  const metadataValid=check=>record(check)&&['id','name','status','note'].every(key=>typeof check[key]==='string'&&check[key].trim())&&link(check.url,'Source')&&relatedValid(check);
  if(!Array.isArray(summary?.checks)&&checks.every(check=>metadataValid(check)&&originalValid(check.observed_at)))return `<ul class="source-checks" role="list">${checks.map(check=>`<li><strong>${text(check.name)}</strong> · ${text(check.status)}<p>Observed ${text(date(check.observed_at))}. ${text(check.note)} ${link(check.url,'Source')} ${(check.related_sources||[]).map(source=>link(source.url,source.label)).join(' ')}</p></li>`).join('')}</ul>`;
  const clock=value=>originalValid(value)?`<time datetime="${text(value)}">${text(date(value))}</time>`:'Unavailable';
  return `<ul class="source-checks stock-sources" role="list">${checks.map((raw,index)=>{
    const check=record(raw)?raw:{},metadataOK=metadataValid(check);
    const matches=Array.isArray(summary?.checks)?summary.checks.filter(row=>row?.id===check.id):[],row=matches[0];
    const matched=metadataOK&&checks.filter(item=>item?.id===check.id).length===1&&matches.length===1&&row.sourceKind===(check.source_kind||'unclassified')&&row.observedAt===check.observed_at;
    const age=matched?row.captureStatus:null;
    const within=age==='capture_within_age_policy',due=age==='capture_stale';
    const ageLabel=!metadataOK?'Source metadata incomplete':within&&Number.isFinite(row.maxCaptureAgeHours)&&row.maxCaptureAgeHours>0?`Checked within ${row.maxCaptureAgeHours} hours`:due?'Check due':'Source timing needs review';
    const latest=matched&&row.lastCheckStatus==='valid'&&(within||due)&&row.lastCheckedAt===row.effectiveObservedAt&&originalValid(row.lastCheckedAt);
    const checkLabel=check.source_kind==='sec_submissions'?'Latest inventory check':check.source_kind==='bls_current_vintage'?'Latest CPI check':'Latest source check';
    const outcome=row?.lastCheckOutcome==='metadata_changed'?'Metadata changed':row?.lastCheckOutcome==='unchanged'?(check.source_kind==='sec_submissions'?'Inventory unchanged':'Compared data unchanged'):'';
    const name=typeof check.name==='string'&&check.name.trim()?check.name:`Source entry ${index+1}`;
    const primary=link(check.url,'Source')||'<span>Source link unavailable.</span>';
    const related=Array.isArray(check.related_sources)?check.related_sources.map(source=>record(source)&&typeof source.label==='string'&&source.label.trim()?link(source.url,source.label)||'<span>Related source link unavailable.</span>':'<span>Related source metadata incomplete.</span>').join(' '):check.related_sources!==undefined?'<span>Related sources incomplete.</span>':'';
    return `<li data-source-id="${text(typeof check.id==='string'?check.id:`unavailable-${index}`)}"><strong>${text(name)}</strong><p>${text(ageLabel)}<br>Original observation: ${clock(check.observed_at)}${latest?`<br>${checkLabel}: ${clock(row.lastCheckedAt)}${outcome?` · ${outcome}`:''}`:''}</p><details class="source-coverage" data-state-key="source-check:${text(typeof check.id==='string'?check.id:'unavailable')}:${index}"><summary>Coverage & sources<span class="sr-only"> for ${text(name)}</span></summary><p>${typeof check.status==='string'?`${text(check.status)}. `:''}${typeof check.note==='string'?text(check.note):'Source coverage could not be read.'} ${primary} ${related}</p></details></li>`;
  }).join('')}</ul>`;
}
// Optional capture-age projection. Default rendering remains byte-for-byte
// unchanged; callers supply structured counts and clocks, never HTML.
function sourceAgeNote(summary){
  if(!summary || typeof summary!=='object')return null;
  const {total,staleCount,invalidCount,missingCount,maxCaptureAgeHours,latestObservedAt}=summary;
  if(![total,staleCount,invalidCount,missingCount].every(value=>Number.isSafeInteger(value)&&value>=0) || staleCount+invalidCount+missingCount>total || !Number.isFinite(maxCaptureAgeHours) || maxCaptureAgeHours<=0)return null;
  const due=staleCount>0, incomplete=invalidCount+missingCount>0||total===0;
  const heading=due?'Source checks due':incomplete?'Source timing incomplete':'Capture age checked';
  const projected=Array.isArray(summary.checks);
  const description=due?projected?`${staleCount} of ${total} sources need a new check after ${maxCaptureAgeHours} hours.`:`${staleCount} of ${total} retained capture times are older than ${maxCaptureAgeHours} hours.`:incomplete?`${invalidCount+missingCount} source clocks need review.`:projected?`Source checks are within the ${maxCaptureAgeHours}-hour review interval.`:`Retained capture times are within the ${maxCaptureAgeHours}-hour review interval.`;
  const last=typeof latestObservedAt==='string' && /^\d{4}-\d{2}-\d{2}T/.test(latestObservedAt) && Number.isFinite(Date.parse(latestObservedAt))?` ${projected?'Latest source check':'Latest capture'}: ${text(date(latestObservedAt))}.`:'';
  return {label:due?' · check due':incomplete?' · timing incomplete':'',content:`<div class="source-age-feedback"><h3>${heading}</h3><p>${text(description)} Coverage remains incomplete.${last}</p><p>Reloading this page does not re-check any source.</p></div>`};
}
export function renderStockView(snapshot,query='',{slateSlot,horizonId=snapshot?.window?.horizon_id,sourceFreshness,priceSymbols=[]}={}){
  priceSymbols=Array.isArray(priceSymbols)?priceSymbols:[];
  const approved=renderApprovedResearchView(slateSlot,{horizonId,query,priceSymbols});
  if(approved!==null)return approved;
  if(!snapshot)return `<section class="card stock-empty"><h2>Stock research unavailable</h2><p>The candidate evidence could not be loaded. Prices, ranks and return estimates remain unavailable.</p></section>`;
  const freshness=sourceAgeNote(sourceFreshness);
  const needle=typeof query==='string'?query.trim().toLowerCase():'';
  const exactTicker=[...snapshot.hypotheses,...snapshot.event_watch].some(item=>item.ticker.toLowerCase()===needle);
  const matches=item=>!needle||(exactTicker?item.ticker.toLowerCase()===needle:JSON.stringify(item).toLowerCase().includes(needle));
  const hypotheses=snapshot.hypotheses.filter(matches),events=snapshot.event_watch.filter(matches).sort((a,b)=>Date.parse(a.webcast_at_utc)-Date.parse(b.webcast_at_utc));
  const status={upcoming:'Upcoming',in_progress:'Window in progress',archived:'Archived snapshot',unavailable:'Window unavailable'}[snapshot.status]||'Window unavailable';
  const positions=events.map(item=>eventRelation(item.webcast_at_utc,snapshot.window));
  const every=position=>positions.length>0&&positions.every(value=>value===position);
  const windowKnown=validDate(snapshot.window?.entry_at)&&validDate(snapshot.window?.exit_at)&&Date.parse(snapshot.window.entry_at)<Date.parse(snapshot.window.exit_at);
  const eventIntro=!events.length?'No matching event dates.':every('after_exit')?'All of these calls fall after this window.':every('in_window')?'All of these calls fall inside this window.':every('before_entry')?'All of these calls fall before this window.':positions.includes('unknown')?(windowKnown?'Compare each date with the window times.':'The window dates are unknown, so these calls cannot be placed in the window.'):!positions.includes('in_window')?'None of these calls fall inside this window. Compare each date with the window times.':'Some calls fall outside this window. Compare each date with the window times.';
  // The state sentence leads the desk in every state. Only past or unreadable
  // windows get the amber alert; an upcoming window gets a neutral note.
  const stateLine=snapshot.status==='upcoming'?`<p class="window-note">This window (the trading days this research covers) opens ${text(date(snapshot.window.entry_at))}.</p>`:`<p class="window-alert">${snapshot.status==='in_progress'?`This window (the trading days this research covers) opened ${text(date(snapshot.window.entry_at))}. The cases below were written before it opened. They give no new starting point. A new window needs a new snapshot (a new review with its own date).`:snapshot.status==='archived'?`This snapshot (a dated review that is not updated) is archived. Its window (the trading days it covered) closed ${text(date(snapshot.window.exit_at))}. Nothing on this page is current. A new window needs a new snapshot.`:'The window dates (the trading days this research covers) could not be read. They need review. Treat every case below as background only. A new window needs a new snapshot (a new review with its own date).'}</p>`;
  return `<div class="stock-desk">
    <section class="window-card card" aria-label="Research window"><div class="window-title"><span class="eyebrow">${text(sessionLabel(snapshot.window))}</span><span class="tag neutral">${text(status)}</span></div><h2>${text(windowTitle(snapshot.window))}</h2>
      ${stateLine}
      <p class="window-eligibility"><strong>No stock is eligible.</strong> Expected return unavailable.</p>
      <p class="window-reviewed">Research checked ${text(date(snapshot.reviewed_at))}.</p>
      <div class="window-times"><div><span>Starts at the open</span><strong>${text(shortDate(snapshot.window.entry_at))}</strong><small>${text(utcDate(snapshot.window.entry_at))}</small></div><span class="window-arrow" aria-hidden="true">→</span><div><span>Ends at the close</span><strong>${text(shortDate(snapshot.window.exit_at))}</strong><small>${text(utcDate(snapshot.window.exit_at))}</small></div></div>
      <details class="eligibility-details"><summary>Why nothing is eligible</summary><div><p>${text(snapshot.conclusion)}</p><p><strong>No ranking yet.</strong> Several checks are not finished. Prices and liquidity (how easily shares trade without moving the price) are not checked yet. Share identity and corporate actions (events like splits and dividends that change shares) are not fully checked. Permission to use the sources and full company coverage are not confirmed. There are no expected returns or probabilities.</p><p class="ordering-note">How stocks would be ordered. A stock must first pass every required check. It also needs new company guidance or a dated company event. Then four areas get 0, 1 or 2 points each: business results, the event, price history and the economy. The points make a research score from 0 to 100. Ties stay tied. This rubric is unvalidated. It does not estimate stock returns. These stocks were chosen for convenience. They are not a scan of the whole market.</p><button class="text-button" id="eligibility-method-link" data-go="methodology">How the method works <span aria-hidden="true">→</span></button></div></details>
      <details class="window-details"><summary>Window details and source checks${freshness?.label||''}</summary><div>${freshness?.content||''}<p>A paper test (a practice trade with no real money) would use this window's opening and closing prices. A real order might fill at another price. ${text(sessionDate(snapshot.price_session,'long'))} close is a historical reference. No prior-close or weekend opening gap is earned.</p><div class="snapshot-meta"><span>Research checked ${text(date(snapshot.reviewed_at))}</span><span>Manual snapshot · source cutoff varies</span><span>Price reference session ${text(sessionDate(snapshot.price_session))} · OHLCV (open, high, low and close prices plus volume) missing</span></div><h3>Data connections</h3><p>Price API awaiting approved access. No automatic collector is active.</p>${sourceChecks(snapshot.source_checks||[],sourceFreshness)}</div></details>
    </section>
    <p class="coverage-strip"><span class="sr-only">Research coverage: </span>${snapshot.roster_count} stocks on the list <span class="coverage-part"><span aria-hidden="true">·</span> ${snapshot.screened_count} partly reviewed</span> <span class="coverage-part"><span aria-hidden="true">·</span> ${snapshot.blocked_count} blocked</span> <span class="coverage-part"><span aria-hidden="true">·</span> 0 eligible</span></p>
    <section aria-labelledby="cases-heading"><div class="section-label-row"><h2 id="cases-heading">Company cases <span class="section-count">${hypotheses.length}</span></h2><span>Alphabetical · unranked</span></div><p class="section-intro">Forecast unavailable for every case. Each one lacks inputs that ranking needs. Open a case to see what is missing.</p><div class="stock-list">${hypotheses.map(item=>stockCard(item,snapshot,priceSymbols)).join('')||'<p>No matching stocks.</p>'}</div></section>
    <section aria-labelledby="events-heading"><div class="section-label-row"><h2 id="events-heading">${snapshot.status==='upcoming'?'Earnings calls ahead':'Earnings calls in this snapshot'} <span class="section-count">${events.length}</span></h2></div><p class="section-intro">${text(eventIntro)}${events.length?` These dates were listed in the review of ${text(date(snapshot.reviewed_at))}. They are not updated. An earnings call can move a stock up or down.`:''}</p><div class="card event-list">${events.map(eventCard).join('')||'<p>No matching events.</p>'}</div></section>
    <details class="card research-context"><summary>Method and economic context</summary><section class="method-application" aria-labelledby="context-heading"><div><span class="eyebrow">How the research shapes these cases</span><h2 id="context-heading">Company facts, checked against economic ideas</h2><p>The step-by-step method links company facts and event dates to the value of one share. Ideas from Nobel research help us test claims about the economy. They also help us question prices that look wrong and evidence chosen to fit a story. These ideas are background only. No prize proves a one-day or five-day trading edge. The timing and funding rules are our own design choices. So is the rule that every case has a case against. The cases are reviewed by hand and listed A to Z.</p><button class="text-button" id="context-method-link" data-go="methodology">How the method works <span aria-hidden="true">→</span></button></div><div class="macro-strip"><strong>Economic context · dated facts</strong>${snapshot.macro_context.map(item=>`<p>${text(item.fact)} ${link(snapshot.sources[item.source_ref]?.url,'Source')}<span>${text(item.interpretation)}</span></p>`).join('')}</div></section></details>
  </div>`;
}
