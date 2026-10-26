import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';
import {createApprovedSlateSlot,renderApprovedResearchView} from '../dist/lib/research-slate-view.js';
import {summarizeSourceChecks} from '../dist/lib/source-freshness.js';
import {at as slateAt,proposal} from './fixtures/research-slate-fixtures.mjs';

// Area B fix round (SP/briefs/fix-rulings.md R-2, R-4, R-11, R-12 and the verifier findings on the desk).
const payload=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const text=node=>typeof node==='string'?node:node.children.map(text).join('');
const hasClass=(node,name)=>(node.attrs?.class||'').split(/\s+/).includes(name);
const byClass=(root,name)=>all(root,node=>hasClass(node,name));
// What a reader sees with every disclosure closed: everything outside <details>, plus each summary.
const visible=node=>typeof node==='string'?node:node.tag==='details'?node.children.filter(child=>typeof child!=='string'&&child.tag==='summary').map(visible).join(' '):node.children.map(visible).join('');
// The served snapshot's three states, from its own horizons: an hour before entry, a minute after
// entry and a minute after the week exit. The retained snapshot keeps its own clocks below.
const shiftClock=(value,ms)=>new Date(Date.parse(value)+ms).toISOString(),horizons=payload.event_evidence.horizons;
const clocks={upcoming:shiftClock(horizons.entry_at_utc,-3600000),in_progress:shiftClock(horizons.entry_at_utc,60000),archived:shiftClock(horizons.week_exit_at_utc,60000)};
const retainedClocks={upcoming:'2026-10-17T04:00:00Z',in_progress:'2026-10-19T15:00:00Z',archived:'2026-10-24T00:00:00Z'};
const symbols=['IBM','JNJ','NFLX','PG','TSLA','TXN'];
const snap=(horizon,state='archived')=>buildStockSnapshot(payload,horizon,clocks[state]);
// The 2026-10-16 snapshot, kept as a fixture for tests that pin its JNJ figures, Oct 16 prices,
// CPI fact, six cases and preview questions.
const retained=JSON.parse(await readFile(new URL('./fixtures/stock-evidence-2026-10-16.json',import.meta.url),'utf8'));
const snapRetained=(horizon,state='archived')=>buildStockSnapshot(retained,horizon,retainedClocks[state]);
const rankingWords=/\b(?:top pick|picks?|ranked|upside|buy|sell|winner|outperform|price target)\b/i;

test('the test clocks give each named state on both snapshots, and the served source checks are valid at the upcoming clock',()=>{
  for(const horizon of ['next_day','next_week'])for(const state of Object.keys(clocks)){
    assert.equal(snap(horizon,state).status,state,`${horizon}/${state}`);
    assert.equal(snapRetained(horizon,state).status,state,`retained ${horizon}/${state}`);
  }
  const summary=summarizeSourceChecks(payload.operating_evidence.source_checks,{at:clocks.upcoming});
  assert.equal(summary.invalidCount,0);assert.equal(summary.missingCount,0);
});

test('R-12: the visible desk carries no ranking or pick word, and the whole render has no "Ranked upside" or "Top pick"',()=>{
  for(const horizon of ['next_day','next_week'])for(const state of Object.keys(clocks))for(const priceSymbols of [[],symbols])for(const query of ['','PG','upgrade','zzzz']){
    const html=renderStockView(snap(horizon,state),query,{priceSymbols}),label=`${horizon}/${state}/${priceSymbols.length}/${JSON.stringify(query)}`;
    assert.doesNotMatch(html,/Ranked upside|Top pick/i,label);
    const shown=visible(parse(html));
    assert.match(shown,/No stock is eligible\./,label);
    assert.doesNotMatch(shown,rankingWords,`${label}: no ranking or pick word on the visible desk`);
  }
});

test('R-12: the whole approved slate render, alone and through the desk entry point, has no "Ranked upside" or "Top pick"',async()=>{
  const slot=createApprovedSlateSlot({readApprovedBytes:async()=>proposal().serialized,clock:()=>Date.parse(slateAt)});assert.equal(await slot.refresh(),true);
  for(const priceSymbols of [[],['AAA','BBB','CCC']])for(const query of ['','AAA','zzzz']){
    for(const html of [renderApprovedResearchView(slot,{horizonId:'next_week',query,priceSymbols}),renderStockView(buildStockSnapshot(payload,'next_week',slateAt),query,{slateSlot:slot,horizonId:'next_week',priceSymbols})]){
      assert.match(html,/approved-research-slate/,'the slate branch rendered');
      assert.doesNotMatch(html,/Ranked upside|Top pick/i);
      assert.doesNotMatch(visible(parse(html)),rankingWords,'no ranking or pick word on the visible slate');
    }
  }
});

for(const scenario of ['desk-wrapper-adds-no-ranking-language','empty-desk-search-offers-clear-search']){
  test(`app scenario: ${scenario}`,()=>{
    const result=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/ui-B-scenarios.mjs',import.meta.url)),scenario],{encoding:'utf8',env:process.env,timeout:30000});
    assert.equal(result.status,0,result.stderr||result.stdout);
    assert.match(result.stdout,new RegExp(`"scenario":"${scenario}","passed":true`));
  });
}

test('R-4: the eligibility line and the review date sit directly under the date, before the state sentence and the times',()=>{
  for(const horizon of ['next_day','next_week'])for(const state of Object.keys(clocks)){
    const card=byClass(parse(renderStockView(snapRetained(horizon,state))),'window-card')[0];
    const blocks=card.children.filter(child=>typeof child!=='string');
    const at=blocks.findIndex(node=>node.tag==='h2');
    assert.deepEqual(blocks.slice(at+1,at+3).map(node=>node.attrs.class),['window-eligibility','window-reviewed'],`${horizon}/${state}`);
    const stateLine=blocks.findIndex(node=>hasClass(node,state==='upcoming'?'window-note':'window-alert'));
    assert.equal(stateLine,at+3,'the state sentence follows the review date');
    assert.equal(blocks[stateLine+1].attrs.class,'window-times','the state sentence still comes before the times');
  }
});

test('R-2: the JNJ figures are the data fields, and the rounding qualifier gives the data range midpoint',()=>{
  const guidance=retained.operating_evidence.hypotheses.concat(retained.operating_evidence.caution_watch).find(row=>row.ticker==='JNJ').guidance;
  const money=value=>`$${value.toFixed(2)}`;
  assert.equal(guidance.unrounded_range_midpoint_before,11.035);
  for(const horizon of ['next_day','next_week']){
    const jnj=byClass(parse(renderStockView(snapRetained(horizon))),'stock-card').find(card=>text(byClass(card,'ticker')[0])==='JNJ');
    const paragraph=text(all(jnj,node=>node.tag==='p'&&text(node).startsWith('Adjusted diluted EPS'))[0]);
    assert.ok(paragraph.includes(`The stated midpoint moved from ${money(guidance.issuer_stated_before_midpoint)} to ${money(guidance.issuer_stated_after_midpoint)}, up ${money(guidance.issuer_stated_delta)}. The company rounded its earlier midpoint. The range itself gives $${guidance.unrounded_range_midpoint_before}, so the ${money(guidance.issuer_stated_delta)} rise is rounded. Source:`),paragraph);
    assert.match(paragraph,/^Adjusted diluted EPS \(earnings per share, profit divided by the number of shares\) for FY2026/,'EPS carries the glossary explanation');
    assert.ok(Math.abs((guidance.before_range[0]+guidance.before_range[1])/2-guidance.unrounded_range_midpoint_before)<1e-9,'the data midpoint is the midpoint of the earlier range');
  }
});

test('R-11: the window details name a paper trade with its gloss, the Nobel limit matches Method with "investment edge" explained, and the kicker names the window as the toggle does',()=>{
  for(const horizon of ['next_day','next_week']){
    const dom=parse(renderStockView(snap(horizon)));
    const paper=all(byClass(dom,'window-details')[0],node=>node.tag==='p'&&text(node).startsWith('A paper'))[0];
    assert.match(text(paper),/^A paper trade \(a practice trade with no real money\) would use this window's opening and closing prices\./);
    assert.doesNotMatch(text(dom),/paper test/);
    // Only the desk's own copy is checked here; the retained data keeps its own wording verbatim.
    const prose=text(all(byClass(dom,'research-context')[0],node=>node.tag==='p')[0]);
    assert.match(prose,/These ideas are background only\. No prize proves an investment edge \(a lasting advantage over the market\) in either window\./);
    assert.equal((text(dom).match(/investment edge/g)||[]).length,1,'the gloss sits at the only use of "investment edge" on the desk');
    for(const own of [text(paper),prose])assert.doesNotMatch(own,/one-day|five-day|five-session|\bsessions?\b|trading edge/);
    assert.equal(text(byClass(dom,'eyebrow')[0]),horizon==='next_day'?'1 trading day':'5 trading days','the kicker uses the toggle\'s name');
    assert.doesNotMatch(renderStockView(snap(horizon)),/-day window/);
  }
});

test('verifier SHOULDs: the in-progress sentence says the opening price has passed, and the gate rows use plain names',()=>{
  const sentence=text(byClass(parse(renderStockView(snapRetained('next_week','in_progress'))),'window-alert')[0]);
  assert.match(sentence,/The cases below were written before it opened\. The time to use that opening price has passed\. A new window needs a new snapshot/);
  assert.doesNotMatch(sentence,/starting point/);
  const gates=retained.operating_evidence.publication_gates;
  for(const horizon of ['next_day','next_week']){
    const html=renderStockView(snapRetained(horizon)),dom=parse(html);
    for(const card of byClass(dom,'stock-card')){
      const rows=all(byClass(card,'missing-inputs')[0],node=>node.tag==='li').map(text);
      assert.ok(rows.includes(`Oct 16 daily prices (OHLCV): ${gates.latest_completed_session_OHLCV}`),rows.join(' | '));
      assert.ok(rows.includes(`Liquidity over the last 60 trading days: ${gates['60_session_consolidated_liquidity']}`),rows.join(' | '));
      assert.ok(rows.includes(`Permission to show market data: ${gates.quote_display_rights.replaceAll('_',' ')}`),rows.join(' | '));
    }
    assert.doesNotMatch(html,/completed-session|60-session|Market-data display rights/);
    // The eligibility note now says what the gates say: the price and liquidity data are missing.
    assert.equal(gates.latest_completed_session_OHLCV,'missing');assert.equal(gates['60_session_consolidated_liquidity'],'missing');
    assert.match(text(byClass(dom,'eligibility-details')[0]),/Data on prices and liquidity \(how easily shares trade without moving the price\) is missing\./);
    assert.doesNotMatch(html,/are not checked yet/);
  }
});

test('verifier NITs: the data conclusion is framed, the review-and-order limit is back, and the event list carries no borrowed clock',()=>{
  for(const horizon of ['next_day','next_week']){
    const snapshot=snap(horizon),dom=parse(renderStockView(snapshot));
    const first=all(byClass(dom,'eligibility-details')[0],node=>node.tag==='p')[0];
    assert.equal(text(first),`From the snapshot: ${snapshot.conclusion}`);
    const prose=text(all(byClass(dom,'research-context')[0],node=>node.tag==='p')[0]);
    assert.match(prose,/The cases are reviewed by hand and listed A to Z\. Neither the review nor the order predicts returns\.$/);
    assert.match(prose,/links company facts and event dates to what is left for each share\./);
    assert.doesNotMatch(prose,/value of one share/);
    const intro=text(byClass(dom,'section-intro').find(node=>!text(node).startsWith('Forecast')));
    assert.match(intro,/ These dates come from this snapshot\. They are not updated\. An earnings call can move a stock up or down\.$/);
    assert.doesNotMatch(text(dom),/listed in the review of/);
  }
});

test('the BLS notice sits beside the CPI fact in the macro strip, and nowhere else in that strip',()=>{
  for(const horizon of ['next_day','next_week']){
    const snapshot=snapRetained(horizon),strip=byClass(parse(renderStockView(snapshot)),'macro-strip')[0];
    const notice='BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.';
    const facts=all(strip,node=>node.tag==='p');assert.equal(facts.length,snapshot.macro_context.length);
    facts.forEach((fact,index)=>{
      const item=snapshot.macro_context[index],bls=snapshot.sources[item.source_ref]?.type==='BLS';
      assert.equal(all(fact,node=>node.tag==='span'&&text(node)===notice).length,bls?1:0,item.source_ref);
      if(bls)assert.match(text(fact),/^September CPI-U increased/);
    });
    assert.equal(facts.filter(fact=>text(fact).includes(notice)).length,1);
  }
});

test('every desk link hides its new-tab glyph from the accessible name, on both source-check paths',()=>{
  const snapshot=snap('next_day','upcoming');
  const name=node=>typeof node==='string'?node:node.attrs?.['aria-hidden']==='true'?'':node.children.map(name).join('');
  const newTabLinks=html=>{const links=all(parse(html),node=>node.tag==='a'&&node.attrs.target==='_blank');assert.ok(links.length>40,`${links.length} links`);return links;};
  for(const html of [renderStockView(snapshot),renderStockView(snapshot,'',{sourceFreshness:summarizeSourceChecks(snapshot.source_checks,{at:clocks.upcoming})})]){
    for(const element of newTabLinks(html)){
      const shown=text(element),accessible=name(element);
      assert.match(shown,/ ↗ \(opens in a new tab\)$/,shown);
      assert.ok(!accessible.includes('↗'),`no glyph in the accessible name: ${accessible}`);
      assert.deepEqual(all(element,node=>node.attrs?.['aria-hidden']==='true').map(text),['↗']);
    }
  }
});

test('an empty desk search shows the shared empty state with Clear search, and no empty events card',()=>{
  for(const horizon of ['next_day','next_week'])for(const query of ['no-such-company-or-phrase','no-results','zzzz']){
    const html=renderStockView(snapRetained(horizon),query),dom=parse(html);
    const empty=byClass(byClass(dom,'stock-list')[0],'search-empty');assert.equal(empty.length,1,`${horizon} ${query}`);
    assert.deepEqual(empty[0].children.filter(child=>typeof child!=='string').map(node=>[node.tag,text(node)]),[['h3','No matches for this search.'],['p','Try a shorter search, or clear it.'],['button','Clear search']]);
    assert.equal(Object.hasOwn(all(empty[0],node=>node.tag==='button')[0].attrs,'data-clear-search'),true);
    assert.equal(byClass(dom,'event-list').length,0,'no empty events card');
    assert.doesNotMatch(html,/No matching stocks|No matching events\./);
  }
  // Cases match but no call does: no events card and no search-empty block.
  let dom=parse(renderStockView(snapRetained('next_week'),'JNJ'));
  assert.equal(byClass(dom,'stock-card').length,1);assert.equal(byClass(dom,'search-empty').length,0);assert.equal(byClass(dom,'event-list').length,0);
  // Calls match but no case does (reachable with the retained data, for example "nasdaq"): the block
  // says no case matches and points to the calls below, so it never claims that nothing matched.
  const partial=[[snapRetained('next_week'),'nasdaq'],[(()=>{const s=snapRetained('next_week');s.hypotheses=s.hypotheses.filter(row=>row.ticker!=='PG');return s;})(),'PG']];
  for(const [snapshot,query] of partial){
    dom=parse(renderStockView(snapshot,query));
    assert.equal(byClass(dom,'stock-card').length,0,query);assert.ok(byClass(dom,'event-item').length>=1,query);
    const block=byClass(dom,'search-empty');assert.equal(block.length,1,query);
    assert.deepEqual(block[0].children.filter(child=>typeof child!=='string').map(node=>[node.tag,text(node)]),[['h3','No company case matches this search.'],['p','Matching earnings calls are listed below.'],['button','Clear search']],query);
    assert.doesNotMatch(text(dom),/No matches for this search/,query);
  }
  // No search and no cases: the list says so plainly and offers no Clear search.
  const none=snapRetained('next_week');none.hypotheses=[];
  const html=renderStockView(none);
  assert.match(html,/<div class="stock-list"><p>No company cases are listed\.<\/p><\/div>/);assert.doesNotMatch(html,/data-clear-search|No matches for this search/);
});

test('case previews apply only to the review they were written for; another review gets the neutral fallback',()=>{
  const snapshot=snapRetained('next_week');snapshot.reviewed_at='2026-11-20T02:40:41.433Z';
  const cards=byClass(parse(renderStockView(snapshot)),'stock-card');assert.equal(cards.length,6);
  for(const card of cards){
    assert.equal(text(byClass(card,'stock-thesis')[0]),'Question: What evidence would move this case?');
    assert.equal(text(byClass(card,'stock-risk')[0]),'Risk: Operating outlook uncertain.');
  }
  const ibm=byClass(parse(renderStockView(snapRetained('next_week'))),'stock-card').find(card=>text(byClass(card,'ticker')[0])==='IBM');
  assert.match(text(byClass(ibm,'stock-thesis')[0]),/July guidance cut/,'the retained review keeps its questions');
});

test('the source-age note uses singular forms at a count of 1 and keeps every other count unchanged',()=>{
  const snapshot=snap('next_day','upcoming');
  const note=freshness=>text(byClass(parse(renderStockView(snapshot,'',{sourceFreshness:freshness})),'source-age-feedback')[0]);
  const base={total:14,staleCount:0,invalidCount:0,missingCount:0,maxCaptureAgeHours:12};
  assert.match(note({...base,staleCount:1,checks:[]}),/1 of 14 sources needs a new check after 12 hours\./);
  assert.match(note({...base,staleCount:2,checks:[]}),/2 of 14 sources need a new check after 12 hours\./);
  assert.match(note({...base,staleCount:1}),/1 of 14 retained capture times is older than 12 hours\./);
  assert.match(note({...base,total:1,staleCount:1}),/1 of 1 retained capture time is older than 12 hours\./);
  assert.match(note({...base,staleCount:3}),/3 of 14 retained capture times are older than 12 hours\./);
  assert.match(note({...base,invalidCount:1}),/1 source clock needs review\./);
  assert.match(note({...base,invalidCount:1,missingCount:1}),/2 source clocks need review\./);
  assert.match(note({...base,staleCount:1,maxCaptureAgeHours:1,checks:[]}),/after 1 hour\./);
});

test('style.css block B: lede spacing for the R-4 order, ink tickers, one mint border, aligned tags and dot-free wrapping on phones',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  const block=css.slice(css.indexOf('/* == area:B stock-desk == */'),css.indexOf('/* == end area:B == */'));
  assert.match(block,/\n\.stock-desk \.window-alert\{margin:0 0 var\(--space-4,16px\)/,'the alert keeps its gap before the times');
  assert.match(block,/\n\.stock-desk \.window-reviewed\{margin:var\(--space-1,4px\) 0 var\(--space-3,12px\)/);
  assert.match(block,/\n\.stock-desk \.ticker\{font-weight:600;color:var\(--ink\)\}/,'a ticker is a label, so it is ink at a scale weight');
  assert.match(block,/\n\.stock-desk \.window-card\{[^}]*border-color:var\(--mint-line,#c7d2c1\)/);
  assert.match(block,/\n\.stock-desk \.window-card>details\{[^}]*border-top:1px solid var\(--mint-line,#c7d2c1\)/);
  assert.match(block,/\.stock-desk \.stock-card-header \.tag\{[^}]*padding:2px 7px/,'tags match the shared tag padding');
  assert.match(block,/@media \(max-width:480px\)\{\.stock-desk \.coverage-strip\{display:flex;flex-wrap:wrap;column-gap:var\(--space-3,12px\)\}\.stock-desk \.coverage-strip>\.coverage-part>span\[aria-hidden\]\{display:none\}\}/);
  assert.match(block,/\n\.stock-desk \.section-label-row\{margin-bottom:var\(--space-3,12px\)/,'section headings get the shared 12 px gap');
  assert.match(block,/\n\.stock-desk \.window-title\{flex-wrap:wrap;gap:var\(--space-2,8px\)\}/,'the kicker row keeps "5 trading days" and its status tag on one line at 320 px');
});
