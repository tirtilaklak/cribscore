const text=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/New_York',timeZoneName:'short'}).format(new Date(value)):'Unavailable';
const shortDate=value=>value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/New_York',timeZoneName:'short'}).format(new Date(value)):'Unavailable';
const link=(url,label)=>{try{const u=new URL(url);return u.protocol==='https:'?`<a class="source-link" href="${text(u.href)}" target="_blank" rel="noopener noreferrer">${text(label)} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`:'';}catch{return '';}};
const labels={identity:'Security identity',prices_actions:'Prices and corporate actions',company_evidence:'Latest company evidence',latest_completed_session_OHLCV:'Oct 16 daily prices (OHLCV)','60_session_consolidated_liquidity':'Liquidity over the last 60 trading days',corporate_actions_security_master:'Security identity and corporate actions',quote_display_rights:'Permission to show market data',all_latest_required_filings_and_later_material_announcements:'Complete filing and announcement coverage'};

// Mirrors the live renderer: each case carries its own question and main risk,
// shown only for the review they were written for (case_text_review_at).
const caseFallback={question:'What evidence would move this case?',risk:'Operating outlook uncertain'};
function caseText(item,snapshot){
  const filled=value=>typeof value==='string'&&value.trim()!=='';
  return filled(item.case_question)&&filled(item.main_risk)&&typeof item.case_text_review_at==='string'&&item.case_text_review_at===snapshot.reviewed_at?{question:item.case_question.trim(),risk:item.main_risk.trim()}:caseFallback;
}
// Mirrors the live renderer: company guidance comes only from the guidance record.
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
// A figure shows with the record's own decimals only when that loses nothing.
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
function sourceLinks(item,snapshot){
  const label=id=>(id.startsWith(`${item.ticker.toLowerCase()}_`)?`${item.ticker}${id.slice(item.ticker.length)}`:id).replaceAll('_',' ');
  return (item.source_refs||[]).map(id=>{const s=snapshot.sources[id];return s?`<li>${link(s.url,label(id))}<span class="source-date">${text(s.published_date||'Publication time not retained')}${s.access_note?` · ${text(s.access_note)}`:''}</span></li>`:'';}).join('');
}
function timing(item,snapshot,compact=false){
  const c=item.catalyst;
  if(c.status==='already_public_not_future_catalyst')return compact?'Oct 13 update · already public':'Oct 13 update already public · no verified new event in this window';
  const when=c.release_at_utc||c.webcast_at_utc;
  const precision=c.release_at_utc?(compact?'results about then':'results expected about then'):(compact?'earnings call':'earnings call confirmed · results time not given');
  return `${compact?shortDate(when):date(when)} · ${precision}${snapshot.window.horizon_id==='next_day'?' · after the window':''}`;
}
function stockCard(item,snapshot){
  const preview=caseText(item,snapshot);
  return `<article class="card stock-card" aria-label="${text(item.ticker)} case">
    <div class="stock-card-header"><div class="stock-identity"><span class="ticker">${text(item.ticker)}</span><h3>${text(item.company)}</h3></div><span class="tag neutral">Not eligible</span></div>
    <p class="stock-thesis"><strong>Question:</strong> ${text(preview.question)}</p>
    <p class="stock-risk"><strong>Risk:</strong> ${text(preview.risk)}.</p>
    <p class="stock-catalyst"><span aria-hidden="true">◷</span> ${text(timing(item,snapshot,true))}</p>
    <details class="stock-details"><summary>Analysis & sources<span class="sr-only"> for ${text(item.ticker)}</span></summary><div class="expanded-stock">
      <div class="stock-summary"><div><h4>What changed</h4><p>${text(item.what_changed)}</p></div><div><h4>Event timing</h4><p>${text(timing(item,snapshot))}</p></div><div><h4>The case for · analyst interpretation</h4><p>${text(item.positive_case)}</p></div><div><h4>The case against · analyst interpretation</h4><p>${text(item.counter_case)}</p></div></div>
      <h4>What would prove this case wrong?</h4><p>${text(item.invalidation_trigger)}</p>
      <h4>What blocks ranking</h4><ul class="missing-inputs">${item.gate_reasons.map(([id,state])=>`<li><strong>${text(labels[id]||id)}</strong>: ${text(state.replaceAll('_',' '))}</li>`).join('')}</ul>
      <p>What the market expects is unknown. How the price reacted is unknown. Nobody has tested whether this case predicts returns. The review covers selected sources only. It does not cover every filing. It does not confirm the stock is easy to trade.</p>
      <dl class="stock-metrics"><div><dt>Window start</dt><dd>${text(date(snapshot.window.entry_at))} open</dd></div><div><dt>Window end</dt><dd>${text(date(snapshot.window.exit_at))} close</dd></div><div><dt>Price</dt><dd>Unavailable</dd></div><div><dt>Expected return</dt><dd>Unavailable</dd></div><div><dt>Chance of gain</dt><dd>Unavailable</dd></div></dl>
      <h4>Macro → industry → company update → event → each share</h4><ol class="evidence-chain">${item.evidence_chain.map(step=>`<li><strong>${text(step.link.replaceAll('_',' '))}</strong><span class="chain-kind">${text(step.kind.replaceAll('_',' '))}</span><p>${text(step.text)}</p></li>`).join('')}</ol>
      ${item.research_application?`<h4>How the research notes shape this case</h4><p>${text(item.research_application.concentric_effect)}</p><p>${text(item.research_application.nobel_effect)}</p><p>${text(item.research_application.ordering_effect)}</p><p class="source-date">This mapping draws on the supplied PDF texts and saved public summaries. Nobody fully reviewed their images or the papers they cite. No predictive validation is claimed.</p>`:''}
      ${item.review_limits?.length?`<h4>Review limits</h4><ul>${item.review_limits.map(limit=>`<li>${text(limit)}</li>`).join('')}</ul>`:''}
      <h4>Funding and new shares</h4><p>${text(item.funding_check)}</p>
      ${item.guidance?guidanceBlock(item.guidance):''}
      <h4>Sources read</h4><ul class="stock-sources">${sourceLinks(item,snapshot)}</ul><p class="source-date">Research checked ${text(date(snapshot.reviewed_at))}. Some publication times are unknown. Some original files were not saved. Permission to use each source is not fully checked. This case has no rank, price, return or probability.</p>
    </div></details>
  </article>`;
}
function eventCard(item){
  return `<article class="event-item"><details class="event-details"><summary class="event-row"><strong class="event-ticker">${text(item.ticker)}</strong><span class="event-time"><strong>${text(shortDate(item.webcast_at_utc))}</strong><span>Earnings call</span></span><span class="event-toggle">Details</span></summary><div class="event-expanded"><h3>${text(item.name)}</h3><p>${text(item.event_summary)}</p><p>Confirmed webcast · ${item.results_release_at_utc?'release approximately '+text(date(item.results_release_at_utc)):'exact release time not specified'}</p>${link(item.primary_source_url,'Issuer event')}<p class="source-date">Checked ${text(date(item.evidence_checked_at_utc))}</p></div></details></article>`;
}
export function renderStockView(snapshot,query=''){
  if(!snapshot)return `<section class="card stock-empty"><h2>Stock research unavailable</h2><p>The candidate evidence could not be loaded. Prices, ranks and return estimates remain unavailable.</p></section>`;
  const needle=typeof query==='string'?query.trim().toLowerCase():'';
  const exactTicker=[...snapshot.hypotheses,...snapshot.event_watch].some(item=>item.ticker.toLowerCase()===needle);
  const matches=item=>!needle||(exactTicker?item.ticker.toLowerCase()===needle:JSON.stringify(item).toLowerCase().includes(needle));
  const hypotheses=snapshot.hypotheses.filter(matches),events=snapshot.event_watch.filter(matches).sort((a,b)=>Date.parse(a.webcast_at_utc)-Date.parse(b.webcast_at_utc)),day=snapshot.window.horizon_id==='next_day';
  const status={upcoming:'Upcoming',in_progress:'Window in progress',archived:'Archived snapshot',unavailable:'Window unavailable'}[snapshot.status];
  return `<div class="stock-desk">
    <section class="window-card card" aria-label="Research window"><div class="window-title"><span class="eyebrow">${day?'1 trading day':'5 trading days'}</span><span class="tag neutral">${text(status)}</span></div><h2>${day?'October 19, 2026':'October 19–23, 2026'}</h2>
      <p class="window-eligibility"><strong>No stock is eligible.</strong> Expected return unavailable.</p>
      <p class="window-reviewed">Research checked ${text(date(snapshot.reviewed_at))}.</p>
      ${snapshot.status==='upcoming'?`<p class="window-note">This window (the trading days this research covers) opens ${text(date(snapshot.window.entry_at))}.</p>`:`<p class="window-alert">${snapshot.status==='in_progress'?`This window (the trading days this research covers) opened ${text(date(snapshot.window.entry_at))}. The cases below were written before it opened. The time to use that opening price has passed. A new window needs a new snapshot (a new review with its own date).`:`This snapshot (a dated review that is not updated) is archived. Its window (the trading days it covered) closed ${text(date(snapshot.window.exit_at))}. Nothing on this page is current. A new window needs a new snapshot.`}</p>`}
      <div class="window-times"><div><span>Starts at the open</span><strong>${text(shortDate(snapshot.window.entry_at))}</strong><small>2026-10-19 13:30 UTC</small></div><span class="window-arrow" aria-hidden="true">→</span><div><span>Ends at the close</span><strong>${text(shortDate(snapshot.window.exit_at))}</strong><small>${day?'2026-10-19':'2026-10-23'} 20:00 UTC</small></div></div>
      <details class="eligibility-details"><summary>Why nothing is eligible</summary><div><p><strong>From the snapshot:</strong> ${text(snapshot.conclusion)}</p><p><strong>No ranking yet.</strong> Several checks are not finished. Data on prices and liquidity (how easily shares trade without moving the price) is missing. Share identity and corporate actions (events like splits and dividends that change shares) are not fully checked. Permission to use the sources and full company coverage are not confirmed. There are no expected returns or probabilities.</p><p class="ordering-note">How stocks would be ordered. A stock must first pass every required check. It also needs new company guidance or a dated company event. Then four areas get 0, 1 or 2 points each: business results, the event, price history and the economy. The points make a research score from 0 to 100. Ties stay tied. This rubric is unvalidated. It does not estimate stock returns. These stocks were chosen for convenience. They are not a scan of the whole market.</p><button class="text-button" id="eligibility-method-link" data-go="methodology">How the method works <span aria-hidden="true">→</span></button></div></details>
      <details class="window-details"><summary>Window details and source checks</summary><div><p>A paper trade (a practice trade with no real money) would use this window's opening and closing prices. A real order might fill at another price. October 16 close is a historical reference. No prior-close or weekend opening gap is earned.</p><div class="snapshot-meta"><span>Research checked ${text(date(snapshot.reviewed_at))}</span><span>Manual snapshot · source cutoff varies</span><span>Price reference session Oct 16 · OHLCV (open, high, low and close prices plus volume) missing</span></div><h3>Data connections</h3><p>Price API awaiting approved access. No automatic collector is active.</p><ul class="source-checks" role="list">${(snapshot.source_checks||[]).map(check=>`<li><strong>${text(check.name)}</strong> · ${text(check.status)}<p>Observed ${text(date(check.observed_at))}. ${text(check.note)} ${link(check.url,'Source')} ${(check.related_sources||[]).map(source=>link(source.url,source.label)).join(' ')}</p></li>`).join('')}</ul></div></details>
    </section>
    <p class="coverage-strip"><span class="sr-only">Research coverage: </span>${snapshot.roster_count} stocks on the list <span class="coverage-part"><span aria-hidden="true">·</span> ${snapshot.screened_count} partly reviewed</span> <span class="coverage-part"><span aria-hidden="true">·</span> ${snapshot.blocked_count} blocked</span> <span class="coverage-part"><span aria-hidden="true">·</span> 0 eligible</span></p>
    <section aria-labelledby="cases-heading"><div class="section-label-row"><h2 id="cases-heading">Company cases <span class="section-count">${hypotheses.length}</span></h2><span>Alphabetical · unranked</span></div><p class="section-intro">Forecast unavailable for every case. Each one lacks inputs that ranking needs. Open a case to see what is missing.</p><div class="stock-list">${hypotheses.map(item=>stockCard(item,snapshot)).join('')||(needle?`<div class="search-empty"><h3>${events.length?'No company case matches this search.':'No matches for this search.'}</h3><p>${events.length?'Matching earnings calls are listed below.':'Try a shorter search, or clear it.'}</p><button class="text-button" data-clear-search>Clear search</button></div>`:'<p>No company cases are listed.</p>')}</div></section>
    <section aria-labelledby="events-heading"><div class="section-label-row"><h2 id="events-heading">${snapshot.status==='upcoming'?'Earnings calls ahead':'Earnings calls in this snapshot'} <span class="section-count">${events.length}</span></h2></div><p class="section-intro">${!events.length?'No matching event dates.':day?'All of these calls fall after this window.':'All of these calls fall inside this window.'}${events.length?' These dates come from this snapshot. They are not updated. An earnings call can move a stock up or down.':''}</p>${events.length?`<div class="card event-list">${events.map(eventCard).join('')}</div>`:''}</section>
    <details class="card research-context"><summary>Method and economic context</summary><section class="method-application" aria-labelledby="context-heading"><div><span class="eyebrow">How the research shapes these cases</span><h2 id="context-heading">Company facts, checked against economic ideas</h2><p>The step-by-step method links company facts and event dates to what is left for each share. Ideas from Nobel research help us test claims about the economy. They also help us question prices that look wrong and evidence chosen to fit a story. These ideas are background only. No prize proves an investment edge (a lasting advantage over the market) in either window. The timing and funding rules are our own design choices. So is the rule that every case has a case against. The cases are reviewed by hand and listed A to Z. Neither the review nor the order predicts returns.</p><button class="text-button" id="context-method-link" data-go="methodology">How the method works <span aria-hidden="true">→</span></button></div><div class="macro-strip"><strong>Economic context · dated facts</strong>${snapshot.macro_context.map(item=>`<p>${text(item.fact)} ${link(snapshot.sources[item.source_ref]?.url,'Source')}<span>${text(item.interpretation)}</span>${snapshot.sources[item.source_ref]?.type==='BLS'?'<span>BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.</span>':''}</p>`).join('')}</div></section></details>
  </div>`;
}
