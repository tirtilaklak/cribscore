import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildStockSnapshot} from '../dist/lib/candidates.js';
import {renderStockView} from '../dist/lib/stock-view.js';
import {createApprovedSlateSlot,renderApprovedResearchView} from '../dist/lib/research-slate-view.js';
import {summarizeSourceChecks} from '../dist/lib/source-freshness.js';
import {at as slateAt,proposal} from './fixtures/research-slate-fixtures.mjs';

// Area B: the stock desk leads with the archived story, keeps every limitation on the page,
// and never shows a rank, a pick or a forecast word. Clocks: upcoming, in progress, archived.
const payload=JSON.parse(await readFile(new URL('../dist/data/stock-evidence.json',import.meta.url),'utf8'));
const parse=html=>JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./fixtures/html-tree.py',import.meta.url))],{input:html,encoding:'utf8'}));
const all=(node,predicate)=>typeof node==='string'?[]:[...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];
const text=node=>typeof node==='string'?node:node.children.map(text).join('');
const hasClass=(node,name)=>(node.attrs?.class||'').split(/\s+/).includes(name);
const byClass=(root,name)=>all(root,node=>hasClass(node,name));
const clocks={upcoming:'2026-10-17T04:00:00Z',in_progress:'2026-10-19T15:00:00Z',archived:'2026-10-24T00:00:00Z'};
const statusLabels={upcoming:'Upcoming',in_progress:'Window in progress',archived:'Archived snapshot',unavailable:'Window unavailable'};
const symbols=['IBM','JNJ','NFLX','PG','TSLA','TXN'];
const snap=(horizon,state)=>buildStockSnapshot(payload,horizon,clocks[state]);
const cases=[];
for(const horizon of ['next_day','next_week'])for(const state of Object.keys(clocks))cases.push({horizon,state});

test('default desk never shows ranking, pick, target or forecast-trading words, with or without price symbols',()=>{
  for(const {horizon,state} of cases)for(const priceSymbols of [[],symbols]){
    const html=renderStockView(snap(horizon,state),'',{priceSymbols});
    for(const banned of ['Ranked upside','TARGET','Caution','Event watch','View price action','accounting fact','Stocks to investigate','No next-day selection','Why no picks','Required inputs missing'])
      assert.ok(!html.includes(banned),`${horizon}/${state}: "${banned}" is gone`);
    assert.doesNotMatch(html,/class="tag caution"|stock-shortlist|aria-label="Exact holding window"/);
  }
});

test('the lede card leads with the status tag, the date, the eligibility line and the review date, then the state sentence before the times',()=>{
  for(const {horizon,state} of cases){
    const snapshot=snap(horizon,state),dom=parse(renderStockView(snapshot));
    const cards=byClass(dom,'window-card');assert.equal(cards.length,1);
    const card=cards[0];assert.equal(card.attrs['aria-label'],'Research window');
    const order=card.children.filter(child=>typeof child!=='string').map(child=>child.tag==='h2'?'h2':(child.attrs.class||'').split(' ')[0]);
    const expected=['window-title','h2','window-eligibility','window-reviewed',state==='upcoming'?'window-note':'window-alert','window-times','eligibility-details','window-details'];
    assert.deepEqual(order,expected,`${horizon}/${state}`);
    assert.equal(text(card.children.find(child=>child.tag==='h2')),horizon==='next_day'?'October 19, 2026':'October 19–23, 2026');
    assert.equal(text(byClass(card,'window-eligibility')[0]),'No stock is eligible. Expected return unavailable.');
    assert.match(text(byClass(card,'window-reviewed')[0]),/^Research checked Oct 16, 2026, 22:40 EDT\.$/);
    assert.equal(text(byClass(card,'eyebrow')[0]),horizon==='next_day'?'1 trading day':'5 trading days');
    const times=byClass(card,'window-times')[0];assert.deepEqual(all(times,n=>n.tag==='span'&&!n.attrs['aria-hidden']).map(text),['Starts at the open','Ends at the close']);
    assert.equal(all(card,n=>n.tag==='details'&&n.attrs.class==='window-details').length,1,'window-details class stays exact');
    assert.equal(byClass(card,'window-alert').length,state==='upcoming'?0:1,'amber alert only for a window that opened or closed');
  }
});

test('each state sentence is plain, dated and points to a new snapshot; unavailable dates get their own sentence',()=>{
  const sentence=html=>{const dom=parse(html);return text(byClass(dom,'window-alert')[0]||byClass(dom,'window-note')[0]);};
  assert.equal(sentence(renderStockView(snap('next_day','upcoming'))),'This window (the trading days this research covers) opens Oct 19, 2026, 09:30 EDT.');
  assert.equal(sentence(renderStockView(snap('next_week','in_progress'))),'This window (the trading days this research covers) opened Oct 19, 2026, 09:30 EDT. The cases below were written before it opened. The time to use that opening price has passed. A new window needs a new snapshot (a new review with its own date).');
  assert.equal(sentence(renderStockView(snap('next_week','archived'))),'This snapshot (a dated review that is not updated) is archived. Its window (the trading days it covered) closed Oct 23, 2026, 16:00 EDT. Nothing on this page is current. A new window needs a new snapshot.');
  const broken=snap('next_day','upcoming');broken.status='unavailable';broken.window.entry_at='invalid';
  const html=renderStockView(broken);
  assert.equal(sentence(html),'The window dates (the trading days this research covers) could not be read. They need review. Treat every case below as background only. A new window needs a new snapshot (a new review with its own date).');
  assert.match(html,/<span class="tag neutral">Window unavailable<\/span>/);assert.match(html,/<h2>Window dates unavailable<\/h2>/);
  assert.match(text(byClass(parse(html),'section-intro')[1]),/^The window dates are unknown, so these calls cannot be placed in the window\. /,'unknown positions make no inside/outside claim');
});

test('exactly one element carries a status label, and it is the current status',()=>{
  for(const {horizon,state} of cases){
    const dom=parse(renderStockView(snap(horizon,state),'',{priceSymbols:symbols}));
    const labelled=all(dom,node=>Object.values(statusLabels).includes(text(node).trim()));
    assert.deepEqual(labelled.map(node=>[node.tag,node.attrs.class,text(node)]),[['span','tag neutral',statusLabels[state]]],`${horizon}/${state}`);
  }
});

test('"Research checked" and the eligibility line sit outside every disclosure',()=>{
  for(const {horizon,state} of cases){
    const dom=parse(renderStockView(snap(horizon,state)));
    const outside=node=>typeof node==='string'?node:node.tag==='details'?'':node.children.map(outside).join('');
    const visible=outside(dom);
    assert.match(visible,/Research checked Oct 16, 2026, 22:40 EDT\./);
    assert.match(visible,/No stock is eligible\. Expected return unavailable\./);
    assert.match(visible,/Forecast unavailable for every case\./);
    assert.match(visible,/0 eligible/);assert.match(visible,/Alphabetical · unranked/);
  }
});

test('"Forecast unavailable" sits outside every case card, also after exact, broad and empty searches',()=>{
  for(const horizon of ['next_day','next_week'])for(const query of ['','PG','  pg ','upgrade','no-such-company-or-phrase']){
    const dom=parse(renderStockView(snap(horizon,'archived'),query));
    const intro=all(dom,node=>node.tag==='p'&&node.attrs.class==='section-intro'&&text(node).startsWith('Forecast unavailable'));
    assert.equal(intro.length,1,`${horizon} ${JSON.stringify(query)}`);
    assert.equal(text(intro[0]),'Forecast unavailable for every case. Each one lacks inputs that ranking needs. Open a case to see what is missing.');
    for(const card of byClass(dom,'stock-card'))assert.doesNotMatch(text(card),/Forecast unavailable/);
  }
});

test('coverage strip names itself for screen readers, hides its dots and sits right above the cases heading',()=>{
  const dom=parse(renderStockView(snap('next_week','archived'))),desk=byClass(dom,'stock-desk')[0];
  const strip=all(dom,node=>node.tag==='p'&&node.attrs.class==='coverage-strip')[0];
  assert.equal(Object.hasOwn(strip.attrs,'aria-label'),false);
  assert.equal(text(byClass(strip,'sr-only')[0]),'Research coverage: ');
  const dots=all(strip,node=>node.tag==='span'&&text(node)==='·');assert.equal(dots.length,3);for(const dot of dots)assert.equal(dot.attrs['aria-hidden'],'true');
  assert.equal(text(strip).replace('Research coverage: ',''),'6 stocks on the list · 6 partly reviewed · 6 blocked · 0 eligible');
  const blocks=desk.children.filter(child=>typeof child!=='string');
  const at=blocks.indexOf(strip);assert.equal(blocks[at-1].attrs.class,'window-card card');
  assert.equal(blocks[at+1].attrs['aria-labelledby'],'cases-heading');
  assert.deepEqual(blocks.map(block=>block.attrs.class||block.attrs['aria-labelledby']),['window-card card','coverage-strip','cases-heading','events-heading','card research-context']);
});

test('every aria-labelledby names a visible heading, ids are unique, and the two method buttons keep distinct focus keys',()=>{
  for(const {horizon,state} of cases){
    const dom=parse(renderStockView(snap(horizon,state))),ids=all(dom,node=>node.attrs?.id).map(node=>node.attrs.id);
    assert.equal(new Set(ids).size,ids.length);
    for(const node of all(dom,node=>node.attrs?.['aria-labelledby'])){
      const target=all(dom,candidate=>candidate.attrs?.id===node.attrs['aria-labelledby']);
      assert.equal(target.length,1);assert.match(target[0].tag,/^h2$/);assert.ok(text(target[0]).trim());
    }
    const method=all(dom,node=>node.attrs?.['data-go']==='methodology');
    assert.deepEqual(method.map(node=>node.attrs.id),['eligibility-method-link','context-method-link']);
    for(const button of method){assert.equal(button.tag,'button');assert.equal(text(button),'How the method works →');assert.equal(all(button,n=>n.attrs?.['aria-hidden']==='true').map(text).join(''),'→');}
  }
});

test('each case card: one neutral "Not eligible" tag, question and risk on the face, dated qualifier, price route after the disclosure',()=>{
  for(const {horizon,state} of cases){
    const snapshot=snap(horizon,state),dom=parse(renderStockView(snapshot,'',{priceSymbols:symbols}));
    const cards=byClass(dom,'stock-card');assert.equal(cards.length,6);
    for(const card of cards){
      const ticker=text(byClass(card,'ticker')[0]);
      assert.equal(card.attrs['aria-label'],`${ticker} case`);
      const tags=all(card,node=>hasClass(node,'tag'));assert.deepEqual(tags.map(tag=>[tag.attrs.class,text(tag)]),[['tag neutral','Not eligible']]);
      assert.equal(byClass(card,'stock-thesis').length,1);assert.match(text(byClass(card,'stock-thesis')[0]),/^Question: .+\?$/);
      assert.equal(byClass(card,'stock-risk').length,1);assert.match(text(byClass(card,'stock-risk')[0]),/^Risk: .+\.$/);
      assert.match(text(byClass(card,'stock-catalyst')[0]),/already public|results about then|earnings call/);
      const top=card.children.filter(child=>typeof child!=='string');
      const details=top.findIndex(node=>node.tag==='details'&&hasClass(node,'stock-details')),button=top.findIndex(node=>node.tag==='button');
      assert.ok(details>=0&&button===details+1,`${ticker}: price route follows the disclosure`);
      assert.equal(top[button].attrs['data-price-symbol'],ticker);assert.equal(text(top[button]),`Price chart for ${ticker}→`);
    }
  }
});

test('IBM keeps the July guidance cut in its question instead of an amber marker',()=>{
  const dom=parse(renderStockView(snap('next_week','archived'))),ibm=byClass(dom,'stock-card').find(card=>text(byClass(card,'ticker')[0])==='IBM');
  assert.equal(text(byClass(ibm,'stock-thesis')[0]),'Question: After its July guidance cut, are delayed deals turning into revenue?');
  assert.equal(text(byClass(ibm,'stock-risk')[0]),'Risk: More delayed deals.');
});

test('card disclosure keeps limits before narrative, equal analyst headings and every no-forecast row',()=>{
  const snapshot=snap('next_week','archived'),dom=parse(renderStockView(snapshot));
  for(const card of byClass(dom,'stock-card')){
    const ticker=text(byClass(card,'ticker')[0]),item=snapshot.hypotheses.find(row=>row.ticker===ticker),expanded=byClass(card,'expanded-stock')[0];
    const headings=all(expanded,node=>node.tag==='h4').map(text);
    const expected=['What changed','Event timing','The case for · analyst interpretation','The case against · analyst interpretation','What would prove this case wrong?','What blocks ranking','Macro → industry → company update → event → each share',
      ...(item.research_application?['How the research notes shape this case']:[]),...(item.review_limits?.length?['Review limits']:[]),'Funding and new shares',...(item.guidance?['Company guidance']:[]),'Sources read'];
    assert.deepEqual(headings,expected,ticker);
    const body=text(expanded);
    assert.ok(body.includes('What the market expects is unknown. How the price reacted is unknown. Nobody has tested whether this case predicts returns. The review covers selected sources only. It does not cover every filing. It does not confirm the stock is easy to trade.'));
    assert.ok(body.includes('This case has no rank, price, return or probability.'));
    const rows=all(byClass(expanded,'stock-metrics')[0],node=>node.tag==='div').map(row=>[text(all(row,n=>n.tag==='dt')[0]),text(all(row,n=>n.tag==='dd')[0])]);
    assert.deepEqual(rows.slice(2),[['Price','Unavailable'],['Expected return','Unavailable'],['Chance of gain','Unavailable']]);
    assert.deepEqual(rows.slice(0,2).map(row=>row[0]),['Window start','Window end']);
    assert.equal(all(byClass(expanded,'missing-inputs')[0],node=>node.tag==='li').length,item.gate_reasons.length);
  }
});

test('JNJ guidance names the non-GAAP basis, keeps all three numbers and drops the staff rounding note',()=>{
  const snapshot=snap('next_week','archived'),html=renderStockView(snapshot,'JNJ'),jnj=byClass(parse(html),'stock-card')[0];
  const guidance=all(jnj,node=>node.tag==='h4'&&text(node)==='Company guidance')[0];assert.ok(guidance);
  const body=text(jnj);
  assert.match(body,/non-GAAP figure \(adjusted by the company, outside standard accounting rules\)/);
  assert.match(body,/The stated midpoint moved from \$11\.04 to \$11\.10, up \$0\.06\./);
  assert.match(body,/Guidance is the company's own estimate\. It does not estimate the stock's return\./);
  assert.ok(snapshot.hypotheses.find(row=>row.ticker==='JNJ').guidance.midpoint_rounding_note);
  assert.doesNotMatch(html,/Do not present \$0\.06|exact unrounded calculation|accounting fact/);
});

test('earnings heading and intro follow the status and the event positions, with no stale "upcoming" wording',()=>{
  const heading=html=>text(all(parse(html),node=>node.attrs?.id==='events-heading')[0]).replace(/\s*\d+$/,'');
  const intro=html=>text(byClass(parse(html),'section-intro').find(node=>!text(node).startsWith('Forecast')));
  for(const horizon of ['next_day','next_week']){
    assert.equal(heading(renderStockView(snap(horizon,'upcoming'))),'Earnings calls ahead');
    for(const state of ['in_progress','archived'])assert.equal(heading(renderStockView(snap(horizon,state))),'Earnings calls in this snapshot');
    const tail=' These dates come from this snapshot. They are not updated. An earnings call can move a stock up or down.';
    assert.equal(intro(renderStockView(snap(horizon,'archived'))),(horizon==='next_day'?'All of these calls fall after this window.':'All of these calls fall inside this window.')+tail);
    assert.equal(intro(renderStockView(snap(horizon,'archived'),'no-such-company-or-phrase')),'No matching event dates.');
  }
  const shifted=snap('next_week','upcoming');shifted.window.entry_at='2026-10-26T13:30:00Z';shifted.window.exit_at='2026-10-30T20:00:00Z';
  assert.match(intro(renderStockView(shifted)),/^All of these calls fall before this window\. /);
  const mixed=snap('next_week','upcoming');mixed.window.exit_at='2026-10-21T20:00:00Z';
  assert.match(intro(renderStockView(mixed)),/^Some calls fall outside this window\. Compare each date with the window times\. /);
});

test('research context carries the Nobel limit beside the Nobel mention and links in-app with an arrow',()=>{
  const dom=parse(renderStockView(snap('next_day','archived'))),context=byClass(dom,'research-context')[0];
  assert.equal(text(all(context,node=>node.tag==='summary')[0]),'Method and economic context');
  const prose=text(all(context,node=>node.tag==='p')[0]);
  assert.ok(prose.indexOf('Ideas from Nobel research')<prose.indexOf('These ideas are background only. No prize proves an investment edge (a lasting advantage over the market) in either window.'));
  assert.match(prose,/The timing and funding rules are our own design choices\. So is the rule that every case has a case against\./);
  const inApp=all(context,node=>node.attrs?.['data-go']==='methodology');assert.equal(inApp.length,1);
  assert.doesNotMatch(text(inApp[0]),/↗/,'no new-tab glyph on an in-app move');
  for(const link of all(context,node=>node.tag==='a'))assert.match(text(link),/↗ \(opens in a new tab\)$/,'external sources keep the new-tab glyph and note');
});

test('window labels name the window as the toggle does; only explicit sessions give another count',()=>{
  const snapshot=snap('next_week','upcoming');
  assert.match(renderStockView(snapshot),/<span class="eyebrow">5 trading days<\/span>/);
  snapshot.window.sessions=Array.from({length:5},(_,i)=>({open:`2026-10-${19+i}T13:30:00Z`,close:`2026-10-${19+i}T20:00:00Z`}));
  assert.match(renderStockView(snapshot),/<span class="eyebrow">5 trading days<\/span>/);
  const day=snap('next_day','upcoming');day.window.sessions=[{open:'2026-10-19T13:30:00Z',close:'2026-10-19T20:00:00Z'}];
  assert.match(renderStockView(day),/<span class="eyebrow">1 trading day<\/span>/);
  // A shorter window: its dates alone never produce a count; checked sessions do.
  const short=snap('next_week','upcoming');short.window.exit_at='2026-10-21T20:00:00Z';
  assert.match(renderStockView(short),/<span class="eyebrow">5 trading days<\/span>/);
  short.window.sessions=Array.from({length:3},(_,i)=>({open:`2026-10-${19+i}T13:30:00Z`,close:`2026-10-${19+i}T20:00:00Z`}));
  assert.match(renderStockView(short),/<span class="eyebrow">3 trading days<\/span>/);
});

test('approved slate mirrors the desk labels and keeps "Unvalidated" on every score line',async()=>{
  const slot=createApprovedSlateSlot({readApprovedBytes:async()=>proposal().serialized,clock:()=>Date.parse(slateAt)});assert.equal(await slot.refresh(),true);
  const html=renderApprovedResearchView(slot,{horizonId:'next_week',priceSymbols:['AAA','BBB','CCC',...symbols]}),dom=parse(html);
  assert.doesNotMatch(html,/View price action|ENTRY · OPEN|EXIT · CLOSE|FIVE EXCHANGE SESSIONS|Stocks to investigate|aria-label="Declared/);
  assert.equal(text(byClass(dom,'eyebrow')[0]),'5 trading days');
  assert.match(text(dom),/Starts at the open.*Ends at the close/s);
  for(const card of byClass(dom,'stock-card')){
    assert.match(text(byClass(card,'stock-status')[0]),/^Research evidence score \d+\/100 · Unvalidated$/);
    const top=card.children.filter(child=>typeof child!=='string'),button=top.findIndex(node=>node.tag==='button');
    if(button>=0){assert.equal(top[button-1].tag,'details');assert.match(text(top[button]),/^Price chart for [A-Z]+→$/);}
  }
  assert.equal(text(byClass(dom,'sr-only').find(node=>text(node).startsWith('Declared'))),'Declared universe and research coverage: ');
});

test('desk copy in the owned sources passes the voice scan',async()=>{
  for(const file of ['../dist/lib/stock-view.js','../dist/lib/research-slate-view.js','./fixtures/stock-view-before-slate.mjs']){
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    assert.ok(!source.includes(String.fromCharCode(0x2014)),`${file}: no em dash`);
    assert.doesNotMatch(source,/\b(delve|leverage|seamless|robust|unlock|empower|elevate|landscape|journey|crucial|pivotal|tapestry|realm|embark|streamline|cutting-edge|game-changer|harness|foster|showcase|comprehensive|holistic|synergy)\b|dive into|in today.s|at the end of the day/i,file);
    assert.doesNotMatch(source,/, not [a-z]|\bnot [^.<]{1,40}\bbut\b/,`${file}: no "X, not Y" or "not X but Y" pivot`);
  }
});

test('style.css block B: appended once, no global token overrides, no text under 12 px, one column, amber only on the alert',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  const start=css.indexOf('/* == area:B stock-desk == */'),end=css.indexOf('/* == end area:B == */');
  assert.ok(start>0&&end>start);assert.equal(css.indexOf('/* == area:B stock-desk == */',start+1),-1);
  const block=css.slice(start,end);
  assert.doesNotMatch(block,/--(ink|muted|paper|white)\s*:/);
  for(const [,size] of block.matchAll(/font-size:(\d+(?:\.\d+)?)px/g))assert.ok(Number(size)>=12,`font-size ${size}px`);
  assert.match(block,/\.stock-desk:not\(\.approved-research-slate\)\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(block,/\.stock-desk \.stock-thesis,\.stock-desk \.stock-risk\{[^}]*font-size:16px/);
  for(const rule of block.match(/[^{}]+\{[^}]*--warn-[^}]*\}/g)||[])assert.match(rule,/^\s*\.stock-desk \.window-alert\{/,rule);
});

// Review fixes (SP/reports/review-B.md S1-S4, N3, N5-N7).
const eventIntro=html=>text(byClass(parse(html),'section-intro').find(node=>!text(node).startsWith('Forecast')));
const eventTail=' These dates come from this snapshot. They are not updated. An earnings call can move a stock up or down.';

test('unknown call positions: unreadable window dates say the calls cannot be placed; a readable window asks the reader to compare dates',()=>{
  for(const field of ['entry_at','exit_at']){
    const broken=snap('next_week','upcoming');broken.status='unavailable';broken.window[field]='invalid';
    const html=renderStockView(broken);
    assert.equal(eventIntro(html),'The window dates are unknown, so these calls cannot be placed in the window.'+eventTail,field);
    assert.doesNotMatch(html,/Compare each date with the window times|calls fall (inside|outside|before|after) this window/,field);
  }
  const reversed=snap('next_week','upcoming');reversed.window.entry_at='2026-10-24T13:30:00Z';
  assert.equal(eventIntro(renderStockView(reversed)),'The window dates are unknown, so these calls cannot be placed in the window.'+eventTail,'an exit before the entry is no readable window');
  const undated=snap('next_week','upcoming');undated.event_watch[0].webcast_at_utc='invalid';
  assert.equal(eventIntro(renderStockView(undated)),'Compare each date with the window times.'+eventTail,'readable window, one unreadable call date');
});

test('calls on both sides of the window with none inside are described as all outside it',()=>{
  const snapshot=snap('next_week','upcoming');snapshot.window.entry_at='2026-10-21T13:30:00Z';snapshot.window.exit_at='2026-10-21T20:00:00Z';
  assert.equal(eventIntro(renderStockView(snapshot)),'None of these calls fall inside this window. Compare each date with the window times.'+eventTail);
});

test('the eligibility note calls partial checks "not fully checked", and Nobel ideas only question prices',()=>{
  for(const horizon of ['next_day','next_week']){
    const html=renderStockView(snap(horizon,'archived')),dom=parse(html);
    assert.match(text(byClass(dom,'eligibility-details')[0]),/Share identity and corporate actions \(events like splits and dividends that change shares\) are not fully checked\. Permission/);
    assert.doesNotMatch(html,/not checked either/);
    for(const card of byClass(dom,'stock-card'))assert.match(text(byClass(card,'missing-inputs')[0]),/Security identity and corporate actions: not fully reconciled/,'the gate rows say the same thing');
    const prose=text(all(byClass(dom,'research-context')[0],node=>node.tag==='p')[0]);
    assert.match(prose,/Ideas from Nobel research help us test claims about the economy\. They also help us question prices that look wrong and evidence chosen to fit a story\. These ideas are background only\./);
    assert.doesNotMatch(prose,/\bspot\b/i);
  }
});

test('event rows share the heading\'s name "Earnings call" and keep the confirmed-webcast detail',()=>{
  for(const horizon of ['next_day','next_week']){
    const html=renderStockView(snap(horizon,'archived')),rows=byClass(parse(html),'event-item');
    assert.equal(rows.length,5);
    for(const row of rows){
      const label=byClass(row,'event-time')[0].children.filter(child=>typeof child!=='string'&&child.tag==='span');
      assert.deepEqual(label.map(text),['Earnings call']);
      assert.match(text(byClass(row,'event-expanded')[0]),/Confirmed webcast · /);
    }
    assert.doesNotMatch(html,/Earnings webcast/);
  }
});

test('source-check lists keep list semantics on both render paths although CSS hides their bullets',()=>{
  const snapshot=snap('next_day','upcoming');
  const paths={default:renderStockView(snapshot),projected:renderStockView(snapshot,'',{sourceFreshness:summarizeSourceChecks(snapshot.source_checks,{at:clocks.upcoming})})};
  for(const [name,html] of Object.entries(paths)){
    const lists=all(parse(html),node=>node.tag==='ul'&&hasClass(node,'source-checks'));
    assert.equal(lists.length,1,name);assert.equal(lists[0].attrs.role,'list',name);
    assert.equal(hasClass(lists[0],'stock-sources'),name==='projected',name);
    assert.equal(lists[0].children.filter(child=>typeof child!=='string'&&child.tag==='li').length,snapshot.source_checks.length,name);
  }
});

test('coverage strip keeps each dot with the item after it, so no line ends on a dot',()=>{
  for(const horizon of ['next_day','next_week']){
    const strip=all(parse(renderStockView(snap(horizon,'archived'))),node=>node.tag==='p'&&node.attrs.class==='coverage-strip')[0];
    const parts=strip.children.filter(child=>typeof child!=='string'&&hasClass(child,'coverage-part'));
    assert.deepEqual(parts.map(text),['· 6 partly reviewed','· 6 blocked','· 0 eligible']);
    for(const part of parts){const dot=part.children[0];assert.equal(dot.tag,'span');assert.equal(dot.attrs['aria-hidden'],'true');assert.equal(text(dot),'·');}
    assert.equal(text(strip).replace('Research coverage: ',''),'6 stocks on the list · 6 partly reviewed · 6 blocked · 0 eligible');
  }
});

test('style.css block B: the slate score line meets the 12 px floor and coverage groups never break inside',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  const block=css.slice(css.indexOf('/* == area:B stock-desk == */'),css.indexOf('/* == end area:B == */'));
  assert.match(css.slice(0,css.indexOf('/* == area:B stock-desk == */')),/\.stock-status\{font-size:11px/,'the base rule this block overrides');
  assert.match(block,/\n\.stock-desk \.stock-status\{font-size:12px\}/);
  assert.match(block,/\n\.stock-desk \.coverage-strip>\.coverage-part\{[^}]*color:inherit[^}]*white-space:nowrap/,'groups keep the strip colour and never wrap inside');
  assert.match(block,/\n\.stock-desk \.coverage-strip span\[aria-hidden\]\{padding:0 6px/,'nested dots keep their spacing');
});

// Orchestrator rulings on the review NITs N1, N2, N4 and N9.
test('JNJ guidance keeps every number, gloss, source and limit, and says the $0.06 rise is rounded; each sources line says some files were not saved',()=>{
  for(const horizon of ['next_day','next_week']){
    const dom=parse(renderStockView(snap(horizon,'archived')));
    const jnj=byClass(dom,'stock-card').find(card=>text(byClass(card,'ticker')[0])==='JNJ');
    const guidance=all(jnj,node=>node.tag==='p'&&text(node).startsWith('Adjusted diluted EPS'));
    assert.deepEqual(guidance.map(text),["Adjusted diluted EPS (earnings per share, profit divided by the number of shares) for FY2026, as stated by the company. This is a non-GAAP figure (adjusted by the company, outside standard accounting rules). The stated midpoint moved from $11.04 to $11.10, up $0.06. The company rounded its earlier midpoint. The range itself gives $11.035, so the $0.06 rise is rounded. Source: the company's Q3 2026 results release, linked under Sources read. Guidance is the company's own estimate. It does not estimate the stock's return."]);
    assert.doesNotMatch(text(dom),/rounds its midpoints/);
    for(const card of byClass(dom,'stock-card')){
      const line=all(card,node=>node.tag==='p'&&hasClass(node,'source-date')&&text(node).startsWith('Research checked'));
      assert.deepEqual(line.map(text),['Research checked Oct 16, 2026, 22:40 EDT. Some publication times are unknown. Some original files were not saved. Permission to use each source is not fully checked. This case has no rank, price, return or probability.']);
    }
  }
});

test('earnings intro drops the dated tail only when no call is listed, and the paper trade is glossed at its first use',()=>{
  for(const horizon of ['next_day','next_week']){
    for(const query of ['no-such-company-or-phrase','no-results']){
      const html=renderStockView(snap(horizon,'archived'),query);
      assert.equal(eventIntro(html),'No matching event dates.',`${horizon} ${query}`);
      assert.doesNotMatch(html,/These dates were listed|They are not updated|An earnings call can move a stock up or down/,`${horizon} ${query}`);
    }
    for(const query of ['','PG'])assert.ok(eventIntro(renderStockView(snap(horizon,'archived'),query)).endsWith(eventTail),`${horizon} ${JSON.stringify(query)} keeps the tail while calls are listed`);
    const dom=parse(renderStockView(snap(horizon,'archived'))),details=byClass(dom,'window-details')[0];
    const paper=all(details,node=>node.tag==='p'&&text(node).includes('paper trade'));
    assert.equal(paper.length,1);
    assert.match(text(paper[0]),/^A paper trade \(a practice trade with no real money\) would use this window's opening and closing prices\. A real order might fill at another price\./);
    assert.equal((text(dom).match(/paper trade/g)||[]).length,1,'the gloss sits at the only use');
    assert.equal(text(byClass(dom,'window-eligibility')[0]),'No stock is eligible. Expected return unavailable.','the lede stays unglossed');
  }
});
