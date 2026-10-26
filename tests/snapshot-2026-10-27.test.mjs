// The snapshot for the window Tue 27 Oct to Mon 2 Nov 2026, read from dist/data/stock-evidence.json.
// Clocks come from the snapshot's own horizons, so each rule is checked in all three window states.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';
import {renderStockView as frozenView} from './fixtures/stock-view-before-slate.mjs';
import {summarizeSourceChecks,assessSourceCheck} from '../dist/lib/source-freshness.js';
import {createDeskTools} from '../dist/lib/desk-tools.js';
import {hostedSymbol,hostedChartURL} from '../dist/lib/hosted-chart.js';

const payload=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
const retained=JSON.parse(await readFile(new URL('./fixtures/stock-evidence-2026-10-16.json',import.meta.url),'utf8'));
const viewSource=await readFile(new URL('../dist/lib/stock-view.js',import.meta.url),'utf8');
const frozenSource=await readFile(new URL('./fixtures/stock-view-before-slate.mjs',import.meta.url),'utf8');
const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const text=node=>typeof node==='string'?node:node.children.map(text).join('');
const hasClass=(node,name)=>(node.attrs?.class||'').split(/\s+/).includes(name);
const byClass=(root,name)=>all(root,node=>hasClass(node,name));
const visible=node=>typeof node==='string'?node:node.tag==='details'?node.children.filter(child=>typeof child!=='string'&&child.tag==='summary').map(visible).join(' '):node.children.map(visible).join('');
// The guidance heading names the record's own metric, written in lower case after the colon unless it starts with capitals.
const guidanceHeading=g=>`Company guidance: ${g.metric.replace(/^[A-Z](?=[a-z])/,letter=>letter.toLowerCase())}`;

const operating=payload.operating_evidence,events=payload.event_evidence,h=events.horizons;
const cases=[...operating.hypotheses,...operating.caution_watch];
const shift=(value,ms)=>new Date(Date.parse(value)+ms).toISOString();
const clocks={upcoming:shift(h.entry_at_utc,-3600000),in_progress:shift(h.entry_at_utc,60000),archived:shift(h.week_exit_at_utc,60000)};
const snap=(horizon,state)=>buildStockSnapshot(payload,horizon,clocks[state]);
const states=[];
for(const horizon of ['next_day','next_week'])for(const state of Object.keys(clocks))states.push({horizon,state});
const rankingWords=/\b(?:top pick|picks?|ranked|upside|buy|sell|winner|outperform|price target)\b/i;

test('window: entry Tue 27 Oct 13:30 UTC, day exit 20:00 UTC, week exit Mon 2 Nov at 21:00 UTC after daylight saving ends',()=>{
  // The review ran during the Monday, October 26 session, so the last completed session is Friday, October 23.
  assert.equal(h.last_completed_regular_session,'2026-10-23');assert.equal(h.next_trading_day,'2026-10-27');
  assert.equal(events.market_as_of_date,'2026-10-23');assert.equal(operating.market_session_reference,'2026-10-23');
  assert.ok(Date.parse(`${h.last_completed_regular_session}T20:00:00Z`)<=Date.parse(operating.checked_at_utc),'the stated last session closed before the review');
  assert.ok(Date.parse('2026-10-26T13:30:00Z')<=Date.parse(operating.checked_at_utc)&&Date.parse(operating.checked_at_utc)<Date.parse('2026-10-26T20:00:00Z'),'the review ran while the October 26 session was open, so October 26 is not a completed session');
  assert.doesNotMatch(JSON.stringify(payload),/published after the (?:Monday, )?October 26 close|October 26 close is a historical reference|Oct 26 close is only/,'nothing claims the October 26 session had closed');
  assert.equal(h.entry_at_utc,'2026-10-27T13:30:00Z');assert.equal(h.day_exit_at_utc,'2026-10-27T20:00:00Z');assert.equal(h.week_exit_at_utc,'2026-11-02T21:00:00Z');
  assert.deepEqual(h.session_dates,['2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-02']);
  assert.equal(h.sessions.length,5);
  assert.deepEqual(h.sessions.map(s=>s.date),h.session_dates);
  for(const s of h.sessions){
    assert.ok([1,2,3,4,5].includes(new Date(`${s.date}T12:00:00Z`).getUTCDay()),`${s.date} is a weekday`);
    const local=value=>new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/New_York'}).format(new Date(value));
    assert.equal(local(s.open_utc),'09:30',`${s.date} opens 09:30 New York time`);assert.equal(local(s.close_utc),'16:00',`${s.date} closes 16:00 New York time`);
  }
  assert.equal(h.sessions[0].open_utc,h.entry_at_utc);assert.equal(h.sessions[0].close_utc,h.day_exit_at_utc);
  assert.equal(h.sessions[4].open_utc,'2026-11-02T14:30:00Z');assert.equal(h.sessions[4].close_utc,h.week_exit_at_utc);
  const zone=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'short'}).formatToParts(new Date(h.week_exit_at_utc)).find(p=>p.type==='timeZoneName').value;
  assert.equal(zone,'EST','the last session is on standard time');
  assert.deepEqual([operating.horizons.next_day_entry_at_utc,operating.horizons.next_day_exit_at_utc,operating.horizons.week_entry_at_utc,operating.horizons.week_exit_at_utc,operating.horizons.expires_at_utc],[h.entry_at_utc,h.day_exit_at_utc,h.entry_at_utc,h.week_exit_at_utc,h.week_exit_at_utc]);
  assert.ok(Date.parse(operating.checked_at_utc)<Date.parse(h.entry_at_utc),'research is checked before the window opens');
  assert.equal(events.research_checked_at_utc,operating.checked_at_utc);
  // The 21:00 UTC close holds: at 20:00 UTC on Nov 2 the week is still in progress.
  assert.equal(buildStockSnapshot(payload,'next_week','2026-11-02T20:00:00Z').status,'in_progress');
  assert.equal(buildStockSnapshot(payload,'next_week','2026-11-02T20:59:59Z').status,'in_progress');
  assert.equal(buildStockSnapshot(payload,'next_week','2026-11-02T21:00:00Z').status,'archived');
  assert.equal(buildStockSnapshot(payload,'next_day','2026-10-27T13:29:59Z').status,'upcoming');
  assert.equal(buildStockSnapshot(payload,'next_day','2026-10-27T13:30:00Z').status,'in_progress');
  assert.equal(buildStockSnapshot(payload,'next_day','2026-10-27T20:00:00Z').status,'archived');
  const week=renderStockView(snap('next_week','upcoming')),day=renderStockView(snap('next_day','upcoming'));
  assert.match(week,/<small>2026-10-27 13:30 UTC<\/small>/);assert.match(week,/<small>2026-11-02 21:00 UTC<\/small>/);assert.match(week,/Nov 2, 16:00 EST/);
  assert.match(week,/<h2>October 27, 2026 – November 2, 2026<\/h2>/);
  assert.match(day,/<small>2026-10-27 20:00 UTC<\/small>/);assert.match(day,/<h2>October 27, 2026<\/h2>/);
  assert.match(week,/Price reference session Oct 23/);assert.match(week,/October 23 close is a historical reference/);
});

test('every case and event row keeps price, rank, return and probability null, and nothing is eligible',()=>{
  assert.equal(cases.length,9);assert.equal(operating.ranked_count,0);assert.equal(operating.predictive_status,'unvalidated');
  assert.equal(operating.screened_count,cases.length);assert.equal(operating.blocked_count,cases.length);
  assert.equal(operating.publication_gates.ranked_upside_list,'blocked');
  assert.equal(operating.publication_gates.latest_completed_session_OHLCV,'missing');
  assert.equal(operating.publication_gates['60_session_consolidated_liquidity'],'missing');
  assert.equal(operating.publication_gates.all_latest_required_filings_and_later_material_announcements,'partial_review_only');
  for(const c of cases){
    for(const field of ['rank','expected_return','gain_probability','price_reference'])assert.equal(c[field],null,`${c.ticker}.${field}`);
    for(const field of ['day_eligible','week_rank_eligible','ready_to_trade','liquidity_verified'])assert.equal(c[field],false,`${c.ticker}.${field}`);
    assert.equal(c.market_expectations,'unavailable');
  }
  for(const e of events.candidates){
    for(const field of ['last_price','expected_return_next_day','expected_return_next_week','rank_next_day','rank_next_week'])assert.equal(e[field],null,`${e.ticker}.${field}`);
    assert.equal(e.liquidity_verified,false);assert.equal(e.directional_signal,'not_established');
  }
  assert.equal(events.horizons.entry_reference_price,null);assert.equal(operating.quote_attempts.last_price,null);
  for(const {horizon,state} of states){
    const s=snap(horizon,state);
    assert.deepEqual(s.candidates,[]);assert.equal(s.price_available,false);
    for(const c of s.hypotheses)for(const field of ['rank','expected_return','gain_probability','price_reference'])assert.equal(c[field],null);
    for(const e of s.event_watch)assert.equal(e.rank,null);
    assert.equal(s.roster_count,new Set([...s.hypotheses,...s.event_watch].map(x=>x.ticker)).size);
  }
});

test('every fact source is in sources, with an https link and its own retrieval and check times',()=>{
  const sources=operating.sources;
  const https=url=>{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password;};
  for(const [id,s] of Object.entries(sources))assert.ok(https(s.url),id);
  for(const c of cases){
    assert.ok(c.source_refs.length>0,c.ticker);
    for(const ref of c.source_refs)assert.ok(Object.hasOwn(sources,ref),`${c.ticker} cites ${ref}`);
    for(const step of c.evidence_chain)for(const ref of step.source_refs||[])assert.ok(c.source_refs.includes(ref),`${c.ticker} ${step.link} cites ${ref}`);
    if(c.guidance)assert.ok(c.source_refs.includes(c.guidance.source_ref),`${c.ticker} guidance source`);
    const own=c.source_refs.filter(ref=>ref.startsWith(`${c.ticker.toLowerCase()}_`));
    assert.equal(own.length,c.source_refs.length,`${c.ticker} cites only its own company sources`);
    for(const ref of own){
      const s=sources[ref];
      assert.match(s.retrieved_at_utc,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,ref);assert.match(s.verified_at_utc,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,ref);
      assert.ok(Date.parse(s.retrieved_at_utc)<=Date.parse(s.verified_at_utc),`${ref} was checked after it was read`);
      assert.ok(Date.parse(s.verified_at_utc)<=Date.parse(operating.checked_at_utc),`${ref} was checked before publication`);
    }
  }
  for(const m of operating.macro_context){assert.ok(Object.hasOwn(sources,m.source_ref),m.source_ref);if(m.calendar_source_ref)assert.ok(Object.hasOwn(sources,m.calendar_source_ref),m.calendar_source_ref);}
  const urls=new Set(Object.values(sources).map(s=>s.url));
  for(const e of events.candidates){
    assert.ok(urls.has(e.primary_source_url),`${e.ticker} event source`);
    if(e.corroborating_primary_source_url)assert.ok(urls.has(e.corroborating_primary_source_url),`${e.ticker} second event source`);
    assert.ok(Date.parse(e.evidence_retrieved_at_utc)<=Date.parse(e.evidence_verified_at_utc));
    assert.ok(Date.parse(e.evidence_checked_at_utc)<=Date.parse(operating.checked_at_utc),`${e.ticker} event page rechecked before publication`);
  }
  assert.deepEqual(events.candidates.map(e=>e.ticker).toSorted(),cases.map(c=>c.ticker).toSorted(),'each case has its company event');
  const summary=summarizeSourceChecks(operating.source_checks,{at:operating.checked_at_utc,maxCaptureAgeHours:12});
  assert.equal(summary.invalidCount,0);assert.equal(summary.missingCount,0);assert.equal(new Set(operating.source_checks.map(c=>c.id)).size,operating.source_checks.length);
  for(const check of operating.source_checks){
    assert.ok(https(check.url),check.id);
    if(check.last_check)assert.equal(assessSourceCheck(check,{at:operating.checked_at_utc,maxCaptureAgeHours:12}).lastCheckStatus,'valid',check.id);
  }
});

test('event boundary: Coca-Cola reports before entry and gets no in-window badge; eight calls sit inside the week',()=>{
  const ko=cases.find(c=>c.ticker==='KO');
  assert.equal(ko.catalyst.in_holding_window,false);assert.ok(Date.parse(ko.catalyst.webcast_at_utc)<Date.parse(h.entry_at_utc));
  assert.equal(events.candidates.find(e=>e.ticker==='KO').next_week_event,false);
  for(const c of cases.filter(c=>c.ticker!=='KO')){
    assert.equal(c.catalyst.in_holding_window,true,c.ticker);
    const at=Date.parse(c.catalyst.release_at_utc||c.catalyst.webcast_at_utc);
    assert.ok(at>Date.parse(h.entry_at_utc)&&at<Date.parse(h.week_exit_at_utc),c.ticker);
  }
  assert.equal(events.next_day_specific_evidence.verified_during_regular_session_events_in_this_set,0);
  for(const e of events.candidates)assert.equal(e.next_day_regular_session_event,false,e.ticker);
  const week=snap('next_week','upcoming'),day=snap('next_day','upcoming');
  assert.deepEqual(week.event_watch.filter(e=>e.position!=='in_window').map(e=>e.ticker),['KO']);
  assert.ok(day.event_watch.every(e=>e.ticker==='KO'?e.position==='before_entry':e.position==='after_exit'));
  const dom=parse(renderStockView(week)),koCard=byClass(dom,'stock-card').find(card=>text(byClass(card,'ticker')[0])==='KO');
  assert.match(text(byClass(koCard,'stock-catalyst')[0]),/before the window$/);
  assert.equal(text(byClass(dom,'section-intro').find(node=>!text(node).startsWith('Forecast'))).split('.')[0],'Some calls fall outside this window');
  assert.equal(text(byClass(parse(renderStockView(day)),'section-intro').find(node=>!text(node).startsWith('Forecast'))).split('.')[0],'None of these calls fall inside this window');
});

test('company guidance renders from each case\'s guidance record, with no figures in the renderer',()=>{
  const withGuidance=cases.filter(c=>c.guidance);
  assert.deepEqual(withGuidance.map(c=>c.ticker).toSorted(),['GOOGL','KO','MRK','MSFT','XOM']);
  const shown=(g,value)=>{const d=g.decimals??(g.unit==='usd_per_share'?2:undefined);return Number.isInteger(d)&&Number(value.toFixed(d))===value?value.toFixed(d):String(value);};
  const figure=(g,value)=>g.unit==='usd_billion'?`$${shown(g,value)} billion`:g.unit==='percent'?`${shown(g,value)}%`:`$${shown(g,value)}`;
  for(const c of withGuidance){
    const g=c.guidance,dom=parse(renderStockView(snap('next_week','upcoming'),c.ticker));
    const card=byClass(dom,'stock-card')[0],expanded=byClass(card,'expanded-stock')[0];
    const heading=all(expanded,node=>node.tag==='h4').map(text);assert.equal(heading.filter(x=>x===guidanceHeading(g)).length,1,c.ticker);assert.equal(heading.filter(x=>x.startsWith('Company guidance')).length,1,c.ticker);
    const paragraph=text(all(expanded,node=>node.tag==='p'&&text(node).startsWith(g.metric))[0]);
    assert.ok(paragraph.startsWith(`${g.metric}${g.metric_gloss?` (${g.metric_gloss})`:''} for ${g.period}, as stated by the company.`),paragraph);
    assert.equal(paragraph.includes('This is a non-GAAP figure (adjusted by the company, outside standard accounting rules).'),g.non_gaap===true,c.ticker);
    assert.equal(g.issuer_stated_before_midpoint,null);assert.equal(g.issuer_stated_after_midpoint,null);
    assert.equal(g.issuer_states_midpoint,false,`${c.ticker}: the record itself says the company gives no midpoint`);
    assert.ok(paragraph.includes('The company gives this figure as a range, with no midpoint.'),c.ticker);
    assert.doesNotMatch(paragraph,/states ranges only/,`${c.ticker}: the sentence covers this figure only`);
    const change=g.range_midpoint_change;
    const moved=change===0?`stayed at ${figure(g,g.unrounded_range_midpoint_after)}`:`moved from ${figure(g,g.unrounded_range_midpoint_before)} to ${figure(g,g.unrounded_range_midpoint_after)}, ${change>0?'up':'down'} ${g.unit==='percent'?`${shown(g,Math.abs(change))} percentage point${Math.abs(change)===1?'':'s'}`:figure(g,Math.abs(change))}`;
    assert.ok(paragraph.includes(`The middle of its range ${moved}.`),`${c.ticker}: ${paragraph}`);
    assert.ok(paragraph.includes(`Source: ${g.source_label}, linked under Sources read.`));
    assert.ok(paragraph.endsWith("Guidance is the company's own estimate. It does not estimate the stock's return."));
    assert.ok(Math.abs((g.before_range[0]+g.before_range[1])/2-g.unrounded_range_midpoint_before)<1e-9,`${c.ticker} earlier midpoint is the range middle`);
    assert.ok(Math.abs((g.after_range[0]+g.after_range[1])/2-g.unrounded_range_midpoint_after)<1e-9,`${c.ticker} later midpoint is the range middle`);
    assert.ok(Math.abs(g.unrounded_range_midpoint_after-g.unrounded_range_midpoint_before-change)<1e-9,`${c.ticker} change is the midpoint difference`);
    const rows=Object.fromEntries(all(byClass(expanded,'guidance-figures')[0],node=>node.tag==='div').map(row=>[text(all(row,n=>n.tag==='dt')[0]),text(all(row,n=>n.tag==='dd')[0])]));
    assert.ok(rows['Earlier range'].startsWith(`${figure(g,g.before_range[0])} to ${figure(g,g.before_range[1])}`),rows['Earlier range']);
    assert.ok(rows['Later range'].startsWith(`${figure(g,g.after_range[0])} to ${figure(g,g.after_range[1])}`),rows['Later range']);
    assert.equal(rows.Basis,g.basis);
    assert.doesNotMatch(renderStockView(snap('next_week','upcoming'),c.ticker),/computed \(low\+high\)\/2|nothing was rounded by the company/,'the staff rounding note is not shown');
  }
  // Change the data and the text follows it.
  const edited=structuredClone(payload),ko=edited.operating_evidence.hypotheses.find(c=>c.ticker==='KO').guidance;
  Object.assign(ko,{after_range:[10,11],unrounded_range_midpoint_after:10.5,range_midpoint_change:2});
  const html=renderStockView(buildStockSnapshot(edited,'next_week',clocks.upcoming),'KO');
  assert.match(html,/The middle of its range moved from 8\.5% to 10\.5%, up 2 percentage points\./);assert.match(html,/<dd>10% to 11% · stated Jul 28, 2026<\/dd>/);
  // An incomplete record shows no figures at all.
  delete ko.after_range;
  const broken=renderStockView(buildStockSnapshot(edited,'next_week',clocks.upcoming),'KO');
  assert.match(broken,/The guidance record for this case is incomplete\./);assert.doesNotMatch(broken,/guidance-figures|The middle of its range/);
  // A stated midpoint keeps its own rounding note, and an unrounded figure is never rounded.
  const jnj=text(all(parse(renderStockView(buildStockSnapshot(retained,'next_week','2026-10-24T00:00:00Z'),'JNJ')),node=>node.tag==='p'&&text(node).startsWith('Adjusted diluted EPS'))[0]);
  assert.equal(jnj,"Adjusted diluted EPS (earnings per share, profit divided by the number of shares) for FY2026, as stated by the company. This is a non-GAAP figure (adjusted by the company, outside standard accounting rules). The stated midpoint moved from $11.04 to $11.10, up $0.06. The company rounded its earlier midpoint. The range itself gives $11.035, so the $0.06 rise is rounded. Source: the company's Q3 2026 results release, linked under Sources read. Guidance is the company's own estimate. It does not estimate the stock's return.");
  // No guidance figure, period or source name is written into either renderer.
  for(const source of [viewSource,frozenSource]){
    assert.doesNotMatch(source,/\$\d|11\.0[0-9]|11\.035|FY20\d\d|Q3 2026 results release/);
  }
});

test('no hardcoded tickers remain in case-question constants; each card shows its own case_question and main_risk',()=>{
  const tickers=[...new Set([...cases,...retained.operating_evidence.hypotheses,...retained.operating_evidence.caution_watch].map(c=>c.ticker))];
  for(const source of [viewSource,frozenSource]){
    assert.doesNotMatch(source,/CASE_QUESTIONS|previewReview|\bpreviews\s*=/);
    assert.doesNotMatch(source,new RegExp(`\\b(?:${tickers.join('|')})\\s*:\\s*\\{`),'no per-ticker object literal');
    for(const c of [...cases,...retained.operating_evidence.hypotheses,...retained.operating_evidence.caution_watch])assert.ok(!source.includes(c.case_question),`${c.ticker} question is data, not code`);
  }
  for(const c of cases){
    assert.match(c.case_question,/\?$/);assert.ok(c.case_question.trim().split(/\s+/).length<16,`${c.ticker} question under 16 words`);
    assert.doesNotMatch(`${c.case_question} ${c.main_risk}`,rankingWords);
    assert.equal(c.case_text_review_at,operating.checked_at_utc);
  }
  for(const {horizon,state} of states){
    const s=snap(horizon,state),cards=byClass(parse(renderStockView(s)),'stock-card');
    assert.equal(cards.length,s.hypotheses.length);
    for(const card of cards){
      const item=s.hypotheses.find(c=>c.ticker===text(byClass(card,'ticker')[0]));
      assert.equal(text(byClass(card,'stock-thesis')[0]),`Question: ${item.case_question}`);
      assert.equal(text(byClass(card,'stock-risk')[0]),`Risk: ${item.main_risk}.`);
    }
  }
  // A question is bound to the review it was written for: any other review clock gets the neutral fallback.
  const other=snap('next_week','upcoming');other.reviewed_at='2026-11-20T00:00:00Z';
  for(const card of byClass(parse(renderStockView(other)),'stock-card')){
    assert.equal(text(byClass(card,'stock-thesis')[0]),'Question: What evidence would move this case?');
    assert.equal(text(byClass(card,'stock-risk')[0]),'Risk: Operating outlook uncertain.');
  }
  // The old fixture keeps its old questions, IBM's naming the July guidance cut, through both renderers.
  const old=buildStockSnapshot(retained,'next_week','2026-10-24T00:00:00Z');
  const ibm=byClass(parse(renderStockView(old)),'stock-card').find(card=>text(byClass(card,'ticker')[0])==='IBM');
  assert.equal(text(byClass(ibm,'stock-thesis')[0]),'Question: After its July guidance cut, are delayed deals turning into revenue?');
  assert.equal(renderStockView(old),frozenView(old));
});

test('in all three states the desk shows one status, no ranking words, and every limit beside each case',()=>{
  const label={upcoming:'Upcoming',in_progress:'Window in progress',archived:'Archived snapshot'};
  for(const {horizon,state} of states){
    const s=snap(horizon,state);assert.equal(s.status,state,`${horizon}/${state}`);
    for(const query of ['','KO','guidance','zzzz']){
      const html=renderStockView(s,query,{priceSymbols:['IBM','JNJ','NFLX','PG','TSLA','TXN']});
      assert.doesNotMatch(html,/Ranked upside|Top pick|class="tag caution"|stock-shortlist/i);
      assert.doesNotMatch(visible(parse(html)),rankingWords,`${horizon}/${state}/${query}`);
    }
    const dom=parse(renderStockView(s));
    assert.deepEqual(all(dom,node=>hasClass(node,'tag')&&!hasClass(node,'neutral')||(hasClass(node,'tag')&&Object.values(label).includes(text(node)))).map(text),[label[state]]);
    for(const card of byClass(dom,'stock-card')){
      const item=s.hypotheses.find(c=>c.ticker===text(byClass(card,'ticker')[0]));
      const headings=all(byClass(card,'expanded-stock')[0],node=>node.tag==='h4').map(text);
      assert.deepEqual(headings.slice(0,7),['What changed','Event timing','The case for · analyst interpretation','The case against · analyst interpretation','What would prove this case wrong?','What blocks ranking','Macro → industry → company update → event → each share'],item.ticker);
      assert.deepEqual(headings.slice(7),[...(item.review_limits?.length?['Review limits']:[]),'Funding and new shares',...(item.guidance?[guidanceHeading(item.guidance)]:[]),'Sources read'],item.ticker);
      const body=text(card);
      assert.ok(body.includes('What the market expects is unknown. How the price reacted is unknown. Nobody has tested whether this case predicts returns.'));
      assert.ok(body.includes('This case has no rank, price, return or probability.'));
      for(const limit of item.review_limits)assert.ok(body.includes(limit),`${item.ticker}: ${limit}`);
      const rows=all(byClass(card,'missing-inputs')[0],node=>node.tag==='li').map(text);
      assert.ok(rows.includes('Oct 23 daily prices (OHLCV): missing'),rows.join(' | '));
      assert.equal(rows.length,item.gate_reasons.length);
    }
  }
});

test('the BLS notice sits beside each BLS data fact in the macro strip and nowhere else',()=>{
  const notice='BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.';
  const s=snap('next_week','upcoming'),facts=all(byClass(parse(renderStockView(s)),'macro-strip')[0],node=>node.tag==='p');
  assert.equal(facts.length,s.macro_context.length);
  const bls=s.macro_context.filter(item=>s.sources[item.source_ref]?.type==='BLS').map(item=>item.source_ref);
  assert.deepEqual(bls.toSorted(),['bls_eci_q2','bls_empsit','bls_ppi','cpi']);
  facts.forEach((fact,index)=>{
    const item=s.macro_context[index];
    assert.equal(all(fact,node=>node.tag==='span'&&text(node)===notice).length,s.sources[item.source_ref]?.type==='BLS'?1:0,item.source_ref);
  });
  assert.ok(s.macro_context.some(item=>/^The FOMC \(the Federal Reserve committee that sets interest rate policy\) meets on Tuesday and Wednesday, October 27–28, 2026\./.test(item.fact)));
});

test('style.css block B: guidance figures stack on phones and a five-letter ticker never wraps in the call list',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  const block=css.slice(css.indexOf('/* == area:B stock-desk == */'),css.indexOf('/* == end area:B == */'));
  assert.match(block,/\n\.stock-desk \.guidance-figures>div\{display:grid;grid-template-columns:minmax\(0,8rem\) minmax\(0,1fr\)/);
  assert.match(block,/@media \(max-width:480px\)\{\.stock-desk \.guidance-figures>div\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(block,/\n\.stock-desk \.guidance-figures dt\{color:var\(--muted\);font-size:12px\}/,'labels keep the 12 px floor');
  assert.match(block,/\n\.stock-desk \.event-ticker\{white-space:nowrap\}/);
  assert.match(block,/@media \(max-width:680px\)\{\.stock-desk \.event-details>summary\.event-row\{grid-template-columns:minmax\(52px,max-content\) minmax\(0,1fr\) auto\}\}/);
  assert.ok(cases.some(c=>c.ticker.length===5),'the snapshot holds a five-letter ticker');
});

for(const [helper,scenario] of [['ui-B-scenarios.mjs','desk-wrapper-adds-no-ranking-language-current-window'],['interaction-scenarios.mjs','off-view-boundary-at-current-entry']]){
  test(`app scenario on the current snapshot: ${scenario}`,()=>{
    const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL(`./helpers/${helper}`,import.meta.url)),scenario],{encoding:'utf8',env:process.env,timeout:30000});
    assert.equal(result.status,0,result.stderr||result.stdout);
    assert.equal(JSON.parse(result.stdout.trim()).passed,true);
  });
}

test('review corrections: Mastercard currency adds about 1 point, Microsoft free cash flow is after cash paid for equipment, Amazon sterling notes cite their 8-K',()=>{
  const ma=cases.find(c=>c.ticker==='MA'),macro=ma.evidence_chain.find(step=>step.link==='macro');
  assert.equal(macro.text,'Mastercard expects currency to add about 1 percentage point to 2026 net revenue growth (low teens as reported, high end of low double digits currency-neutral). No other link from economic data to Mastercard was established.');
  assert.deepEqual(macro.source_refs,['ma_q2_presentation']);
  assert.doesNotMatch(JSON.stringify(ma),/currency drag|currency headwind/i,'a negative currency row in Mastercard\'s table adds to reported growth');
  const msft=cases.find(c=>c.ticker==='MSFT').funding_check;
  assert.ok(msft.includes('cash flow from operations was $55.4 billion and free cash flow was $19.6 billion after $35.8 billion of cash paid for property and equipment. Capital spending including finance leases was $41 billion.'),msft);
  const money=label=>Number(msft.match(new RegExp(`${label} was \\$([\\d.]+) billion`))[1]);
  assert.equal(Math.round((money('cash flow from operations')-35.8)*10)/10,money('free cash flow'),'free cash flow is operating cash flow less cash paid for property and equipment');
  assert.doesNotMatch(msft,/after \$41 billion/);
  const amzn=cases.find(c=>c.ticker==='AMZN'),source=operating.sources.amzn_gbp_notes_8k;
  assert.ok(amzn.funding_check.includes('A sale of £4.25 billion of sterling notes closed September 14.'),amzn.funding_check);
  assert.ok(amzn.source_refs.includes('amzn_gbp_notes_8k'));
  assert.equal(source.url,'https://www.sec.gov/Archives/edgar/data/1018724/000110465926107526/tm2624614d5_8k.htm');
  assert.equal(source.published_date,'2026-09-14');assert.equal(source.type,'SEC_8K');
  assert.ok(Date.parse(source.published_date)<Date.parse(operating.checked_at_utc));
  const card=byClass(parse(renderStockView(snap('next_week','upcoming'),'AMZN')),'stock-card')[0];
  const links=all(byClass(card,'stock-sources')[0],node=>node.tag==='a').map(node=>node.attrs.href);
  assert.ok(links.includes(source.url),'the 8-K is linked under Sources read');
  const corrections=operating.review_history.filter(entry=>entry.checked_at_utc===operating.checked_at_utc);
  assert.equal(corrections.length,1);assert.match(corrections[0].scope,/Mastercard currency/);assert.match(corrections[0].scope,/Microsoft free cash flow/);assert.match(corrections[0].scope,/sterling notes/);
  assert.equal(operating.review_history.at(-2),corrections[0],'the corrections are recorded in the review history, before the final text fixes');
});

test('each case with rejected research facts says so once, with the right count; the other cases say nothing',()=>{
  const counts={};
  for(const item of events.rejected_research_items)counts[item.ticker]=(counts[item.ticker]||0)+1;
  assert.deepEqual(counts,{KO:2,V:1,CAT:3,AMZN:2,XOM:2,MA:1});
  const words=['One','Two','Three','Four','Five'],rejection=/researched facts? (?:was|were) rejected/;
  for(const c of cases){
    const lines=c.review_limits.filter(limit=>rejection.test(limit));
    if(!counts[c.ticker]){assert.deepEqual(lines,[],c.ticker);continue;}
    assert.equal(lines.length,1,c.ticker);
    assert.match(lines[0],new RegExp(`^${words[counts[c.ticker]-1]} researched facts? (?:was|were) rejected[.:] \\S`),`${c.ticker}: ${lines[0]}`);
    const card=byClass(parse(renderStockView(snap('next_week','upcoming'),c.ticker)),'stock-card')[0];
    assert.ok(text(card).includes(lines[0]),`${c.ticker}: the line is on the card`);
  }
  assert.ok(cases.find(c=>c.ticker==='KO').review_limits.includes('Two researched facts were rejected: the date Jennifer Mann stepped down (a company release and its 8-K disagree) and the scope of a marketing agency change.'));
});

test('case questions read the same before and after results and spell out the period',()=>{
  for(const c of cases){
    assert.match(c.case_question,/^What do /,c.ticker);
    assert.doesNotMatch(c.case_question,/\bwill\b/i,`${c.ticker}: no future tense, so the question stays true after results`);
    assert.doesNotMatch(c.case_question,/\b(?:Q[1-4]|[1-4]Q)\b/,`${c.ticker}: no quarter shorthand on the card front`);
  }
  assert.equal(cases.find(c=>c.ticker==='MSFT').case_question,'What do fiscal first-quarter results under the new segments show against the July outlook?');
  assert.equal(cases.find(c=>c.ticker==='AMZN').case_question,'What do third-quarter results show against the July guidance for sales and operating income?');
  // After each company's own event, while the week is still open, the card asks the same question.
  for(const c of cases){
    const event=Date.parse(c.catalyst.release_at_utc||c.catalyst.webcast_at_utc),after=new Date(Math.max(event,Date.parse(h.entry_at_utc))+60000).toISOString();
    const s=buildStockSnapshot(payload,'next_week',after);assert.equal(s.status,'in_progress',c.ticker);
    const card=byClass(parse(renderStockView(s,c.ticker)),'stock-card')[0];
    assert.equal(text(byClass(card,'stock-thesis')[0]),`Question: ${c.case_question}`,c.ticker);
  }
});

test('the "no midpoint" sentence covers the record\'s own figure and needs the record to say so; a midpoint that was not captured shows as not recorded',()=>{
  const para=html=>text(all(parse(html),node=>node.tag==='p'&&text(node).startsWith('Comparable EPS growth'))[0]);
  const ko=edited=>edited.operating_evidence.hypotheses.find(c=>c.ticker==='KO').guidance;
  const render=edited=>renderStockView(buildStockSnapshot(edited,'next_week',clocks.upcoming),'KO');
  assert.ok(para(render(payload)).includes('The company gives this figure as a range, with no midpoint. The middle of its range moved from 8.5% to 9.5%, up 1 percentage point.'));
  for(const value of [undefined,null,true,'false',0]){
    const edited=structuredClone(payload);
    if(value===undefined)delete ko(edited).issuer_states_midpoint;else ko(edited).issuer_states_midpoint=value;
    const shown=para(render(edited));
    assert.ok(shown.includes("The company's own midpoint for this figure is not recorded here. The middle of its range moved from 8.5% to 9.5%, up 1 percentage point."),`${String(value)}: ${shown}`);
    assert.doesNotMatch(shown,/states ranges only|as a range, with no midpoint|with no midpoint/,String(value));
  }
  // A record that says "no midpoint" and also holds one contradicts itself, so it shows no figures.
  for(const field of ['issuer_stated_before_midpoint','issuer_stated_after_midpoint','issuer_stated_delta']){
    const edited=structuredClone(payload);ko(edited)[field]=9;
    const html=render(edited);
    assert.match(html,/The guidance record for this case is incomplete\./,field);assert.doesNotMatch(html,/guidance-figures|guidance-scope|as a range, with no midpoint|The stated midpoint/,field);
  }
  // A stated midpoint (the retained JNJ record has no flag) keeps its own path.
  const jnj=renderStockView(buildStockSnapshot(retained,'next_week','2026-10-24T00:00:00Z'),'JNJ');
  assert.match(jnj,/The stated midpoint moved from \$11\.04 to \$11\.10, up \$0\.06\./);assert.doesNotMatch(jnj,/not recorded here/);
});

// Literal guidance figures, copied from the independent-check files (verified-<ticker>.json in the
// snapshot work folder). A wrong number that stays self-consistent still fails here.
const verifiedGuidance={
  GOOGL:{unit:'usd_billion',before:[180,190],after:[195,205],stated:['2026-04-29','2026-07-22'],mid:[185,200],change:15,prose:'what_changed',ranges:['$180 billion to $190 billion','$195 billion to $205 billion']},
  KO:{unit:'percent',before:[8,9],after:[9,10],stated:['2026-04-28','2026-07-28'],mid:[8.5,9.5],change:1,prose:'what_changed',ranges:['8% to 9%','9% to 10%']},
  MRK:{unit:'usd_billion',before:[65.8,67.0],after:[66.3,67.3],stated:['2026-04-30','2026-08-04'],mid:[66.4,66.8],change:0.4,prose:'what_changed',ranges:['$65.8 billion to $67.0 billion','$66.3 billion to $67.3 billion']},
  MSFT:{unit:'usd_billion',before:[89.85,90.95],after:[89.85,90.95],stated:['2026-07-29','2026-09-02'],mid:[90.4,90.4],change:0,prose:'what_changed',ranges:['$89.85 billion to $90.95 billion','$89.85 billion to $90.95 billion']},
  XOM:{unit:'usd_billion',before:[27,29],after:[27,29],stated:['2025-12-09','2026-08-03'],mid:[28,28],change:0,prose:'funding_check',ranges:['$27 billion to $29 billion','$27 billion to $29 billion']},
};
test('guidance figures equal the independently checked literals, and the case prose states the same ranges',()=>{
  assert.deepEqual(Object.keys(verifiedGuidance).toSorted(),cases.filter(c=>c.guidance).map(c=>c.ticker).toSorted());
  for(const [ticker,want] of Object.entries(verifiedGuidance)){
    const c=cases.find(item=>item.ticker===ticker),g=c.guidance;
    assert.equal(g.unit,want.unit,ticker);
    assert.deepEqual([g.before_range,g.after_range],[want.before,want.after],ticker);
    assert.deepEqual([g.before_stated_on,g.after_stated_on],want.stated,ticker);
    assert.deepEqual([g.unrounded_range_midpoint_before,g.unrounded_range_midpoint_after],want.mid,ticker);
    assert.equal(g.range_midpoint_change,want.change,ticker);
    for(const range of want.ranges)assert.ok(c[want.prose].includes(range),`${ticker} ${want.prose} states ${range}`);
    const expanded=byClass(byClass(parse(renderStockView(snap('next_week','upcoming'),ticker)),'stock-card')[0],'expanded-stock')[0];
    const rows=Object.fromEntries(all(byClass(expanded,'guidance-figures')[0],node=>node.tag==='div').map(row=>[text(all(row,n=>n.tag==='dt')[0]),text(all(row,n=>n.tag==='dd')[0])]));
    assert.ok(rows['Earlier range'].startsWith(want.ranges[0]),`${ticker}: ${rows['Earlier range']}`);
    assert.ok(rows['Later range'].startsWith(want.ranges[1]),`${ticker}: ${rows['Later range']}`);
  }
});

test('research notes on screen are plain; each original review note is one click away, in a closed "Original note" right after its plain line',()=>{
  const jargon=/WebFetch|\bcurl\b|headless|fetch tool|DTSTART|TZID|StartDate|byte-checked|same bytes|\bHTTP\b|\bHTML\b|\b403\b|sha256|\biCal\b|\bical\b|bot challenge|\bfeed\b|\d{2}:\d{2}Z\b/;
  // Text outside the "Original note" disclosures stays plain.
  const plainText=node=>typeof node==='string'?node:hasClass(node,'original-note')?'':node.children.map(plainText).join('');
  const freshness=state=>summarizeSourceChecks(operating.source_checks,{at:clocks[state],maxCaptureAgeHours:12});
  for(const {horizon,state} of states){
    const s=snap(horizon,state);
    for(const html of [renderStockView(s),renderStockView(s,'',{sourceFreshness:freshness(state)})]){
      const shown=plainText(parse(html));
      assert.doesNotMatch(shown,jargon,`${horizon}/${state}: ${shown.match(jargon)?.[0]}`);
    }
  }
  // The audit fields stay. Each review-limit original names the exact plain line that replaced it.
  const limitAudits=cases.flatMap(c=>(c.review_limits_audit||[]).map(entry=>({c,entry})));
  for(const {c,entry} of limitAudits){
    assert.deepEqual(Object.keys(entry).toSorted(),['original','plain'],c.ticker);
    assert.ok(c.review_limits.includes(entry.plain),`${c.ticker}: the original pairs with a plain line on the card`);
    assert.notEqual(entry.plain,entry.original,c.ticker);
  }
  const sourceAudits=Object.entries(operating.sources).filter(([,source])=>source.audit_note);
  const checkAudits=operating.source_checks.filter(check=>check.audit_note);
  const audits=[...limitAudits.map(({entry})=>entry.original),...sourceAudits.map(([,source])=>source.audit_note),...checkAudits.map(check=>check.audit_note)];
  assert.ok(audits.length>=20,`${audits.length} raw notes kept`);
  assert.ok(audits.filter(note=>jargon.test(note)).length>=15,'the raw tool notes are kept for audit');
  for(const check of checkAudits)assert.notEqual(check.note,check.audit_note,check.id);
  for(const [id,source] of sourceAudits){assert.ok(source.access_note,id);assert.notEqual(source.access_note,source.audit_note,id);}
  // A closed disclosure, a 44 px "Original note" summary, and the original as escaped text.
  const kids=node=>node.children.filter(child=>typeof child!=='string'||child.trim()!=='');
  const oneClick=(container,original,label)=>{
    const notes=kids(container).filter(child=>typeof child!=='string'&&hasClass(child,'original-note'));
    assert.equal(notes.length,1,`${label}: one original note`);
    const note=notes[0];assert.equal(note.tag,'details',label);assert.equal(Object.hasOwn(note.attrs,'open'),false,`${label}: closed`);
    const summary=kids(note)[0];assert.equal(summary.tag,'summary',label);assert.match(text(summary),/^Original note/,label);
    const body=kids(note).filter(child=>typeof child!=='string'&&child.tag==='p');assert.equal(body.length,1,label);assert.equal(text(body[0]),original,label);
    return kids(container)[kids(container).indexOf(note)-1];
  };
  const week=parse(renderStockView(snap('next_week','upcoming'),'',{sourceFreshness:freshness('upcoming')}));
  const cards=byClass(week,'stock-card'),card=ticker=>cards.find(node=>text(byClass(node,'ticker')[0])===ticker);
  for(const {c,entry} of limitAudits){
    const item=all(card(c.ticker),node=>node.tag==='li'&&typeof node.children[0]==='string'&&node.children[0]===entry.plain);
    assert.equal(item.length,1,`${c.ticker}: plain line shown once`);
    assert.equal(oneClick(item[0],entry.original,c.ticker),entry.plain,`${c.ticker}: the original follows its plain line`);
  }
  for(const c of cases)for(const id of c.source_refs.filter(ref=>operating.sources[ref].audit_note)){
    const source=operating.sources[id],rows=all(byClass(card(c.ticker),'stock-sources')[0],node=>node.tag==='li'&&all(node,n=>n.tag==='a'&&n.attrs.href===source.url).length>0);
    assert.equal(rows.length,1,id);
    const before=oneClick(rows[0],source.audit_note,id);
    assert.ok(hasClass(before,'source-date')&&text(before).endsWith(source.access_note),`${id}: the original follows its plain access note`);
  }
  const window=all(week,node=>hasClass(node,'window-details'))[0];
  for(const check of checkAudits){
    const row=all(window,node=>node.tag==='li'&&node.attrs['data-source-id']===check.id)[0],coverage=byClass(row,'source-coverage')[0];
    const before=oneClick(coverage,check.audit_note,check.id);
    assert.ok(before.tag==='p'&&text(before).includes(check.note),`${check.id}: the original follows its plain note`);
  }
  // Without the freshness projection the checks render as a plain list. The originals follow there too.
  const legacy=all(parse(renderStockView(snap('next_week','upcoming'))),node=>hasClass(node,'window-details'))[0];
  for(const check of checkAudits){
    const row=all(legacy,node=>node.tag==='li'&&text(kids(node)[0])===check.name)[0];
    const before=oneClick(row,check.audit_note,check.id);
    assert.ok(before.tag==='p'&&text(before).includes(check.note),`${check.id}: the original follows its plain note`);
  }
  // Originals are escaped, and a copy that matches its plain line adds no disclosure.
  const edited=structuredClone(payload),amzn=edited.operating_evidence.hypotheses.find(c=>c.ticker==='AMZN');
  amzn.review_limits_audit[0].original='<img src=x onerror=alert(1)>Raw & "quoted"';
  const html=renderStockView(buildStockSnapshot(edited,'next_week',clocks.upcoming),'AMZN');
  assert.ok(html.includes('<p>&lt;img src=x onerror=alert(1)&gt;Raw &amp; &quot;quoted&quot;</p>'));assert.doesNotMatch(html,/<img/);
  amzn.review_limits_audit[0].original=amzn.review_limits_audit[0].plain;
  const limits=all(byClass(parse(renderStockView(buildStockSnapshot(edited,'next_week',clocks.upcoming),'AMZN')),'stock-card')[0],node=>node.tag==='li'&&node.children[0]===amzn.review_limits_audit[0].plain);
  assert.equal(limits.length,1);assert.equal(byClass(limits[0],'original-note').length,0);
  // The old snapshot has no audit fields, so it shows no original notes.
  assert.equal(byClass(parse(renderStockView(buildStockSnapshot(retained,'next_week','2026-10-24T00:00:00Z'))),'original-note').length,0);
  // XOM keeps EDGAR, glossed at its only use on the desk.
  assert.ok(cases.find(c=>c.ticker==='XOM').review_limits.some(limit=>limit.includes("EDGAR (the SEC's online system for company filings)")));
});

test('style.css block B: an "Original note" summary is a 44 px target styled like "Original wording"',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  const block=css.slice(css.indexOf('/* == area:B stock-desk == */'),css.indexOf('/* == end area:B == */'));
  assert.match(block,/\n\.stock-desk \.original-note>summary\{display:list-item;width:max-content;max-width:100%;min-height:44px;padding:var\(--space-2,8px\) 0;font-size:12px;line-height:1\.5;font-weight:500;color:var\(--green,#315d49\)\}/);
  assert.match(block,/\n\.stock-desk \.original-note>p\{max-width:68ch;margin:0 0 var\(--space-2,8px\);padding-left:var\(--space-3,12px\);border-left:2px solid var\(--line,#d9dfd5\);font-size:13px;line-height:1\.6;color:var\(--muted,#56655e\)/);
});

test('no case implies a price, a return or a recommendation, in any disclosure or field',()=>{
  const advice=/\b(?:buy|buying|sell|selling|upside|downside|price targets?|target price|expected returns?|forecast\w*|recommend\w*|bullish|bearish|outperform\w*|underperform\w*|overweight|underweight|undervalued|overvalued|top pick)\b/i;
  const sharePrice=/\b(?:closed|closing|trading|traded|trades|shares?|stock) (?:at|near|around|of) \$\d/i;
  const negated=/\b(?:does|do|is|are) not forecast\b/g;
  // Fixed limit sentences in the renderer state that nothing is forecast. Each is literal renderer text.
  const fixed=['Expected return unavailable.','There are no expected returns or probabilities.','Forecast unavailable for every case.'];
  for(const sentence of fixed)assert.ok(viewSource.includes(sentence),sentence);
  assert.ok(viewSource.includes('<div><dt>Expected return</dt><dd>Unavailable</dd></div>'));
  const scrub=node=>typeof node==='string'?node:node.tag==='dl'&&hasClass(node,'stock-metrics')?'':node.children.map(scrub).join(' ');
  for(const {horizon,state} of states){
    const s=snap(horizon,state),dom=parse(renderStockView(s));
    for(const card of byClass(dom,'stock-card')){
      const metrics=Object.fromEntries(all(byClass(card,'stock-metrics')[0],node=>node.tag==='div').map(row=>[text(all(row,n=>n.tag==='dt')[0]),text(all(row,n=>n.tag==='dd')[0])]));
      assert.deepEqual([metrics.Price,metrics['Expected return'],metrics['Chance of gain']],['Unavailable','Unavailable','Unavailable']);
    }
    let shown=scrub(dom);for(const sentence of fixed)shown=shown.split(sentence).join(' ');shown=shown.replace(negated,' ');
    assert.doesNotMatch(shown,advice,`${horizon}/${state}: ${shown.match(advice)?.[0]}`);
    assert.doesNotMatch(shown,sharePrice,`${horizon}/${state}`);
  }
  const strings=(value,path,out=[])=>{if(typeof value==='string')out.push([path,value]);else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value))strings(item,`${path}.${key}`,out);return out;};
  const priceKey=/price|close|quote|target|return|probab|rank/i;
  const numbersUnder=(value,path,out=[])=>{if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(priceKey.test(key)&&typeof item==='number')out.push(`${path}.${key}`);numbersUnder(item,`${path}.${key}`,out);}return out;};
  for(const row of [...cases,...events.candidates]){
    for(const [path,value] of strings(row,row.ticker)){
      assert.doesNotMatch(value.replace(negated,' '),advice,path);
      assert.doesNotMatch(value,sharePrice,path);
    }
    assert.deepEqual(numbersUnder(row,row.ticker),[],`${row.ticker}: no number under a price, close, quote, target, return, probability or rank field`);
  }
});

test('the Prices picker lists the current desk companies first, keeps the October 16 companies and SPY, and every case gets a chart button',()=>{
  const document={querySelector:()=>null,addEventListener(){},removeEventListener(){},createElement(){throw Error('No chart frame expected');}};
  const app=createDeskTools({document,fetch:()=>{throw Error('No request expected');}});
  try{
    const symbols=app.priceSymbols(),tickers=cases.map(c=>c.ticker).toSorted(),old=[...retained.operating_evidence.hypotheses,...retained.operating_evidence.caution_watch].map(c=>c.ticker).toSorted();
    assert.deepEqual(symbols.slice(0,tickers.length),tickers,'the current snapshot companies come first, A to Z');
    assert.deepEqual(symbols.slice(tickers.length),old,'the October 16 companies stay, so older journal entries still chart');
    // Each chart symbol carries the exchange the snapshot verified for that company.
    for(const e of events.candidates){
      assert.equal(hostedSymbol(e.ticker),`${e.exchange}:${e.ticker}`,e.ticker);
      assert.equal(new URL(hostedChartURL(e.ticker)).searchParams.get('symbol'),`${e.exchange}:${e.ticker}`,e.ticker);
    }
    for(const ticker of old)assert.ok(hostedSymbol(ticker),ticker);
    assert.equal(hostedSymbol('SPY'),'AMEX:SPY');assert.equal(hostedSymbol('GOOG'),null,'only the share class the case uses');
    const prices=parse(app.html('prices'));
    const options=all(all(prices,node=>node.attrs?.id==='price-symbol')[0],node=>node.tag==='option').map(node=>node.attrs.value);
    assert.deepEqual(options,symbols,'the picker shows the same order');
    const controls=all(prices,node=>hasClass(node,'desk-controls'))[0],kids=controls.children.filter(child=>typeof child!=='string');
    const note=kids.find(node=>hasClass(node,'desk-roster-note'));
    assert.equal(text(note),'The list starts with the companies on the current stock desk. Companies from the October 16 review come after them.');
    assert.ok(kids.indexOf(note)>kids.findIndex(node=>node.attrs['data-price-form']==='selection'),'the note follows the picker');
    // The desk: every case can open its chart, so no gap line shows.
    for(const {horizon,state} of states){
      const dom=parse(renderStockView(snap(horizon,state),'',{priceSymbols:symbols}));
      assert.deepEqual(all(dom,node=>node.attrs?.['data-price-symbol']).map(node=>node.attrs['data-price-symbol']).toSorted(),tickers);
      assert.equal(byClass(dom,'chart-gap-note').length,0);
    }
    for(const ticker of tickers)assert.equal(app.selectPriceSymbol(ticker),true,ticker);
    // The gap line still names any case a Prices list cannot chart.
    assert.deepEqual(byClass(parse(renderStockView(snap('next_week','upcoming'),'KO',{priceSymbols:old})),'chart-gap-note').map(text),['The Prices page has no chart for this company yet.']);
    assert.deepEqual(byClass(parse(renderStockView(snap('next_week','upcoming'),'',{priceSymbols:old})),'chart-gap-note').map(text),['The Prices page has no chart for these companies yet.']);
    assert.deepEqual(byClass(parse(renderStockView(snap('next_week','upcoming'),'',{priceSymbols:['KO','MA','V','XOM','IBM']})),'chart-gap-note').map(text),['The Prices page has no chart yet for AMZN, CAT, GOOGL, MRK, and MSFT.']);
    for(const html of [renderStockView(snap('next_week','upcoming')),renderStockView(snap('next_week','upcoming'),'zzzz',{priceSymbols:old})])
      assert.equal(byClass(parse(html),'chart-gap-note').length,0,'no line without a Prices list or with no case shown');
    // The October 16 snapshot is still fully charted: six buttons and no line.
    const oldDesk=parse(renderStockView(buildStockSnapshot(retained,'next_week','2026-10-24T00:00:00Z'),'',{priceSymbols:symbols}));
    assert.equal(all(oldDesk,node=>node.attrs?.['data-price-symbol']).length,6);assert.equal(byClass(oldDesk,'chart-gap-note').length,0);
  }finally{app.destroy();}
});

test('Prices opens on the first company of the current stock desk, not a company from an older review',()=>{
  const document={querySelector:()=>null,addEventListener(){},removeEventListener(){},createElement(){throw Error('No chart frame expected');}};
  const app=createDeskTools({document,fetch:()=>{throw Error('No request expected');}});
  try{
    const first=cases.map(c=>c.ticker).toSorted()[0],old=[...retained.operating_evidence.hypotheses,...retained.operating_evidence.caution_watch].map(c=>c.ticker);
    assert.equal(app.priceSymbols()[0],first,'the default is the first company in the picker');
    const prices=parse(app.html('prices'));
    const picked=all(all(prices,node=>node.attrs?.id==='price-symbol')[0],node=>node.tag==='option'&&'selected' in node.attrs).map(node=>node.attrs.value);
    assert.deepEqual(picked,[first],'one company is selected, and it is on the current desk');
    assert.equal(text(all(prices,node=>node.attrs?.id==='hosted-price-heading')[0]),`${first} chart`);
    assert.deepEqual(all(prices,node=>node.attrs?.['data-price-action']==='load-hosted').map(text),[`Load ${first} chart`]);
    assert.ok(!old.includes(first),'the first company is not from the October 16 review');
    for(const ticker of old)assert.doesNotMatch(text(prices),new RegExp(`\\b${ticker} chart\\b`),ticker);
  }finally{app.destroy();}
});

test('the snapshot id names each snapshot\'s own review date',()=>{
  for(const horizon of ['next_day','next_week']){
    assert.equal(snap(horizon,'upcoming').id,`manual-2026-10-26-${horizon}`);
    assert.equal(buildStockSnapshot(retained,horizon,'2026-10-24T00:00:00Z').id,`manual-2026-10-17-${horizon}`);
  }
  assert.equal(operating.checked_at_utc.slice(0,10),'2026-10-26');assert.equal(retained.operating_evidence.checked_at_utc.slice(0,10),'2026-10-17');
  const edited=structuredClone(payload);delete edited.operating_evidence.checked_at_utc;
  assert.equal(buildStockSnapshot(edited,'next_week',clocks.upcoming).id,'manual-undated-next_week','an unreadable review date never borrows another snapshot\'s id');
});

// Final fix round. Each literal below was checked against the cited filing or release:
// Amazon 10-Q (Note 5, debt) and its September 14 8-K; ExxonMobil's October 16 8-K table, its 2Q26 prepared
// remarks and its 10-Q filed August 3; Alphabet's 10-Q; Merck's August 4 release; Merck's September 25 and
// October 21 releases; Microsoft's July 29 call transcript.
test('final fix round: Amazon 2026 debt is restated from its filings, and the undrawn term loan is not counted as debt raised',()=>{
  const amzn=cases.find(c=>c.ticker==='AMZN'),funding=amzn.funding_check;
  for(const issue of ['In March Amazon sold $37.0 billion of U.S. dollar notes and €14.5 billion of euro notes.','It sold CHF2.8 billion of Swiss franc notes in May and C$14.0 billion of Canadian dollar notes in June.','In July it sold $25.0 billion of U.S. dollar notes.','A sale of £4.25 billion of sterling notes closed September 14.'])
    assert.ok(funding.includes(issue),issue);
  // The count is what the filings reviewed show. The May Swiss franc sale had no 8-K and shows only in the 10-Q,
  // so a later sale of that kind would not show until the next 10-Q. The count is never stated as complete.
  assert.ok(funding.startsWith('The filings reviewed show six note sales in 2026.'));
  assert.doesNotMatch(funding,/sold notes six times|six times in 2026|all (?:of )?(?:its|the) note sales/i);
  assert.deepEqual(funding.match(/(?:C?\$|€|CHF|£)\d+\.\d+ billion of [A-Za-z. ]+? notes/g),['$37.0 billion of U.S. dollar notes','€14.5 billion of euro notes','CHF2.8 billion of Swiss franc notes','C$14.0 billion of Canadian dollar notes','$25.0 billion of U.S. dollar notes','£4.25 billion of sterling notes'],'the six sales named are the six counted');
  for(const fact of ['In June Amazon also entered into a $17.5 billion delayed-draw term loan','It could draw it on or before September 30, 2026. Any amount not drawn by then ended. Nothing was borrowed under it at June 30. The filings reviewed do not say whether Amazon drew it.'])
    assert.ok(funding.includes(fact),fact);
  assert.doesNotMatch(funding,/raised debt|debt raised|term loan facility/i);
  const loan=funding.split(/(?<=\.)\s+/).filter(sentence=>/term loan/.test(sentence));
  assert.equal(loan.length,1);assert.doesNotMatch(loan[0],/\b(?:sold|raised|issued)\b/,'the loan sentence never calls it debt sold or raised');
  for(const ref of ['amzn_10q','amzn_gbp_notes_8k'])assert.ok(amzn.source_refs.includes(ref),ref);
  assert.match(operating.sources.amzn_10q.type,/^SEC_10Q/);
});

test('final fix round: corrected facts state what their sources say',()=>{
  const c=Object.fromEntries(cases.map(item=>[item.ticker,item]));
  // ExxonMobil: the October 16 table gives the earnings effect of Middle East volume disruptions as $0.0 billion.
  assert.equal(c.XOM.invalidation_trigger,'A cut to the 2026 buyback plan of about $20 billion, or a third-quarter earnings effect from Middle East volume disruptions worse than the October 16 estimate of no change ($0.0 billion) from the second quarter.');
  assert.ok(c.XOM.source_refs.includes('xom_q3_factors_8k'));
  assert.ok(c.XOM.counter_case.includes("ExxonMobil's net Guyana entitlement volumes fall by about 100 thousand barrels a day in the third quarter."));
  assert.doesNotMatch(c.XOM.counter_case,/from the third quarter/);
  // The basis names the cited source and its date.
  const xg=c.XOM.guidance,cited=operating.sources[xg.source_ref];
  assert.equal(xg.basis,'A non-GAAP measure. The company set the range in its December 2025 plan. Its second-quarter 10-Q, filed August 3, 2026, repeats it.');
  assert.equal(cited.type,'SEC_10Q');assert.equal(cited.published_date,'2026-08-03');assert.equal(xg.after_stated_on,cited.published_date);
  // Alphabet.
  assert.ok(c.GOOGL.funding_check.includes('Purchase commitments and other contractual obligations were $811.0 billion at June 30, of which $200.7 billion was short-term.'));
  assert.doesNotMatch(c.GOOGL.funding_check,/Purchase commitments were/);
  // Merck: the EPS cut is the Terns deal; the April range already held the Cidara charge.
  assert.ok(c.MRK.what_changed.includes('The cut reflects the Terns deal, which the earlier outlook left out. That deal brings a one-time charge of $2.31 a share and about $0.12 a share of costs to finance it and advance MK-4208, a drug candidate from Terns. The April range already included the Cidara charge of $3.62 a share.'));
  assert.doesNotMatch(c.MRK.what_changed,/new EPS range includes one-time charges for the Cidara/);
  assert.ok(c.MRK.positive_case.includes('On September 25 it announced US approval of WELIREG plus LENVIMA. On October 21 it announced European Union approval of KEYTRUDA plus Padcev.'));
  assert.ok(c.MRK.review_limits.some(limit=>/investor event at ESMO.*What Merck said at that event was not reviewed\.$/.test(limit)));
  // Microsoft.
  assert.equal(c.MSFT.main_risk,'Data center capacity limits');
  assert.ok(c.MSFT.positive_case.includes('On the July call it said it continues to expect Azure growth to speed up in the first half of fiscal year 2027 (July to December 2026).'));
  assert.doesNotMatch(c.MSFT.positive_case,/from the second half of fiscal 2026/);
  // Coca-Cola: the event line uses no internal terms.
  const koEvent=c.KO.evidence_chain.find(step=>step.link==='event').text;
  assert.equal(koEvent,'Results come out on October 27 before the New York Stock Exchange opens, with a call at 8:30 a.m. ET (12:30 UTC). Both come before this window opens at 9:30 a.m. ET (13:30 UTC). They are not counted as an event inside this window.');
  assert.doesNotMatch(JSON.stringify(cases),/pre-entry|catalyst badge|in-window/);
  // Guidance periods are written out; glosses add no new jargon.
  for(const item of cases.filter(row=>row.guidance))assert.doesNotMatch(item.guidance.period,/\bFY\s?\d|\bQ[1-4]\b/,item.ticker);
  for(const ticker of ['GOOGL','KO','MRK','XOM'])assert.equal(c[ticker].guidance.period,'fiscal year 2026',ticker);
  assert.equal(c.MSFT.guidance.period,'the quarter ending September 30, 2026 (the first quarter of fiscal year 2027)');
  assert.equal(c.GOOGL.guidance.metric_gloss,'money spent on buildings, servers and equipment');
  assert.equal(c.XOM.guidance.metric_gloss,'cash spent on property, plant, equipment and investments');
  for(const item of cases.filter(row=>row.guidance))assert.doesNotMatch(`${item.guidance.metric_gloss||''} ${item.guidance.basis}`,/capex/i,item.ticker);
  // The record of this round sits after the earlier review entries.
  const last=operating.review_history.at(-1);
  assert.ok(Date.parse(last.checked_at_utc)>Date.parse(operating.checked_at_utc));assert.match(last.scope,/review clock, window, sources and gates are unchanged/);
});

test('final fix round: Merck guidance names its metric and says the same update lowered the EPS range',()=>{
  const want={GOOGL:'Company guidance: capital spending',KO:'Company guidance: comparable EPS growth',MRK:'Company guidance: worldwide sales',MSFT:'Company guidance: total revenue',XOM:'Company guidance: cash capital spending'};
  for(const [ticker,heading] of Object.entries(want)){
    const expanded=byClass(byClass(parse(renderStockView(snap('next_week','upcoming'),ticker)),'stock-card')[0],'expanded-stock')[0];
    assert.deepEqual(all(expanded,node=>node.tag==='h4').map(text).filter(x=>x.startsWith('Company guidance')),[heading],ticker);
    const scope=byClass(expanded,'guidance-scope'),g=cases.find(item=>item.ticker===ticker).guidance;
    assert.equal(scope.length,g.scope_note?1:0,ticker);
  }
  const g=cases.find(item=>item.ticker==='MRK').guidance;
  assert.equal(g.scope_note,'This block covers sales only. The same August 4 update lowered the 2026 non-GAAP EPS range to $2.66 to $2.76, from $5.04 to $5.16. Merck says the new range includes $2.43 a share of Terns deal charges.');
  const html=renderStockView(snap('next_week','upcoming'),'MRK'),expanded=byClass(byClass(parse(html),'stock-card')[0],'expanded-stock')[0];
  const order=all(expanded,node=>node.tag==='h4'&&text(node).startsWith('Company guidance')||hasClass(node,'guidance-scope')||hasClass(node,'guidance-figures')).map(node=>node.tag==='h4'?'heading':node.attrs.class);
  assert.deepEqual(order,['heading','guidance-scope','guidance-figures'],'the note sits inside the block, before the figures');
  assert.equal(text(byClass(expanded,'guidance-scope')[0]),g.scope_note);
  // An incomplete record shows neither figures nor the note.
  const edited=structuredClone(payload),mrk=edited.operating_evidence.hypotheses.find(item=>item.ticker==='MRK').guidance;delete mrk.after_range;
  const broken=renderStockView(buildStockSnapshot(edited,'next_week',clocks.upcoming),'MRK');
  assert.match(broken,/<h4>Company guidance: worldwide sales<\/h4><p>The guidance record for this case is incomplete\./);assert.doesNotMatch(broken,/guidance-scope|guidance-figures/);
});

test('final fix round: GAAP, non-GAAP, interchange and the macro release names are explained at first use',()=>{
  const dom=parse(renderStockView(snap('next_week','upcoming')));
  // In each case the first GAAP or non-GAAP carries a short gloss in brackets.
  for(const card of byClass(dom,'stock-card')){
    const ticker=text(byClass(card,'ticker')[0]),body=text(card),first=body.search(/\b(?:non-)?GAAP\b/);
    if(first<0)continue;
    const after=body.slice(first,first+160);
    assert.match(after,/^(?:non-)?GAAP(?: [\w-]+){0,2} \((?:[^)]*accounting rules|[^)]*by the company)[^)]*\)/,`${ticker}: ${after}`);
  }
  // Interchange is explained where it first appears on the page.
  const page=text(dom),at=page.search(/interchange/i);
  assert.ok(at>=0);assert.match(page.slice(at),/^interchange \(fees card-issuing banks earn on each card payment\)/i);
  // The macro strip explains each release name at its first use.
  const strip=text(byClass(dom,'macro-strip')[0]);
  for(const [term,gloss] of [['FOMC','the Federal Reserve committee that sets interest rate policy'],['H.15',"the Fed's daily table of selected interest rates"],['CPI-U','the consumer price index for all urban consumers'],['PPI','the producer price index, prices that producers receive'],['PCE','the prices people pay for goods and services']]){
    const index=strip.indexOf(term);assert.ok(index>=0,term);
    assert.match(strip.slice(index+term.length),new RegExp(`^(?: price index| release)? \\(${gloss.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\)`),term);
  }
  // H.15 keeps the October 23 release and labels it with that date.
  assert.ok(operating.macro_context.find(item=>item.source_ref==='fed_h15').fact.startsWith("The H.15 release (the Fed's daily table of selected interest rates) of October 23, 2026 shows October 22"));
});
