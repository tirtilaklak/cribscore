// Area E (Sources, Library, Method) behaviour on the actual ESM app in the offline
// fake DOM. Real data files only; the clock is set per scenario. No browser or network.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {boot} from './continued-research-harness.mjs';
const project=process.env.CRIBSCORE_PROJECT_ROOT||fileURLToPath(new URL('../../',import.meta.url));
const after='2026-10-23T12:00:00Z';
const codePattern=/\b[a-z]+_[a-z]+(?:_[a-z]+)*\b/;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function openers(app){return app.queryAll('#view-content [data-detail]');}
function assertOpeners(app,label){
  const controls=openers(app);assert.ok(controls.length>0,`${label}: dialog openers exist`);
  for(const control of controls){
    assert.equal(control.tagName,'BUTTON',`${label}: opener is a button`);
    assert.equal(control.getAttribute('aria-haspopup'),'dialog',`${label}: ${control.textContent} announces a dialog`);
    assert.doesNotMatch(control.textContent,/↗/,`${label}: no new-tab glyph on a dialog opener`);
  }
  const names=controls.map(control=>control.textContent.trim());
  assert.equal(new Set(names).size,names.length,`${label}: every opener has its own name`);
}
// First-screen prose keeps to sentences of 25 words or fewer (owner voice rule, ruling R-9).
function assertShortSentences(text,label){
  const sentences=text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);assert.ok(sentences.length>0,`${label}: has text`);
  for(const sentence of sentences){const words=sentence.split(/\s+/).length;assert.ok(words<=25,`${label}: ${words} words in "${sentence}"`);}
}
const scenarios={
  async 'sources-lede-states-the-expired-permission'(){
    const app=await boot({at:after});app.click(app.query('[data-view="evidence"]'));
    const text=app.text(),html=app.html();
    assert.match(text,/No filing fact can be shown right now/);
    assert.match(text,/The permission to show the saved SEC record ended on 17 Oct 2026/);
    assert.match(text,/Until a new review allows it, the record stays hidden\. No number is shown in place of missing evidence\./);
    assert.ok(text.indexOf('No filing fact can be shown right now')<text.indexOf('Company and economic data'),'the lede comes before the registry');
    assert.doesNotMatch(text,codePattern,'no raw reason code in the main view');
    assert.doesNotMatch(html,/Apple|0000320193/,'the withheld issuer is never named');
    assert.equal(app.query('[data-detail="fact-0"]'),null);
    for(const count of ['0 filing facts shown','1 record withheld','25 sources','0 validated investment views'])assert.ok(text.includes(count),count);
    assert.match(html,/<h2>Filing facts/);assert.doesNotMatch(html,/Original filing observations/);
    const intro=app.query('#view-content .view-intro').textContent;assertShortSentences(intro,'sources intro');
    for(const check of [/six checks/,/the company, the period, the units and when it became public/,/The other two cover its provenance \(where a number came from and how it was saved\) and our permission to show it\./,/A past fact can still be useful when no forecast exists\./])assert.match(intro,check,'the intro keeps each of the six checks and the past-fact limit');
    const opener=app.query('[data-detail="evidence-state"]');assert.equal(opener.textContent,'See why');
    app.click(opener);assert.equal(app.query('#detail-dialog').open,true);
    assert.equal(app.query('#detail-title').textContent,'Why no filing fact is shown');assert.equal(app.query('#detail-kicker').textContent,'Filing facts','one name for the filing facts in the dialog');
    assert.match(app.query('#detail-content').textContent,/^A filing fact appears only after it passes every display check\. No placeholder value is shown as a fact\./);
    const item=app.query('#detail-content li');
    assert.match(item.textContent,/^The permission to show the saved SEC record ended on 17 Oct 2026.* display_rights_expired$/,'the code follows its plain sentence');
    assert.equal(app.query('#detail-content code').textContent,'display_rights_expired');
    assert.match(app.query('#detail-content').textContent,/Missing data does not imply a problem at an issuer\. It describes the coverage of this workspace\./);
    app.click(app.query('#close-detail'));assert.equal(app.document.activeElement.dataset.detail,'evidence-state');
    assertOpeners(app,'sources');
  },
  async 'rights-that-end-mid-session-are-explained-from-the-record'(){
    const app=await boot({at:'2026-10-17T23:30:00Z'});app.click(app.query('[data-view="evidence"]'));
    assert.ok(app.query('[data-detail="fact-0"]'),'the record displays while its permission lasts');
    await app.advance(5*60*1000);
    assert.equal(app.query('[data-detail="fact-0"]'),null,'the fact leaves at the expiry boundary');
    assert.match(app.text(),/The permission to show the saved SEC record ended on 17 Oct 2026/);
    assert.doesNotMatch(app.text(),codePattern);assert.doesNotMatch(app.html(),/Apple|0000320193/);
  },
  async 'two-facts-from-one-filing-have-distinct-opener-names'(){
    // Test-only copy of the served record as a second metric from the same 10-K and period, which the rights scope allows.
    const evidence=JSON.parse(await readFile(`${project}/dist/data/sec-evidence.json`,'utf8')),first=evidence.records[0],second=structuredClone(first);
    second.id=`${first.id}-revenue-test-copy`;second.metric={...first.metric,concept:'RevenueFromContractWithCustomerExcludingAssessedTax',label:'Revenue'};second.value=383285;second.source={...first.source,factId:'f-100',location:'Consolidated Statements of Operations, printed page 28; context c-1; fact f-100'};
    const app=await boot({at:'2026-10-17T12:00:00Z',evidencePayload:{...evidence,records:[first,second]}});app.click(app.query('[data-view="evidence"]'));
    const names=app.queryAll('#view-content [data-detail]').filter(control=>control.getAttribute('data-detail').startsWith('fact-')).map(control=>control.textContent);
    const name=metric=>`Evidence and provenance for ${first.issuer.name}, ${metric}, ${first.period.start} to ${first.period.end}`;
    assert.deepEqual(names,[name(first.metric.label),name('Revenue')],'each fact opener names its issuer, metric and period');
    assertOpeners(app,'two facts from one filing');
    app.click(app.query('[data-detail="fact-0"]'));assert.equal(app.query('#detail-title').textContent,'The source behind this fact');
    const rows=app.queryAll('#detail-content dt').map(dt=>dt.textContent);
    for(const label of ['Saved on','SEC filing ID','File fingerprint','Reader version'])assert.ok(rows.includes(label),`plain row label ${label}`);
    assert.match(app.query('#detail-content').textContent,/Display statePassed every display check/);
    assert.doesNotMatch(app.query('#detail-content').textContent,/Successful ingestion|Original accession|Content identity|Parser version|loaded evidence contract/,'no developer labels in the fact dialog');
  },
  async 'a-blocked-capture-note-uses-plain-labels'(){
    // Test-only metadata note for a blocked capture; no real issuer, filing or URL is implied.
    const evidence=JSON.parse(await readFile(`${project}/dist/data/sec-evidence.json`,'utf8'));
    const sourceNote={title:'Synthetic metadata review',issuer:'Synthetic Filer Inc.',cik:'0000000000',form:'10-K',periodEnd:'2025-12-31',accession:'0000000000-26-000001',checkedAt:'2026-10-16T12:00:00Z',url:'https://www.sec.gov/Archives/edgar/data/0/000000000026000001/synthetic.htm',indexUrl:'https://www.sec.gov/Archives/edgar/data/0/000000000026000001/',note:'Test-only note.',checkSemantics:'Test-only timing.',captureStatus:'raw_document_bytes_unavailable'};
    const app=await boot({at:after,evidencePayload:{...evidence,sourceNote}});app.click(app.query('[data-view="evidence"]'));
    const card=app.query('.source-note');assert.ok(card,'the blocked capture shows its filing-review card');
    assert.match(card.textContent,/SEC company ID 0000000000 · Original Form 10-K/);assert.match(card.textContent,/SEC filing ID0000000000-26-000001/);
    assert.match(card.textContent,/We reviewed the original filing\. We have not verified its raw file, the exact context of each fact or its file fingerprint\./);
    assert.match(card.textContent,/A filing to inspect\. Financial facts still withheld\./);
    assert.doesNotMatch(card.textContent,/\bCIK\b|accession|Raw document bytes|content identity/i,'the card explains instead of naming SEC codes');
    assertOpeners(app,'blocked capture');
    app.click(app.query('[data-detail="source-note"]'));const dialog=app.query('#detail-content').textContent;
    for(const pair of ['SEC company ID0000000000','SEC filing ID0000000000-26-000001','Capture stateOriginal document not captured','File fingerprintNot captured','Numeric display eligibilityWithheld'])assert.ok(dialog.includes(pair),pair);
    assert.match(dialog,/What remains missing/);assert.match(dialog,/No financial value may be shown\./);
    assert.doesNotMatch(dialog,/\bCIK\b|accession|source-byte hash|operation evidence|eligible for display/i);
  },
  async 'registry-groups-and-visible-field-search'(){
    const app=await boot({at:after});app.click(app.query('[data-view="evidence"]'));
    const data=app.query('section.registry-group'),research=app.query('details.registry-group');
    assert.equal(data.querySelector('h3').textContent,'Company and economic data');
    assert.deepEqual(data.querySelectorAll('.registry-card').map(card=>card.querySelector('h3').textContent),['FRED / ALFRED','SEC EDGAR'],'data sources first, in data order');
    assert.equal(research.querySelectorAll('.registry-card').length,23);assert.equal(research.open,false);
    assert.equal(research.getAttribute('data-state-key'),'evidence:research-sources');
    assert.match(research.querySelector('summary').textContent,/^Research behind the library · 23$/);
    assert.equal((app.html().match(/class="card registry-card"/g)||[]).length,25);
    assert.match(app.query('.registry-card [data-detail]').textContent,/^Source details for FRED \/ ALFRED$/);
    app.click(app.query('.registry-card [data-detail]'));assert.ok(app.query('#detail-content a'),'the first data source keeps its link');app.click(app.query('#close-detail'));
    app.input('lecture');
    assert.equal(app.query('details.registry-group'),null,'a search never hides matches in a closed group');
    assert.equal(app.queryAll('.registry-card').length,6);assert.match(app.text(),/Research behind the library · 6/);assert.match(app.text(),/6 of 25 sources match this search\./);
    app.input('SEC');assert.equal(app.queryAll('.registry-card').length,1);assert.match(app.text(),/No filing fact can be shown right now/,'the lede is a status and stays during a search');
    app.input('https');assert.equal(app.queryAll('.registry-card').length,0,'hidden URLs do not match');assert.match(app.text(),/No matches for this search\./);
    app.input('2013');assert.equal(app.queryAll('.registry-card').length,0,'only visible fields match');
  },
  async 'rail-keeps-pinned-pairs-and-the-timing-dialog'(){
    const app=await boot({at:after});app.click(app.query('[data-view="evidence"]'));
    const html=app.html();
    assert.match(html,/<dt>Return forecast<\/dt><dd>Unavailable<\/dd>/);assert.match(html,/<dt>Refresh schedule<\/dt><dd>Not configured<\/dd>/);
    assert.doesNotMatch(html,/Selected horizon|library-feature|principle-card/);
    assert.match(app.query('.rail-note').textContent,/daily/);
    assert.equal(app.query('.rail-heading').textContent,'Research status');assert.equal(app.query('aside.rail').getAttribute('aria-label'),'Research status','the read-only rail is named as a status');
    assert.match(app.query('.rail').textContent,/Next earnings release timeNot confirmed/);
    const timing=app.query('[data-detail="timing"]');assert.equal(timing.textContent,'Window dates');
    app.click(timing);assert.equal(app.query('#detail-title').textContent,'Retained snapshot: window dates');assert.equal(app.query('#detail-kicker').textContent,'Timing');
    assert.ok(app.query('#detail-title').textContent.toLowerCase().includes(timing.textContent.toLowerCase()),'the dialog title names what its opener says');
    assert.match(app.query('#detail-content').innerHTML,/<dt>Selected window<\/dt><dd>1 trading day<\/dd>/);
    assert.match(app.query('#detail-content').textContent,/A new window needs a new snapshot\./);
    app.click(app.query('#close-detail'));app.click(app.query('[data-horizon="next_week"]'));app.click(app.query('[data-detail="timing"]'));
    assert.match(app.query('#detail-content').innerHTML,/<dt>Selected window<\/dt><dd>5 trading days<\/dd>/);
  },
  async 'library-cards-without-topic-chips'(){
    const app=await boot({at:after});app.click(app.query('[data-view="library"]'));
    const html=app.html(),cards=app.queryAll('.library-card');
    assert.equal(app.queryAll('[data-topic]').length,0);assert.equal(cards.length,16);
    assert.equal((html.match(/class="card library-card"/g)||[]).length,16);
    assert.ok(html.indexOf('<h2')>-1&&html.indexOf('<h2')<html.indexOf('<h3'),'an h2 precedes the first card heading');
    for(const card of cards){
      assert.match(card.textContent,/Used for: \S/);
      const status=card.querySelectorAll('.library-status');assert.equal(status.length,1);assert.ok(status[0].textContent.trim().length>0);
      assert.match(card.querySelector('.library-year').textContent,/^\d{4} prize$/);
    }
    assert.doesNotMatch(app.text(),/metadata_pending/);assert.match(app.text(),/Awaiting primary check/);
    assert.match(app.text(),/A prize is background only\. It does not show that any Cribscore method works\./);
    assert.match(app.query('#view-content .view-intro').textContent,/^Each note keeps the limits of its source\. A prize is background only\. It does not show that any Cribscore method works\./,'the intro opens with the limits and leaves the page description to the header');
    assert.match(app.text(),/The 2026 entry is waiting for its source check\./);
    assertShortSentences(app.query('#view-content .view-intro').textContent,'library intro');
    assertOpeners(app,'library');
    app.click(app.query('[data-detail="library-nobel-2026"]'));
    assert.match(app.query('#detail-content').textContent,/StatusAwaiting primary check/);assert.doesNotMatch(app.query('#detail-content').textContent,/metadata_pending/);
    assert.match(app.query('#detail-content').textContent,/What this does not establish/);app.click(app.query('#close-detail'));
    app.input('2013');assert.equal(app.queryAll('.library-card').length,1);
    app.input('2026 entry awaits');assert.equal(app.queryAll('.library-card').length,1);
    app.input('takeaway');assert.equal(app.queryAll('.library-card').length,0,'field names do not match');assert.match(app.text(),/No matches for this search\./);
  },
  async 'method-leads-with-its-status'(){
    const app=await boot({at:after});app.click(app.query('[data-view="methodology"]'));
    const html=app.html();
    assert.ok(html.indexOf('method-status')>-1&&html.indexOf('method-status')<html.indexOf('method-application'),'status card precedes the process');
    assert.equal(app.queryAll('.method-application h3').length,7);
    assert.deepEqual(app.queryAll('.method-gates dd').map(dd=>dd.textContent),['Failed','Review required','Unknown','Not run']);
    assert.equal(app.queryAll('.method-gates dt').length,4);
    assert.equal(app.queryAll('[data-detail="gates"]').length,1);assert.ok(app.query('.method-status [data-detail="gates"]'));
    assert.match(app.query('.method-status').textContent,/This method is unproven\..*It does not rank stocks or forecast returns\./);
    assert.equal(app.query('.method-status p').textContent,'This method is unproven. No investment edge (a lasting advantage over the market) is validated. The desk shows research only. It does not rank stocks or forecast returns.','ruling R-3 status, with the R-11 gloss');
    assert.doesNotMatch(app.query('.method-status').textContent,/\buntil\b|\bonce\b|\bwill\b|\bsoon\b|\bnot yet\b/i,'the status card promises no future ranking or forecast');
    assert.equal(app.query('.method-gates-label')?.textContent,'Open checks','the four checks carry a label');
    assertShortSentences(app.query('.method-status p').textContent,'method status');assertShortSentences(app.query('#view-content .view-intro').textContent,'method intro');
    const page=app.text();
    for(const [term,gloss] of [['investment edge',' (a lasting advantage over the market)'],['calibration test',' (a check that stated odds match what really happens)'],['windows',' (the trading days this research covers)'],['unvalidated',' (not proven to work; a test may have failed)']])assert.equal(page.indexOf(term),page.indexOf(term+gloss),`${term} is explained on its first use`);
    assert.doesNotMatch(page,/\b(?:one|five)-day\b|\b\d+-day\b|\bsessions?\b/i,'windows are named in trading days');
    assert.match(page,/Each window, 1 trading day or 5 trading days, needs its own timing and evidence checks\./);
    assert.match(page,/An earlier test used windows of 5 and 21 trading days\. It proves nothing about these two windows\./);
    assert.match(app.text(),/How we use Nobel ideas/);assert.match(app.text(),/No prize proves an investment edge in either window\./);
    assert.match(app.text(),/This rubric is unvalidated \(not proven to work; a test may have failed\)\. It does not estimate returns or the chance of a gain\./);
    assert.match(app.text(),/Our calibration test \(a check that stated odds match what really happens\) failed\. No investment edge is validated\./);
    assert.doesNotMatch(html,/Mechanisms, not return coefficients/);
    app.input('zzzz');
    assert.equal(app.queryAll('.method-card').filter(card=>!card.className.includes('wide-note')).length,6,'practices never filter');
    assert.doesNotMatch(app.text(),/No matches for this search/);
    app.click(app.query('[data-detail="gates"]'));assert.equal(app.query('#detail-title').textContent,'Open checks');
    assert.equal(app.queryAll('#detail-content h3').length,4);assert.match(app.query('#detail-content').textContent,/No empirical forecast study is validated or frozen\./);
  },
  async 'a-second-dialog-opens-at-the-top'(){
    // The close bar is sticky, so focusing it no longer scrolls a reused dialog back up (ruling R-7).
    const app=await boot({at:after});app.click(app.query('[data-view="library"]'));
    const dialog=app.query('#detail-dialog');
    app.click(app.query('[data-detail="library-nobel-2013"]'));assert.equal(dialog.open,true);
    dialog.scrollTop=480;app.click(app.query('#close-detail'));assert.equal(dialog.open,false);
    app.click(app.query('[data-detail="library-nobel-2026"]'));
    assert.equal(dialog.open,true);assert.equal(dialog.scrollTop,0,'the next note opens at its title');
    assert.equal(app.document.activeElement.id,'close-detail','focus still opens on Close');
    dialog.scrollTop=300;app.click(app.query('#close-detail'));assert.equal(app.document.activeElement.dataset.detail,'library-nobel-2026','focus returns to the opener');
    app.click(app.query('[data-view="evidence"]'));app.click(app.query('[data-detail="evidence-state"]'));
    assert.equal(dialog.scrollTop,0,'every dialog kind opens at the top');
  },
  async 'unknown-counts-and-failed-files-show-words'(){
    const held=deferred(),app=await boot({at:after,requests:{evidence:[held.promise]}});app.click(app.query('[data-view="evidence"]'));
    assert.match(app.text(),/Filing facts shown: Not loaded/);assert.match(app.text(),/Records withheld: Not loaded/);assert.match(app.text(),/25 sources/);
    assert.match(app.text(),/Checking the filing record/);assert.doesNotMatch(app.text(),/\b0 filing facts shown/);
    const lost=await boot({at:after,requests:{evidence:[{ok:false,status:503,json:async()=>({})}]}});lost.click(lost.query('[data-view="evidence"]'));assert.match(lost.text(),/The evidence records did not load/);assert.match(lost.text(),/No filing fact is shown\. Use Retry evidence records above\. No number is shown in place of missing evidence\./);assert.match(lost.text(),/Records withheld: Not loaded/);
    const none=await boot({at:after,evidencePayload:{schemaVersion:'1.0',status:'blocked',records:[],blockers:['x']}});none.click(none.query('[data-view="evidence"]'));assert.match(none.text(),/No SEC filing has been captured for this desk yet\. No number is shown in place of missing evidence\./);assert.match(none.text(),/0 records withheld/);
    const failed=await boot({at:after,failImport:url=>url.endsWith('/nobel-corpus.js')});failed.click(failed.query('[data-view="evidence"]'));
    assert.match(failed.text(),/Sources: Not loaded/);assert.match(failed.text(),/The source list did not load/);assert.equal(failed.queryAll('.registry-card').length,0);
    failed.click(failed.query('[data-view="library"]'));assert.match(failed.text(),/Research notes unavailable/);assert.match(failed.text(),/The library did not load\. Use Retry research notes above\./);assert.doesNotMatch(failed.text(),/being prepared/);
    failed.click(failed.query('[data-view="methodology"]'));assert.match(failed.text(),/The seven steps did not load\./);assert.ok(failed.query('[data-detail="gates"]'),'the gates dialog stays reachable');
    assert.equal(failed.queryAll('.method-application h3').length,0);
    assert.ok(failed.query('[data-retry="research"]'),'the page offers Retry research notes');
    failed.click(failed.query('[data-detail="gates"]'));const gates=failed.query('#detail-content').textContent;
    assert.match(gates,/^The list of open checks did not load\. Use Retry research notes on the page\./,'the dialog says why it has no checks');
    assert.match(gates,/No empirical forecast study is validated or frozen\.$/);assert.equal(failed.queryAll('#detail-content h3').length,0);
  }
};
const name=process.argv[2];assert.ok(Object.hasOwn(scenarios,name),`known scenario ${name}`);await scenarios[name]();console.log(JSON.stringify({scenario:name,passed:true}));
