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
  if(exact)return sessions.length===1?'ONE SESSION':`${sessions.length===5?'FIVE':sessions.length} EXCHANGE SESSIONS`;
  return window?.horizon_id==='next_day'?'NEXT-DAY TARGET':'FIVE-SESSION TARGET';
}
function eventRelation(value,window){
  if(!validDate(value)||!validDate(window?.entry_at)||!validDate(window?.exit_at)||Date.parse(window.entry_at)>=Date.parse(window.exit_at))return 'unknown';
  return Date.parse(value)<Date.parse(window.entry_at)?'before_entry':Date.parse(value)>Date.parse(window.exit_at)?'after_exit':'in_window';
}
const link=(url,label)=>{try{const u=new URL(url);return u.protocol==='https:'?`<a class="source-link" href="${text(u.href)}" target="_blank" rel="noopener noreferrer">${text(label)} ↗<span class="sr-only"> (opens in a new tab)</span></a>`:'';}catch{return '';}};
const labels={identity:'Security identity',prices_actions:'Prices and corporate actions',company_evidence:'Latest company evidence',latest_completed_session_OHLCV:'Oct 16 completed-session OHLCV','60_session_consolidated_liquidity':'60-session consolidated liquidity',corporate_actions_security_master:'Security identity and corporate actions',quote_display_rights:'Market-data display rights',all_latest_required_filings_and_later_material_announcements:'Complete filing and announcement coverage'};

// Short editorial interpretations of the retained cases. Full source wording,
// qualifications and references remain below each native disclosure.
const previews={
  IBM:{thesis:'A recovery case needs evidence that delayed deals are converting.',risk:'More deal slippage'},
  JNJ:{thesis:'A modest forward-guidance raise could support reassessment.',risk:'Legal and acquisition offsets'},
  NFLX:{thesis:'Pricing and ads could support stronger revenue and margins.',risk:'Retention and content costs'},
  PG:{thesis:'The next report tests whether volume and margins can improve together.',risk:'Weak demand and margin pressure'},
  TSLA:{thesis:'Deliveries need to translate into operating profit and cash flow.',risk:'Margin pressure and investment needs'},
  TXN:{thesis:'The next report tests whether industrial-demand recovery is continuing.',risk:'Weaker orders or excess inventory'},
};
function sourceLinks(item,snapshot){
  return (item.source_refs||[]).map(id=>{const s=snapshot.sources[id];return s?`<li>${link(s.url,id.replaceAll('_',' '))}<span class="source-date">${text(s.published_date||'Publication time not retained')}${s.access_note?` · ${text(s.access_note)}`:''}</span></li>`:'';}).join('');
}
function timing(item,snapshot,compact=false){
  const c=item.catalyst;
  if(c.status==='already_public_not_future_catalyst')return `${sessionDate(c.source_date)} update${compact?' · already public':' already public · no verified new event in this window'}`;
  const when=c.release_at_utc||c.webcast_at_utc;
  const precision=c.release_at_utc?(compact?'approx. release':'approximate release'):(compact?'call':'confirmed webcast; exact release time unknown');
  const relation=eventRelation(when,snapshot.window),day=snapshot.window.horizon_id==='next_day';
  const relative=relation==='after_exit'?day?' · after day exit':' · after window exit':relation==='before_entry'?' · before entry':relation==='unknown'?' · window timing unavailable':'';
  return `${compact?shortDate(when):date(when)} · ${precision}${relative}`;
}
function stockCard(item,snapshot,priceSymbols){
  const caution=item.ticker==='IBM',preview=previews[item.ticker]||{thesis:'This operating case needs further evidence.',risk:'Operating outlook uncertain'};
  return `<article class="card stock-card" aria-label="${text(item.ticker)} ${caution?'caution case':'operating hypothesis'}">
    <div class="stock-card-header"><div class="stock-identity"><span class="ticker">${text(item.ticker)}</span><h3>${text(item.company)}</h3></div><span class="tag ${caution?'caution':'neutral'}">${caution?'Caution':'Unranked'}</span></div>
    <p class="stock-thesis">${text(preview.thesis)}</p>
    <p class="stock-catalyst"><span aria-hidden="true">◷</span> ${text(timing(item,snapshot,true))}</p>
    <p class="stock-risk"><strong>Risk:</strong> ${text(preview.risk)} · Required inputs missing.</p>
    <p class="stock-status">${snapshot.window.horizon_id==='next_day'?'No next-day selection':'Not eligible'} · Forecast unavailable</p>
${priceSymbols.includes(item.ticker)?`<button type="button" class="desk-button desk-button-secondary" data-price-symbol="${text(item.ticker)}">View price action<span class="sr-only"> for ${text(item.ticker)}</span><span aria-hidden="true">→</span></button>\n`:''}    <details class="stock-details"><summary>Analysis & sources<span class="sr-only"> for ${text(item.ticker)}</span></summary><div class="expanded-stock">
      <div class="stock-summary"><div><h4>What changed</h4><p>${text(item.what_changed)}</p></div><div><h4>Why this window</h4><p>${text(timing(item,snapshot))}</p></div><div><h4>Favorable test · analyst interpretation</h4><p>${text(item.positive_case)}</p></div><div><h4>DOWNSIDE / COUNTER-CASE</h4><p>${text(item.counter_case)}</p></div></div>
      <h4>What would invalidate the thesis?</h4><p>${text(item.invalidation_trigger)}</p>
      <h4>Inputs blocking ranking</h4><ul class="missing-inputs">${item.gate_reasons.map(([id,state])=>`<li><strong>${text(id==='latest_completed_session_OHLCV'?`${sessionDate(snapshot.price_session)} completed-session OHLCV`:labels[id]||id)}</strong>: ${text(state.replaceAll('_',' '))}</li>`).join('')}</ul>
      <p>Market expectations unavailable. Price response unknown. Predictive performance untested. Review covers selected sources; it is not complete filing coverage or a verified tradability screen.</p>
      <dl class="stock-metrics"><div><dt>Entry reference</dt><dd>${text(date(snapshot.window.entry_at))} open</dd></div><div><dt>Exit reference</dt><dd>${text(date(snapshot.window.exit_at))} close</dd></div><div><dt>Price / expected return / gain probability</dt><dd>Unavailable / unavailable / unavailable</dd></div></dl>
      <h4>Macro → industry → company update → event → each share</h4><ol class="evidence-chain">${item.evidence_chain.map(step=>`<li><strong>${text(step.link.replaceAll('_',' '))}</strong><span class="chain-kind">${text(step.kind.replaceAll('_',' '))}</span><p>${text(step.text)}</p></li>`).join('')}</ol>
      ${item.research_application?`<h4>How the retained research affects this case</h4><p>${text(item.research_application.concentric_effect)}</p><p>${text(item.research_application.nobel_effect)}</p><p>${text(item.research_application.ordering_effect)}</p><p class="source-date">Both supplied PDF texts and retained public summaries informed this mapping. Embedded images and the underlying cited paper corpus were not fully reviewed. No predictive validation is claimed.</p>`:''}
      ${item.review_limits?.length?`<h4>Review limits</h4><ul>${item.review_limits.map(limit=>`<li>${text(limit)}</li>`).join('')}</ul>`:''}
      <h4>Funding and dilution review</h4><p>${text(item.funding_check)}</p>
      ${item.guidance?`<h4>Comparable guidance reference</h4><p>Issuer-stated adjusted diluted EPS midpoint: $11.04 → $11.10 for FY2026. This $0.06 rounded guidance change is an accounting fact, not a stock-return estimate. ${text(item.guidance.midpoint_rounding_note)}</p>`:''}
      <h4>Source links · retained review</h4><ul class="stock-sources">${sourceLinks(item,snapshot)}</ul><p class="source-date">Research checked ${text(date(snapshot.reviewed_at))}. Exact source publication times, original-byte capture and operation-rights coverage are incomplete. Current rank, price, return and probability fields remain null.</p>
    </div></details>
  </article>`;
}
function eventCard(item){
  return `<article class="event-item"><details class="event-details"><summary class="event-row"><strong class="event-ticker">${text(item.ticker)}</strong><span class="event-time"><strong>${text(shortDate(item.webcast_at_utc))}</strong><span>Earnings webcast</span></span><span class="event-toggle">Details</span></summary><div class="event-expanded"><h3>${text(item.name)}</h3><p>${text(item.event_summary)}</p><p>Confirmed webcast · ${item.results_release_at_utc?'release approximately '+text(date(item.results_release_at_utc)):'exact release time not specified'}</p>${link(item.primary_source_url,'Issuer event')}<p class="source-date">Checked ${text(date(item.evidence_checked_at_utc))}</p></div></details></article>`;
}
// Source age comes only from the validated projection. A repeated ID or a
// different endpoint kind must never borrow another row's later check.
function sourceChecks(checks,summary){
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const originalValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)&&validDate(value)&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
  const relatedValid=check=>check.related_sources===undefined||(Array.isArray(check.related_sources)&&check.related_sources.every(source=>record(source)&&typeof source.label==='string'&&source.label.trim()&&link(source.url,source.label)));
  const metadataValid=check=>record(check)&&['id','name','status','note'].every(key=>typeof check[key]==='string'&&check[key].trim())&&link(check.url,'Source')&&relatedValid(check);
  if(!Array.isArray(summary?.checks)&&checks.every(check=>metadataValid(check)&&originalValid(check.observed_at)))return `<ul class="source-checks">${checks.map(check=>`<li><strong>${text(check.name)}</strong> · ${text(check.status)}<p>Observed ${text(date(check.observed_at))}. ${text(check.note)} ${link(check.url,'Source')} ${(check.related_sources||[]).map(source=>link(source.url,source.label)).join(' ')}</p></li>`).join('')}</ul>`;
  const clock=value=>originalValid(value)?`<time datetime="${text(value)}">${text(date(value))}</time>`:'Unavailable';
  return `<ul class="source-checks stock-sources">${checks.map((raw,index)=>{
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
  return {label:due?' · check due':incomplete?' · timing incomplete':'',content:`<aside class="source-age-feedback" aria-label="Source capture age"><h3>${heading}</h3><p>${text(description)} Coverage remains incomplete.${last}</p><p>Reloading a workspace file does not refresh source observations.</p></aside>`};
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
  const hypotheses=snapshot.hypotheses.filter(matches),events=snapshot.event_watch.filter(matches).sort((a,b)=>Date.parse(a.webcast_at_utc)-Date.parse(b.webcast_at_utc)),day=snapshot.window.horizon_id==='next_day';
  const status={upcoming:'Upcoming',in_progress:'Window in progress',archived:'Archived snapshot',unavailable:'Window unavailable'}[snapshot.status]||'Window unavailable';
  const positions=events.map(item=>eventRelation(item.webcast_at_utc,snapshot.window));
  const allAfter=positions.length>0&&positions.every(position=>position==='after_exit'),allInside=positions.length>0&&positions.every(position=>position==='in_window');
  const eventIntro=!events.length?'No matching event dates.':allAfter?(day?'Outside the day window.':'After the selected window.'):allInside?(day?'Within the day window.':'Within the selected window.'):'Event positions vary; compare each date with the entry and exit.';
  return `<div class="stock-desk">
    <section class="window-card card" aria-label="Exact holding window"><div class="window-title"><span class="eyebrow">${text(sessionLabel(snapshot.window))}</span><span class="tag neutral">${text(status)}</span></div><h2>${text(windowTitle(snapshot.window))}</h2>
      <div class="window-times"><div><span>ENTRY · OPEN</span><strong>${text(shortDate(snapshot.window.entry_at))}</strong><small>${text(utcDate(snapshot.window.entry_at))}</small></div><span class="window-arrow" aria-hidden="true">→</span><div><span>EXIT · CLOSE</span><strong>${text(shortDate(snapshot.window.exit_at))}</strong><small>${text(utcDate(snapshot.window.exit_at))}</small></div></div>
      ${snapshot.status!=='upcoming'?`<p class="window-alert">${snapshot.status==='in_progress'?'The original entry has passed. These cards do not offer a new entry at the old open.':snapshot.status==='archived'?'This slate is archived and must not be treated as a current opportunity.':'The holding window could not be established. Entry and exit timing need review.'} A new entry requires a new snapshot.</p>`:''}
      <details class="window-details"><summary>Window & data status${freshness?.label||''}</summary><div>${freshness?.content||''}<p>Prospective open-to-close simulation references; fills are not guaranteed. ${text(sessionDate(snapshot.price_session,'long'))} close is a historical reference. No prior-close or weekend opening gap is earned.</p><div class="snapshot-meta"><span>Research checked ${text(date(snapshot.reviewed_at))}</span><span>Manual snapshot · source cutoff varies</span><span>Price reference session ${text(sessionDate(snapshot.price_session))} · OHLCV missing</span></div><h3>Data connections</h3><p>Price API awaiting approved access. No automatic collector is active.</p>${sourceChecks(snapshot.source_checks||[],sourceFreshness)}</div></details>
    </section>
    <p class="coverage-strip" aria-label="Research coverage">${snapshot.roster_count}-stock roster <span>·</span> ${snapshot.screened_count} partial reviews <span>·</span> ${snapshot.blocked_count} blocked <span>·</span> 0 eligible</p>
    <section class="stock-shortlist" aria-label="Ranked upside candidates"><div class="card stock-empty"><h2>No eligible selection</h2><p>Expected return unavailable. Prices, liquidity and source-rights checks are incomplete.</p><details class="eligibility-details"><summary>Why no picks?</summary><div><p>${text(snapshot.conclusion)}</p><p><strong>Ranking unavailable:</strong> prices, liquidity, security/actions, source rights and full company coverage remain incomplete. Expected returns and probabilities are unavailable.</p><p class="ordering-note">Proposed research order. After required gates and a qualifying evidence route pass, fundamentals, catalyst, price action and macro each receive 0–2 reviewed points. Their equally weighted research score runs from 0 to 100. Ties stay tied. This unvalidated rubric does not estimate stock returns. The roster is a convenience sample, not a market-wide screen.</p></div></details></div></section>
    <section aria-label="Operating hypotheses"><div class="section-label-row"><h2>Stocks to investigate <span class="section-count">${hypotheses.length}</span></h2><span>Alphabetical · unranked</span></div><div class="stock-list">${hypotheses.map(item=>stockCard(item,snapshot,priceSymbols)).join('')||'<p>No matching stocks.</p>'}</div></section>
    <section aria-label="Event watch"><div class="section-label-row"><h2>${day&&allAfter?'After the day window':'Event watch'} <span class="section-count">${events.length}</span></h2></div><p class="section-intro">${text(eventIntro)} New York webcast times · two-sided events, not bullish picks.</p><div class="card event-list">${events.map(eventCard).join('')||'<p>No matching events.</p>'}</div></section>
    <details class="card research-context"><summary>Method & macro context</summary><section class="method-application"><div><span class="eyebrow">HOW THE RESEARCH CHANGES SELECTION</span><h2>Company evidence, through both research lenses</h2><p>The retained concentric method connects company evidence, event timing and per-share economics. Cribscore applies ideas from Nobel research to question macro causality, apparent mispricing and selective use of evidence. The counter-case, timing and funding rules are product design choices. Current cards are hand-reviewed and alphabetical; neither input establishes a one-day or five-session return signal.</p><button class="text-button" data-go="methodology">Why this method? ↗</button></div><div class="macro-strip"><strong>Macro context · dated facts</strong>${snapshot.macro_context.map(item=>`<p>${text(item.fact)} ${link(snapshot.sources[item.source_ref]?.url,'Source')}<span>${text(item.interpretation)}</span></p>`).join('')}</div></section></details>
  </div>`;
}
