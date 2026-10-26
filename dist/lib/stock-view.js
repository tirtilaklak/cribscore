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
  // Without checked sessions the label is the window's own name, as on the toggle.
  // A count that differs from it needs explicit sessions.
  return window?.horizon_id==='next_day'?'1 trading day':'5 trading days';
}
function eventRelation(value,window){
  if(!validDate(value)||!validDate(window?.entry_at)||!validDate(window?.exit_at)||Date.parse(window.entry_at)>=Date.parse(window.exit_at))return 'unknown';
  return Date.parse(value)<Date.parse(window.entry_at)?'before_entry':Date.parse(value)>Date.parse(window.exit_at)?'after_exit':'in_window';
}
const link=(url,label)=>{try{const u=new URL(url);return u.protocol==='https:'?`<a class="source-link" href="${text(u.href)}" target="_blank" rel="noopener noreferrer">${text(label)} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`:'';}catch{return '';}};
const labels={identity:'Security identity',prices_actions:'Prices and corporate actions',company_evidence:'Latest company evidence',latest_completed_session_OHLCV:'Latest daily prices (OHLCV)','60_session_consolidated_liquidity':'Liquidity over the last 60 trading days',corporate_actions_security_master:'Security identity and corporate actions',quote_display_rights:'Permission to show market data',all_latest_required_filings_and_later_material_announcements:'Complete filing and announcement coverage'};

// Each case carries its own short question and main risk in the snapshot data.
// Full source wording, qualifications and references remain below each native
// disclosure. A question is written for one review only: it shows only when its
// case_text_review_at equals the snapshot's review clock. Any other clock, or
// a missing question, gets the neutral fallback, never a stale question.
// Questions are worded in the present tense ("What do ... results show"), so
// they read the same before and after the company's event inside the window.
const caseFallback={question:'What evidence would move this case?',risk:'Operating outlook uncertain'};
function caseText(item,snapshot){
  const filled=value=>typeof value==='string'&&value.trim()!=='';
  return filled(item.case_question)&&filled(item.main_risk)&&typeof item.case_text_review_at==='string'&&item.case_text_review_at===snapshot.reviewed_at?{question:item.case_question.trim(),risk:item.main_risk.trim()}:caseFallback;
}
// Company guidance renders only from the case's own guidance record. Every
// figure is a data field. The code picks the words and formats the numbers;
// it never rounds a figure the data does not round.
// A figure shows with the record's own decimals only when that loses nothing.
// "No midpoint" is a claim about the company, so it needs the record to say so
// (issuer_states_midpoint: false), and it covers only the record's own figure. A
// midpoint that was simply not captured shows as not recorded. A record that says
// "no midpoint" and also holds one is incomplete.
// The heading names the record's own metric. An optional scope_note says when the
// same company update moved another figure the other way.
const shown=(value,decimals)=>Number.isInteger(decimals)&&decimals>=0&&decimals<=6&&Number(value.toFixed(decimals))===value?value.toFixed(decimals):String(value);
const guidanceUnits={
  usd_per_share:{format:(value,decimals=2)=>`$${shown(value,decimals)}`},
  usd_billion:{format:(value,decimals)=>`$${shown(value,decimals)} billion`},
  percent:{format:(value,decimals)=>`${shown(value,decimals)}%`,change:(value,decimals)=>`${shown(value,decimals)} ${value===1?'percentage point':'percentage points'}`},
};
const dayDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&validDate(value)&&new Date(value).toISOString().slice(0,10)===value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value)):null;
function guidanceBlock(g){
  const finite=Number.isFinite,filled=value=>typeof value==='string'&&value.trim()!=='';
  const pair=range=>Array.isArray(range)&&range.length===2&&range.every(finite)&&range[0]<=range[1];
  const unit=guidanceUnits[g?.unit];
  const statesNone=g?.issuer_states_midpoint===false,holdsStated=[g?.issuer_stated_before_midpoint,g?.issuer_stated_after_midpoint,g?.issuer_stated_delta].some(value=>value!==null&&value!==undefined);
  // "Worldwide sales" reads "worldwide sales" after the colon; "EPS growth" keeps its capitals.
  const heading=filled(g?.metric)?`Company guidance: ${g.metric.trim().replace(/^[A-Z](?=[a-z])/,letter=>letter.toLowerCase())}`:'Company guidance';
  if(!unit||!filled(g.metric)||!filled(g.period)||!pair(g.before_range)||!pair(g.after_range)||!filled(g.source_label)||(statesNone&&holdsStated))return `<h4>${text(heading)}</h4><p>The guidance record for this case is incomplete. Read the company's own release under Sources read. Guidance is the company's own estimate. It does not estimate the stock's return.</p>`;
  const figure=value=>unit.format(value,g.decimals),change=value=>(unit.change||unit.format)(value,g.decimals),word=value=>value>0?'up':'down';
  const moved=(from,to,delta,format)=>delta===0?`stayed at ${format(to)}`:`moved from ${format(from)} to ${format(to)}, ${word(delta)} ${change(Math.abs(delta))}`;
  const statedBefore=g.issuer_stated_before_midpoint,statedAfter=g.issuer_stated_after_midpoint,statedDelta=g.issuer_stated_delta;
  const rangeBefore=g.unrounded_range_midpoint_before,rangeAfter=g.unrounded_range_midpoint_after;
  let midpoint='';
  if([statedBefore,statedAfter,statedDelta].every(finite)){
    midpoint=` The stated midpoint ${moved(statedBefore,statedAfter,statedDelta,figure)}.`;
    const before=finite(rangeBefore)&&rangeBefore!==statedBefore,after=finite(rangeAfter)&&rangeAfter!==statedAfter;
    if(filled(g.midpoint_rounding_note)&&(before||after))midpoint+=` The company rounded ${before&&after?'both midpoints':`its ${before?'earlier':'later'} midpoint`}. ${before&&after?`The ranges themselves give ${figure(rangeBefore)} and ${figure(rangeAfter)}`:`The range itself gives ${figure(before?rangeBefore:rangeAfter)}`}, so the ${change(Math.abs(statedDelta))} ${statedDelta>0?'rise':statedDelta<0?'fall':'change'} is rounded.`;
  }else if([rangeBefore,rangeAfter,g.range_midpoint_change].every(finite))midpoint=` ${statesNone?'The company gives this figure as a range, with no midpoint.':'The company\'s own midpoint for this figure is not recorded here.'} The middle of its range ${moved(rangeBefore,rangeAfter,g.range_midpoint_change,figure)}.`;
  const paragraph=`${g.metric.trim()}${filled(g.metric_gloss)?` (${g.metric_gloss.trim()})`:''} for ${g.period.trim()}, as stated by the company.${g.non_gaap===true?' This is a non-GAAP figure (adjusted by the company, outside standard accounting rules).':''}${midpoint} Source: ${g.source_label.trim()}, linked under Sources read. Guidance is the company's own estimate. It does not estimate the stock's return.`;
  const range=([low,high])=>`${figure(low)} to ${figure(high)}`,stated=value=>dayDate(value)?` · stated ${dayDate(value)}`:'';
  const rows=[['Earlier range',`${range(g.before_range)}${stated(g.before_stated_on)}`],['Later range',`${range(g.after_range)}${stated(g.after_stated_on)}`],...(filled(g.basis)?[['Basis',g.basis.trim()]]:[])];
  return `<h4>${text(heading)}</h4><p>${text(paragraph)}</p>${filled(g.scope_note)?`<p class="guidance-scope">${text(g.scope_note.trim())}</p>`:''}<dl class="guidance-figures">${rows.map(([term,value])=>`<div><dt>${text(term)}</dt><dd>${text(value)}</dd></div>`).join('')}</dl>`;
}
// Owner decision 5: each plain review note keeps its original wording one click
// away, in a closed disclosure right after the plain line. The original is data
// and is always escaped. A copy that matches the plain line adds nothing.
const originalNote=(original,plain,context)=>typeof original==='string'&&original.trim()&&original.trim()!==String(plain??'').trim()?`<details class="original-note"><summary>Original note${context?`<span class="sr-only"> for ${text(context)}</span>`:''}</summary><p>${text(original.trim())}</p></details>`:'';
// review_limits_audit pairs each original with the exact plain line that replaced it.
const limitOriginal=(item,limit)=>(Array.isArray(item.review_limits_audit)?item.review_limits_audit:[]).find(entry=>entry&&typeof entry==='object'&&entry.plain===limit)?.original;
// Source ids such as "ibm_aug14_notes" read as "IBM aug14 notes": the case's own
// ticker is upper-cased; every other id keeps its words.
const sourceLabel=(id,ticker)=>(id.startsWith(`${ticker.toLowerCase()}_`)?`${ticker}${id.slice(ticker.length)}`:id).replaceAll('_',' ');
function sourceLinks(item,snapshot){
  return (item.source_refs||[]).map(id=>{const s=snapshot.sources[id];return s?`<li>${link(s.url,sourceLabel(id,item.ticker))}<span class="source-date">${text(s.published_date||'Publication time not retained')}${s.access_note?` · ${text(s.access_note)}`:''}</span>${s.access_note?originalNote(s.audit_note,s.access_note,sourceLabel(id,item.ticker)):''}</li>`:'';}).join('');
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
  const preview=caseText(item,snapshot);
  return `<article class="card stock-card" aria-label="${text(item.ticker)} case">
    <div class="stock-card-header"><div class="stock-identity"><span class="ticker">${text(item.ticker)}</span><h3>${text(item.company)}</h3></div><span class="tag neutral">Not eligible</span></div>
    <p class="stock-thesis"><strong>Question:</strong> ${text(preview.question)}</p>
    <p class="stock-risk"><strong>Risk:</strong> ${text(preview.risk)}.</p>
    <p class="stock-catalyst"><span aria-hidden="true">◷</span> ${text(timing(item,snapshot,true))}</p>
    <details class="stock-details"><summary>Analysis & sources<span class="sr-only"> for ${text(item.ticker)}</span></summary><div class="expanded-stock">
      <div class="stock-summary"><div><h4>What changed</h4><p>${text(item.what_changed)}</p></div><div><h4>Event timing</h4><p>${text(timing(item,snapshot))}</p></div><div><h4>The case for · analyst interpretation</h4><p>${text(item.positive_case)}</p></div><div><h4>The case against · analyst interpretation</h4><p>${text(item.counter_case)}</p></div></div>
      <h4>What would prove this case wrong?</h4><p>${text(item.invalidation_trigger)}</p>
      <h4>What blocks ranking</h4><ul class="missing-inputs">${item.gate_reasons.map(([id,state])=>`<li><strong>${text(id==='latest_completed_session_OHLCV'?`${sessionDate(snapshot.price_session)} daily prices (OHLCV)`:labels[id]||id)}</strong>: ${text(state.replaceAll('_',' '))}</li>`).join('')}</ul>
      <p>What the market expects is unknown. How the price reacted is unknown. Nobody has tested whether this case predicts returns. The review covers selected sources only. It does not cover every filing. It does not confirm the stock is easy to trade.</p>
      <dl class="stock-metrics"><div><dt>Window start</dt><dd>${text(date(snapshot.window.entry_at))} open</dd></div><div><dt>Window end</dt><dd>${text(date(snapshot.window.exit_at))} close</dd></div><div><dt>Price</dt><dd>Unavailable</dd></div><div><dt>Expected return</dt><dd>Unavailable</dd></div><div><dt>Chance of gain</dt><dd>Unavailable</dd></div></dl>
      <h4>Macro → industry → company update → event → each share</h4><ol class="evidence-chain">${item.evidence_chain.map(step=>`<li><strong>${text(step.link.replaceAll('_',' '))}</strong><span class="chain-kind">${text(step.kind.replaceAll('_',' '))}</span><p>${text(step.text)}</p></li>`).join('')}</ol>
      ${item.research_application?`<h4>How the research notes shape this case</h4><p>${text(item.research_application.concentric_effect)}</p><p>${text(item.research_application.nobel_effect)}</p><p>${text(item.research_application.ordering_effect)}</p><p class="source-date">This mapping draws on the supplied PDF texts and saved public summaries. Nobody fully reviewed their images or the papers they cite. No predictive validation is claimed.</p>`:''}
      ${item.review_limits?.length?`<h4>Review limits</h4><ul>${item.review_limits.map(limit=>`<li>${text(limit)}${originalNote(limitOriginal(item,limit),limit,`${item.ticker} review limit`)}</li>`).join('')}</ul>`:''}
      <h4>Funding and new shares</h4><p>${text(item.funding_check)}</p>
      ${item.guidance?guidanceBlock(item.guidance):''}
      <h4>Sources read</h4><ul class="stock-sources">${sourceLinks(item,snapshot)}</ul><p class="source-date">Research checked ${text(date(snapshot.reviewed_at))}. Some publication times are unknown. Some original files were not saved. Permission to use each source is not fully checked. This case has no rank, price, return or probability.</p>
    </div></details>
${priceSymbols.includes(item.ticker)?`    <button type="button" class="desk-button desk-button-secondary" data-price-symbol="${text(item.ticker)}">Price chart<span class="sr-only"> for ${text(item.ticker)}</span><span aria-hidden="true">→</span></button>\n`:''}  </article>`;
}
function eventCard(item){
  return `<article class="event-item"><details class="event-details"><summary class="event-row"><strong class="event-ticker">${text(item.ticker)}</strong><span class="event-time"><strong>${text(shortDate(item.webcast_at_utc))}</strong><span>Earnings call</span></span><span class="event-toggle">Details</span></summary><div class="event-expanded"><h3>${text(item.name)}</h3><p>${text(item.event_summary)}</p><p>Confirmed webcast · ${item.results_release_at_utc?'release approximately '+text(date(item.results_release_at_utc)):'exact release time not specified'}</p>${link(item.primary_source_url,'Issuer event')}<p class="source-date">Checked ${text(date(item.evidence_checked_at_utc))}</p></div></details></article>`;
}
const hours=value=>`${value} ${value===1?'hour':'hours'}`;
// Source age comes only from the validated projection. A repeated ID or a
// different endpoint kind must never borrow another row's later check.
function sourceChecks(checks,summary){
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const originalValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)&&validDate(value)&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
  const relatedValid=check=>check.related_sources===undefined||(Array.isArray(check.related_sources)&&check.related_sources.every(source=>record(source)&&typeof source.label==='string'&&source.label.trim()&&link(source.url,source.label)));
  const metadataValid=check=>record(check)&&['id','name','status','note'].every(key=>typeof check[key]==='string'&&check[key].trim())&&link(check.url,'Source')&&relatedValid(check);
  if(!Array.isArray(summary?.checks)&&checks.every(check=>metadataValid(check)&&originalValid(check.observed_at)))return `<ul class="source-checks" role="list">${checks.map(check=>`<li><strong>${text(check.name)}</strong> · ${text(check.status)}<p>Observed ${text(date(check.observed_at))}. ${text(check.note)} ${link(check.url,'Source')} ${(check.related_sources||[]).map(source=>link(source.url,source.label)).join(' ')}</p>${originalNote(check.audit_note,check.note,check.name)}</li>`).join('')}</ul>`;
  const clock=value=>originalValid(value)?`<time datetime="${text(value)}">${text(date(value))}</time>`:'Unavailable';
  return `<ul class="source-checks stock-sources" role="list">${checks.map((raw,index)=>{
    const check=record(raw)?raw:{},metadataOK=metadataValid(check);
    const matches=Array.isArray(summary?.checks)?summary.checks.filter(row=>row?.id===check.id):[],row=matches[0];
    const matched=metadataOK&&checks.filter(item=>item?.id===check.id).length===1&&matches.length===1&&row.sourceKind===(check.source_kind||'unclassified')&&row.observedAt===check.observed_at;
    const age=matched?row.captureStatus:null;
    const within=age==='capture_within_age_policy',due=age==='capture_stale';
    const ageLabel=!metadataOK?'Source metadata incomplete':within&&Number.isFinite(row.maxCaptureAgeHours)&&row.maxCaptureAgeHours>0?`Checked within ${hours(row.maxCaptureAgeHours)}`:due?'Check due':'Source timing needs review';
    const latest=matched&&row.lastCheckStatus==='valid'&&(within||due)&&row.lastCheckedAt===row.effectiveObservedAt&&originalValid(row.lastCheckedAt);
    const checkLabel=check.source_kind==='sec_submissions'?'Latest inventory check':check.source_kind==='bls_current_vintage'?'Latest CPI check':'Latest source check';
    const outcome=row?.lastCheckOutcome==='metadata_changed'?'Metadata changed':row?.lastCheckOutcome==='unchanged'?(check.source_kind==='sec_submissions'?'Inventory unchanged':'Compared data unchanged'):'';
    const name=typeof check.name==='string'&&check.name.trim()?check.name:`Source entry ${index+1}`;
    const primary=link(check.url,'Source')||'<span>Source link unavailable.</span>';
    const related=Array.isArray(check.related_sources)?check.related_sources.map(source=>record(source)&&typeof source.label==='string'&&source.label.trim()?link(source.url,source.label)||'<span>Related source link unavailable.</span>':'<span>Related source metadata incomplete.</span>').join(' '):check.related_sources!==undefined?'<span>Related sources incomplete.</span>':'';
    return `<li data-source-id="${text(typeof check.id==='string'?check.id:`unavailable-${index}`)}"><strong>${text(name)}</strong><p>${text(ageLabel)}<br>Original observation: ${clock(check.observed_at)}${latest?`<br>${checkLabel}: ${clock(row.lastCheckedAt)}${outcome?` · ${outcome}`:''}`:''}</p><details class="source-coverage" data-state-key="source-check:${text(typeof check.id==='string'?check.id:'unavailable')}:${index}"><summary>Coverage & sources<span class="sr-only"> for ${text(name)}</span></summary><p>${typeof check.status==='string'?`${text(check.status)}. `:''}${typeof check.note==='string'?text(check.note):'Source coverage could not be read.'} ${primary} ${related}</p>${typeof check.note==='string'?originalNote(check.audit_note,check.note,name):''}</details></li>`;
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
  const one=staleCount===1,single=total===1,clocks=invalidCount+missingCount;
  const description=due?projected?`${staleCount} of ${total} ${single?'source':'sources'} ${one?'needs':'need'} a new check after ${hours(maxCaptureAgeHours)}.`:`${staleCount} of ${total} retained capture ${single?'time':'times'} ${one?'is':'are'} older than ${hours(maxCaptureAgeHours)}.`:incomplete?`${clocks} source ${clocks===1?'clock needs':'clocks need'} review.`:projected?`Source checks are within the ${maxCaptureAgeHours}-hour review interval.`:`Retained capture times are within the ${maxCaptureAgeHours}-hour review interval.`;
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
  // The eligibility line and the review date sit right under the date, so the
  // first phone screen holds them (R-4). The state sentence follows, before the
  // times. Only past or unreadable windows get the amber alert; an upcoming
  // window gets a neutral note.
  // The Prices page lists its own companies. When it has none of a shown case's charts,
  // the desk says so once, instead of a silent missing button on each card.
  const uncharted=priceSymbols.length?hypotheses.filter(item=>!priceSymbols.includes(item.ticker)).map(item=>item.ticker):[];
  const chartGap=!uncharted.length?'':`<p class="chart-gap-note">${uncharted.length===hypotheses.length?`The Prices page has no chart for ${hypotheses.length===1?'this company':'these companies'} yet.`:`The Prices page has no chart yet for ${text(new Intl.ListFormat('en-US',{type:'conjunction'}).format(uncharted))}.`}</p>`;
  const stateLine=snapshot.status==='upcoming'?`<p class="window-note">This window (the trading days this research covers) opens ${text(date(snapshot.window.entry_at))}.</p>`:`<p class="window-alert">${snapshot.status==='in_progress'?`This window (the trading days this research covers) opened ${text(date(snapshot.window.entry_at))}. The cases below were written before it opened. The time to use that opening price has passed. A new window needs a new snapshot (a new review with its own date).`:snapshot.status==='archived'?`This snapshot (a dated review that is not updated) is archived. Its window (the trading days it covered) closed ${text(date(snapshot.window.exit_at))}. Nothing on this page is current. A new window needs a new snapshot.`:'The window dates (the trading days this research covers) could not be read. They need review. Treat every case below as background only. A new window needs a new snapshot (a new review with its own date).'}</p>`;
  return `<div class="stock-desk">
    <section class="window-card card" aria-label="Research window"><div class="window-title"><span class="eyebrow">${text(sessionLabel(snapshot.window))}</span><span class="tag neutral">${text(status)}</span></div><h2>${text(windowTitle(snapshot.window))}</h2>
      <p class="window-eligibility"><strong>No stock is eligible.</strong> Expected return unavailable.</p>
      <p class="window-reviewed">Research checked ${text(date(snapshot.reviewed_at))}.</p>
      ${stateLine}
      <div class="window-times"><div><span>Starts at the open</span><strong>${text(shortDate(snapshot.window.entry_at))}</strong><small>${text(utcDate(snapshot.window.entry_at))}</small></div><span class="window-arrow" aria-hidden="true">→</span><div><span>Ends at the close</span><strong>${text(shortDate(snapshot.window.exit_at))}</strong><small>${text(utcDate(snapshot.window.exit_at))}</small></div></div>
      <details class="eligibility-details"><summary>Why nothing is eligible</summary><div><p><strong>From the snapshot:</strong> ${text(snapshot.conclusion)}</p><p><strong>No ranking yet.</strong> Several checks are not finished. Data on prices and liquidity (how easily shares trade without moving the price) is missing. Share identity and corporate actions (events like splits and dividends that change shares) are not fully checked. Permission to use the sources and full company coverage are not confirmed. There are no expected returns or probabilities.</p><p class="ordering-note">How stocks would be ordered. A stock must first pass every required check. It also needs new company guidance or a dated company event. Then four areas get 0, 1 or 2 points each: business results, the event, price history and the economy. The points make a research score from 0 to 100. Ties stay tied. This rubric is unvalidated. It does not estimate stock returns. These stocks were chosen for convenience. They are not a scan of the whole market.</p><button class="text-button" id="eligibility-method-link" data-go="methodology">How the method works <span aria-hidden="true">→</span></button></div></details>
      <details class="window-details"><summary>Window details and source checks${freshness?.label||''}</summary><div>${freshness?.content||''}<p>A paper trade (a practice trade with no real money) would use this window's opening and closing prices. A real order might fill at another price. ${text(sessionDate(snapshot.price_session,'long'))} close is a historical reference. No prior-close or weekend opening gap is earned.</p><div class="snapshot-meta"><span>Research checked ${text(date(snapshot.reviewed_at))}</span><span>Manual snapshot · source cutoff varies</span><span>Price reference session ${text(sessionDate(snapshot.price_session))} · OHLCV (open, high, low and close prices plus volume) missing</span></div><h3>Data connections</h3><p>Price API awaiting approved access. No automatic collector is active.</p>${sourceChecks(snapshot.source_checks||[],sourceFreshness)}</div></details>
    </section>
    <p class="coverage-strip"><span class="sr-only">Research coverage: </span>${snapshot.roster_count} stocks on the list <span class="coverage-part"><span aria-hidden="true">·</span> ${snapshot.screened_count} partly reviewed</span> <span class="coverage-part"><span aria-hidden="true">·</span> ${snapshot.blocked_count} blocked</span> <span class="coverage-part"><span aria-hidden="true">·</span> 0 eligible</span></p>
    <section aria-labelledby="cases-heading"><div class="section-label-row"><h2 id="cases-heading">Company cases <span class="section-count">${hypotheses.length}</span></h2><span>Alphabetical · unranked</span></div><p class="section-intro">Forecast unavailable for every case. Each one lacks inputs that ranking needs. Open a case to see what is missing.</p>${chartGap}<div class="stock-list">${hypotheses.map(item=>stockCard(item,snapshot,priceSymbols)).join('')||(needle?`<div class="search-empty"><h3>${events.length?'No company case matches this search.':'No matches for this search.'}</h3><p>${events.length?'Matching earnings calls are listed below.':'Try a shorter search, or clear it.'}</p><button class="text-button" data-clear-search>Clear search</button></div>`:'<p>No company cases are listed.</p>')}</div></section>
    <section aria-labelledby="events-heading"><div class="section-label-row"><h2 id="events-heading">${snapshot.status==='upcoming'?'Earnings calls ahead':'Earnings calls in this snapshot'} <span class="section-count">${events.length}</span></h2></div><p class="section-intro">${text(eventIntro)}${events.length?' These dates come from this snapshot. They are not updated. An earnings call can move a stock up or down.':''}</p>${events.length?`<div class="card event-list">${events.map(eventCard).join('')}</div>`:''}</section>
    <details class="card research-context"><summary>Method and economic context</summary><section class="method-application" aria-labelledby="context-heading"><div><span class="eyebrow">How the research shapes these cases</span><h2 id="context-heading">Company facts, checked against economic ideas</h2><p>The step-by-step method links company facts and event dates to what is left for each share. Ideas from Nobel research help us test claims about the economy. They also help us question prices that look wrong and evidence chosen to fit a story. These ideas are background only. No prize proves an investment edge (a lasting advantage over the market) in either window. The timing and funding rules are our own design choices. So is the rule that every case has a case against. The cases are reviewed by hand and listed A to Z. Neither the review nor the order predicts returns.</p><button class="text-button" id="context-method-link" data-go="methodology">How the method works <span aria-hidden="true">→</span></button></div><div class="macro-strip"><strong>Economic context · dated facts</strong>${snapshot.macro_context.map(item=>`<p>${text(item.fact)} ${link(snapshot.sources[item.source_ref]?.url,'Source')}<span>${text(item.interpretation)}</span>${snapshot.sources[item.source_ref]?.type==='BLS'?'<span>BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.</span>':''}</p>`).join('')}</div></section></details>
  </div>`;
}
