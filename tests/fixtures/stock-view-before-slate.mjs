const text=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/New_York',timeZoneName:'short'}).format(new Date(value)):'Unavailable';
const shortDate=value=>value?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/New_York',timeZoneName:'short'}).format(new Date(value)):'Unavailable';
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
  if(c.status==='already_public_not_future_catalyst')return compact?'Oct 13 update · already public':'Oct 13 update already public · no verified new event in this window';
  const when=c.release_at_utc||c.webcast_at_utc;
  const precision=c.release_at_utc?(compact?'approx. release':'approximate release'):(compact?'call':'confirmed webcast; exact release time unknown');
  return `${compact?shortDate(when):date(when)} · ${precision}${snapshot.window.horizon_id==='next_day'?' · after day exit':''}`;
}
function stockCard(item,snapshot){
  const caution=item.ticker==='IBM',preview=previews[item.ticker]||{thesis:'This operating case needs further evidence.',risk:'Operating outlook uncertain'};
  return `<article class="card stock-card" aria-label="${text(item.ticker)} ${caution?'caution case':'operating hypothesis'}">
    <div class="stock-card-header"><div class="stock-identity"><span class="ticker">${text(item.ticker)}</span><h3>${text(item.company)}</h3></div><span class="tag ${caution?'caution':'neutral'}">${caution?'Caution':'Unranked'}</span></div>
    <p class="stock-thesis">${text(preview.thesis)}</p>
    <p class="stock-catalyst"><span aria-hidden="true">◷</span> ${text(timing(item,snapshot,true))}</p>
    <p class="stock-risk"><strong>Risk:</strong> ${text(preview.risk)} · Required inputs missing.</p>
    <p class="stock-status">${snapshot.window.horizon_id==='next_day'?'No next-day selection':'Not eligible'} · Forecast unavailable</p>
    <details class="stock-details"><summary>Analysis & sources<span class="sr-only"> for ${text(item.ticker)}</span></summary><div class="expanded-stock">
      <div class="stock-summary"><div><h4>What changed</h4><p>${text(item.what_changed)}</p></div><div><h4>Why this window</h4><p>${text(timing(item,snapshot))}</p></div><div><h4>Favorable test · analyst interpretation</h4><p>${text(item.positive_case)}</p></div><div><h4>DOWNSIDE / COUNTER-CASE</h4><p>${text(item.counter_case)}</p></div></div>
      <h4>What would invalidate the thesis?</h4><p>${text(item.invalidation_trigger)}</p>
      <h4>Inputs blocking ranking</h4><ul class="missing-inputs">${item.gate_reasons.map(([id,state])=>`<li><strong>${text(labels[id]||id)}</strong>: ${text(state.replaceAll('_',' '))}</li>`).join('')}</ul>
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
export function renderStockView(snapshot,query=''){
  if(!snapshot)return `<section class="card stock-empty"><h2>Stock research unavailable</h2><p>The candidate evidence could not be loaded. Prices, ranks and return estimates remain unavailable.</p></section>`;
  const needle=typeof query==='string'?query.trim().toLowerCase():'';
  const exactTicker=[...snapshot.hypotheses,...snapshot.event_watch].some(item=>item.ticker.toLowerCase()===needle);
  const matches=item=>!needle||(exactTicker?item.ticker.toLowerCase()===needle:JSON.stringify(item).toLowerCase().includes(needle));
  const hypotheses=snapshot.hypotheses.filter(matches),events=snapshot.event_watch.filter(matches).sort((a,b)=>Date.parse(a.webcast_at_utc)-Date.parse(b.webcast_at_utc)),day=snapshot.window.horizon_id==='next_day';
  const status={upcoming:'Upcoming',in_progress:'Window in progress',archived:'Archived snapshot',unavailable:'Window unavailable'}[snapshot.status];
  return `<div class="stock-desk">
    <section class="window-card card" aria-label="Exact holding window"><div class="window-title"><span class="eyebrow">${day?'NEXT-DAY TARGET':'FIVE-SESSION TARGET'}</span><span class="tag neutral">${text(status)}</span></div><h2>${day?'October 19, 2026':'October 19–23, 2026'}</h2>
      <div class="window-times"><div><span>ENTRY · OPEN</span><strong>${text(shortDate(snapshot.window.entry_at))}</strong><small>2026-10-19 13:30 UTC</small></div><span class="window-arrow" aria-hidden="true">→</span><div><span>EXIT · CLOSE</span><strong>${text(shortDate(snapshot.window.exit_at))}</strong><small>${day?'2026-10-19':'2026-10-23'} 20:00 UTC</small></div></div>
      ${snapshot.status!=='upcoming'?`<p class="window-alert">${snapshot.status==='in_progress'?'The original entry has passed. These cards do not offer a new entry at the old open.':'This slate is archived and must not be treated as a current opportunity.'} A new entry requires a new snapshot.</p>`:''}
      <details class="window-details"><summary>Window & data status</summary><div><p>Prospective open-to-close simulation references; fills are not guaranteed. October 16 close is a historical reference. No prior-close or weekend opening gap is earned.</p><div class="snapshot-meta"><span>Research checked ${text(date(snapshot.reviewed_at))}</span><span>Manual snapshot · source cutoff varies</span><span>Price reference session Oct 16 · OHLCV missing</span></div><h3>Data connections</h3><p>Price API awaiting approved access. No automatic collector is active.</p><ul class="source-checks">${(snapshot.source_checks||[]).map(check=>`<li><strong>${text(check.name)}</strong> · ${text(check.status)}<p>Observed ${text(date(check.observed_at))}. ${text(check.note)} ${link(check.url,'Source')} ${(check.related_sources||[]).map(source=>link(source.url,source.label)).join(' ')}</p></li>`).join('')}</ul></div></details>
    </section>
    <p class="coverage-strip" aria-label="Research coverage">${snapshot.roster_count}-stock roster <span>·</span> ${snapshot.screened_count} partial reviews <span>·</span> ${snapshot.blocked_count} blocked <span>·</span> 0 eligible</p>
    <section class="stock-shortlist" aria-label="Ranked upside candidates"><div class="card stock-empty"><h2>No eligible selection</h2><p>Expected return unavailable. Prices, liquidity and source-rights checks are incomplete.</p><details class="eligibility-details"><summary>Why no picks?</summary><div><p>${text(snapshot.conclusion)}</p><p><strong>Ranking unavailable:</strong> prices, liquidity, security/actions, source rights and full company coverage remain incomplete. Expected returns and probabilities are unavailable.</p><p class="ordering-note">Proposed research order. After required gates and a qualifying evidence route pass, fundamentals, catalyst, price action and macro each receive 0–2 reviewed points. Their equally weighted research score runs from 0 to 100. Ties stay tied. This unvalidated rubric does not estimate stock returns. The roster is a convenience sample, not a market-wide screen.</p></div></details></div></section>
    <section aria-label="Operating hypotheses"><div class="section-label-row"><h2>Stocks to investigate <span class="section-count">${hypotheses.length}</span></h2><span>Alphabetical · unranked</span></div><div class="stock-list">${hypotheses.map(item=>stockCard(item,snapshot)).join('')||'<p>No matching stocks.</p>'}</div></section>
    <section aria-label="Event watch"><div class="section-label-row"><h2>${day&&events.length?'After the day window':'Event watch'} <span class="section-count">${events.length}</span></h2></div><p class="section-intro">${!events.length?'No matching event dates.':day?'Outside the day window.':'Within the selected window.'} New York webcast times · two-sided events, not bullish picks.</p><div class="card event-list">${events.map(eventCard).join('')||'<p>No matching events.</p>'}</div></section>
    <details class="card research-context"><summary>Method & macro context</summary><section class="method-application"><div><span class="eyebrow">HOW THE RESEARCH CHANGES SELECTION</span><h2>Company evidence, through both research lenses</h2><p>The retained concentric method connects company evidence, event timing and per-share economics. Cribscore applies ideas from Nobel research to question macro causality, apparent mispricing and selective use of evidence. The counter-case, timing and funding rules are product design choices. Current cards are hand-reviewed and alphabetical; neither input establishes a one-day or five-session return signal.</p><button class="text-button" data-go="methodology">Why this method? ↗</button></div><div class="macro-strip"><strong>Macro context · dated facts</strong>${snapshot.macro_context.map(item=>`<p>${text(item.fact)} ${link(snapshot.sources[item.source_ref]?.url,'Source')}<span>${text(item.interpretation)}</span></p>`).join('')}</div></section></details>
  </div>`;
}
